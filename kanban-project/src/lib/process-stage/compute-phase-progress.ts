// src/lib/process-stage/compute-phase-progress.ts

/**
 * Calcula quantos documentos satisfazem o critério da fase ATUAL.
 * Reseta a cada mudança de fase — cada fase tem seu próprio 0%/100%.
 *
 * Portado de computePhaseProgress() do HTML do Marco.
 *
 * A FASE do card é o `faseCode` da coluna (fonte da verdade, igual ao
 * resto do sistema). O header reflete ESSE faseCode — o derive pelos
 * status dos documentos só entra como FALLBACK quando o processo ainda
 * não tem faseCode definido. (Antes o header re-derivava sempre, o que
 * mostrava "Análise" mesmo com o card já em Emissão Retificada.)
 *
 * Critérios por fase (espelha STATUS_POS_* da derive-stage):
 *   GENEALOGIA           → 100% sempre (não há docs pra contar)
 *   BUSCA_DOCUMENTAL     → status em SOLICITAR+ (ou terminal)
 *   EMISSAO_DOCUMENTAL   → status em RECEBIDO+
 *   ANALISE_DOCUMENTAL   → status em EM_TRADUCAO+
 *   RETIFICACAO_JUDICIAL → doc que NÃO está em RETIFICANDO conta como concluído
 *   TRADUCAO             → status em TRADUZIDO+
 *   APOSTILAMENTO        → status em APOSTILADO+
 *   AGUARDANDO_PROTOCOLO → status === ENTREGUE
 *   PROTOCOLADO          → 100% (terminal)
 */

import type { StatusDocumento } from "@prisma/client"
import {
  deriveProcessStage,
  STAGE_LABELS,
  type DocForStage,
  type ProcessStage,
} from "./derive-stage"

export interface PhaseProgress {
  stage: ProcessStage
  label: string
  done: number
  total: number
  percent: number
  reason: string
}

const STATUS_TERMINAL = new Set<StatusDocumento>([
  "NAO_ENCONTRADO",
  "INVALIDO",
  "CANCELADO",
])

const POS_BUSCA = new Set<StatusDocumento>([
  "SOLICITAR", "SOLICITADO", "RECEBIDO", "EM_ANALISE", "RETIFICANDO",
  "EM_TRADUCAO", "TRADUZIDO", "EM_APOSTILAMENTO", "APOSTILADO", "ENTREGUE",
])
const POS_EMISSAO = new Set<StatusDocumento>([
  "RECEBIDO", "EM_ANALISE", "RETIFICANDO", "EM_TRADUCAO", "TRADUZIDO",
  "EM_APOSTILAMENTO", "APOSTILADO", "ENTREGUE",
])
const POS_ANALISE = new Set<StatusDocumento>([
  "EM_TRADUCAO", "TRADUZIDO", "EM_APOSTILAMENTO", "APOSTILADO", "ENTREGUE",
])
const POS_TRADUCAO = new Set<StatusDocumento>([
  "TRADUZIDO", "EM_APOSTILAMENTO", "APOSTILADO", "ENTREGUE",
])
const POS_APOSTILAMENTO = new Set<StatusDocumento>([
  "APOSTILADO", "ENTREGUE",
])

type Criteria = (status: StatusDocumento) => boolean

const CRITERIA: Record<ProcessStage, Criteria> = {
  GENEALOGIA: () => true,
  BUSCA_DOCUMENTAL: (s) => STATUS_TERMINAL.has(s) || POS_BUSCA.has(s),
  EMISSAO_DOCUMENTAL: (s) => STATUS_TERMINAL.has(s) || POS_EMISSAO.has(s),
  ANALISE_DOCUMENTAL: (s) => STATUS_TERMINAL.has(s) || POS_ANALISE.has(s),
  RETIFICACAO_JUDICIAL: (s) => STATUS_TERMINAL.has(s) || s !== "RETIFICANDO",
  EMISSAO_DOCUMENTAL_RETIFICADA: (s) =>
    STATUS_TERMINAL.has(s) || POS_EMISSAO.has(s),
  TRADUCAO: (s) => STATUS_TERMINAL.has(s) || POS_TRADUCAO.has(s),
  APOSTILAMENTO: (s) => STATUS_TERMINAL.has(s) || POS_APOSTILAMENTO.has(s),
  AGUARDANDO_PROTOCOLO: (s) => STATUS_TERMINAL.has(s) || s === "ENTREGUE",
  PROTOCOLADO: () => true,
}

/**
 * Mapa FaseCode (enum do Status, define a coluna/fase do card) →
 * ProcessStage (vocabulário interno do progresso). Note que o FaseCode
 * não tem BUSCA_DOCUMENTAL (a coluna é EMISSAO_DOCUMENTAL) nem distingue
 * FINALIZADO no progresso (tratado como terminal = PROTOCOLADO).
 */
export const FASECODE_TO_STAGE: Record<string, ProcessStage> = {
  GENEALOGIA: "GENEALOGIA",
  EMISSAO_DOCUMENTAL: "EMISSAO_DOCUMENTAL",
  ANALISE_DOCUMENTAL: "ANALISE_DOCUMENTAL",
  RETIFICACAO_REGISTROS: "RETIFICACAO_JUDICIAL",
  EMISSAO_DOCUMENTAL_RETIFICADA: "EMISSAO_DOCUMENTAL_RETIFICADA",
  TRADUCAO_JURAMENTADA: "TRADUCAO",
  APOSTILAMENTO: "APOSTILAMENTO",
  AGUARDANDO_PROTOCOLO: "AGUARDANDO_PROTOCOLO",
  PROTOCOLADO: "PROTOCOLADO",
  FINALIZADO: "PROTOCOLADO",
}

export function stageFromFaseCode(faseCode?: string | null): ProcessStage | null {
  if (!faseCode) return null
  return FASECODE_TO_STAGE[faseCode] ?? null
}

/**
 * @param documentos    docs (linha reta) pra contar o progresso
 * @param stageOverride fase REAL do card (do faseCode). Quando informado,
 *                      manda — o derive pelos docs vira só fallback.
 */
export function computePhaseProgress(
  documentos: DocForStage[],
  stageOverride?: ProcessStage | null,
): PhaseProgress {
  const derived = deriveProcessStage(documentos)
  const stage = stageOverride ?? derived.stage
  const required = documentos.filter(
    (d) => d.required !== false && d.status !== "CANCELADO",
  )
  const total = required.length

  if (total === 0) {
    return {
      stage,
      label: STAGE_LABELS[stage],
      done: 0,
      total: 0,
      percent: 0,
      reason: stageOverride ? "Sem documentos obrigatórios nesta fase" : derived.reason,
    }
  }

  const fn = CRITERIA[stage]
  const done = required.filter((d) => fn(d.status)).length
  const percent = Math.round((done / total) * 100)

  return {
    stage,
    label: STAGE_LABELS[stage],
    done,
    total,
    percent,
    reason: stageOverride ? `${done} de ${total} doc(s) prontos nesta fase` : derived.reason,
  }
}