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

    // ESCOPO DE FASE EM USO NÃO MUDA POR TELA.
    //
    // Trocar o escopo muda sobre quantas entidades a fase materializa: de PROCESSO
    // para DOCUMENTO, um roteiro vira N. Processos em execução materializaram com o
    // escopo antigo, e a mudança os pegaria no meio do caminho — a fase mudaria de
    // forma debaixo deles. Enquanto a fase não estiver em fluxo nenhum, é cadastro
    // livre; depois disso, é decisão estrutural e não passa por aqui.
    const escopoPedido = b?.escopo !== undefined ? String(b.escopo).trim().toUpperCase() : null
    if (escopoPedido && escopoPedido !== (atual.escopo ?? '') && usosAtuais > 0) {
      return NextResponse.json(
        {
          error: `A fase "${atual.label}" é usada em ${usosAtuais} fluxo(s). Mudar o escopo mudaria como ela materializa nos processos em andamento.`,
          code: 'ESCOPO_EM_USO',
        },
        { status: 409 },
      )
    }
    if (escopoPedido && !ESCOPOS_VALIDOS.includes(escopoPedido)) {
      return NextResponse.json({ error: `Escopo inválido. Use um de: ${ESCOPOS_VALIDOS.join(', ')}.` }, { status: 400 })
    }

    const fase = await prisma.catalogoFase.update({
      where: { id },
      // phaseKey NÃO entra no update — chave estável (vínculo com fluxos/runtime).
      data: {
        label: b?.label !== undefined ? String(b.label).trim() || atual.label : atual.label,
        ordemPadrao: b?.ordemPadrao !== undefined && Number.isFinite(Number(b.ordemPadrao)) ? Number(b.ordemPadrao) : atual.ordemPadrao,
        requiredPadrao: b?.requiredPadrao !== undefined ? !!b.requiredPadrao : atual.requiredPadrao,
        conditionalPadrao: b?.conditionalPadrao !== undefined ? !!b.conditionalPadrao : atual.conditionalPadrao,
        slaDiasPadrao: b?.slaDiasPadrao !== undefined && Number.isFinite(Number(b.slaDiasPadrao)) ? Number(b.slaDiasPadrao) : atual.slaDiasPadrao,
        descricao: b?.descricao !== undefined ? (String(b.descricao).trim() || null) : atual.descricao,
        escopo: escopoPedido ? (escopoPedido as never) : atual.escopo,
        // COMPETÊNCIA DA FASE — quais efeitos os passos dela podem executar. Recusa
        // chave que não existe no catálogo: uma competência inventada não protegeria
        // nada e ainda daria a impressão de estar protegendo.
        efeitosPermitidos: Array.isArray(b?.efeitosPermitidos)
          ? (b.efeitosPermitidos.filter((k: unknown) => typeof k === 'string' && efeitoExiste(k)) as never)
          : (atual.efeitosPermitidos as never),
        ativo: b?.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })
    const usos = await prisma.faseMacro.count({ where: { phaseKey: fase.phaseKey } })

    // INATIVAR é um fato diferente de EDITAR: é o que tira a fase das configurações
    // novas sem apagar nada, e é o que se procura no histórico depois.
    const usuario = await extrairUsuarioComPermissoes(request)
    const desativou = atual.ativo && !fase.ativo
    await prisma.logAuditoria.create({
      data: {
        acao: desativou ? 'PHASE_DISABLED' : 'PHASE_UPDATED',
        entidade: 'CatalogoFase', entidadeId: fase.id,
        descricao: desativou
          ? `Fase "${fase.label}" inativada. Continua no histórico e nos processos existentes; só não aparece para novas configurações.`
          : `Fase "${fase.label}" alterada (chave ${fase.phaseKey}, imutável).`,
        detalhes: { antes: atual, depois: fase, usos } as never,
        usuarioId: usuario?.userId ?? null,
      },
    }).catch(() => null)
    return NextResponse.json({ fase: { ...fase, usos } })
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
