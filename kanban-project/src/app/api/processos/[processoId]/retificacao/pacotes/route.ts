// ============================================================
// src/app/api/processos/[processoId]/retificacao/pacotes/route.ts
// POST → cria um novo pacote de retificação (tipo judicial|administrativa).
// ============================================================

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { buildInitialWorkflow } from "@/src/lib/process-stage/retificacao-engine"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const body = await request.json().catch(() => ({}))
    const tipo = body.tipo === "administrativa" ? "administrativa" : "judicial"

    const processo = await prisma.processo.findUnique({ where: { id }, select: { id: true } })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const count = await prisma.retificacaoPacote.count({ where: { processoId: id } })
    const num = "PR-" + String(count + 1).padStart(3, "0")

    const pacote = await prisma.retificacaoPacote.create({
      data: {
        processoId: id,
        num,
        tipo,
        status: "em_preparacao",
        currentStep: "definir_estrategia",
        prioridade: "Média",
        proxAcao: "Definir estratégia",
        workflow: buildInitialWorkflow() as unknown as Prisma.InputJsonValue,
        movements: [] as unknown as Prisma.InputJsonValue,
        attachments: [] as unknown as Prisma.InputJsonValue,
      },
    })

    return NextResponse.json({ ok: true, pacote })
  } catch (error) {
    console.error("[POST .../retificacao/pacotes]", error)
    return NextResponse.json({ error: "Erro ao criar pacote de retificação" }, { status: 500 })
  }
}