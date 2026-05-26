// src/lib/process-stage/derive-stage.ts

/**
 * Motor de derivação de fase do processo — portado da lógica de gates do
 * HTML do Marco (ProcessOrchestrator.evaluate em discovery-bancada.html).
 *
 * REGRA ABSOLUTA: process.stage é GATE MACRO SEQUENCIAL.
 * Cada gate só fecha quando TODOS os documentos obrigatórios cumprem o
 * critério desse gate. Documentos avançam EM PARALELO dentro do gate.
 *
 * Esta função é PURA e DETERMINÍSTICA — não tem side effects, não toca em
 * banco. Recebe a lista de documentos do processo (apenas os campos que
 * importam) e devolve a fase derivada + o motivo legível.
 */

import type { StatusDocumento } from "@prisma/client"

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type ProcessStage =
  | "GENEALOGIA"
  | "BUSCA_DOCUMENTAL"
  | "EMISSAO_DOCUMENTAL"
  | "ANALISE_DOCUMENTAL"
  | "RETIFICACAO_JUDICIAL"
  | "EMISSAO_DOCUMENTAL_RETIFICADA"
  | "TRADUCAO"
  | "APOSTILAMENTO"
  | "AGUARDANDO_PROTOCOLO"
  | "PROTOCOLADO"

/** Subset de Documento que importa pra derivação. */
export interface DocForStage {
  id: number
  status: StatusDocumento
  /**
   * Se o documento NÃO entra na conta da fase (porque é opcional,
   * extra, etc). Por enquanto sempre true; mantenho a flag pra
   * preparar futuro `Documento.obrigatorio`.
   */
  required?: boolean
}

export interface DerivedStage {
  stage: ProcessStage
  reason: string
  /** Contagem por status — útil pra debug e logs. */
  countByStatus: Partial<Record<StatusDocumento, number>>
}

// ─────────────────────────────────────────────────────────────────────────────
// Conjuntos de status que importam pra cada gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estados terminais "não conta como ainda em produção".
 * Documentos nesses estados são ignorados nos gates de progresso
 * (NÃO travam o gate, mas também não contam como concluídos do gate).
 */
const STATUS_TERMINAL = new Set<StatusDocumento>([
  "NAO_ENCONTRADO",
  "INVALIDO",
  "CANCELADO",
])

/**
 * Estados "busca resolvida" — o documento já foi localizado no cartório
 * (ou está num estado posterior). Significa que o gate 1 fechou pra ele.
 *
 * PENDENTE e EM_BUSCA → busca ainda em andamento (gate aberto)
 * SOLICITAR em diante → busca resolvida
 */
const STATUS_POS_BUSCA = new Set<StatusDocumento>([
  "SOLICITAR",
  "SOLICITADO",
  "RECEBIDO",
  "EM_ANALISE",
  "RETIFICANDO",
  "EM_TRADUCAO",
  "TRADUZIDO",
  "EM_APOSTILAMENTO",
  "APOSTILADO",
  "ENTREGUE",
])

/**
 * Estados "documento já recebido do cartório" — fechou o gate 2.
 */
const STATUS_POS_EMISSAO = new Set<StatusDocumento>([
  "RECEBIDO",
  "EM_ANALISE",
  "RETIFICANDO",
  "EM_TRADUCAO",
  "TRADUZIDO",
  "EM_APOSTILAMENTO",
  "APOSTILADO",
  "ENTREGUE",
])

/**
 * Estados "documento já passou pela análise jurídica" — fechou o gate 3.
 * RECEBIDO ainda está aguardando análise → não conta.
 */
const STATUS_POS_ANALISE = new Set<StatusDocumento>([
  "EM_TRADUCAO",
  "TRADUZIDO",
  "EM_APOSTILAMENTO",
  "APOSTILADO",
  "ENTREGUE",
])

/**
 * Estados "documento já traduzido" — fechou o gate 5.
 */
const STATUS_POS_TRADUCAO = new Set<StatusDocumento>([
  "TRADUZIDO",
  "EM_APOSTILAMENTO",
  "APOSTILADO",
  "ENTREGUE",
])

/**
 * Estados "documento já apostilado" — fechou o gate 6.
 */
const STATUS_POS_APOSTILAMENTO = new Set<StatusDocumento>([
  "APOSTILADO",
  "ENTREGUE",
])

// ─────────────────────────────────────────────────────────────────────────────
// Função principal: deriveProcessStage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aplica os 8 gates em ordem e devolve a fase que o processo deveria estar.
 *
 * Ordem de avaliação (1º que bate vence):
 *   0. GENEALOGIA              — se não há documentos
 *   1. BUSCA_DOCUMENTAL        — algum doc sem busca resolvida
 *   2. EMISSAO_DOCUMENTAL      — algum doc ainda não recebido do cartório
 *   3. RETIFICACAO_JUDICIAL    — algum doc em RETIFICANDO (gate especial)
 *   4. ANALISE_DOCUMENTAL      — algum doc ainda em análise (RECEBIDO/EM_ANALISE)
 *   5. TRADUCAO                — algum doc ainda em tradução
 *   6. APOSTILAMENTO           — algum doc ainda em apostilamento
 *   7. AGUARDANDO_PROTOCOLO    — todos apostilados, aguardando protocolo
 *   8. PROTOCOLADO             — todos entregues
 */
export function deriveProcessStage(documentos: DocForStage[]): DerivedStage {
  // Filtra apenas obrigatórios e não-cancelados
  const required = documentos.filter(
    (d) => d.required !== false && d.status !== "CANCELADO",
  )

  // Contagem por status (útil pra logs e mensagens)
  const countByStatus: Partial<Record<StatusDocumento, number>> = {}
  for (const d of required) {
    countByStatus[d.status] = (countByStatus[d.status] || 0) + 1
  }
  const c = (s: StatusDocumento) => countByStatus[s] || 0

  // ─── Gate 0: GENEALOGIA ────────────────────────────────────────────────
  if (required.length === 0) {
    return {
      stage: "GENEALOGIA",
      reason: "Sem documentos obrigatórios — montar árvore primeiro",
      countByStatus,
    }
  }

  // ─── Gate 1: BUSCA_DOCUMENTAL ─────────────────────────────────────────
  // Fecha quando TODOS os docs já têm busca resolvida (ou são terminais).
  const semBusca = required.filter(
    (d) => !STATUS_POS_BUSCA.has(d.status) && !STATUS_TERMINAL.has(d.status),
  )
  if (semBusca.length > 0) {
    return {
      stage: "BUSCA_DOCUMENTAL",
      reason: `${semBusca.length} doc(s) sem busca resolvida · ${c("PENDENTE")} pendente(s) · ${c("EM_BUSCA")} em busca`,
      countByStatus,
    }
  }

  // ─── Gate 2: EMISSAO_DOCUMENTAL ───────────────────────────────────────
  // Busca fechada. Fecha quando todos foram recebidos do cartório.
  const semEmissao = required.filter(
    (d) => !STATUS_POS_EMISSAO.has(d.status) && !STATUS_TERMINAL.has(d.status),
  )
  if (semEmissao.length > 0) {
    return {
      stage: "EMISSAO_DOCUMENTAL",
      reason: `${semEmissao.length} doc(s) aguardando cartório · ${c("SOLICITAR")} a solicitar · ${c("SOLICITADO")} solicitado(s)`,
      countByStatus,
    }
  }

  // ─── Gate 3: RETIFICACAO_JUDICIAL (precede análise) ───────────────────
  // Se algum doc está em RETIFICANDO, processo trava aqui até resolver.
  const emRetificacao = required.filter((d) => d.status === "RETIFICANDO")
  if (emRetificacao.length > 0) {
    return {
      stage: "RETIFICACAO_JUDICIAL",
      reason: `${emRetificacao.length} doc(s) em retificação judicial`,
      countByStatus,
    }
  }

  // ─── Gate 4: ANALISE_DOCUMENTAL ───────────────────────────────────────
  // Recebidos do cartório. Fecha quando todos passaram pela análise jurídica.
  // RECEBIDO e EM_ANALISE ainda estão aguardando análise.
  const semAnalise = required.filter(
    (d) => !STATUS_POS_ANALISE.has(d.status) && !STATUS_TERMINAL.has(d.status),
  )
  if (semAnalise.length > 0) {
    return {
      stage: "ANALISE_DOCUMENTAL",
      reason: `${c("RECEBIDO")} recebido(s) · ${c("EM_ANALISE")} em análise · aguardando validação individual`,
      countByStatus,
    }
  }

  // ─── Gate 5: TRADUCAO ─────────────────────────────────────────────────
  // Análise validada. Fecha quando todos traduzidos.
  const semTraducao = required.filter(
    (d) => !STATUS_POS_TRADUCAO.has(d.status) && !STATUS_TERMINAL.has(d.status),
  )
  if (semTraducao.length > 0) {
    return {
      stage: "TRADUCAO",
      reason: `${c("EM_TRADUCAO")} em tradução · aguardando tradução juramentada`,
      countByStatus,
    }
  }

  // ─── Gate 6: APOSTILAMENTO ────────────────────────────────────────────
  // Traduzidos. Fecha quando todos apostilados.
  const semApostilamento = required.filter(
    (d) => !STATUS_POS_APOSTILAMENTO.has(d.status) && !STATUS_TERMINAL.has(d.status),
  )
  if (semApostilamento.length > 0) {
    return {
      stage: "APOSTILAMENTO",
      reason: `${c("EM_APOSTILAMENTO")} em apostilamento · aguardando apostila`,
      countByStatus,
    }
  }

  // ─── Gate 7: AGUARDANDO_PROTOCOLO ─────────────────────────────────────
  // Tudo apostilado. Fecha quando todos foram entregues/protocolados.
  const semProtocolo = required.filter(
    (d) => d.status !== "ENTREGUE" && !STATUS_TERMINAL.has(d.status),
  )
  if (semProtocolo.length > 0) {
    return {
      stage: "AGUARDANDO_PROTOCOLO",
      reason: `${c("APOSTILADO")} apostilado(s) · aguardando protocolo final`,
      countByStatus,
    }
  }

  // ─── Gate 8: PROTOCOLADO ──────────────────────────────────────────────
  return {
    stage: "PROTOCOLADO",
    reason: "Processo protocolado",
    countByStatus,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels amigáveis pra UI
// ─────────────────────────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<ProcessStage, string> = {
  GENEALOGIA: "Genealogia",
  BUSCA_DOCUMENTAL: "Busca Documental",
  EMISSAO_DOCUMENTAL: "Emissão de Documentos",
  ANALISE_DOCUMENTAL: "Análise Documental",
  RETIFICACAO_JUDICIAL: "Retificação",
  EMISSAO_DOCUMENTAL_RETIFICADA: "Emissão Retificada",
  TRADUCAO: "Tradução",
  APOSTILAMENTO: "Apostilamento",
  AGUARDANDO_PROTOCOLO: "Aguardando Protocolo",
  PROTOCOLADO: "Protocolado",
}

/**
 * Mapeamento de ProcessStage → nome do Status no banco.
 * Usado pra encontrar o `statusId` correto e mover o card kanban.
 *
 * Quando há fallback (TRADUCAO, EMISSAO_DOCUMENTAL_RETIFICADA), uso a
 * coluna mais próxima conceitualmente. Quando Marco criar essas colunas
 * no banco, basta trocar pelo nome real.
 */
export const STAGE_TO_STATUS_NAME: Record<ProcessStage, string> = {
  GENEALOGIA: "Genealogia",
  BUSCA_DOCUMENTAL: "Busca Documental",
  EMISSAO_DOCUMENTAL: "Emissão de Documentos",
  ANALISE_DOCUMENTAL: "Análise Documental",
  RETIFICACAO_JUDICIAL: "Retificação",
  EMISSAO_DOCUMENTAL_RETIFICADA: "Retificação",   // fallback: sem coluna própria
  TRADUCAO: "Análise Documental",                  // fallback: sem coluna própria
  APOSTILAMENTO: "Apostilamento",
  AGUARDANDO_PROTOCOLO: "Aguardando Protocolo",
  PROTOCOLADO: "Protocolado",
}