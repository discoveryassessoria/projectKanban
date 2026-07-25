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

/** Taxa a partir de um par (valorBrl / valorBase). 0 quando base 0. */
export function taxaDe(valorBrl: number, valorBase: number): number {
  const b = Number(valorBase) || 0
  return b === 0 ? 0 : (Number(valorBrl) || 0) / b
}
