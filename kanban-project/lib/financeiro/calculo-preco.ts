// lib/financeiro/calculo-preco.ts
// ============================================================================
// ALGORITMO ÚNICO de cálculo de preço do Discovery.
//
// Fonte única dos parâmetros: a Tabela de Preços (valor, valorBase,
// valorAdicional, modoCalculo). TODOS os fluxos do FinanceRuleEngine calculam
// por AQUI — nenhum caminho (honorários ou qualquer outro) tem fórmula própria.
//
//   fixo                          → valor
//   por unidade (base+adicional)  → valorBase + max(qtd-1, 0) × valorAdicional
//   por unidade (só valor)        → valor × qtd
//
// Módulo PURO: sem Prisma, sem React. Determinístico e testável.
// ============================================================================
import { estrategiaDoModo } from './modo-calculo'

export type EstrategiaCalculo = 'fixo' | 'por_unidade' | 'primeiro_e_adicional'

export interface EntradaCalculo {
  modoCalculo: string | null | undefined
  /** Preço base/unitário da linha (TabelaValor.valor). */
  valor: number
  /** Preço do PRIMEIRO (TabelaValor.valorBase), quando a estratégia é base+adicional. */
  valorBase?: number | string | null
  /** Preço de cada ADICIONAL (TabelaValor.valorAdicional). */
  valorAdicional?: number | string | null
  /** Quantidade de unidades elegíveis (requerentes, documentos, …). Padrão 1. */
  quantidade?: number | null
}

export interface ResultadoCalculo {
  total: number
  unitario: number
  quantidade: number
  estrategia: EstrategiaCalculo
  /** Passo a passo para congelar no lançamento (auditoria). */
  memoria: string
}

const cent = (v: number) => Math.round(v * 100) / 100
const n = (v: unknown) => (v == null ? null : Number(v))

/**
 * Calcula o preço final a partir dos parâmetros da Tabela de Preços.
 * A fórmula base+adicional é: valorBase + max(quantidade-1, 0) × valorAdicional.
 */
export function calcularPreco(e: EntradaCalculo): ResultadoCalculo {
  const qtd = Math.max(1, Math.trunc(Number(e.quantidade) || 1))
  const valor = cent(Number(e.valor) || 0)

  // A ESTRATÉGIA decide o algoritmo (fonte única). Fixo → o preço é o valor, uma vez.
  if (estrategiaDoModo(e.modoCalculo) === 'fixo') {
    return { total: valor, unitario: valor, quantidade: 1, estrategia: 'fixo', memoria: `Valor fixo: ${valor.toFixed(2)}` }
  }

  const base = n(e.valorBase)
  const adic = n(e.valorAdicional)

  // Por unidade com PRIMEIRO + ADICIONAL (ex.: honorários por requerente).
  if (base != null && adic != null) {
    const total = cent(base + Math.max(qtd - 1, 0) * adic)
    return {
      total,
      unitario: cent(base),
      quantidade: qtd,
      estrategia: 'primeiro_e_adicional',
      memoria: `${cent(base).toFixed(2)} (primeiro) + max(${qtd} − 1, 0) × ${cent(adic).toFixed(2)} (adicional) = ${total.toFixed(2)}`,
    }
  }

  // Por unidade simples: valor × quantidade.
  const total = cent(valor * qtd)
  return { total, unitario: valor, quantidade: qtd, estrategia: 'por_unidade', memoria: `${valor.toFixed(2)} × ${qtd} = ${total.toFixed(2)}` }
}
