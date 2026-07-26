// lib/financeiro/cambio-financas.ts
// ============================================================================
// ETAPA 1A — FONTE ÚNICA DE CÂMBIO para o Financeiro Geral (/api/financas/*).
//
// Substitui o `const FX = { EUR: 5.52, USD: 5.08 }` que estava duplicado em
// dre, receber, dashboard e fluxo. A cotação passa a vir de CotacaoCambio
// (job diário, fonte Confidence) via snapshotCotacoes — o mesmo caminho que o
// Financeiro V2 já usa.
//
// REGRA INEGOCIÁVEL: sem cotação real NÃO se inventa taxa e NÃO se assume 1:1.
// O valor fica FORA do total e é devolvido em `naoConvertido`, para a tela
// poder dizer o que não pôde ser convertido em vez de exibir número errado.
// ============================================================================

import { snapshotCotacoes } from '@/src/lib/cambio/servico-cambio'

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

const BRL = 'BRL'

export async function carregarFx(): Promise<FxFinancas> {
  const taxas: Record<string, number> = { [BRL]: 1 }
  const indisponiveis: string[] = []
  let dataReferencia: string | null = null
  let fonte = 'CotacaoCambio'

  try {
    const snap = await snapshotCotacoes()
    fonte = snap.fonte ?? fonte
    for (const m of snap.moedas) {
      const moeda = String(m.moeda)
      if (m.valor != null && Number.isFinite(Number(m.valor)) && Number(m.valor) > 0) {
        taxas[moeda] = Number(m.valor)
        if (!dataReferencia && m.dataReferencia) dataReferencia = m.dataReferencia
      } else {
        indisponiveis.push(moeda)
      }
    }
  } catch {
    // Falha ao ler cotações não pode virar taxa inventada: só BRL permanece
    // conversível e todo o resto é reportado como indisponível pelo caller.
    fonte = 'indisponivel'
  }

  return { taxas, indisponiveis, fonte, dataReferencia }
}

/** Converte para BRL. Devolve null quando não há cotação real — nunca 1:1. */
export function converterBrl(fx: FxFinancas, valor: number, moeda?: string | null): number | null {
  const m = (moeda ?? BRL).toUpperCase()
  const taxa = fx.taxas[m]
  if (taxa == null) return null
  return Number(valor) * taxa
}

/**
 * Soma uma coleção em BRL. Itens sem cotação NÃO entram no total — voltam em
 * `naoConvertido` para a tela poder ser honesta sobre a lacuna.
 */
export function somarBrl(
  fx: FxFinancas,
  itens: { valor: number; moeda?: string | null; valorBrl?: number | null }[],
): SomaBrl {
  let total = 0
  const faltando = new Map<string, number>()

  for (const it of itens) {
    // valorBrl já congelado no lançamento tem precedência: é fato, não estimativa
    if (it.valorBrl != null && Number.isFinite(Number(it.valorBrl))) {
      total += Number(it.valorBrl)
      continue
    }
    const convertido = converterBrl(fx, Number(it.valor) || 0, it.moeda)
    if (convertido == null) {
      const m = (it.moeda ?? BRL).toUpperCase()
      faltando.set(m, (faltando.get(m) ?? 0) + (Number(it.valor) || 0))
      continue
    }
    total += convertido
  }

  return {
    total: Math.round(total * 100) / 100,
    naoConvertido: [...faltando.entries()].map(([moeda, valor]) => ({ moeda, valor: Math.round(valor * 100) / 100 })),
  }
}
