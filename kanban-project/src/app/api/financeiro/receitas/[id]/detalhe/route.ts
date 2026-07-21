// src/app/api/financeiro/receitas/[id]/detalhe/route.ts
// GET /api/financeiro/receitas/[id]/detalhe
//
// Payload ÚNICO do Drawer de detalhes do lançamento: resumo financeiro,
// composição do cálculo (produzida pelo FinanceRuleEngine — nunca recalculada
// aqui nem no frontend), origem/rastreabilidade, requerentes considerados,
// parcelas, recebimentos, histórico e as ações permitidas com seus motivos.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withRetry } from '@/lib/db-retry'
import { origemOperacionalDoLancamento } from '@/lib/financeiro/supressao-motor'
import { rotularPhaseKey } from '@/lib/financeiro/apresentacao-lancamento'

type RouteContext = { params: Promise<{ id: string }> }

interface Composicao {
  linhas: Array<{ rotulo: string; detalhe?: string; valor: number }>
  total: number
  moeda: string
  requerentes?: number
  regra?: string
}

/**
 * Lê a composição CONGELADA pelo motor (contextoAplicado + campos de freeze).
 * Somente leitura: nenhum valor é recalculado — se o motor não registrou, a
 * seção informa isso em vez de inventar um cálculo.
 */
function montarComposicao(r: {
  valor: unknown
  moeda: string
  valorUnitario: unknown
  quantidade: unknown
  valorTotalCongelado: unknown
  contextoAplicado: unknown
}): Composicao | null {
  const ctx = (r.contextoAplicado && typeof r.contextoAplicado === 'object' && !Array.isArray(r.contextoAplicado))
    ? (r.contextoAplicado as Record<string, unknown>)
    : null
  const n = (v: unknown) => (v == null ? 0 : Number(v))
  const total = n(r.valorTotalCongelado) || n(r.valor)

  // Honorários por requerente: base + adicionais (contexto gravado pelo motor).
  if (ctx && ctx.fonte === 'honorario_cidadania_italiana') {
    const req = Number(ctx.requerentes ?? 0)
    const base = Number(ctx.valorBase ?? 0)
    const adic = Number(ctx.valorAdicional ?? 0)
    const extras = Math.max(0, req - 1)
    return {
      linhas: [
        { rotulo: '1 requerente incluído no valor base', valor: base },
        {
          rotulo: `${extras} ${extras === 1 ? 'requerente adicional' : 'requerentes adicionais'}`,
          detalhe: extras > 0 ? `${extras} × ${adic.toFixed(2)}` : undefined,
          valor: Number((extras * adic).toFixed(2)),
        },
      ],
      total,
      moeda: r.moeda,
      requerentes: req,
      regra: 'Honorários — Cidadania Italiana',
    }
  }

  // Composição genérica congelada: valor unitário × quantidade.
  const vu = n(r.valorUnitario)
  const qt = n(r.quantidade)
  if (vu > 0 && qt > 0) {
    return {
      linhas: [{ rotulo: `${qt} × valor unitário`, detalhe: vu.toFixed(2), valor: Number((vu * qt).toFixed(2)) }],
      total,
      moeda: r.moeda,
    }
  }
  return null
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id: idStr } = await ctx.params
    const id = Number(idStr)
    if (!id || isNaN(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

    const receita = await withRetry(() =>
      prisma.receita.findUnique({
        where: { id },
        include: {
          parcelas: { orderBy: { numero: 'asc' } },
          requerentes: { orderBy: { idx: 'asc' } },
          eventos: { orderBy: { createdAt: 'desc' } },
          pessoa: { select: { id: true, nome: true, sobrenome: true } },
          tipoServico: { select: { id: true, nome: true } },
          documento: { select: { id: true, tipo: true } },
          processo: {
            select: {
              id: true, codigo: true, nome: true, pais: true, arvoreId: true,
              tipoProcessoMotor: { select: { id: true, name: true } },
            },
          },
        },
      }),
    )
    if (!receita) return NextResponse.json({ error: 'Receita não encontrada' }, { status: 404 })

    // ── origem / rastreabilidade ──────────────────────────────────────────
    const origem = await origemOperacionalDoLancamento('receita', id)

    const [fase, tabela, config, atorCancelamento] = await Promise.all([
      receita.phaseKey
        ? prisma.catalogoFase.findUnique({ where: { phaseKey: receita.phaseKey }, select: { label: true } })
        : Promise.resolve(null),
      receita.pricingRuleId
        ? prisma.tabelaValor.findUnique({
            where: { id: receita.pricingRuleId },
            select: { id: true, modoCalculo: true, natureza: true, vigenciaInicio: true, vigenciaFim: true, prioridade: true, arquivado: true },
          })
        : Promise.resolve(null),
      receita.configFinanceiraId
        ? prisma.produtoFinanceiro.findUnique({ where: { id: receita.configFinanceiraId }, select: { id: true, nome: true, moedaPadrao: true } })
        : Promise.resolve(null),
      receita.canceladoPorId
        ? prisma.usuario.findUnique({ where: { id: receita.canceladoPorId }, select: { id: true, nome: true } })
        : Promise.resolve(null),
    ])

    // ── requerentes considerados no cálculo ───────────────────────────────
    // Preferência: os congelados no lançamento. Fallback: os marcados na árvore
    // (fonte única do motor). Ascendentes não-requerentes nunca aparecem.
    let requerentesConsiderados = receita.requerentes.map((r) => ({
      id: r.id,
      nome: r.nome,
      statusFamiliar: r.statusFamiliar,
      percentual: Number(r.percentual),
    }))
    if (requerentesConsiderados.length === 0 && receita.processo?.arvoreId) {
      const pessoas = await prisma.pessoa.findMany({
        where: { arvoreId: receita.processo.arvoreId, requerente: { in: ['maior', 'menor'] } },
        select: { id: true, nome: true, sobrenome: true, requerente: true },
        orderBy: { id: 'asc' },
      })
      requerentesConsiderados = pessoas.map((p) => ({
        id: p.id,
        nome: `${p.nome} ${p.sobrenome ?? ''}`.trim(),
        statusFamiliar: p.requerente === 'menor' ? 'menor' : 'maior',
        percentual: 100,
      }))
    }

    // ── ações permitidas + motivo do bloqueio ─────────────────────────────
    const temRecebimento = receita.parcelas.some((p) => p.status === 'RECEBIDA' || p.status === 'PAGA')
    const jaCancelado = receita.canceladoEm != null || receita.cancelada
    const jaEstornado = receita.estornadoEm != null
    const geradoPeloMotor = receita.origem === 'motor'

    let motivoBloqueioCancelamento: string | null = null
    if (jaEstornado) motivoBloqueioCancelamento = 'Este lançamento já foi estornado.'
    else if (jaCancelado) motivoBloqueioCancelamento = 'Este lançamento já está cancelado.'
    else if (temRecebimento) motivoBloqueioCancelamento = 'Este lançamento não pode ser cancelado porque possui um recebimento registrado. Use o estorno.'
    else if (geradoPeloMotor && origem?.ativa) {
      motivoBloqueioCancelamento = `Este lançamento continua sendo exigido pela regra financeira ativa (${origem.descricao}). Corrija a origem operacional ou registre uma supressão autorizada ao cancelar.`
    }

    const acoes = {
      podeCancelar: !jaCancelado && !jaEstornado && !temRecebimento,
      /** Cancelar exige registrar supressão porque a regra ativa recriaria o lançamento. */
      exigeSupressao: !jaCancelado && !jaEstornado && !temRecebimento && geradoPeloMotor && (origem?.ativa ?? false),
      podeEstornar: !jaEstornado && temRecebimento,
      podeEditarParcelas: !jaCancelado && !jaEstornado && !temRecebimento,
      podeRegistrarRecebimento: !jaCancelado && !jaEstornado && receita.parcelas.some((p) => p.status === 'PENDENTE'),
      podeRevogarSupressao: origem?.supressao != null,
      motivoBloqueioCancelamento,
      motivoBloqueioParcelas: temRecebimento
        ? 'O parcelamento não pode ser alterado porque já existe recebimento registrado.'
        : jaCancelado ? 'Lançamento cancelado.' : null,
    }

    return NextResponse.json({
      receita: {
        ...receita,
        composicao: montarComposicao(receita),
      },
      requerentesConsiderados,
      origem: {
        processo: receita.processo
          ? {
              id: receita.processo.id,
              codigo: receita.processo.codigo,
              nome: receita.processo.nome,
              pais: receita.processo.pais,
              tipo: receita.processo.tipoProcessoMotor?.name ?? null,
            }
          : null,
        phaseKey: receita.phaseKey,
        faseLabel: receita.phaseKey ? (fase?.label ?? rotularPhaseKey(receita.phaseKey)) : null,
        servico: receita.tipoServico?.nome ?? null,
        documento: receita.documento ? { id: receita.documento.id, tipo: receita.documento.tipo } : null,
        configuracaoFinanceira: config,
        tabelaPrecos: tabela,
        regraFinanceira: origem
          ? { descricao: origem.descricao, ruleKind: origem.ruleKind, ruleSource: origem.ruleSource, ruleId: origem.ruleId }
          : null,
        eventoOperacional: receita.eventoOperacionalId ?? (origem?.event ?? null),
        criadoEm: receita.createdAt,
        atualizadoEm: receita.updatedAt,
        dataReferencia: receita.dataReferencia,
        // Informação TÉCNICA — a UI mantém recolhida, nunca como dado principal.
        tecnico: {
          chaveIdempotencia: receita.chaveIdempotencia,
          automaticKey: origem?.automaticKey ?? null,
          artefatoId: origem?.artefatoId ?? null,
          modoCalculoAplicado: receita.modoCalculoAplicado,
          naturezaPreco: receita.naturezaPreco,
        },
      },
      supressao: origem?.supressao ?? null,
      origemAtiva: origem?.ativa ?? false,
      cancelamento: jaCancelado
        ? { em: receita.canceladoEm, motivo: receita.canceladoMotivo, por: atorCancelamento?.nome ?? null }
        : null,
      estorno: jaEstornado ? { em: receita.estornadoEm, motivo: receita.estornoMotivo } : null,
      acoes,
    })
  } catch (err) {
    console.error('[GET /api/financeiro/receitas/[id]/detalhe] erro:', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
