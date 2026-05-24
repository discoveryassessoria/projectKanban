// src/app/api/documentos/[id]/workflow/steps/[stepId]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// ============================================================
// PATCH — atualiza um step (status/assignee/dueAt/notes/bloqueio/etc.)
//
// Comportamento especial:
//  - quando status muda pra "concluida": seta completedAt + completedById,
//    libera o próximo step (status='em_andamento', startedAt, dueAt) e
//    recalcula progress do workflow; se for o último, marca workflow como
//    concluído.
//  - quando status muda pra "em_andamento" e startedAt ainda nulo: seta
//    startedAt e dueAt com base no slaDays.
// ============================================================

type StatusStep =
  | "nao_iniciada"
  | "bloqueada"
  | "em_andamento"
  | "aguardando_terceiro"
  | "atrasada"
  | "concluida"
  | "cancelada"

const ALLOWED_STATUS: StatusStep[] = [
  "nao_iniciada",
  "bloqueada",
  "em_andamento",
  "aguardando_terceiro",
  "atrasada",
  "concluida",
  "cancelada",
]

interface PatchBody {
  status?: StatusStep
  assigneeId?: number | null
  dueAt?: string | null
  notes?: string | null
  motivoBloqueio?: string | null
  trackingCode?: string | null
  externalProtocol?: string | null
  requestChannel?: string | null
  reviewResult?: string | null
  validationResult?: string | null
  completedById?: number | null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  try {
    const { id, stepId } = await params
    const documentoId = parseInt(id)
    const stepIdNum = parseInt(stepId)
    if (isNaN(documentoId) || isNaN(stepIdNum)) {
      return NextResponse.json({ error: "IDs inválidos" }, { status: 400 })
    }

    const body = (await request.json()) as PatchBody

    // -- Busca o step + workflow
    const step = await prisma.workflowStep.findUnique({
      where: { id: stepIdNum },
      include: {
        workflow: { select: { id: true, documentoId: true } },
      },
    })
    if (!step) {
      return NextResponse.json({ error: "Step não encontrado" }, { status: 404 })
    }
    if (step.workflow.documentoId !== documentoId) {
      return NextResponse.json({ error: "Step não pertence a este documento" }, { status: 400 })
    }

    // -- Valida status novo (se enviado)
    if (body.status !== undefined && !ALLOWED_STATUS.includes(body.status)) {
      return NextResponse.json({ error: "Status inválido" }, { status: 400 })
    }

    const now = new Date()
    const updateData: Record<string, unknown> = {}

    // -- Campos simples (whitelist)
    if (body.assigneeId !== undefined) updateData.assigneeId = body.assigneeId
    if (body.dueAt !== undefined) updateData.dueAt = body.dueAt ? new Date(body.dueAt) : null
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.motivoBloqueio !== undefined) updateData.motivoBloqueio = body.motivoBloqueio
    if (body.trackingCode !== undefined) updateData.trackingCode = body.trackingCode
    if (body.externalProtocol !== undefined) updateData.externalProtocol = body.externalProtocol
    if (body.requestChannel !== undefined) updateData.requestChannel = body.requestChannel
    if (body.reviewResult !== undefined) updateData.reviewResult = body.reviewResult
    if (body.validationResult !== undefined) updateData.validationResult = body.validationResult

    // -- Lógica de transição de status
    let liberarProximo = false
    if (body.status !== undefined) {
      updateData.status = body.status

      if (body.status === "em_andamento" && !step.startedAt) {
        updateData.startedAt = now
        if (!step.dueAt) {
          updateData.dueAt = new Date(now.getTime() + step.slaDays * 86400000)
        }
      }
      if (body.status === "concluida") {
        updateData.completedAt = now
        if (body.completedById !== undefined) {
          updateData.completedById = body.completedById
        }
        liberarProximo = true
      }
    }

    // -- Aplica a atualização
    await prisma.workflowStep.update({
      where: { id: stepIdNum },
      data: updateData,
    })

    // -- Se concluiu, libera o próximo step bloqueado e atualiza progresso
    if (liberarProximo) {
      // Próximo step bloqueado (menor ordem ainda bloqueada)
      const proximo = await prisma.workflowStep.findFirst({
        where: {
          workflowId: step.workflowId,
          status: "bloqueada",
          motivoBloqueio: null,
          ordem: { gt: step.ordem },
        },
        orderBy: { ordem: "asc" },
      })

      if (proximo) {
        await prisma.workflowStep.update({
          where: { id: proximo.id },
          data: {
            status: "em_andamento",
            startedAt: now,
            dueAt: new Date(now.getTime() + proximo.slaDays * 86400000),
          },
        })
      }

      // Recalcula o progresso do workflow
      const allSteps = await prisma.workflowStep.findMany({
        where: { workflowId: step.workflowId },
        select: { weight: true, status: true },
      })
      const totalWeight = allSteps.reduce((acc, s) => acc + s.weight, 0)
      const doneWeight = allSteps
        .filter((s) => s.status === "concluida")
        .reduce((acc, s) => acc + s.weight, 0)
      const progress = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0

      const todosConcluidos = allSteps.every((s) => s.status === "concluida" || s.status === "cancelada")

      await prisma.workflow.update({
        where: { id: step.workflowId },
        data: {
          progress,
          status: todosConcluidos ? "concluido" : "em_andamento",
          completedAt: todosConcluidos ? now : null,
        },
      })
    }

    // -- Marca movimento no documento
    await prisma.documento.update({
      where: { id: documentoId },
      data: { ultimaMovimentacao: now },
    })

    // -- Retorna o workflow completo atualizado
    const workflow = await prisma.workflow.findUnique({
      where: { documentoId },
      include: {
        steps: {
          orderBy: { ordem: "asc" },
          include: {
            assignee: { select: { id: true, nome: true, email: true } },
            completedBy: { select: { id: true, nome: true, email: true } },
          },
        },
      },
    })

    return NextResponse.json({ workflow })
  } catch (error) {
    console.error("[PATCH /api/documentos/[id]/workflow/steps/[stepId]]", error)
    return NextResponse.json(
      { error: "Erro ao atualizar step" },
      { status: 500 }
    )
  }
}