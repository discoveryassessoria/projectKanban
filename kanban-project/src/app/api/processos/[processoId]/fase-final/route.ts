// ============================================================
// src/app/api/processos/[processoId]/fase-final/route.ts
// GET → carrega/cria o estado da fase final em que o processo está
// (Aguardando protocolo / Protocolado / Finalizado), derivado do faseCode.
// ============================================================

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import {
  FINAL_CFG, keyFromFaseCode, buildInitialWorkflow, calcProgress,
  type FinalWorkflowStep,
} from "@/src/lib/process-stage/final-engine"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, status: { select: { faseCode: true } } },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const key = keyFromFaseCode(processo.status.faseCode)
    if (!key) return NextResponse.json({ fase: null })

    let fase = await prisma.faseFinal.findUnique({
      where: { processoId_faseKey: { processoId: id, faseKey: key } },
    })

    if (!fase) {
      const cfg = FINAL_CFG[key]
      try {
        fase = await prisma.faseFinal.create({
          data: {
            processoId: id,
            faseKey: key,
            status: "em_andamento",
            currentStep: cfg.steps[0].id,
            workflow: buildInitialWorkflow(key) as unknown as Prisma.InputJsonValue,
            data: {},
          },
        })
      } catch {
        fase = await prisma.faseFinal.findUnique({
          where: { processoId_faseKey: { processoId: id, faseKey: key } },
        })
        if (!fase) throw new Error("Falha ao criar o estado da fase final.")
      }
    }

    const workflow = (fase.workflow as unknown as FinalWorkflowStep[]) ?? []
    return NextResponse.json({ fase, faseKey: key, progress: calcProgress(workflow) })
  } catch (error) {
    console.error("[GET .../fase-final]", error)
    return NextResponse.json({ error: "Erro ao carregar a fase final" }, { status: 500 })
  }
}