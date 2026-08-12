// lib/financeiro/dominio/origem-lancamento.ts
// ============================================================================
// ORIGEM DO LANÇAMENTO — como uma ObrigacaoEconomica passou a existir.
//
// POR QUE ISTO É UM CAMPO E NÃO UMA INFERÊNCIA
// --------------------------------------------
// "Custo automático" e "custo manual" são coisas diferentes na operação: o
// primeiro é consequência da cadeia documental (registro localizado → serviços do
// documento → preço vigente) e não deve ser editado a esmo; o segundo é despesa
// extraordinária, lançada por uma pessoa, e exige justificativa. Distinguir os
// dois por heurística (tem documentoId? veio do motor? a descrição parece…) daria
// respostas diferentes conforme quem perguntasse. Por isso a origem é DECLARADA
// por quem cria, e as linhas anteriores à declaração ficam NULL — a reconciliação
// as RELATA como não classificadas em vez de adivinhar.
//
// Fonte única: motor, backfill, API de custo manual, filtros da lista e Planilha
// Documental leem estas constantes; nenhum deles repete a string.
// ============================================================================

export const ORIGEM_AUTOMATICA = 'AUTOMATICO_DOCUMENTAL'
export const ORIGEM_BACKFILL = 'BACKFILL_DOCUMENTAL'
export const ORIGEM_MANUAL = 'MANUAL'

export type OrigemLancamento =
  | typeof ORIGEM_AUTOMATICA
  | typeof ORIGEM_BACKFILL
  | typeof ORIGEM_MANUAL

export const ORIGENS_LANCAMENTO: OrigemLancamento[] = [
  ORIGEM_AUTOMATICA, ORIGEM_BACKFILL, ORIGEM_MANUAL,
]

export const ROTULO_ORIGEM: Record<OrigemLancamento, string> = {
  [ORIGEM_AUTOMATICA]: 'Automático (documental)',
  [ORIGEM_BACKFILL]: 'Reparo documental',
  [ORIGEM_MANUAL]: 'Manual',
}

/**
 * Nasceu da cadeia documental? O backfill conta: ele repõe exatamente o que o
 * evento teria criado, com a mesma chave idempotente e o mesmo vínculo.
 */
export function ehAutomatico(origem: string | null | undefined): boolean {
  return origem === ORIGEM_AUTOMATICA || origem === ORIGEM_BACKFILL
}

/**
 * Lançado por uma pessoa. NULL não é manual: é *não classificado* (anterior à
 * declaração de origem) — por isso `ehManual(null) === false`. Quem precisa
 * separar "manual" de "não classificado" na tela usa `ehAutomatico` para um lado
 * e trata o resto explicitamente, sem transformar ausência em afirmação.
 */
export function ehManual(origem: string | null | undefined): boolean {
  return origem === ORIGEM_MANUAL
}

/** Rótulo honesto, inclusive para o que ainda não foi classificado. */
export function rotuloOrigem(origem: string | null | undefined): string {
  if (!origem) return 'Não classificado'
  return ROTULO_ORIGEM[origem as OrigemLancamento] ?? origem
}
