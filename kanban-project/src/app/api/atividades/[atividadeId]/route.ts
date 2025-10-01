import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PUT(request: NextRequest, { params }: { params: { atividadeId: string } }) {
  try {
    const { atividadeId } = params
    const body = await request.json()
    const { statusId, nome, descricao, data_termino } = body

    const updateData: any = {}

    if (statusId !== undefined && statusId !== null) {
      const parsedStatusId = Number.parseInt(statusId, 10)
      if (isNaN(parsedStatusId)) {
        return NextResponse.json({ error: `O ID do status é inválido: ${statusId}` }, { status: 400 })
      }
      updateData.statusId = parsedStatusId
    }

    if (nome !== undefined) updateData.nome = nome
    if (descricao !== undefined) updateData.descricao = descricao
    if (data_termino !== undefined) updateData.data_termino = data_termino ? new Date(data_termino) : null

    const atividadeAtualizada = await prisma.atividade.update({
      where: {
        id: Number.parseInt(atividadeId),
      },
      data: updateData,
    })

    return NextResponse.json({ atividade: atividadeAtualizada }, { status: 200 })
  } catch (error) {
    console.error("Erro ao atualizar atividade:", error)
    return NextResponse.json({ error: "Erro interno do servidor ao atualizar atividade" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { atividadeId: string } }) {
  try {
    const { atividadeId } = params

    await prisma.atividade.delete({
      where: {
        id: Number.parseInt(atividadeId),
      },
    })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error("Erro ao deletar atividade:", error)
    return NextResponse.json({ error: "Erro interno do servidor ao deletar atividade" }, { status: 500 })
  }
}
