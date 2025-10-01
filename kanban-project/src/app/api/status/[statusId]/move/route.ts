import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(request: NextRequest, { params }: { params: Promise<{ statusId: string }> }) {
  try {
    const { statusId } = await params
    const body = await request.json()
    const { direction, projetoId } = body

    if (!direction || !projetoId) {
      return NextResponse.json({ error: "Direção e ID do projeto são obrigatórios" }, { status: 400 })
    }

    const currentStatusId = Number.parseInt(statusId)

    // Get all statuses for this project, sorted by id
    const allStatuses = await prisma.status.findMany({
      where: {
        projetoId: Number.parseInt(projetoId),
      },
      orderBy: {
        id: "asc",
      },
    })

    // Find current status index
    const currentIndex = allStatuses.findIndex((s) => s.id === currentStatusId)
    if (currentIndex === -1) {
      return NextResponse.json({ error: "Status não encontrado" }, { status: 404 })
    }

    // Determine target index
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1

    // Check bounds
    if (targetIndex < 0 || targetIndex >= allStatuses.length) {
      return NextResponse.json({ error: "Não é possível mover nesta direção" }, { status: 400 })
    }

    // Swap IDs (simple approach - swap the id values)
    const currentStatus = allStatuses[currentIndex]
    const targetStatus = allStatuses[targetIndex]

    // Use a transaction to swap IDs
    await prisma.$transaction([
      // Temporarily set current status to a high number to avoid conflicts
      prisma.status.update({
        where: { id: currentStatus.id },
        data: { id: 999999 },
      }),
      // Update target status to current's id
      prisma.status.update({
        where: { id: targetStatus.id },
        data: { id: currentStatus.id },
      }),
      // Update current status (now 999999) to target's id
      prisma.status.update({
        where: { id: 999999 },
        data: { id: targetStatus.id },
      }),
    ])

    return NextResponse.json({ message: "Status movido com sucesso" }, { status: 200 })
  } catch (error) {
    console.error("Erro ao mover status:", error)
    return NextResponse.json({ error: "Erro interno do servidor ao mover status" }, { status: 500 })
  }
}
