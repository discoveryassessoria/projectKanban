import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ statusId: string }> }) {
  try {
    const { statusId } = await params
    const body = await request.json()
    const { direction, projetoId } = body

    console.log('Move status - Recebido:', { statusId, direction, projetoId })

    if (!direction || projetoId === undefined) {
      return NextResponse.json({ error: "Direção e ID do projeto são obrigatórios" }, { status: 400 })
    }

    const currentStatusId = Number.parseInt(statusId)
    const projectId = Number.parseInt(projetoId)

    if (Number.isNaN(currentStatusId) || Number.isNaN(projectId)) {
      return NextResponse.json({ error: "IDs inválidos" }, { status: 400 })
    }

    // Verificar se o status existe e pertence ao projeto
    const currentStatus = await prisma.status.findFirst({
      where: {
        id: currentStatusId,
        projetoId: projectId,
      },
    })

    if (!currentStatus) {
      return NextResponse.json({ error: "Status não encontrado neste projeto" }, { status: 404 })
    }

    // Não permitir mover o status "Concluído"
    if (currentStatus.nome.toLowerCase() === "concluído") {
      return NextResponse.json({ error: "O status 'Concluído' sempre deve ser o último" }, { status: 400 })
    }

    // Get all statuses for this project, sorted by ordem
    const allStatuses = await prisma.status.findMany({
      where: {
        projetoId: projectId,
      },
      orderBy: {
        ordem: "asc",
      },
    })

    // Filtrar "Concluído" da lista de statuses que podem ser movidos
    const movableStatuses = allStatuses.filter(s => s.nome.toLowerCase() !== "concluído")

    // Find current status index nos statuses móveis
    const currentIndex = movableStatuses.findIndex((s) => s.id === currentStatusId)
    if (currentIndex === -1) {
      return NextResponse.json({ error: "Status não encontrado" }, { status: 404 })
    }

    // Determine target index
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1

    // Check bounds
    if (targetIndex < 0 || targetIndex >= movableStatuses.length) {
      return NextResponse.json({ error: "Não é possível mover nesta direção" }, { status: 400 })
    }

    // Get the statuses to swap
    const targetStatus = movableStatuses[targetIndex]

    // Swap usando transação
    await prisma.$transaction([
      // Atualizar ordem do status atual
      prisma.status.update({
        where: { id: currentStatus.id },
        data: { ordem: targetStatus.ordem },
      }),
      // Atualizar ordem do status alvo
      prisma.status.update({
        where: { id: targetStatus.id },
        data: { ordem: currentStatus.ordem },
      }),
    ])

    console.log('Status movido com sucesso')
    return NextResponse.json({ message: "Status movido com sucesso" }, { status: 200 })
  } catch (error) {
    console.error("Erro ao mover status:", error)
    return NextResponse.json({ 
      error: "Erro interno do servidor ao mover status",
      details: error instanceof Error ? error.message : "Erro desconhecido"
    }, { status: 500 })
  }
}
