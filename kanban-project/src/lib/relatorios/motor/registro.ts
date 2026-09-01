// src/lib/relatorios/motor/registro.ts
//
// O REGISTRO DOS DOMÍNIOS. Poucos, e cada um dono de um assunto.
//
// Acrescentar um domínio aqui é acrescentar um ASSUNTO, não um relatório: as
// perguntas dentro dele saem de filtros. Se alguém precisar registrar
// "Protocolos de janeiro", a resposta é não — isso é uma visão salva.

import type { DominioDef } from "./tipos"
import { DOMINIO_PROTOCOLOS } from "./dominios/protocolos"

export const DOMINIOS: DominioDef[] = [DOMINIO_PROTOCOLOS]

export const dominioPorChave = (k: string | null | undefined): DominioDef | null =>
  DOMINIOS.find((d) => d.key === k) ?? null

/** Só os domínios que quem está olhando pode ver, na ordem declarada. */
export const dominiosVisiveis = (pode: (p: string) => boolean): DominioDef[] =>
  DOMINIOS.filter((d) => pode(d.permissao)).sort((a, b) => a.ordem - b.ordem)
