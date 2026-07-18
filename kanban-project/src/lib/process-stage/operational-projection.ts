// src/lib/process-stage/operational-projection.ts
//
// CAMADA DE I/O do RESOLVER CANÔNICO. Carrega o snapshot do banco e delega TODO o
// cálculo ao núcleo puro (operational-projection-core). Duas entradas:
//
//   • resolveOperationalProjection(processId)        — 1 processo.
//   • resolveOperationalProjectionBatch(processIds)  — N processos, POUCAS queries
//     agregadas (custo CONSTANTE em nº de queries, sem N+1). Usado pelo Kanban.
//
// O single delega ao batch (mesma carga/mesma lógica) para eliminar qualquer
// divergência entre as duas formas. Nenhum consumidor recalcula progresso/bloqueio:
// tudo nasce daqui.

import { prisma } from "@/lib/prisma"
import { WorkflowInstanceStatus } from "@prisma/client"
import { getFase, phaseKeyToFaseCode } from "./fases-catalog"
import { itemCatalogosDeCertidao } from "@/src/lib/documentos/natureza-certidao"
import {
  buildOperationalProjection,
  type OperationalProjection,
  type ProjectionInput,
  type GateStepData,
  type NecessidadeData,
  type DocumentoData,
} from "@/src/lib/motor/operational-projection-core"

export type { OperationalProjection } from "@/src/lib/motor/operational-projection-core"

/** Shape mínimo de um PhaseWorkflowStepInstance (+ tarefas) que o gate/projeção consomem. */
export interface StepInstanceLike {
  id: number
  stepKey: string
  ordem: number
  status: string
  obrigatorio: boolean
  tipo: unknown
  geraTarefa: boolean
  documentoId: number | null
  necessidadeId: number | null
  bloqueadoManual: boolean
  motivo: string | null
  snapshot: unknown
  dependeDeStepKeys: unknown
  tarefas: Array<{ id: number; statusTarefa: unknown; responsavelId: number | null }>
}

/** Mapeia um passo persistido (Prisma) para o snapshot puro GateStepData. Fonte ÚNICA
 *  desse mapeamento — reusada pela projeção (batch/single) e pelo BlockingEngine. */
export function mapStepToGate(s: StepInstanceLike): GateStepData {
  return {
    id: s.id,
    stepKey: s.stepKey,
    ordem: s.ordem,
    status: String(s.status),
    obrigatorio: s.obrigatorio,
    tipo: String(s.tipo),
    geraTarefa: s.geraTarefa,
    documentoId: s.documentoId,
    necessidadeId: s.necessidadeId,
    bloqueadoManual: s.bloqueadoManual,
    motivo: s.motivo ?? null,
    snapshot: (s.snapshot as GateStepData["snapshot"]) ?? null,
    dependeDeStepKeys: (s.dependeDeStepKeys as string[] | null) ?? null,
    tarefas: s.tarefas.map((t) => ({ id: t.id, statusTarefa: String(t.statusTarefa), responsavelId: t.responsavelId })),
  }
}

const INSTANCIA_ATIVA: WorkflowInstanceStatus[] = [
  WorkflowInstanceStatus.ATIVO,
  WorkflowInstanceStatus.AGUARDANDO,
  WorkflowInstanceStatus.BLOQUEADO,
]

/** Projeção operacional oficial de UM processo. */
export async function resolveOperationalProjection(processId: number): Promise<OperationalProjection> {
  const [proj] = await resolveOperationalProjectionBatch([processId])
  return proj
}

/**
 * Projeção operacional oficial de N processos em POUCAS queries agregadas.
 * Preserva a ordem de `processIds`. Processos inexistentes recebem projeção "vazia"
 * (activePhase=null) — nunca lançam.
 */
export async function resolveOperationalProjectionBatch(
  processIds: number[],
): Promise<OperationalProjection[]> {
  const ids = [...new Set(processIds.filter((n) => Number.isFinite(n)))]
  if (ids.length === 0) return []

  // (1) Processos.
  const processos = await prisma.processo.findMany({
    where: { id: { in: ids } },
    select: { id: true, faseAtualKey: true, arvoreId: true },
  })
  const procById = new Map(processos.map((p) => [p.id, p]))
  const arvoreIds = [...new Set(processos.map((p) => p.arvoreId).filter((x): x is number => x != null))]

  // (2) Instâncias ATIVAS + passos (+ tarefas idempotentes) de TODAS de uma vez.
  const instancias = await prisma.phaseWorkflowInstance.findMany({
    where: { processoId: { in: ids }, status: { in: INSTANCIA_ATIVA } },
    orderBy: { ciclo: "desc" },
    include: {
      steps: {
        include: { tarefas: { where: { chaveIdempotencia: { not: null } }, select: { id: true, statusTarefa: true, responsavelId: true } } },
        orderBy: { ordem: "asc" },
      },
    },
  })
  // Por processo, a instância ATIVA da FASE ATUAL com maior ciclo (findMany já veio desc).
  const instByProc = new Map<number, (typeof instancias)[number]>()
  for (const inst of instancias) {
    const proc = procById.get(inst.processoId)
    if (!proc || proc.faseAtualKey == null) continue
    if (inst.faseMacroKey !== proc.faseAtualKey) continue
    if (!instByProc.has(inst.processoId)) instByProc.set(inst.processoId, inst)
  }

  // (3) Necessidades de todos os processos.
  const necsRaw = await prisma.necessidadeDocumental.findMany({
    where: { processoId: { in: ids } },
    select: { id: true, processoId: true, status: true, obrigatoriedade: true, itemCatalogoId: true },
  })
  // (4) Conjunto de itens de catálogo de natureza CERTIDÃO (1 query, reutilizável).
  const certidaoItens = await itemCatalogosDeCertidao(prisma)
  const necsByProc = new Map<number, NecessidadeData[]>()
  for (const n of necsRaw) {
    const arr = necsByProc.get(n.processoId) ?? []
    arr.push({
      id: n.id,
      status: n.status,
      obrigatoria: n.obrigatoriedade === "OBRIGATORIA",
      ehCertidao: certidaoItens.has(n.itemCatalogoId),
    })
    necsByProc.set(n.processoId, arr)
  }

  // (5) Documentos da LINHA RETA por árvore (denominador do escopo DOCUMENTO).
  const docsByArvore = new Map<number, DocumentoData[]>()
  if (arvoreIds.length > 0) {
    const pessoas = await prisma.pessoa.findMany({
      where: { arvoreId: { in: arvoreIds }, linhaReta: true },
      select: { arvoreId: true, documentos: { select: { id: true, status: true } } },
    })
    for (const p of pessoas) {
      if (p.arvoreId == null) continue
      const arr = docsByArvore.get(p.arvoreId) ?? []
      for (const d of p.documentos) arr.push({ id: d.id, status: d.status, linhaReta: true })
      docsByArvore.set(p.arvoreId, arr)
    }
  }

  // (6) Contagem de requerentes por processo.
  const reqAgg = await prisma.processoRequerente.groupBy({
    by: ["processoId"],
    where: { processoId: { in: ids } },
    _count: { _all: true },
  })
  const reqByProc = new Map(reqAgg.map((r) => [r.processoId, r._count._all]))

  // Monta o snapshot e delega ao núcleo puro — na ordem original dos ids.
  return processIds.map((pid) => {
    const proc = procById.get(pid)
    if (!proc) {
      return buildOperationalProjection({
        processId: pid, faseCode: null, faseMacroKey: null, phaseName: null, scope: null,
        processoExists: false, hasActiveInstance: false, steps: [], necessidades: [], documentos: [],
        hasArvore: false, requerentesCount: 0,
      })
    }
    const faseCode = phaseKeyToFaseCode(proc.faseAtualKey)
    const faseDef = faseCode ? getFase(faseCode) : null
    const inst = instByProc.get(pid) ?? null
    const steps: GateStepData[] = (inst?.steps ?? []).map(mapStepToGate)

    const input: ProjectionInput = {
      processId: pid,
      faseCode,
      faseMacroKey: proc.faseAtualKey ?? null,
      phaseName: faseDef?.label ?? proc.faseAtualKey ?? null,
      scope: faseDef?.scope ?? null,
      processoExists: true,
      hasActiveInstance: !!inst,
      steps,
      necessidades: necsByProc.get(pid) ?? [],
      documentos: proc.arvoreId != null ? docsByArvore.get(proc.arvoreId) ?? [] : [],
      hasArvore: proc.arvoreId != null,
      requerentesCount: reqByProc.get(pid) ?? 0,
    }
    return buildOperationalProjection(input)
  })
}
