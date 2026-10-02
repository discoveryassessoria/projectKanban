// src/lib/genealogia/cadastro-linhagem.ts
// ============================================================================
// CADASTRO DE LINHAGEM EM SÉRIE — as regras do "adicionar pai/mãe encadeado",
// em módulo PURO. O modal só apresenta; quem decide o que oferecer é daqui.
//
// O vínculo continua indo pelo mesmo caminho de hoje (POST /api/pessoas com
// `filhoId` + `tipoPai`, que passa por `aplicarMudancaNaArvore`): este módulo
// não escreve nada.
// ============================================================================

export type TipoGenitor = "pai" | "mae"
export type TipoAdicao = "pai" | "mae" | "filho" | "pessoa" | "conjuge" | null

/**
 * Que passos seguintes oferecer depois de salvar uma pessoa: pai e/ou mãe que a
 * pessoa recém-criada ainda NÃO tem. Só para quem está na linha reta, e nunca para
 * cônjuge (cônjuge não entra na linhagem).
 */
export function proximosPassosDaLinhagem(entrada: {
  linhaReta: boolean
  tipo: TipoAdicao
  temPai: boolean
  temMae: boolean
}): TipoGenitor[] {
  if (!entrada.linhaReta || entrada.tipo === "conjuge") return []
  const passos: TipoGenitor[] = []
  if (!entrada.temPai) passos.push("pai")
  if (!entrada.temMae) passos.push("mae")
  return passos
}

/** A trilha do lote: a pessoa-base (quando a série começou num filho) + cada cadastrada. */
export function estenderTrilha(trilha: readonly string[], baseNome: string | null, novoNome: string): string[] {
  const inicio = trilha.length === 0 && baseNome ? [baseNome] : [...trilha]
  return [...inicio, novoNome]
}

/** "Cadastrando linhagem: Fulano → Pai → Avô" — só existe com lote em andamento. */
export function rotuloDaTrilha(trilha: readonly string[], proximo: TipoGenitor | null): string | null {
  if (trilha.length === 0) return null
  const fim = proximo ? [proximo === "pai" ? "pai" : "mãe"] : []
  return `Cadastrando linhagem: ${[...trilha, ...fim].join(" → ")}`
}

export const ROTULO_GENITOR: Record<TipoGenitor, string> = { pai: "pai", mae: "mãe" }
