import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PUT(request: NextRequest, { params }: { params: Promise<{ statusId: string }> }) {
  try {
    const { statusId } = await params
    const body = await request.json()
    const { nome } = body

    if (!nome) {
      return NextResponse.json({ error: "Nome do status é obrigatório" }, { status: 400 })
    }

    const statusAtualizado = await prisma.status.update({
      where: {
        id: Number.parseInt(statusId),
      },
      data: {
        nome,
      },
    })

    return NextResponse.json({ status: statusAtualizado }, { status: 200 })
  } catch (error) {
    console.error("Erro ao atualizar status:", error)
    return NextResponse.json({ error: "Erro interno do servidor ao atualizar status" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ statusId: string }> }) {
  try {
    const { statusId } = await params
    const parsedStatusId = Number.parseInt(statusId)

    // Check if status has activities
    const atividadesCount = await prisma.atividade.count({
      where: {
        statusId: parsedStatusId,
      },
    })

    // Delete all activities in this status first
    if (atividadesCount > 0) {
      await prisma.atividade.deleteMany({
        where: {
          statusId: parsedStatusId,
        },
      })
    }

    // Delete the status
    await prisma.status.delete({
      where: {
        id: parsedStatusId,
      },
    })

    return NextResponse.json({ message: "Status excluído com sucesso" }, { status: 200 })
  } catch (error) {
    console.error("Erro ao excluir status:", error)
    return NextResponse.json({ error: "Erro interno do servidor ao excluir status" }, { status: 500 })
  }
}
