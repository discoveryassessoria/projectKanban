// src/lib/motor/historical-operational-projection.ts
//
// CONTRATO + INFRAESTRUTURA do SNAPSHOT DA PROJEÇÃO OPERACIONAL por ciclo.
//
// Princípio (Central Operacional ÚNICA): ao CONCLUIR um ciclo, serializamos a projeção
// operacional consumida pela Central e a vinculamos à PhaseWorkflowInstance (imutável).
// Ao CONSULTAR uma fase concluída (VIEW), apenas DESSERIALIZAMOS este snapshot — nunca
// reconstruímos a tela lendo tabelas vivas do domínio.
//
// Não snapshotamos tabelas de domínio nem duplicamos entidades: guardamos apenas o
// PAYLOAD que a interface usa para renderizar a fase, num envelope VERSIONADO que pode ser
// enriquecido incrementalmente (cards/queue/panels são preenchidos conforme cada fase de
// domínio é migrada; nesta fundação capturamos workflow/documents/needs/metrics).

import type { Prisma, PrismaClient } from "@prisma/client"

export const OPERATIONAL_SNAPSHOT_SCHEMA_VERSION = 1

// Estados terminais "feitos" de um passo (métrica de progresso materializada).
const STEP_DONE = new Set(["CONCLUIDO", "EXECUTADO", "DISPENSADO"])

export interface HistoricalWorkflowStep {
  id: number
  stepKey: string
  ordem: number
  tipo: string
  status: string
  obrigatorio: boolean
  responsavelId: number | null
  prazo: string | null
  bloqueadoManual: boolean
  motivo: string | null
  completedAt: string | null
}

export interface HistoricalDocRef {
  stepInstanceId: number
  stepKey: string
  documentoId: number
  stepStatus: string
}

export interface HistoricalNeedRef {
  stepInstanceId: number
  stepKey: string
  necessidadeId: number
  stepStatus: string
}

export interface HistoricalBlock {
  stepInstanceId: number
  stepKey: string
  status: string
  bloqueadoManual: boolean
  motivo: string | null
}

/** Envelope IMUTÁVEL — exatamente o que a Central consome para renderizar a fase daquele ciclo. */
export interface HistoricalOperationalProjection {
  schemaVersion: number
  faseCode: string | null
  faseMacroKey: string
  ciclo: number
  capturedAt: string
  metrics: { percentage: number; completedWeight: number; totalWeight: number }
  workflow: { steps: HistoricalWorkflowStep[] }
  documents: HistoricalDocRef[]
  needs: HistoricalNeedRef[]
  blocks: HistoricalBlock[]
  // Seções ricas do payload da Central (cards/fila/painéis/decisões). Preenchidas conforme
  // cada fase de domínio passa a serializar sua projeção na conclusão. null = não capturado
  // nesta versão do snapshot (VIEW usa o que houver, sem cair para estado vivo).
  cards: unknown | null
  queue: unknown | null
  panels: unknown | null
  decisions: unknown | null
}

/** Shape mínimo de um passo materializado que o serializador consome (in-transaction safe). */
export interface StepForSnapshot {
  id: number
  stepKey: string
  ordem: number
  tipo: unknown
  status: unknown
  obrigatorio: boolean
  responsavelId: number | null
  prazo: Date | null
  bloqueadoManual: boolean
  motivo: string | null
  completedAt: Date | null
  documentoId: number | null
  necessidadeId: number | null
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

/**
 * Constrói o envelope da projeção histórica a partir dos passos MATERIALIZADOS do ciclo.
 * Puro/determinístico (recebe `capturedAt` de fora — Date.now não é usado aqui).
 */
export function buildOperationalSnapshot(input: {
  faseCode: string | null
  faseMacroKey: string
  ciclo: number
  capturedAt: string
  steps: StepForSnapshot[]
}): HistoricalOperationalProjection {
  const steps: HistoricalWorkflowStep[] = input.steps.map((s) => ({
    id: s.id,
    stepKey: s.stepKey,
    ordem: s.ordem,
    tipo: String(s.tipo),
    status: String(s.status),
    obrigatorio: s.obrigatorio,
    responsavelId: s.responsavelId,
    prazo: iso(s.prazo),
    bloqueadoManual: s.bloqueadoManual,
    motivo: s.motivo,
    completedAt: iso(s.completedAt),
  }))

  const totalWeight = steps.length
  const completedWeight = steps.filter((s) => STEP_DONE.has(s.status)).length
  const percentage = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0

  const documents: HistoricalDocRef[] = input.steps
    .filter((s) => s.documentoId != null)
    .map((s) => ({ stepInstanceId: s.id, stepKey: s.stepKey, documentoId: s.documentoId as number, stepStatus: String(s.status) }))

  const needs: HistoricalNeedRef[] = input.steps
    .filter((s) => s.necessidadeId != null)
    .map((s) => ({ stepInstanceId: s.id, stepKey: s.stepKey, necessidadeId: s.necessidadeId as number, stepStatus: String(s.status) }))

  const blocks: HistoricalBlock[] = input.steps
    .filter((s) => s.bloqueadoManual || String(s.status) === "BLOQUEADO")
    .map((s) => ({ stepInstanceId: s.id, stepKey: s.stepKey, status: String(s.status), bloqueadoManual: s.bloqueadoManual, motivo: s.motivo }))

  return {
    schemaVersion: OPERATIONAL_SNAPSHOT_SCHEMA_VERSION,
    faseCode: input.faseCode,
    faseMacroKey: input.faseMacroKey,
    ciclo: input.ciclo,
    capturedAt: input.capturedAt,
    metrics: { percentage, completedWeight, totalWeight },
    workflow: { steps },
    documents,
    needs,
    blocks,
    cards: null,
    queue: null,
    panels: null,
    decisions: null,
  }
}

/** Cliente Prisma OU transação — o hook de conclusão passa a `tx`. */
type Db = PrismaClient | Prisma.TransactionClient

/**
 * Captura e GRAVA o snapshot da projeção na instância que está concluindo — IMUTÁVEL:
 * só grava se `operationalSnapshot` ainda for null (nunca reescreve um snapshot existente).
 * Chamado dentro da transação de conclusão do PhaseAdvanceService.
 */
export async function captureOperationalSnapshot(
  db: Db,
  args: { instanceId: number; faseCode: string | null; faseMacroKey: string; ciclo: number; capturedAt: string },
): Promise<boolean> {
  const inst = await db.phaseWorkflowInstance.findUnique({
    where: { id: args.instanceId },
    select: {
      operationalSnapshot: true,
      steps: {
        orderBy: { ordem: "asc" },
        select: {
          id: true, stepKey: true, ordem: true, tipo: true, status: true, obrigatorio: true,
          responsavelId: true, prazo: true, bloqueadoManual: true, motivo: true, completedAt: true,
          documentoId: true, necessidadeId: true,
        },
      },
    },
  })
  if (!inst) return false
  if (inst.operationalSnapshot != null) return false // imutável — nunca reescreve

  const snapshot = buildOperationalSnapshot({
    faseCode: args.faseCode,
    faseMacroKey: args.faseMacroKey,
    ciclo: args.ciclo,
    capturedAt: args.capturedAt,
    steps: inst.steps,
  })

  await db.phaseWorkflowInstance.update({
    where: { id: args.instanceId },
    data: {
      operationalSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      operationalSnapshotSchemaVersion: OPERATIONAL_SNAPSHOT_SCHEMA_VERSION,
    },
  })
  return true
}

export type ReadHistoricalResult =
  | { available: true; projection: HistoricalOperationalProjection }
  | { available: false; faseMacroKey: string | null; ciclo: number | null; reason: "SEM_SNAPSHOT" | "INSTANCIA_INEXISTENTE" }

/**
 * Lê a projeção histórica de uma instância (VIEW). Apenas DESSERIALIZA o snapshot imutável;
 * nunca reconstrói a partir de tabelas vivas. Retorna `available:false` quando o ciclo foi
 * concluído antes desta infra (ou a fase de domínio ainda não serializa sua projeção).
 */
export async function readHistoricalProjection(
  db: Db,
  instanceId: number,
): Promise<ReadHistoricalResult> {
  const inst = await db.phaseWorkflowInstance.findUnique({
    where: { id: instanceId },
    select: { operationalSnapshot: true, faseMacroKey: true, ciclo: true },
  })
  if (!inst) return { available: false, faseMacroKey: null, ciclo: null, reason: "INSTANCIA_INEXISTENTE" }
  if (inst.operationalSnapshot == null) {
    return { available: false, faseMacroKey: inst.faseMacroKey, ciclo: inst.ciclo, reason: "SEM_SNAPSHOT" }
  }
  return { available: true, projection: inst.operationalSnapshot as unknown as HistoricalOperationalProjection }
}
