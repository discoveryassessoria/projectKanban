// src/app/api/gerenciamento/catalogo-fases/[id]/route.ts
//
// Edição e exclusão de uma fase do catálogo (fonte única de fases).
// GUARDAS (não destrutivo):
//  - `phaseKey` é IMUTÁVEL depois de criada: é a chave que os fluxos (FaseMacro),
//    workflows internos, automações e o runtime usam. Renomear quebraria vínculos.
//  - excluir só é permitido se NENHUM fluxo usar a fase (senão devolve 409 e a UI
//    sugere inativar, que tira do seletor sem apagar nada).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { efeitoExiste } from '@/src/lib/motor/catalogo-de-efeitos'
import { publicarRevisaoCatalogoFase, statusDeAtivo } from '@/src/lib/motor/catalogo-fase-revisao'
import { enqueueReconciliacaoCatalogoFase, type EnqueueResultadoCatalogoFase } from '@/src/lib/motor/reconciliar-fase-macro'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

/** Sobre o que uma fase pode operar. Mesmo vocabulário do enum EscopoExecucao. */
const ESCOPOS_VALIDOS = ['PROCESSO', 'PESSOA', 'NECESSIDADE', 'DOCUMENTO'] as const as readonly string[]

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.catalogoFase.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Fase não encontrada.' }, { status: 404 })

    const b = await request.json().catch(() => ({}))
    const usosAtuais = await prisma.faseMacro.count({ where: { phaseKey: atual.phaseKey } })

    // ESCOPO DE FASE EM USO — decisão estrutural, não clique acidental.
    //
    // Trocar o escopo muda sobre quantas entidades a fase materializa: de PROCESSO
    // para DOCUMENTO, um roteiro vira N. Desde a correção 20/09/2026 (mandato
    // "Catálogo de Fases") isto é SEGURO — a publicação da revisão nova dispara
    // reconciliação automática que preserva 100% a instância antiga (histórico,
    // tarefas, anexos, responsáveis) e materializa a obrigação nova num ciclo
    // NOVO, sem tocar no que já existia (ver enqueueReconciliacaoCatalogoFase,
    // caso `escopoMudou`, coberto por scripts/reconciliacao-escopo-documento.test.ts).
    // Ainda assim, é decisão estrutural demais para um clique sem querer: exige
    // confirmação explícita quando a fase já está em uso.
    const escopoPedido = b?.escopo !== undefined ? String(b.escopo).trim().toUpperCase() : null
    const escopoRealmenteMudou = escopoPedido != null && escopoPedido !== (atual.escopo ?? '')
    if (escopoRealmenteMudou && usosAtuais > 0 && b?.confirmarMudancaEscopo !== true) {
      return NextResponse.json(
        {
          error: `A fase "${atual.label}" é usada em ${usosAtuais} fluxo(s). Mudar o escopo materializa diferente para os processos em andamento. Envie confirmarMudancaEscopo: true para confirmar — a reconciliação automática preserva o histórico e só cria o que estiver faltando.`,
          code: 'ESCOPO_EM_USO',
          usos: usosAtuais,
        },
        { status: 409 },
      )
    }
    if (escopoPedido && !ESCOPOS_VALIDOS.includes(escopoPedido)) {
      return NextResponse.json({ error: `Escopo inválido. Use um de: ${ESCOPOS_VALIDOS.join(', ')}.` }, { status: 400 })
    }

    // RÓTULO OBRIGATÓRIO — explícito, nunca fallback silencioso para o valor
    // antigo (mandato "Catálogo de Fases", correção 20/09/2026: "impossibilidade
    // de publicar revisão inválida"). Enviar `label` vazio é erro, não "manter o
    // que já tinha" — o admin precisa saber que o campo não foi aceito.
    if (b?.label !== undefined && String(b.label).trim() === '') {
      return NextResponse.json({ error: 'O rótulo da fase não pode ficar vazio.', code: 'ROTULO_OBRIGATORIO' }, { status: 400 })
    }
    // ORDEM VÁLIDA — explícita. `NaN`/negativo não vira silenciosamente "mantém a
    // ordem antiga": é rejeitado, para o admin corrigir o valor que digitou.
    if (b?.ordemPadrao !== undefined && (!Number.isFinite(Number(b.ordemPadrao)) || Number(b.ordemPadrao) < 0)) {
      return NextResponse.json({ error: 'A ordem da fase precisa ser um número válido, maior ou igual a zero.', code: 'ORDEM_INVALIDA' }, { status: 400 })
    }
    // EFEITOS PERMITIDOS EXPLICITAMENTE — uma chave que não existe no catálogo é
    // erro do admin (chave digitada errada, ou efeito renomeado), não algo a
    // descartar em silêncio e publicar como se o pedido tivesse sido atendido.
    if (b?.efeitosPermitidos !== undefined) {
      if (!Array.isArray(b.efeitosPermitidos)) {
        return NextResponse.json({ error: 'Efeitos permitidos precisa ser uma lista.', code: 'EFEITOS_INVALIDOS' }, { status: 400 })
      }
      const desconhecidos = b.efeitosPermitidos.filter((k: unknown) => typeof k !== 'string' || !efeitoExiste(k))
      if (desconhecidos.length > 0) {
        return NextResponse.json(
          { error: `Efeito(s) inexistente(s) no catálogo: ${desconhecidos.join(', ')}.`, code: 'EFEITOS_INVALIDOS' },
          { status: 400 },
        )
      }
    }

    // ATIVO É A ENTRADA; STATUS É A FONTE (mandato "Catálogo de Fases", 20/09/2026).
    // Mantidos em sincronia por quem escreve — nunca duas verdades. `ativo:false`
    // grava `status:INATIVA`/`RASCUNHO`; `ativo:true` PUBLICA.
    const ativoPedido = b?.ativo !== undefined ? !!b.ativo : atual.ativo

    // PUBLICAÇÃO EXIGE EFEITO EXPLÍCITO — nenhuma fase fica PUBLICADA sem pelo
    // menos um efeito marcado (correção 20/09/2026, bug 3: "sem declaração =
    // pode tudo" está definitivamente eliminado; a contrapartida é que "sem
    // declaração" também não pode virar publicação vazia por omissão).
    const efeitosResultantes = (Array.isArray(b?.efeitosPermitidos) ? b.efeitosPermitidos : atual.efeitosPermitidos) as string[] | null
    if (ativoPedido && (efeitosResultantes ?? []).length === 0) {
      return NextResponse.json(
        { error: `A fase "${atual.label}" não pode ser publicada sem nenhum efeito selecionado. Marque pelo menos um efeito permitido.`, code: 'EFEITOS_OBRIGATORIOS_PARA_PUBLICAR' },
        { status: 400 },
      )
    }

    const dadosNovos = {
      label: b?.label !== undefined ? String(b.label).trim() : atual.label,
      ordemPadrao: b?.ordemPadrao !== undefined ? Number(b.ordemPadrao) : atual.ordemPadrao,
      requiredPadrao: b?.requiredPadrao !== undefined ? !!b.requiredPadrao : atual.requiredPadrao,
      conditionalPadrao: b?.conditionalPadrao !== undefined ? !!b.conditionalPadrao : atual.conditionalPadrao,
      descricao: b?.descricao !== undefined ? (String(b.descricao).trim() || null) : atual.descricao,
      escopo: escopoPedido ? (escopoPedido as never) : atual.escopo,
      // COMPETÊNCIA DA FASE — quais efeitos os passos dela podem executar. Já
      // validada acima (só chega aqui uma lista 100% de chaves existentes).
      efeitosPermitidos: Array.isArray(b?.efeitosPermitidos)
        ? (b.efeitosPermitidos as never)
        : (atual.efeitosPermitidos as never),
      ativo: ativoPedido,
      status: statusDeAtivo(ativoPedido, atual.status) as never,
    }

    const usuario = await extrairUsuarioComPermissoes(request)
    const { fase, revisaoNova, mudou: mudouAlgo } = await prisma.$transaction((tx) =>
      publicarRevisaoCatalogoFase(tx, atual, dadosNovos, usuario?.userId ?? null),
    )
    const usos = await prisma.faseMacro.count({ where: { phaseKey: fase.phaseKey } })

    // REGRA MASTER — publicação válida dispara reconciliação automática dos
    // processos em andamento aplicáveis (mandato "Catálogo de Fases", correção
    // 20/09/2026). Só quando algo de fato mudou (revisão nova) e só DEPOIS do
    // commit da revisão — nunca antes, para não reconciliar contra uma revisão
    // que pode não ter sido publicada de verdade (transação podia falhar).
    let reconciliacao: EnqueueResultadoCatalogoFase | null = null
    if (mudouAlgo) {
      reconciliacao = await enqueueReconciliacaoCatalogoFase({
        phaseKey: fase.phaseKey,
        catalogoFaseId: fase.id,
        revisaoAnterior: atual.revisaoAtual,
        revisaoNova,
        escopoMudou: escopoRealmenteMudou,
        publicadoPorId: usuario?.userId ?? null,
      })
    }

    // INATIVAR é um fato diferente de EDITAR: é o que tira a fase das configurações
    // novas sem apagar nada, e é o que se procura no histórico depois. NÃO remove a
    // fase de nenhum FaseMacro que já a use — isso é decisão separada (composição do
    // Workflow Macro), e mexer nela aqui apagaria de qual fluxo a fase saiu.
    const desativou = atual.ativo && !fase.ativo
    const ativou = !atual.ativo && fase.ativo
    const acao = desativou ? 'PHASE_DISABLED' : ativou ? 'PHASE_ACTIVATED' : 'PHASE_UPDATED'
    await prisma.logAuditoria.create({
      data: {
        acao,
        entidade: 'CatalogoFase', entidadeId: fase.id,
        descricao: desativou
          ? `Fase "${fase.label}" inativada (revisão ${revisaoNova}). Continua no histórico e nos processos existentes; só não aparece para novas configurações.${usos > 0 ? ` Ainda usada em ${usos} fluxo(s) — remova-a da composição em Workflow Macro se a intenção é parar de exigi-la em processos não iniciados.` : ''}`
          : ativou
          ? `Fase "${fase.label}" publicada/ativada (revisão ${revisaoNova}, ${(fase.efeitosPermitidos as string[] | null)?.length ?? 0} efeito(s) permitido(s)). Passa a ser ofertada em fluxo novo.`
          : `Fase "${fase.label}" alterada (chave ${fase.phaseKey}, imutável)${mudouAlgo ? `, revisão ${revisaoNova}` : ' — nenhum campo relevante mudou'}.`,
        detalhes: { antes: atual, depois: fase, usos, revisao: revisaoNova, reconciliacao } as never,
        usuarioId: usuario?.userId ?? null,
      },
    }).catch(() => null)
    return NextResponse.json({ fase: { ...fase, usos }, reconciliacao })
  } catch (e) {
    console.error('PUT catalogo-fases/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar a fase.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.catalogoFase.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Fase não encontrada.' }, { status: 404 })

    const usos = await prisma.faseMacro.count({ where: { phaseKey: atual.phaseKey } })
    if (usos > 0) {
      return NextResponse.json(
        { error: `Esta fase é usada em ${usos} fluxo(s). Inative-a em vez de excluir.` },
        { status: 409 },
      )
    }
    await prisma.catalogoFase.delete({ where: { id } })
    const usuario = await extrairUsuarioComPermissoes(request)
    await prisma.logAuditoria.create({
      data: {
        acao: 'PHASE_DELETED', entidade: 'CatalogoFase', entidadeId: id,
        descricao: `Fase "${atual.label}" (chave ${atual.phaseKey}) excluída do cadastro. Nenhum fluxo a usava.`,
        detalhes: { antes: atual } as never, usuarioId: usuario?.userId ?? null,
      },
    }).catch(() => null)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE catalogo-fases/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir a fase.' }, { status: 500 })
  }
}
