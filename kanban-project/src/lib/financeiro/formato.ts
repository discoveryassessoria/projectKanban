// src/lib/financeiro/formato.ts
// ============================================================================
// F7.6 — Formatação monetária do Financeiro: UMA definição.
// Cada tela redeclarava `fmt`/`brl`/`money` com variações sutis (com e sem
// try/catch, com e sem `|| 0`) — mesma intenção, 18 cópias. Estas funções
// preservam EXATAMENTE a saída já usada nas telas (Intl pt-BR, style currency),
// então a troca é pixel-equivalente.
// ============================================================================

/** Valor em uma moeda ISO qualquer. Moeda inválida cai num fallback legível. */
export function fmtMoeda(valor: number | null | undefined, moeda = "BRL"): string {
  const n = Number(valor) || 0
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda || "BRL" }).format(n)
  } catch {
    return `${moeda} ${n.toFixed(2)}`
  }
}

/** Atalho para Real — o mais usado nas telas. */
export function fmtBrl(valor: number | null | undefined): string {
  return fmtMoeda(valor, "BRL")
}
