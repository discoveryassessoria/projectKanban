// lib/operacional/torre-tarefas-grupos.ts
// ============================================================================
// ABRIR / RECOLHER OS BLOCOS DE FAMÍLIA (aba Tarefas da Torre) — regras PURAS.
// Padrão: TUDO RECOLHIDO. O estado é o conjunto de grupos ABERTOS (vazio = tudo recolhido).
// Seleção × recolhido: a faixa do grupo recolhido diz "N selecionadas", para a ação em massa nunca valer para tarefas que a pessoa
// não está vendo sem que isso apareça.
// ============================================================================

export const grupoAberto = (abertos: ReadonlySet<string>, nome: string): boolean => abertos.has(nome)

export function alternarGrupo(abertos: ReadonlySet<string>, nome: string): Set<string> {
  const n = new Set(abertos)
  if (n.has(nome)) n.delete(nome); else n.add(nome)
  return n
}
export const expandirTudo = (nomes: readonly string[]): Set<string> => new Set(nomes)
export const recolherTudo = (): Set<string> => new Set()

/** Quantas tarefas de TRABALHO do grupo estão selecionadas (a cancelada é só exibição e nunca é selecionada). */
export function contarSelecionadas(idsDoGrupo: readonly number[], sel: Readonly<Record<number, true>>): number {
  return idsDoGrupo.reduce((n, id) => n + (sel[id] ? 1 : 0), 0)
}

/** "1 selecionada" · "3 selecionadas" — só aparece com o grupo recolhido e ao menos uma selecionada; senão `null`. */
export function textoSelecionadasNoGrupo(recolhido: boolean, n: number): string | null {
  if (!recolhido || n <= 0) return null
  return `${n} ${n === 1 ? 'selecionada' : 'selecionadas'}`
}

/** Estado da caixinha do grupo: tudo marcado, parte marcada ou nada. */
export function estadoDaSelecaoDoGrupo(idsDoGrupo: readonly number[], sel: Readonly<Record<number, true>>): 'todas' | 'algumas' | 'nenhuma' {
  const n = contarSelecionadas(idsDoGrupo, sel)
  return n === 0 ? 'nenhuma' : n === idsDoGrupo.length ? 'todas' : 'algumas'
}
