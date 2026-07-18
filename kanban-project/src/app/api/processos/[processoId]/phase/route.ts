// src/app/api/processos/[processoId]/phase/route.ts

/**
 * GET /api/processos/[processoId]/phase
 *
 * Retorna a PROJEÇÃO OPERACIONAL OFICIAL da fase atual (resolveOperationalProjection):
 * progresso (percentage/completedWeight/totalWeight), status (blocked/canAdvance/
 * operationalState), nextAction e metrics. Fonte ÚNICA — nenhum consumidor recalcula.
 *
 * Mantém campos de compatibilidade (stage/label/done/total/percent/reason) para os
 * consumidores atuais enquanto migram para `projection`.
 *
 * Usado pelo <PhaseProgressHeader /> e demais consumidores. Não move o card — só LÊ.
 */

import { NextRequest, NextResponse } from "next/server"
import { stageFromFaseCode } from "@/src/lib/process-stage/compute-phase-progress"
import { STAGE_LABELS } from "@/src/lib/process-stage/derive-stage"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import { resolveOperationalProjection } from "@/src/lib/process-stage/operational-projection"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const { processoId: idStr } = await params
  const processoId = Number(idStr)

  if (!Number.isFinite(processoId)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 })
  }

  // FONTE OFICIAL ÚNICA: resolver canônico da projeção operacional (scope-aware).
  const projection = await resolveOperationalProjection(processoId)

  const faseCode = phaseKeyToFaseCode(projection.activePhase?.id ?? undefined)
  const stage = stageFromFaseCode(faseCode ?? undefined) ?? "GENEALOGIA"
  const done = projection.metrics.completed
  const total = projection.metrics.required
  const percent = projection.progress.percentage

  return NextResponse.json({
    // Contrato definitivo (preferir este objeto).
    projection,
    // Compat (consumidores atuais).
    stage,
    label: projection.activePhase?.name ?? STAGE_LABELS[stage],
    done,
    total,
    percent,
    reason: total === 0
      ? "Sem itens obrigatórios nesta fase"
      : `${done} de ${total} concluído(s) nesta fase`,
  })
}
