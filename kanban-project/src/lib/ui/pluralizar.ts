// src/lib/ui/pluralizar.ts
//
// SINGULAR/PLURAL — utilitário único. Antes desta rodada cada tela escrevia a
// própria conta ("N cobrança(s)", "N ação", "N evento(s)") — cada uma com um
// espaçamento e uma regra diferentes. Uma fonte só, para nunca mais um "1ação"
// ou um "0 cobrança(s)" literal chegar à tela.

/**
 * `pluralizar(3, "processo")` → "3 processos"
 * `pluralizar(1, "processo")` → "1 processo"
 * `pluralizar(2, "ação", "ações")` → "2 ações" (forma irregular explícita)
 */
export function pluralizar(quantidade: number, singular: string, plural?: string): string {
  const forma = quantidade === 1 ? singular : (plural ?? `${singular}s`)
  return `${quantidade} ${forma}`
}

/** Só a palavra, sem o número — para compor frases como "nenhuma pendência". */
export function formaPlural(quantidade: number, singular: string, plural?: string): string {
  return quantidade === 1 ? singular : (plural ?? `${singular}s`)
}
