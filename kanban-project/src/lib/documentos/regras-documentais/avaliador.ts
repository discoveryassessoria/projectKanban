// src/lib/documentos/regras-documentais/avaliador.ts
//
// AVALIADOR CANÔNICO das Regras Documentais — PURO. Só calcula e retorna.
// NÃO cria Documento, NÃO cria NecessidadeDocumental, NÃO cria tarefa, NÃO altera
// processo/árvore/fase. Recebe o conjunto de regras + contexto e devolve o que se
// aplica, com justificativa legível.

import {
  type RegraDocumental, type ContextoAvaliacao, type SujeitoContexto,
  type PublicoAlvo, type ResultadoRegra, type ResultadoAvaliacao, type ValidadeCalculada,
  type ModoSatisfacao, PUBLICO_ALVO_LABEL,
} from "./tipos"
import { avaliarConjunto, justificativaDoConjunto } from "./condicoes"

// ---- público-alvo: o sujeito pertence ao público da regra? ----

export function publicoAlvoAplica(publico: PublicoAlvo, s: SujeitoContexto): { aplica: boolean; motivo: string } {
  const arvore = s.ehPessoaArvore === true
  switch (publico) {
    case "REQUERENTE":
      return s.requerente === true ? { aplica: true, motivo: "é requerente" } : { aplica: false, motivo: "não é requerente" }
    case "CONTRATANTE":
      return s.contratante === true ? { aplica: true, motivo: "é contratante" } : { aplica: false, motivo: "não é contratante" }
    case "PESSOA_DA_ARVORE_COM_DOCUMENTACAO":
      if (!arvore) return { aplica: false, motivo: "não é pessoa da árvore" }
      return s.precisaDeDocumentacao === true ? { aplica: true, motivo: "pessoa da árvore com documentação" } : { aplica: false, motivo: "pessoa da árvore sem documentação" }
    case "PESSOA_DA_LINHA_RETA":
      if (!arvore) return { aplica: false, motivo: "não é pessoa da árvore" }
      return s.linhaReta === true ? { aplica: true, motivo: "pessoa da linha reta" } : { aplica: false, motivo: "pessoa fora da linha reta" }
    case "PESSOA_FORA_DA_LINHA_RETA":
      if (!arvore) return { aplica: false, motivo: "não é pessoa da árvore" }
      return s.linhaReta === false ? { aplica: true, motivo: "pessoa fora da linha reta" } : { aplica: false, motivo: "pessoa da linha reta" }
    case "TODAS_AS_PESSOAS_DA_ARVORE":
      return arvore ? { aplica: true, motivo: "pessoa da árvore" } : { aplica: false, motivo: "não é pessoa da árvore" }
    default:
      return { aplica: false, motivo: "público-alvo desconhecido" }
  }
}

// múltiplos públicos: aplica se QUALQUER um casar (com o motivo do que casou/faltou)
export function publicoAlvoMultiploAplica(publicos: PublicoAlvo[], s: SujeitoContexto): { aplica: boolean; motivo: string } {
  const lista = publicos.length ? publicos : []
  if (lista.length === 0) return { aplica: false, motivo: "nenhum público-alvo definido" }
  const resultados = lista.map((p) => ({ p, r: publicoAlvoAplica(p, s) }))
  const casou = resultados.find((x) => x.r.aplica)
  if (casou) return { aplica: true, motivo: casou.r.motivo }
  return { aplica: false, motivo: resultados.map((x) => `${PUBLICO_ALVO_LABEL[x.p]}: ${x.r.motivo}`).join(" / ") }
}

// ---- satisfação do requisito por seus documentos aceitos ----
export function avaliarSatisfacaoRequisito(modo: ModoSatisfacao, aceitos: string[], presentes: string[]): boolean {
  const set = new Set(presentes)
  if (aceitos.length === 0) return false
  return modo === "TODOS_SAO_EXIGIDOS" ? aceitos.every((c) => set.has(c)) : aceitos.some((c) => set.has(c))
}

// ---- validade / vencimento ----

const DIA_MS = 86400000

export function calcularValidade(regra: RegraDocumental, s: SujeitoContexto, dataReferenciaISO: string): ValidadeCalculada {
  const base: ValidadeCalculada = {
    possuiValidade: !!regra.possuiValidade,
    validadeDias: regra.validadeDias ?? null,
    dataEmissao: s.dataEmissaoDocumento ?? null,
    vencimento: null,
    expirado: false,
    precisaRenovar: false,
    diasParaVencer: null,
  }
  if (!regra.possuiValidade || !regra.validadeDias) return base
  if (!s.dataEmissaoDocumento) return base // sem data de emissão não dá pra calcular vencimento

  const emissao = new Date(s.dataEmissaoDocumento)
  const ref = new Date(dataReferenciaISO)
  if (isNaN(emissao.getTime()) || isNaN(ref.getTime())) return base

  const vencimento = new Date(emissao.getTime() + regra.validadeDias * DIA_MS)
  const diasParaVencer = Math.floor((vencimento.getTime() - ref.getTime()) / DIA_MS)
  const expirado = ref.getTime() > vencimento.getTime()
  return {
    ...base,
    vencimento: vencimento.toISOString(),
    expirado,
    precisaRenovar: expirado && !!regra.renovarQuandoExpirado,
    diasParaVencer,
  }
}

// ---- vigência / status ----

function regraVigenteEStatus(regra: RegraDocumental, dataReferenciaISO: string): { ok: boolean; motivo: string | null } {
  if (regra.status !== "PUBLICADA") return { ok: false, motivo: `regra ${regra.status.toLowerCase()} (não avaliada)` }
  const ref = new Date(dataReferenciaISO).getTime()
  if (regra.vigenciaInicio) {
    const ini = new Date(regra.vigenciaInicio).getTime()
    if (!isNaN(ini) && ref < ini) return { ok: false, motivo: "regra ainda não vigente" }
  }
  if (regra.vigenciaFim) {
    const fim = new Date(regra.vigenciaFim).getTime()
    if (!isNaN(fim) && ref > fim) return { ok: false, motivo: "regra fora de vigência" }
  }
  return { ok: true, motivo: null }
}

function aplicabilidadeProcesso(regra: RegraDocumental, ctx: ContextoAvaliacao): { ok: boolean; motivo: string | null } {
  // aplica a TODOS os processos, ou o processo do contexto está na coleção
  if (regra.aplicaTodosProcessos) return { ok: true, motivo: null }
  const ids = regra.tipoProcessoIds.length ? regra.tipoProcessoIds : [regra.tipoProcessoId]
  if (!ids.includes(ctx.tipoProcessoId)) return { ok: false, motivo: "tipo de processo fora do escopo da regra" }
  return { ok: true, motivo: null }
  // modalidade/país/região saíram do ESCOPO — quando necessários, viram condição.
}

// ---- avaliação de UMA regra contra o contexto ----

export function avaliarRegra(regra: RegraDocumental, ctx: ContextoAvaliacao): ResultadoRegra {
  // injeta a modalidade do contexto no sujeito (para condição "modalidade")
  const s: SujeitoContexto = { ...ctx.sujeito, modalidade: ctx.sujeito.modalidade ?? ctx.modalidadeId ?? null }
  const validade = calcularValidade(regra, s, ctx.dataReferencia)
  const publicos = regra.publicosAlvo.length ? regra.publicosAlvo : [regra.publicoAlvo]
  const base: Omit<ResultadoRegra, "aplicavel" | "motivoNaoAplicavel" | "justificativa" | "condicoesSatisfeitas" | "condicoesNaoSatisfeitas"> = {
    regraId: regra.id,
    regraNome: regra.nome,
    requisitoNome: regra.requisitoNome ?? regra.nome,
    documentTypeCode: regra.documentTypeCode,
    documentosAceitos: regra.documentosAceitos.length ? regra.documentosAceitos : [regra.documentTypeCode],
    modoSatisfacao: regra.modoSatisfacao,
    publicoAlvo: regra.publicoAlvo,
    publicosAlvo: publicos,
    obrigatoriedade: regra.obrigatoriedade,
    faseExigencia: regra.faseExigencia,
    faseBloqueio: regra.faseBloqueio,
    bloqueiaConclusaoFase: regra.bloqueiaConclusaoFase,
    obrigatorioAteFinalProcesso: regra.obrigatorioAteFinalProcesso,
    validade,
  }

  // 1) status + vigência
  const vig = regraVigenteEStatus(regra, ctx.dataReferencia)
  if (!vig.ok) {
    return { ...base, aplicavel: false, motivoNaoAplicavel: vig.motivo, justificativa: "", condicoesSatisfeitas: [], condicoesNaoSatisfeitas: [] }
  }
  // 2) aplicabilidade do processo (lista/todos)
  const proc = aplicabilidadeProcesso(regra, ctx)
  if (!proc.ok) {
    return { ...base, aplicavel: false, motivoNaoAplicavel: proc.motivo, justificativa: "", condicoesSatisfeitas: [], condicoesNaoSatisfeitas: [] }
  }
  // 3) público-alvo (múltiplo — aplica se qualquer um casar)
  const pub = publicoAlvoMultiploAplica(publicos, s)
  if (!pub.aplica) {
    return { ...base, aplicavel: false, motivoNaoAplicavel: pub.motivo, justificativa: "", condicoesSatisfeitas: [], condicoesNaoSatisfeitas: [] }
  }
  // 4) condições
  const cond = avaliarConjunto(regra.condicoes, s)
  if (!cond.satisfeito) {
    return {
      ...base, aplicavel: false,
      motivoNaoAplicavel: `condição não satisfeita: ${cond.naoSatisfeitas.join("; ")}`,
      justificativa: "", condicoesSatisfeitas: cond.satisfeitas, condicoesNaoSatisfeitas: cond.naoSatisfeitas,
    }
  }

  // aplicável
  const just = justificativaDoConjunto(regra.condicoes)
  return {
    ...base, aplicavel: true, motivoNaoAplicavel: null,
    justificativa: just, condicoesSatisfeitas: cond.satisfeitas, condicoesNaoSatisfeitas: [],
  }
}

// ---- avaliação de TODAS as regras para um sujeito ----

export function avaliarRegrasDocumentais(ctx: ContextoAvaliacao): ResultadoAvaliacao {
  const aplicaveis: ResultadoRegra[] = []
  const naoAplicaveis: ResultadoRegra[] = []
  for (const regra of ctx.regras) {
    const r = avaliarRegra(regra, ctx)
    ;(r.aplicavel ? aplicaveis : naoAplicaveis).push(r)
  }
  // ordena aplicáveis por prioridade da regra (desc) e depois por documento
  const prioridadeDe = (id: number) => ctx.regras.find((x) => x.id === id)?.prioridade ?? 0
  aplicaveis.sort((a, b) => prioridadeDe(b.regraId) - prioridadeDe(a.regraId) || a.documentTypeCode.localeCompare(b.documentTypeCode))
  return { sujeitoNome: ctx.sujeito.nome ?? String(ctx.sujeito.id ?? "sujeito"), aplicaveis, naoAplicaveis }
}
