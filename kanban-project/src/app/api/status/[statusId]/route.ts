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

    // First check if status exists
    const statusExists = await prisma.status.findUnique({
      where: {
        id: parsedStatusId,
      },
    })

    if (!statusExists) {
      return NextResponse.json({ error: "Status não encontrado" }, { status: 404 })
    }

    // Use transaction to ensure data consistency
    await prisma.$transaction(async (tx) => {
      // Delete all UserAtv relations for activities in this status
      await tx.userAtv.deleteMany({
        where: {
          atividade: {
            statusId: parsedStatusId,
          },
        },
      })

      // Delete all activities in this status
      await tx.atividade.deleteMany({
        where: {
          statusId: parsedStatusId,
        },
      })

      // Finally delete the status
      await tx.status.delete({
        where: {
          id: parsedStatusId,
        },
      })
    })

    return NextResponse.json({ message: "Status excluído com sucesso" }, { status: 200 })
  } catch (error) {
    console.error("Erro ao excluir status:", error)
    return NextResponse.json({ error: "Erro interno do servidor ao excluir status" }, { status: 500 })
  }
}
