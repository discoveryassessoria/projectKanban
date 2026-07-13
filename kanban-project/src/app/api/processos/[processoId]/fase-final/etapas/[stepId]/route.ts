// ============================================================
// src/app/api/processos/[processoId]/fase-final/etapas/[stepId]/route.ts
// POST → conclui uma etapa da fase final. Na última etapa avança o card
// (Aguardando protocolo→Protocolado→Finalizado). receber_decisao:
// deferido avança; exigência/indeferido registra sem concluir.
// (+ gatilho do MOTOR quando a fase avança — 1 linha, best-effort)
// ============================================================

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { moverStatusIdLegacy } from "@/src/lib/motor/runtime-guard"
import type { FaseCode, Prisma } from "@prisma/client"
import {
  applyStep, calcProgress, keyFromFaseCode,
  type FinalState,
} from "@/src/lib/process-stage/final-engine"
import { dispararMotorNaFaseAtual } from "@/src/lib/motor/executor"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string; stepId: string }> }
) {
  try {
    const { processoId, stepId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const body = await request.json().catch(() => ({}))

    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, pais: true, status: { select: { faseCode: true } }, faseAtualKey: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const key = (processo.faseAtualKey ?? keyFromFaseCode(processo.status?.faseCode ?? null)) as ReturnType<typeof keyFromFaseCode>
    if (!key) return NextResponse.json({ error: "O processo não está numa fase final." }, { status: 422 })

    const fase = await prisma.faseFinal.findUnique({
      where: { processoId_faseKey: { processoId: id, faseKey: key } },
    })
    if (!fase) return NextResponse.json({ error: "Estado da fase final não encontrado." }, { status: 422 })

    const state: FinalState = {
      status: fase.status,
      currentStep: fase.currentStep,
      data: (fase.data as Record<string, unknown>) ?? {},
      workflow: (fase.workflow as unknown as FinalState["workflow"]) ?? [],
    }

    const result = applyStep(key, state, stepId, body)
    if (!result.ok || !result.state) {
      return NextResponse.json({ error: result.error || "Não foi possível concluir a etapa." }, { status: 422 })
    }
    const s = result.state

    const faseData: Prisma.FaseFinalUpdateInput = {
      status: s.status,
      currentStep: s.currentStep,
      workflow: s.workflow as unknown as Prisma.InputJsonValue,
      data: s.data as Prisma.InputJsonValue,
    }

    // coluna destino, se a fase concluiu e há próxima
    let colunaDestinoId: number | null = null
    if (result.completePhase && result.advanceToFaseCode) {
      const coluna = await prisma.status.findFirst({
        where: { pais: processo.pais, faseCode: result.advanceToFaseCode as FaseCode },
        select: { id: true },
      })
      if (!coluna) {
        return NextResponse.json(
          { error: `Não há coluna para ${result.advanceToFaseCode} no país ${processo.pais}.` },
          { status: 422 }
        )
      }
      colunaDestinoId = coluna.id
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.faseFinal.update({
          where: { processoId_faseKey: { processoId: id, faseKey: key } },
          data: faseData,
        })
        if (colunaDestinoId) {
          await moverStatusIdLegacy(tx, id, colunaDestinoId)
        }
      },
      { timeout: 30000, maxWait: 10000 }
    )

    // MOTOR — se o card avançou de fase, dispara o motor (best-effort)
    if (colunaDestinoId) {
      await dispararMotorNaFaseAtual(id)
    }

    return NextResponse.json({
      ok: true,
      completePhase: !!result.completePhase,
      recordedOnly: !!result.recordedOnly,
      advanced: !!colunaDestinoId,
      progress: calcProgress(s.workflow),
    })
  } catch (error) {
    console.error("[POST .../fase-final/etapas]", error)
    return NextResponse.json({ error: "Erro ao concluir etapa da fase final" }, { status: 500 })
  }
}