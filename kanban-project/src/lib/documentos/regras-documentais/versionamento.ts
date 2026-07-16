// src/lib/documentos/regras-documentais/versionamento.ts
//
// Regras puras de versionamento/status. Uma regra PUBLICADA nunca é sobrescrita:
// edições exigem NOVA VERSÃO. Usado pelo route e pelos testes.

import type { StatusRegra } from "./tipos"

/** Edição é SEMPRE no lugar (não duplica nem inativa). Vale para rascunho, inativa
 *  e publicada; apenas ARQUIVADA é somente leitura (reabrir antes de editar). */
export function podeEditarEmLugar(status: StatusRegra): boolean {
  return status !== "ARQUIVADA"
}

/** Próxima versão de um grupo (código): max(versões) + 1. */
export function proximaVersao(versoes: number[]): number {
  return (versoes.length ? Math.max(...versoes) : 0) + 1
}

/** Ao publicar uma versão, as demais versões PUBLICADAS do mesmo código viram INATIVA. */
export function statusAposPublicar(status: StatusRegra, ehAVersaoPublicada: boolean): StatusRegra {
  if (ehAVersaoPublicada) return "PUBLICADA"
  return status === "PUBLICADA" ? "INATIVA" : status
}
