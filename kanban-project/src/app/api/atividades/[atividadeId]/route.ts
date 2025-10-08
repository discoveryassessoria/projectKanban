import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PUT(request: NextRequest, { params }: { params: { atividadeId: string } }) {
  try {
    const { atividadeId } = params
    const body = await request.json()
    const { statusId, nome, descricao, data_termino, usuarioId } = body

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

    const atividadeId_parsed = Number.parseInt(atividadeId)

    // Usar transação para atualizar atividade e gerenciar usuários
    const result = await prisma.$transaction(async (tx) => {
      // Atualizar os dados básicos da atividade
      const atividadeAtualizada = await tx.atividade.update({
        where: { id: atividadeId_parsed },
        data: updateData,
      })

      // Gerenciar usuários responsáveis
      if (usuarioId !== undefined) {
        // Primeiro, remover todas as associações existentes
        await tx.userAtv.deleteMany({
          where: { atividadeId: atividadeId_parsed }
        })

        // Se usuarioId não é null, criar nova associação
        if (usuarioId !== null) {
          await tx.userAtv.create({
            data: {
              usuarioId: Number.parseInt(usuarioId),
              atividadeId: atividadeId_parsed
            }
          })
        }
      }

      // Buscar a atividade atualizada com os usuários e status
      return await tx.atividade.findUnique({
        where: { id: atividadeId_parsed },
        include: {
          status: true,
          usuarios: {
            include: {
              usuario: true
            }
          }
        }
      })
    })

    return NextResponse.json({ atividade: result }, { status: 200 })
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
