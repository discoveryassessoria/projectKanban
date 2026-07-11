// src/services/fornecedor-helpers.ts
// CP-2 — helpers PUROS de Fornecedor (sem prisma/sem alias @/), reutilizáveis
// por script de dedup (tsx) e testes.

/** Normaliza string: trim; retorna null se vazio. */
export function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** Só dígitos do CPF/CNPJ. */
export function digitosFiscais(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "")
}

/**
 * Chave fiscal FORTE para deduplicação: dígitos do CPF (11) ou CNPJ (14).
 * Comprimento fora de {11,14} => "" (identificador ausente/duvidoso → não forte).
 */
export function chaveFiscal(v: string | null | undefined): string {
  const d = digitosFiscais(v)
  return d.length === 11 || d.length === 14 ? d : ""
}
