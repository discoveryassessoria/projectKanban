// src/lib/process-stage/compute-phase-progress.ts

/**
 * Calcula quantos documentos satisfazem o critério da fase ATUAL.
 * Reseta a cada mudança de fase — cada fase tem seu próprio 0%/100%.
 *
 * Portado de computePhaseProgress() do HTML do Marco.
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

export function computePhaseProgress(
  documentos: DocForStage[],
): PhaseProgress {
  const derived = deriveProcessStage(documentos)
  const required = documentos.filter(
    (d) => d.required !== false && d.status !== "CANCELADO",
  )
  const total = required.length

  if (total === 0) {
    return {
      stage: derived.stage,
      label: STAGE_LABELS[derived.stage],
      done: 0,
      total: 0,
      percent: 0,
      reason: derived.reason,
    }
  }

  const fn = CRITERIA[derived.stage]
  const done = required.filter((d) => fn(d.status)).length
  const percent = Math.round((done / total) * 100)

  return {
    stage: derived.stage,
    label: STAGE_LABELS[derived.stage],
    done,
    total,
    percent,
    reason: derived.reason,
  }
}