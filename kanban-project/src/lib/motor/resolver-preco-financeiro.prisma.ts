// src/lib/motor/resolver-preco-financeiro.prisma.ts
// ============================================================================
// Loader com banco para o resolver de preço (Fase 7). Separado do núcleo para
// que `resolver-preco-financeiro.ts` permaneça 100% puro/testável sem Prisma.
//
// Mapeia TabelaValor (Prisma) → LinhaPreco (Decimal → number). Somente LEITURA.
// ============================================================================

import { prisma } from '@/lib/prisma'
import { NaturezaPreco } from '@prisma/client'
import {
  resolverPrecoFinanceiro,
  resolverCustoEReceitaFinanceiro,
  resolverPrecoCore,
  type CarregadorLinhasPreco,
  type ContextoPrecoFinanceiro,
  type LinhaPreco,
  type ResultadoPreco,
} from './resolver-preco-financeiro'

/**
 * F4 — resolvedor CANÔNICO por Configuração Financeira (chave principal).
 * Carrega os preços da config (ignora arquivado/legadoPendente) e resolve pela
 * precedência endurecida. Fase NÃO é critério de preço. Nunca zero silencioso.
 */
export async function resolverPrecoPorConfigDB(
  configId: number,
  ctx: Partial<ContextoPrecoFinanceiro> = {},
): Promise<ResultadoPreco> {
  if (!Number.isInteger(configId) || configId <= 0) {
    return { ok: false, motivo: 'ITEM_INVALIDO', razao: 'configId ausente/inválido', alternativasDescartadas: [] }
  }
  const rows = await prisma.tabelaValor.findMany({
    where: { configuracaoFinanceiraItemId: configId, arquivado: false, legadoPendente: false },
  })
  const linhas: LinhaPreco[] = rows.map((r) => ({
    id: r.id, valor: Number(r.valor), moeda: r.moeda, modoCalculo: r.modoCalculo, natureza: r.natureza,
    arquivado: r.arquivado, processoId: r.processoId ?? null, processoTipoId: r.processoTipoId ?? null,
    regiao: r.regiao ?? null, fornecedorId: r.fornecedorId ?? null, vigenciaInicio: r.vigenciaInicio ?? null, vigenciaFim: r.vigenciaFim ?? null,
  }))
  return resolverPrecoCore(linhas, { ...ctx, itemCatalogoId: configId, natureza: null, dataEvento: ctx.dataEvento ?? new Date() } as ContextoPrecoFinanceiro)
}

/** Carrega as linhas de preço ATIVAS de um item+natureza (findMany, sem escrita). */
export const carregarLinhasPrisma: CarregadorLinhasPreco = async (itemCatalogoId, natureza) => {
  const rows = await prisma.tabelaValor.findMany({
    where: { itemCatalogoId, natureza, arquivado: false },
  })
  return rows.map(
    (r): LinhaPreco => ({
      id: r.id,
      valor: Number(r.valor),
      moeda: r.moeda,
      modoCalculo: r.modoCalculo,
      natureza: r.natureza,
      arquivado: r.arquivado,
      processoId: r.processoId ?? null,
      processoTipoId: r.processoTipoId ?? null,
      regiao: r.regiao ?? null,
      fornecedorId: r.fornecedorId ?? null,
      vigenciaInicio: r.vigenciaInicio ?? null,
      vigenciaFim: r.vigenciaFim ?? null,
    }),
  )
}

/** Resolve preço usando o banco (loader default). */
export async function resolverPrecoFinanceiroDB(ctx: ContextoPrecoFinanceiro): Promise<ResultadoPreco> {
  return resolverPrecoFinanceiro(ctx, carregarLinhasPrisma)
}

/** Resolve custo E receita usando o banco. */
export async function resolverCustoEReceitaDB(
  base: Omit<ContextoPrecoFinanceiro, 'natureza'>,
): Promise<{ custo: ResultadoPreco; receita: ResultadoPreco }> {
  return resolverCustoEReceitaFinanceiro(base, carregarLinhasPrisma)
}

export { NaturezaPreco }
