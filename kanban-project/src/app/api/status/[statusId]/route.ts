import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest, { params }: { params: Promise<{ statusId: string }> }) {
  try {
    const { statusId } = await params
    const parsedStatusId = Number.parseInt(statusId)

    if (isNaN(parsedStatusId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const status = await prisma.status.findUnique({
      where: { id: parsedStatusId },
      include: {
        _count: {
          select: {
            atividades: true
          }
        }
      }
    })

    if (!status) {
      return NextResponse.json({ error: 'Status não encontrado' }, { status: 404 })
    }

    return NextResponse.json({ status })
  } catch (error) {
    console.error('Erro ao buscar status:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ statusId: string }> }) {
  try {
    const { statusId } = await params
    const body = await request.json()
    const { nome } = body

    const parsedStatusId = Number.parseInt(statusId)

    if (isNaN(parsedStatusId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // Validações
    if (!nome || typeof nome !== 'string') {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }

    if (nome.length > 20) {
      return NextResponse.json({ error: 'Nome deve ter no máximo 20 caracteres' }, { status: 400 })
    }

    // Verificar se o status existe
    const existingStatus = await prisma.status.findUnique({
      where: { id: parsedStatusId }
    })

    if (!existingStatus) {
      return NextResponse.json({ error: 'Status não encontrado' }, { status: 404 })
    }

    // Verificar se já existe outro status com o mesmo nome (global)
    const duplicateStatus = await prisma.status.findFirst({
      where: {
        nome: {
          equals: nome.trim(),
          mode: 'insensitive'
        },
        id: {
          not: parsedStatusId
        }
      }
    })

    if (duplicateStatus) {
      return NextResponse.json({ error: 'Já existe um status com este nome' }, { status: 409 })
    }

    const statusAtualizado = await prisma.status.update({
      where: {
        id: parsedStatusId,
      },
      data: {
        nome: nome.trim(),
      },
      include: {
        _count: {
          select: {
            atividades: true
          }
        }
      }
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

    if (isNaN(parsedStatusId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // First check if status exists
    const statusExists = await prisma.status.findUnique({
      where: {
        id: parsedStatusId,
      },
      include: {
        _count: {
          select: {
            atividades: true
          }
        }
      }
    })

    if (!statusExists) {
      return NextResponse.json({ error: "Status não encontrado" }, { status: 404 })
    }

    // Verificar se há atividades associadas
    if (statusExists._count.atividades > 0) {
      // Por enquanto, vamos deletar as atividades junto (cascade delete)
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