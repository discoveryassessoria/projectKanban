// lib/operacional/fase-futura.ts
// ============================================================================
// TAREFA DE FASE FUTURA — UMA REGRA PARA TODA A TORRE E A OPERAÇÃO.
//
// Decisão do Bloco F ("Precisa de você"), agora única: uma tarefa cuja fase
// AINDA NÃO CHEGOU (ordem, no macrofluxo do tipo do processo, MAIOR que a da
// fase atual do processo) não é trabalho de hoje — não entra em lista, KPI,
// Radar, Foco, sino nem no "Precisa de você". Achado real (30/09/2026):
// #3906 "Encerrar processo" (faseMacroKey `finalizado`) com o processo 651 em
// `emissao_documental` entrava na lista da Torre e em "Sem responsável" (30)
// mas não no "Precisa de você".
//
// O QUE NÃO É FUTURA:
//   • fase ANTERIOR pendente — continua aparecendo (selo "Fase anterior");
//   • fase igual à atual;
//   • fase desconhecida no cadastro do tipo, tarefa sem fase (transversal),
//     processo sem fase atual ou sem tipo, tarefa sem processo — NEUTRAS:
//     "fase desconhecida não é 'mais à frente'" (mesma regra de `ordensDeFase`).
//
// PURO — sem Prisma; importável pela tela e pelo servidor. A leitura das
// ordens (FaseMacro do MacroWorkflow do tipo) é feita por quem chama.
// ============================================================================

/** `phaseKey → ordem` do macrofluxo de UM tipo de processo (mesma fonte de `ordensDeFase`). */
export type OrdensDeFase = ReadonlyMap<string, number>

/** A fase `faseDaTarefa` vem DEPOIS da fase atual do processo? Neutra (false) sem informação. */
export function ehFaseFutura(
  faseDaTarefa: string | null | undefined,
  faseAtualDoProcesso: string | null | undefined,
  ordens: OrdensDeFase | null | undefined,
): boolean {
  if (faseDaTarefa == null || faseAtualDoProcesso == null || !ordens) return false
  const ordemTarefa = ordens.get(faseDaTarefa)
  const ordemAtual = ordens.get(faseAtualDoProcesso)
  if (ordemTarefa == null || ordemAtual == null) return false
  return ordemTarefa > ordemAtual
}

/** Tira as linhas de fase futura (`faseFutura`, anotada pela projeção). */
export function semFaseFutura<T extends { faseFutura?: boolean }>(linhas: T[]): T[] {
  return linhas.filter((l) => l.faseFutura !== true)
}
