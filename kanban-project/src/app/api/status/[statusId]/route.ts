import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

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
            tarefas: true
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
    const erro = await verificarPermissao(request, 'processos.editar_coluna')
    if (erro) return erro

    const { statusId } = await params
    const body = await request.json()
    const { nome } = body

    const parsedStatusId = Number.parseInt(statusId)

    if (isNaN(parsedStatusId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    if (!nome || typeof nome !== 'string') {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }

    if (nome.length > 50) {
      return NextResponse.json({ error: 'Nome deve ter no máximo 50 caracteres' }, { status: 400 })
    }

    const existingStatus = await prisma.status.findUnique({
      where: { id: parsedStatusId }
    })

    if (!existingStatus) {
      return NextResponse.json({ error: 'Status não encontrado' }, { status: 404 })
    }

    const duplicateStatus = await prisma.status.findFirst({
      where: {
        nome: {
          equals: nome.trim(),
          mode: 'insensitive'
        },
        pais: existingStatus.pais,
        id: {
          not: parsedStatusId
        }
      }
    })

    if (duplicateStatus) {
      return NextResponse.json({ error: 'Já existe um status com este nome neste país' }, { status: 409 })
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
            tarefas: true
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
    const erro = await verificarPermissao(request, 'processos.excluir_coluna')
    if (erro) return erro

    const { statusId } = await params
    const parsedStatusId = Number.parseInt(statusId)

    if (isNaN(parsedStatusId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const statusExists = await prisma.status.findUnique({
      where: {
        id: parsedStatusId,
      },
      include: {
        _count: {
          select: {
            tarefas: true
          }
        }
      }
    })

    if (!statusExists) {
      return NextResponse.json({ error: "Status não encontrado" }, { status: 404 })
    }

    // Status é domínio de TAREFA. Exclusão NUNCA apaga processos (o legado
    // Processo.statusId foi removido). Restrição segura: se houver tarefas
    // vinculadas, bloqueia — o usuário deve reatribuí-las antes.
    if (statusExists._count.tarefas > 0) {
      return NextResponse.json(
        {
          error: `Este status está em uso por ${statusExists._count.tarefas} tarefa(s). Reatribua-as antes de excluir.`,
          blocked: true,
          tarefasVinculadas: statusExists._count.tarefas,
        },
        { status: 409 },
      )
    }

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