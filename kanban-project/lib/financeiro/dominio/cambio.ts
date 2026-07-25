// lib/financeiro/dominio/cambio.ts
// ============================================================================
// FONTE ÚNICA de parsing/cálculo de CÂMBIO (frontend + backend). Uma TAXA de
// câmbio (ex.: 6,1006) NÃO é dinheiro: o ponto é decimal, nunca milhar. Usar o
// parser monetário (que remove pontos de milhar) numa taxa corrompe a escala
// ("6.1006" -> "61006" -> ×10000). Aqui a taxa é tratada corretamente. Puro.
// ============================================================================

export const centCambio = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

/**
 * Parser de TAXA de câmbio. Aceita "6,1006", "6.1006" e 6.1006 — o separador
 * decimal pode ser vírgula OU ponto; NUNCA há separador de milhar numa taxa.
 * Diferente do parser MONETÁRIO (que remove pontos de milhar).
 */
export function parseTaxaCambio(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v ?? '').trim().replace(/\s/g, '')
  if (s === '') return 0
  // vírgula é sempre decimal; ponto (único) também é decimal numa taxa.
  const normalizado = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : 0
}

/** Converte um valor na moeda-base para BRL pela taxa. Centavos exatos. */
export function converterParaBrl(valorBase: number, taxa: number): number {
  return centCambio((Number(valorBase) || 0) * (Number(taxa) || 0))
}

/** Taxa a partir de um par (valorBrl / valorBase). 0 quando base 0. Precisão TOTAL
 * (NÃO arredondar a taxa — arredondar a taxa e depois multiplicar por um valor
 * grande reintroduz o erro de escala; ex.: cent(6,1006)=6,10 × 4.600 → −R$2,76). */
export function taxaDe(valorBrl: number, valorBase: number): number {
  const b = Number(valorBase) || 0
  return b === 0 ? 0 : (Number(valorBrl) || 0) / b
}

/**
 * Rateia um total em BRL (FONTE ÚNICA — já congelado/consolidado) entre itens,
 * proporcionalmente às suas bases, com resíduo determinístico no MAIOR item, de
 * modo que a soma dos BRL retornados seja EXATAMENTE igual a `totalBrl`. Não usa
 * taxa arredondada: parte do totalBrl verdadeiro e das proporções de base. Assim
 * a distribuição financeira nunca diverge do valor da Receita por arredondamento.
 * Base total 0 → tudo 0. Item de base negativa é tratado como 0 na proporção.
 */
export function ratearBrlPorBase(bases: number[], totalBrl: number): number[] {
  const bs = bases.map((b) => (Number(b) > 0 ? Number(b) : 0))
  const totalBase = bs.reduce((s, b) => s + b, 0)
  const alvo = centCambio(totalBrl)
  if (totalBase <= 0) return bases.map(() => 0)
  const brutos = bs.map((b) => centCambio((alvo * b) / totalBase))
  const soma = centCambio(brutos.reduce((s, v) => s + v, 0))
  const resto = centCambio(alvo - soma)
  if (Math.abs(resto) >= 0.005) {
    let idx = 0
    for (let i = 1; i < bs.length; i++) if (bs[i] > bs[idx]) idx = i
    brutos[idx] = centCambio(brutos[idx] + resto)
  }
  return brutos
}
