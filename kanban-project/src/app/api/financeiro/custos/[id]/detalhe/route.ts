// src/app/api/financeiro/custos/[id]/detalhe/route.ts
// GET /api/financeiro/custos/[id]/detalhe
//
// PARIDADE COM RECEITA: devolve o MESMO envelope de
// /api/financeiro/receitas/[id]/detalhe, para que a Central de Operação do
// lançamento seja um só componente servindo as duas naturezas.
//
// A chave `receita` do envelope significa "o LANÇAMENTO" — mantida com esse
// nome de propósito, para não duplicar os 9 componentes do modal.
//
// Somente leitura: composição, condição de pagamento, taxas e memória são
// CONGELADAS pelo FinanceRuleEngine na criação. Nada é recalculado aqui.

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

/** Composição CONGELADA pelo motor. Sem recálculo — espelha a da receita. */
function montarComposicao(c: {
  valor: unknown
  moeda: string
  valorUnitario: unknown
  quantidade: unknown
  valorTotalCongelado: unknown
  contextoAplicado: unknown
}): Composicao | null {
  const ctx =
    c.contextoAplicado && typeof c.contextoAplicado === 'object' && !Array.isArray(c.contextoAplicado)
      ? (c.contextoAplicado as Record<string, unknown>)
      : null
  const n = (v: unknown) => (v == null ? 0 : Number(v))
  const total = n(c.valorTotalCongelado) || n(c.valor)
  if (!total) return null

  const qtd = n(c.quantidade)
  const unit = n(c.valorUnitario)
  if (qtd > 0 && unit > 0) {
    return {
      linhas: [
        {
          rotulo: qtd === 1 ? 'Valor unitário' : `${qtd} × valor unitário`,
          detalhe: qtd > 1 ? `${qtd} × ${unit.toFixed(2)}` : undefined,
          valor: Number((qtd * unit).toFixed(2)),
        },
      ],
      total,
      moeda: c.moeda,
      regra: typeof ctx?.fonte === 'string' ? String(ctx.fonte) : undefined,
    }
  }
  return { linhas: [{ rotulo: 'Valor do lançamento', valor: total }], total, moeda: c.moeda }
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id: idStr } = await ctx.params
    const id = Number(idStr)
    if (!id || isNaN(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

    const custo = await withRetry(() =>
      prisma.custo.findUnique({
        where: { id },
        include: {
          parcelas: { orderBy: { numero: 'asc' } },
          eventos: { orderBy: { createdAt: 'desc' } },
          pessoa: { select: { id: true, nome: true, sobrenome: true } },
          tipoServico: { select: { id: true, nome: true } },
          documento: { select: { id: true, tipo: true } },
          processo: {
            select: {
              id: true, codigo: true, nome: true, pais: true,
              tipoProcessoMotor: { select: { name: true } },
            },
          },
        },
      }),
    )
    if (!custo) return NextResponse.json({ error: 'Custo não encontrado' }, { status: 404 })

    const origem = await origemOperacionalDoLancamento('custo', id).catch(() => null)

    const [fase, tabela, config] = await Promise.all([
      custo.phaseKey
        ? prisma.catalogoFase.findUnique({ where: { phaseKey: custo.phaseKey }, select: { label: true } })
        : Promise.resolve(null),
      custo.pricingRuleId
        ? prisma.tabelaValor.findUnique({
            where: { id: custo.pricingRuleId },
            select: { id: true, modoCalculo: true, natureza: true, vigenciaInicio: true, vigenciaFim: true, arquivado: true },
          })
        : Promise.resolve(null),
      custo.configFinanceiraId
        ? prisma.produtoFinanceiro.findUnique({
            where: { id: custo.configFinanceiraId },
            select: { id: true, nome: true, moedaPadrao: true },
          })
        : Promise.resolve(null),
    ])

    // ── ações permitidas — mesma semântica da receita ─────────────────────
    const temPagamento = custo.parcelas.some((p) => p.status === 'RECEBIDA' || p.status === 'PAGA')
    const jaCancelado = custo.canceladoEm != null || custo.cancelado
    const jaEstornado = custo.estornadoEm != null
    const geradoPeloMotor = custo.origem === 'motor'

    let motivoBloqueioCancelamento: string | null = null
    if (jaEstornado) motivoBloqueioCancelamento = 'Este lançamento já foi estornado.'
    else if (jaCancelado) motivoBloqueioCancelamento = 'Este lançamento já está cancelado.'
    else if (temPagamento) motivoBloqueioCancelamento = 'Este lançamento não pode ser cancelado porque possui um pagamento registrado. Use o estorno.'
    else if (geradoPeloMotor && origem?.ativa) {
      motivoBloqueioCancelamento = `Este lançamento continua sendo exigido pela regra financeira ativa (${origem.descricao}). Corrija a origem operacional ou registre uma supressão autorizada ao cancelar.`
    }

    const acoes = {
      podeCancelar: !jaCancelado && !jaEstornado && !temPagamento,
      exigeSupressao: !jaCancelado && !jaEstornado && !temPagamento && geradoPeloMotor && (origem?.ativa ?? false),
      podeEstornar: !jaEstornado && temPagamento,
      podeEditarParcelas: !jaCancelado && !jaEstornado && !temPagamento,
      podeRegistrarRecebimento: !jaCancelado && !jaEstornado && custo.parcelas.some((p) => p.status === 'PENDENTE'),
      podeRevogarSupressao: origem?.supressao != null,
      motivoBloqueioCancelamento,
      motivoBloqueioParcelas: temPagamento
        ? 'O parcelamento não pode ser alterado porque já existe pagamento registrado.'
        : jaCancelado ? 'Lançamento cancelado.' : null,
    }

    return NextResponse.json({
      // `receita` = o LANÇAMENTO (envelope compartilhado com a receita).
      receita: {
        ...custo,
        // O motor grava o vencimento único em `vencimento`; o modal lê `data1`.
        data1: custo.vencimento,
        cancelada: custo.cancelado,
        composicao: montarComposicao(custo),
      },
      natureza: 'CUSTO',
      requerentesConsiderados: [],
      origem: {
        processo: custo.processo
          ? {
              id: custo.processo.id,
              codigo: custo.processo.codigo,
              nome: custo.processo.nome,
              pais: custo.processo.pais,
              tipo: custo.processo.tipoProcessoMotor?.name ?? null,
            }
          : null,
        phaseKey: custo.phaseKey,
        faseLabel: custo.phaseKey ? (fase?.label ?? rotularPhaseKey(custo.phaseKey)) : null,
        servico: custo.tipoServico?.nome ?? null,
        documento: custo.documento ? { id: custo.documento.id, tipo: custo.documento.tipo } : null,
        configuracaoFinanceira: config,
        tabelaPrecos: tabela,
        regraFinanceira: origem
          ? { descricao: origem.descricao, ruleKind: origem.ruleKind, ruleSource: origem.ruleSource, ruleId: origem.ruleId }
          : null,
        eventoOperacional: custo.eventoOperacionalId ?? (origem?.event ?? null),
        criadoEm: custo.createdAt,
        atualizadoEm: custo.updatedAt,
        dataReferencia: custo.dataReferencia,
        tecnico: {
          chaveIdempotencia: custo.chaveIdempotencia,
          automaticKey: origem?.automaticKey ?? null,
          artefatoId: origem?.artefatoId ?? null,
          modoCalculoAplicado: custo.modoCalculoAplicado,
          naturezaPreco: custo.naturezaPreco,
          fornecedor: custo.fornecedor,
        },
      },
      supressao: origem?.supressao ?? null,
      origemAtiva: origem?.ativa ?? false,
      cancelamento: jaCancelado ? { em: custo.canceladoEm, motivo: custo.canceladoMotivo, por: null } : null,
      estorno: jaEstornado ? { em: custo.estornadoEm, motivo: custo.estornoMotivo } : null,
      acoes,
    })
  } catch (err) {
    console.error('[GET /api/financeiro/custos/[id]/detalhe] erro:', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
