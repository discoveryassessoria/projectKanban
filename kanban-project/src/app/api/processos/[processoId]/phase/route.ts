// src/app/api/processos/[processoId]/phase/route.ts

/**
 * GET /api/processos/[processoId]/phase
 *
 * Retorna a fase atual do processo + progresso na fase.
 *
 * A fase vem do `faseCode` da coluna onde o card está (fonte da verdade,
 * igual ao motor de avanço). O progresso (done/total) é contado pelos
 * documentos da LINHA RETA. Se o processo ainda não tiver faseCode, cai
 * no derive pelos status dos documentos (fallback).
 *
 * Usado pelo componente <PhaseProgressHeader /> no header do processo.
 * Não move o card aqui — apenas LÊ.
 */

import { NextRequest, NextResponse } from "next/server"
import { stageFromFaseCode } from "@/src/lib/process-stage/compute-phase-progress"
import { STAGE_LABELS } from "@/src/lib/process-stage/derive-stage"
import { resolveProgressoFaseDocumento } from "@/src/lib/process-stage/resolve-fase-progresso"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const { processoId: idStr } = await params
  const processoId = Number(idStr)

  if (!Number.isFinite(processoId)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 })
  }

  // FONTE OFICIAL ÚNICA (mesma da Central Operacional): done/total/percent vêm da
  // conclusão real do Workflow Interno por documento na fase atual. Elimina a fonte
  // paralela antiga (calculava com workflows:[] → status mestre → 0/4 falso).
  const prog = await resolveProgressoFaseDocumento(processoId)
  const stage = stageFromFaseCode(prog.faseCode ?? undefined) ?? "GENEALOGIA"

  return NextResponse.json({
    stage,
    label: STAGE_LABELS[stage],
    done: prog.done,
    total: prog.total,
    percent: prog.percent,
    reason: prog.total === 0
      ? "Sem documentos obrigatórios nesta fase"
      : `${prog.done} de ${prog.total} doc(s) concluídos nesta fase`,
  })
}