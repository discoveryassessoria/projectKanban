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
import { motorVigenteDaFase } from "@/src/services/motor-da-fase"

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

  // A fase pode estar sob o motor LEGADO (tela bespoke da fase, ex.: Análise
  // Documental) em vez do Workflow Interno — ver src/services/motor-da-fase.ts.
  // Nesse modo os passos canônicos existem no banco (a materialização não sabe
  // qual motor conduz) mas só fecham TODOS DE UMA VEZ quando a tela bespoke
  // conclui — nunca um de cada vez. "0 / 5 concluído(s)" nesse caso lê como
  // "nada foi feito", quando na verdade a tela bespoke pode estar com tudo
  // pronto para concluir. O texto avisa; o percentual em si não muda (seria
  // uma segunda fonte de verdade para o gate).
  const motor = projection.activePhase ? await motorVigenteDaFase(projection.activePhase.id) : null
  const bespoke = motor != null && !motor.canonico

  return NextResponse.json({
    // Contrato definitivo (preferir este objeto).
    projection,
    // Compat (consumidores atuais).
    stage,
    label: projection.activePhase?.name ?? STAGE_LABELS[stage],
    done,
    total,
    percent,
    bespoke,
    reason: total === 0
      ? "Sem itens obrigatórios nesta fase"
      : bespoke
        ? "Conduzida pela tela desta fase — os passos fecham juntos ao concluir por lá"
        : `${done} de ${total} concluído(s) nesta fase`,
  })
}
