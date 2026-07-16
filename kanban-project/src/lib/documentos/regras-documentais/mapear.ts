// src/lib/documentos/regras-documentais/mapear.ts
//
// Ponte entre a linha persistida (MatrizDocumental — Prisma) e o tipo canônico
// RegraDocumental (puro). Dual-read: faseExigencia cai para phaseKey legado;
// bloqueiaConclusaoFase = blocksPhaseCompletion legado.

import type { MatrizDocumental, Prisma } from "@prisma/client"
import {
  type RegraDocumental, type ConjuntoCondicoes, type PublicoAlvo, type Obrigatoriedade,
  type StatusRegra, type Combinador, type Operador, type CampoCondicao, type ModoSatisfacao,
  PUBLICOS_ALVO, OPERADORES, CAMPOS_CONDICAO, STATUS_REGRA, MODOS_SATISFACAO,
} from "./tipos"

function parseIntArray(json: unknown): number[] | null {
  if (!Array.isArray(json)) return null
  const out = json.map((x) => Number(x)).filter((n) => !isNaN(n))
  return out
}
function parseStrArray(json: unknown): string[] | null {
  if (!Array.isArray(json)) return null
  return json.map((x) => String(x)).filter(Boolean)
}
function parsePublicoArray(json: unknown): PublicoAlvo[] | null {
  const arr = parseStrArray(json)
  if (!arr) return null
  return arr.filter((x): x is PublicoAlvo => (PUBLICOS_ALVO as readonly string[]).includes(x))
}

function parseCondicoes(json: Prisma.JsonValue | null | undefined): ConjuntoCondicoes | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null
  const o = json as Record<string, unknown>
  const combinador: Combinador = o.combinador === "QUALQUER" ? "QUALQUER" : "TODAS"
  const regrasRaw = Array.isArray(o.regras) ? o.regras : []
  const regras = regrasRaw
    .map((r) => {
      if (!r || typeof r !== "object") return null
      const rr = r as Record<string, unknown>
      const campo = String(rr.campo) as CampoCondicao
      const operador = String(rr.operador) as Operador
      if (!(CAMPOS_CONDICAO as readonly string[]).includes(campo)) return null
      if (!(OPERADORES as readonly string[]).includes(operador)) return null
      const valor = (rr.valor === undefined ? null : rr.valor) as string | number | boolean | null
      return { campo, operador, valor }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
  return { combinador, regras }
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

export function matrizParaRegra(row: MatrizDocumental): RegraDocumental {
  const publicoAlvo = ((PUBLICOS_ALVO as readonly string[]).includes(row.publicoAlvo)
    ? row.publicoAlvo
    : "PESSOA_DA_LINHA_RETA") as PublicoAlvo
  const obrigatoriedade = (row.obrigatoriedade === "OPCIONAL" ? "OPCIONAL" : "OBRIGATORIA") as Obrigatoriedade
  const status = ((STATUS_REGRA as readonly string[]).includes(row.status) ? row.status : "RASCUNHO") as StatusRegra
  return {
    id: row.id,
    codigo: row.codigo ?? null,
    nome: row.nome ?? null,
    descricao: row.descricao ?? null,
    status,
    versao: row.versao,
    prioridade: row.prioridade ?? 0,
    vigenciaInicio: iso(row.vigenciaInicio),
    vigenciaFim: iso(row.vigenciaFim),
    aplicaTodosProcessos: !!row.aplicaTodosProcessos,
    tipoProcessoIds: parseIntArray(row.tipoProcessoIds) ?? [row.tipoProcessoId],
    tipoProcessoId: row.tipoProcessoId,
    modalidadeId: row.modalidadeId ?? null,
    paisCode: row.paisCode ?? null,
    regiaoCode: row.regiaoCode ?? null,
    tipoProcessoVersao: row.tipoProcessoVersao ?? null,
    requisitoNome: row.requisitoNome ?? row.nome ?? null,
    documentosAceitos: parseStrArray(row.documentosAceitos) ?? [row.documentTypeCode],
    modoSatisfacao: ((MODOS_SATISFACAO as readonly string[]).includes(row.modoSatisfacao) ? row.modoSatisfacao : "QUALQUER_UM_ATENDE") as ModoSatisfacao,
    documentTypeCode: row.documentTypeCode,
    categoriaCode: row.categoriaCode ?? null,
    obrigatoriedade,
    publicosAlvo: parsePublicoArray(row.publicosAlvo) ?? [publicoAlvo],
    publicoAlvo,
    condicoes: parseCondicoes(row.condicoes),
    // dual-read: novos campos caem para os legados quando ausentes
    faseExigencia: row.faseExigencia ?? row.phaseKey ?? null,
    faseBloqueio: row.faseBloqueio ?? null,
    bloqueiaConclusaoFase: !!row.blocksPhaseCompletion,
    continuaObrigatorioNasFasesSeguintes: !!row.continuaObrigatorioNasFasesSeguintes,
    faseFinalExigencia: row.faseFinalExigencia ?? null,
    obrigatorioAteFinalProcesso: !!row.obrigatorioAteFinalProcesso,
    possuiValidade: !!row.possuiValidade,
    validadeDias: row.validadeDias ?? null,
    exigeDataEmissao: !!row.exigeDataEmissao,
    renovarQuandoExpirado: !!row.renovarQuandoExpirado,
    antecedenciaRenovacaoDias: row.antecedenciaRenovacaoDias ?? null,
  }
}

// Constrói o objeto de dados canônico para create/update, mantendo dual-write nos
// campos legados (required, blocksPhaseCompletion, phaseKey) para não quebrar
// consumidores legados (ex.: matriz-economica) durante a migração.
export interface RegraInput {
  nome?: string | null
  descricao?: string | null
  aplicaTodosProcessos?: boolean
  tipoProcessoIds?: number[]
  tipoProcessoId?: number
  modalidadeId?: number | null
  paisCode?: string | null
  regiaoCode?: string | null
  tipoProcessoVersao?: number | null
  requisitoNome?: string | null
  documentosAceitos?: string[]
  modoSatisfacao?: ModoSatisfacao
  documentTypeCode?: string
  categoriaCode?: string | null
  obrigatoriedade?: Obrigatoriedade
  publicosAlvo?: PublicoAlvo[]
  publicoAlvo?: PublicoAlvo
  condicoes?: ConjuntoCondicoes | null
  faseExigencia?: string | null
  faseBloqueio?: string | null
  bloqueiaConclusaoFase?: boolean
  continuaObrigatorioNasFasesSeguintes?: boolean
  faseFinalExigencia?: string | null
  obrigatorioAteFinalProcesso?: boolean
  possuiValidade?: boolean
  validadeDias?: number | null
  exigeDataEmissao?: boolean
  renovarQuandoExpirado?: boolean
  antecedenciaRenovacaoDias?: number | null
  prioridade?: number
  vigenciaInicio?: string | null
  vigenciaFim?: string | null
}

export function regraInputParaData(input: RegraInput): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  const set = <T>(k: string, v: T | undefined) => { if (v !== undefined) data[k] = v }

  set("nome", input.nome)
  set("descricao", input.descricao)
  set("aplicaTodosProcessos", input.aplicaTodosProcessos)
  set("modalidadeId", input.modalidadeId)
  set("paisCode", input.paisCode)
  set("regiaoCode", input.regiaoCode)
  set("tipoProcessoVersao", input.tipoProcessoVersao)
  set("requisitoNome", input.requisitoNome)
  set("modoSatisfacao", input.modoSatisfacao)
  set("categoriaCode", input.categoriaCode)
  set("prioridade", input.prioridade)

  // APLICABILIDADE múltipla — grava a coleção e o primário (dual-write)
  if (input.tipoProcessoIds !== undefined) {
    data.tipoProcessoIds = input.tipoProcessoIds as unknown
    if (input.tipoProcessoIds.length) data.tipoProcessoId = input.tipoProcessoIds[0]
  } else if (input.tipoProcessoId !== undefined) {
    data.tipoProcessoId = input.tipoProcessoId
    data.tipoProcessoIds = [input.tipoProcessoId] as unknown
  }
  // REQUISITO — documentos aceitos + primário
  if (input.documentosAceitos !== undefined) {
    data.documentosAceitos = input.documentosAceitos as unknown
    if (input.documentosAceitos.length) data.documentTypeCode = input.documentosAceitos[0]
  } else if (input.documentTypeCode !== undefined) {
    data.documentTypeCode = input.documentTypeCode
    data.documentosAceitos = [input.documentTypeCode] as unknown
  }
  // PÚBLICO-ALVO — coleção + primário
  if (input.publicosAlvo !== undefined) {
    data.publicosAlvo = input.publicosAlvo as unknown
    if (input.publicosAlvo.length) data.publicoAlvo = input.publicosAlvo[0]
  } else if (input.publicoAlvo !== undefined) {
    data.publicoAlvo = input.publicoAlvo
    data.publicosAlvo = [input.publicoAlvo] as unknown
  }
  set("faseExigencia", input.faseExigencia)
  set("faseBloqueio", input.faseBloqueio)
  set("continuaObrigatorioNasFasesSeguintes", input.continuaObrigatorioNasFasesSeguintes)
  set("faseFinalExigencia", input.faseFinalExigencia)
  set("obrigatorioAteFinalProcesso", input.obrigatorioAteFinalProcesso)
  set("possuiValidade", input.possuiValidade)
  set("validadeDias", input.validadeDias)
  set("exigeDataEmissao", input.exigeDataEmissao)
  set("renovarQuandoExpirado", input.renovarQuandoExpirado)
  set("antecedenciaRenovacaoDias", input.antecedenciaRenovacaoDias)

  if (input.obrigatoriedade !== undefined) {
    data.obrigatoriedade = input.obrigatoriedade
    data.required = input.obrigatoriedade === "OBRIGATORIA" // dual-write legado
  }
  if (input.bloqueiaConclusaoFase !== undefined) {
    data.blocksPhaseCompletion = input.bloqueiaConclusaoFase // legado = canônico
  }
  if (input.faseExigencia !== undefined) {
    data.phaseKey = input.faseExigencia // dual-write legado (fase)
  }
  if (input.condicoes !== undefined) {
    data.condicoes = input.condicoes === null ? undefined : (input.condicoes as unknown)
    data.conditional = !!(input.condicoes && input.condicoes.regras.length > 0) // legado
  }
  if (input.vigenciaInicio !== undefined) data.vigenciaInicio = input.vigenciaInicio ? new Date(input.vigenciaInicio) : null
  if (input.vigenciaFim !== undefined) data.vigenciaFim = input.vigenciaFim ? new Date(input.vigenciaFim) : null

  return data
}
