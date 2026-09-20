// src/app/api/gerenciamento/catalogo-fases/route.ts
//
// CATÁLOGO DE FASES (CatalogoFase) — cadastro ÚNICO das fases do sistema.
// ARQUITETURA: fases são cadastradas EXCLUSIVAMENTE aqui (Gerenciamento →
// Processos → Estrutura → Fases). O Workflow apenas REFERENCIA estas fases
// (Workflow Macro monta a sequência a partir deste catálogo). Nenhum outro
// módulo cria cadastro paralelo de fases.
//
// Aditivo: usa a tabela CatalogoFase que já existia (antes só semeada/lida pelo
// bootstrap de /api/gerenciamento/workflow-macro). Nenhuma migration.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { EQUIVALENCIA_LEGADA } from '@/src/lib/process-stage/verificar-phasekeys'
import { efeitoExiste } from '@/src/lib/motor/catalogo-de-efeitos'

/** Sobre o que uma fase pode operar. Mesmo vocabulário do enum EscopoExecucao. */
const ESCOPOS_VALIDOS = ['PROCESSO', 'PESSOA', 'NECESSIDADE', 'DOCUMENTO'] as const as readonly string[]


// "Emissão de Certidões" -> "emissao_de_certidoes"
function slug(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// GET — catálogo completo + em quantos fluxos (FaseMacro) cada fase é usada.
// O "usos" é o que impede exclusão silenciosa de uma fase em produção.
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [fases, usos] = await Promise.all([
      prisma.catalogoFase.findMany({ orderBy: [{ ordemPadrao: 'asc' }, { label: 'asc' }] }),
      prisma.faseMacro.groupBy({ by: ['phaseKey'], _count: { _all: true } }),
    ])
    const usoPorKey = new Map(usos.map((u) => [u.phaseKey, u._count._all]))
    return NextResponse.json({
      fases: fases.map((f) => ({ ...f, usos: usoPorKey.get(f.phaseKey) ?? 0 })),
    })
  } catch (e) {
    console.error('GET catalogo-fases', e)
    return NextResponse.json({ error: 'Erro ao carregar o catálogo de fases.' }, { status: 500 })
  }
}

// POST — cria uma fase no catálogo.
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json().catch(() => ({}))
    const label = String(b?.label || '').trim()
    if (!label) return NextResponse.json({ error: 'Informe o nome da fase.' }, { status: 400 })

    // NORMALIZADA SEMPRE — mesmo quando o admin informa a chave manualmente. É a
    // brecha exata que deixou "TESTEVIS_fase" (maiúsculas inconsistentes) nascer:
    // só o caminho automático (a partir do label) passava por `slug()`. Nenhuma
    // chave nova nasce com dependência de caixa daqui em diante.
    const phaseKey = (slug(String(b?.phaseKey || '').trim()) || slug(label)).slice(0, 60)
    if (!phaseKey) return NextResponse.json({ error: 'Não foi possível gerar a chave da fase.' }, { status: 400 })

    const jaExiste = await prisma.catalogoFase.findUnique({ where: { phaseKey } })
    if (jaExiste) return NextResponse.json({ error: `Já existe uma fase com a chave "${phaseKey}".` }, { status: 409 })

    // CHAVE LEGADA: `retificacao` é o nome antigo de `retificacao_registros`. Deixar
    // criar de novo é reabrir o defeito que custou três macrofluxos.
    const legada = EQUIVALENCIA_LEGADA[phaseKey]
    if (legada) {
      return NextResponse.json(
        { error: `"${phaseKey}" é a chave antiga de "${legada}". Use a fase canônica em vez de recriá-la.`, code: 'CHAVE_LEGADA', canonica: legada },
        { status: 422 },
      )
    }

    // ESCOPO: sem ele a fase existe e não é utilizável. Exigir na criação evita o
    // cadastro pela metade que só aparece como erro lá na frente, no fluxo.
    const escopo = String(b?.escopo || '').trim().toUpperCase()
    if (!ESCOPOS_VALIDOS.includes(escopo)) {
      return NextResponse.json(
        { error: `Informe sobre o que a fase opera: ${ESCOPOS_VALIDOS.join(', ')}.`, code: 'ESCOPO_OBRIGATORIO' },
        { status: 400 },
      )
    }

    // EFEITOS PERMITIDOS EXPLICITAMENTE — ausência de declaração significa [],
    // nunca "todos". Chave que não existe no catálogo é erro do admin, recusado,
    // nunca filtrado em silêncio (mesma regra do PUT).
    let efeitosPermitidos: string[] = []
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
      efeitosPermitidos = b.efeitosPermitidos
    }

    // NOVA FASE NASCE SEMPRE RASCUNHO (mandato "Catálogo de Fases", correção
    // 20/09/2026, bug 3) — nunca publicada diretamente na criação, mesmo que o
    // corpo peça `ativo:true`. Publicar é a edição seguinte (PUT), que exige
    // pelo menos um efeito explicitamente selecionado.
    const usuario = await extrairUsuarioComPermissoes(request)
    const fase = await prisma.$transaction(async (tx) => {
      const criada = await tx.catalogoFase.create({
        data: {
          phaseKey,
          label,
          descricao: b?.descricao ? String(b.descricao).trim() : null,
          escopo: escopo as never,
          ordemPadrao: Number.isFinite(Number(b?.ordemPadrao)) ? Number(b.ordemPadrao) : 0,
          requiredPadrao: b?.requiredPadrao !== false,
          conditionalPadrao: !!b?.conditionalPadrao,
          efeitosPermitidos: efeitosPermitidos as never,
          ativo: false,
          status: 'RASCUNHO' as never,
          revisaoAtual: 1,
        },
      })
      await tx.catalogoFaseRevisao.create({
        data: {
          catalogoFaseId: criada.id, revisao: 1, phaseKey: criada.phaseKey, label: criada.label,
          descricao: criada.descricao, escopo: criada.escopo, ordemPadrao: criada.ordemPadrao,
          requiredPadrao: criada.requiredPadrao, conditionalPadrao: criada.conditionalPadrao,
          status: criada.status, efeitosPermitidos: criada.efeitosPermitidos as never,
          congeladoPorId: usuario?.userId ?? null, origem: 'CRIACAO',
        },
      })
      return criada
    })
    await prisma.logAuditoria.create({
      data: {
        acao: 'PHASE_CREATED', entidade: 'CatalogoFase', entidadeId: fase.id,
        descricao: `Fase "${fase.label}" criada como RASCUNHO (chave ${fase.phaseKey}, opera sobre ${escopo}, ${efeitosPermitidos.length} efeito(s) selecionado(s)). Publique-a para oferecê-la em fluxo novo.`,
        detalhes: { depois: fase } as never, usuarioId: usuario?.userId ?? null,
      },
    }).catch(() => null)
    return NextResponse.json({ fase: { ...fase, usos: 0 } }, { status: 201 })
  } catch (e) {
    console.error('POST catalogo-fases', e)
    return NextResponse.json({ error: 'Erro ao criar a fase.' }, { status: 500 })
  }
}
