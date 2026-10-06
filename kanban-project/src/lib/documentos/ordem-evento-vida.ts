// src/lib/documentos/ordem-evento-vida.ts
//
// ORDEM DE VIDA DO REGISTRO CIVIL — nasce, casa, morre. Fonte única.
//
// Não é alfabética de propósito: "Certidão de casamento" viria antes de
// "Certidão de nascimento" no dicionário, e essa não é a ordem que ninguém
// pensa quando olha os documentos de uma pessoa. Todo lugar do sistema que
// lista certidões de uma pessoa usa ESTA função — nunca uma cópia local.

import { ordemDaCategoria } from "@/lib/operacional/ordem-certidoes"

/**
 * 0 = nascimento, 1 = casamento, 2 = óbito, 3 = qualquer outro documento.
 * DELEGA à regra fixa (`lib/operacional/ordem-certidoes.ts`, item 3: dentro da pessoa, Nascimento, Casamento, Óbito, outros) — uma só definição.
 */
export function prioridadeDoEventoDeVida(titulo: string): number {
  return ordemDaCategoria({ titulo })
}

/** Comparador pronto para a lista de documentos de UMA pessoa: nascimento → casamento → óbito → outros (desempate alfabético só entre "outros"). */
export function compararPorEventoDeVida(tituloA: string, tituloB: string): number {
  return prioridadeDoEventoDeVida(tituloA) - prioridadeDoEventoDeVida(tituloB) || tituloA.localeCompare(tituloB, "pt-BR")
}
