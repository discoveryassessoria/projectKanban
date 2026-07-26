// lib/financeiro/cambio-financas.ts
// ============================================================================
// Adaptador do Financeiro Geral (/api/financas/*) para o SERVIÇO CANÔNICO de
// câmbio (lib/financeiro/cambio/canonico).
//
// Este módulo NÃO tem política própria: consulta, arredondamento, precedência
// e regra de ausência vivem só no canônico. Aqui só existe a forma que as
// rotas do Financeiro Geral já consomem (FxFinancas), preservada para não
// exigir mudança nas seis rotas da Etapa 1A.
//
// O Financeiro Geral trabalha com PROJEÇÃO/CONSULTA ATUAL, então a cotação
// corrente manda; snapshot histórico só entra quando o chamador informa um
// fato consolidado.
// ============================================================================

import {
  carregarCotacoesCorrentes,
  converter,
  resolverTaxa,
  somarCanonico,
  cent,
  MOEDA_CONTABIL,
  type CotacoesCorrentes,
} from '@/lib/financeiro/cambio/canonico'

export { cent }

export interface FxFinancas {
  /** apenas moedas com cotação real; BRL sempre 1. */
  taxas: Record<string, number>
  /** moedas sem cotação disponível — nunca convertidas. */
  indisponiveis: string[]
  fonte: string
  dataReferencia: string | null
}

export interface SomaBrl {
  total: number
  /** o que ficou de fora por falta de cotação, agrupado por moeda. */
  naoConvertido: { moeda: string; valor: number }[]
}

const comoCorrentes = (fx: FxFinancas): CotacoesCorrentes => ({
  taxas: fx.taxas,
  indisponiveis: fx.indisponiveis,
  dataReferencia: fx.dataReferencia,
  fonte: fx.fonte,
})

export async function carregarFx(): Promise<FxFinancas> {
  const c = await carregarCotacoesCorrentes()
  return { taxas: c.taxas, indisponiveis: c.indisponiveis, fonte: c.fonte, dataReferencia: c.dataReferencia }
}

/** Converte para BRL. null quando não há cotação real — nunca 1:1, nunca zero. */
export function converterBrl(fx: FxFinancas, valor: number, moeda?: string | null): number | null {
  return converter(valor, resolverTaxa({ moeda, correntes: comoCorrentes(fx) }))
}

/**
 * Soma uma coleção em BRL. Itens sem cotação NÃO entram no total — voltam em
 * `naoConvertido` para a tela poder ser honesta sobre a lacuna.
 */
export function somarBrl(
  fx: FxFinancas,
  itens: { valor: number; moeda?: string | null; valorBrl?: number | null }[],
): SomaBrl {
  return somarCanonico(
    comoCorrentes(fx),
    itens.map((it) => ({ valor: it.valor, moeda: it.moeda ?? MOEDA_CONTABIL, valorBrlCongelado: it.valorBrl })),
  )
}
