// src/services/necessidade-documental-helpers.ts
// CP-3 — helpers PUROS (sem prisma/sem alias @/), reutilizáveis por scripts e testes.

export interface SujeitoNecessidade {
  pessoaId?: number | null
  uniaoId?: number | null
}

/** Sujeito válido: EXATAMENTE um de pessoaId/uniaoId preenchido (XOR). */
export function sujeitoValido(s: SujeitoNecessidade): boolean {
  const temPessoa = s.pessoaId != null
  const temUniao = s.uniaoId != null
  return temPessoa !== temUniao // XOR
}

export interface ChaveNecessidadeInput {
  processoId: number
  itemCatalogoId: number
  pessoaId?: number | null
  uniaoId?: number | null
  varianteKey?: string | null
  ciclo?: number | null
}

/**
 * Chave de idempotência determinística (Regras 9/10).
 * Derivada de processo + item mestre + sujeito (pessoa|uniao) + variante + ciclo.
 * arvoreId/origem NÃO entram (não geram duplicidade artificial — decisão 1).
 * Lança se o sujeito for inválido (XOR).
 */
export function montarChaveIdempotencia(i: ChaveNecessidadeInput): string {
  if (!sujeitoValido(i)) {
    throw new Error("Sujeito inválido: preencha exatamente um de pessoaId OU uniaoId.")
  }
  const sujeito = i.pessoaId != null ? `p${i.pessoaId}` : `u${i.uniaoId}`
  const variante = (i.varianteKey || "padrao").trim().toLowerCase()
  const ciclo = i.ciclo && i.ciclo > 0 ? i.ciclo : 1
  return `proc${i.processoId}|item${i.itemCatalogoId}|${sujeito}|var:${variante}|c${ciclo}`
}
