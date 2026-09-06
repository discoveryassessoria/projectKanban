// src/lib/documentos/ordem-evento-vida.ts
//
// ORDEM DE VIDA DO REGISTRO CIVIL — nasce, casa, morre. Fonte única.
//
// Não é alfabética de propósito: "Certidão de casamento" viria antes de
// "Certidão de nascimento" no dicionário, e essa não é a ordem que ninguém
// pensa quando olha os documentos de uma pessoa. Todo lugar do sistema que
// lista certidões de uma pessoa usa ESTA função — nunca uma cópia local.

/** 0 = nascimento, 1 = casamento, 2 = óbito, 3 = qualquer outro documento. */
export function prioridadeDoEventoDeVida(titulo: string): number {
  const t = titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  if (t.includes("nascimento")) return 0
  if (t.includes("casamento")) return 1
  if (t.includes("obito")) return 2
  return 3
}

/** Comparador pronto: nascimento → casamento → óbito, com alfabética como desempate. */
export function compararPorEventoDeVida(tituloA: string, tituloB: string): number {
  return prioridadeDoEventoDeVida(tituloA) - prioridadeDoEventoDeVida(tituloB) || tituloA.localeCompare(tituloB, "pt-BR")
}
