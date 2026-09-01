// src/lib/relatorios/motor/registro.ts
//
// O REGISTRO DOS DOMÍNIOS. Poucos, e cada um dono de um assunto.
//
// Acrescentar um domínio aqui é acrescentar um ASSUNTO, não um relatório: as
// perguntas dentro dele saem de filtros. Se alguém precisar registrar
// "Protocolos de janeiro", a resposta é não — isso é uma visão salva.

import type { DominioDef } from "./tipos"
import { DOMINIO_PROCESSOS } from "./dominios/processos"
import { DOMINIO_GENEALOGIA } from "./dominios/genealogia"
import { DOMINIO_COMPLETUDE } from "./dominios/completude"
import { DOMINIO_WORKFLOW } from "./dominios/workflow"
import { DOMINIO_FINANCEIRO } from "./dominios/financeiro"
import { DOMINIO_FORNECEDORES } from "./dominios/fornecedores"
import { DOMINIO_SERVICOS } from "./dominios/servicos"
import { DOMINIO_EQUIPE } from "./dominios/equipe"
import { DOMINIO_ARQUIVOS } from "./dominios/arquivos"
import { DOMINIO_QUALIDADE } from "./dominios/qualidade"
import { DOMINIO_REQUERENTES } from "./dominios/requerentes"
import { DOMINIO_FAMILIAS } from "./dominios/familias"
import { DOMINIO_CERTIDOES } from "./dominios/certidoes"
import { DOMINIO_DOCUMENTOS } from "./dominios/documentos"
import { DOMINIO_PROTOCOLOS } from "./dominios/protocolos"
import { DOMINIO_TAREFAS } from "./dominios/tarefas"
import { DOMINIO_ORGAOS } from "./dominios/orgaos"

export const DOMINIOS: DominioDef[] = [
  DOMINIO_PROCESSOS,
  DOMINIO_REQUERENTES,
  DOMINIO_FAMILIAS,
  DOMINIO_GENEALOGIA,
  DOMINIO_CERTIDOES,
  DOMINIO_DOCUMENTOS,
  DOMINIO_COMPLETUDE,
  DOMINIO_PROTOCOLOS,
  DOMINIO_TAREFAS,
  DOMINIO_WORKFLOW,
  DOMINIO_FINANCEIRO,
  DOMINIO_FORNECEDORES,
  DOMINIO_SERVICOS,
  DOMINIO_ORGAOS,
  DOMINIO_EQUIPE,
  DOMINIO_ARQUIVOS,
  DOMINIO_QUALIDADE,
]

export const dominioPorChave = (k: string | null | undefined): DominioDef | null =>
  DOMINIOS.find((d) => d.key === k) ?? null

/** Só os domínios que quem está olhando pode ver, na ordem declarada. */
export const dominiosVisiveis = (pode: (p: string) => boolean): DominioDef[] =>
  DOMINIOS.filter((d) => pode(d.permissao)).sort((a, b) => a.ordem - b.ordem)
