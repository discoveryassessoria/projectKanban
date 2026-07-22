// lib/genealogia/requerente-flag.ts
// ============================================================================
// FONTE ÚNICA do conceito "esta Pessoa é REQUERENTE na árvore genealógica".
//
// A auditoria encontrou divergência: a UI grava `Pessoa.requerente = "sim"`, e o
// motor legado contava apenas `"maior"|"menor"`. Uma pessoa marcada "sim" NÃO era
// cobrada. Este módulo padroniza UM único conceito, usado tanto pela detecção do
// EVENTO de domínio quanto pelo FinanceRuleEngine — nunca mais dois vocabulários.
//
// É requerente ⇔ o flag ∈ {sim, maior, menor} (case-insensitive). Qualquer outro
// valor (nao, vazio, null, desconhecido) ⇒ NÃO é requerente. Módulo PURO.
// ============================================================================

/** Valores do flag `Pessoa.requerente` que significam "é requerente". */
export const REQUERENTE_VALORES = ['sim', 'maior', 'menor'] as const

/** Uma pessoa é requerente? Fonte única para evento e motor financeiro. */
export function ehRequerente(flag: string | null | undefined): boolean {
  if (flag == null) return false
  const v = String(flag).trim().toLowerCase()
  return (REQUERENTE_VALORES as readonly string[]).includes(v)
}

/**
 * Houve a transição "não requerente → requerente"? SÓ isto deve publicar o evento
 * REQUERENTE_ADICIONADO. Edição de dados, re-save, reorder ou qualquer mudança que
 * NÃO altere o flag para requerente retorna false.
 */
export function houveTransicaoParaRequerente(antes: string | null | undefined, depois: string | null | undefined): boolean {
  return !ehRequerente(antes) && ehRequerente(depois)
}
