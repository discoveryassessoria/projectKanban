import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const statusId = parseInt(params.id)

    if (isNaN(statusId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const status = await prisma.status.findUnique({
      where: { id: statusId },
      select: {
        id: true,
        nome: true,
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

    return NextResponse.json(status)
  } catch (error) {
    console.error('Erro ao buscar status:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const statusId = parseInt(params.id)
    const body = await request.json()
    const { nome } = body

    if (isNaN(statusId)) {
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
      where: { id: statusId }
    })

    if (!existingStatus) {
      return NextResponse.json({ error: 'Status não encontrado' }, { status: 404 })
    }

    // Verificar se já existe outro status com o mesmo nome
    const duplicateStatus = await prisma.status.findFirst({
      where: {
        nome: {
          equals: nome,
          mode: 'insensitive'
        },
        id: {
          not: statusId
        }
      }
    })

    if (duplicateStatus) {
      return NextResponse.json({ error: 'Já existe um status com este nome' }, { status: 409 })
    }

    const updatedStatus = await prisma.status.update({
      where: { id: statusId },
      data: {
        nome: nome.trim()
      },
      select: {
        id: true,
        nome: true,
        _count: {
          select: {
            atividades: true
          }
        }
      }
    })

    return NextResponse.json(updatedStatus)
  } catch (error) {
    console.error('Erro ao atualizar status:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const statusId = parseInt(params.id)

    if (isNaN(statusId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // Verificar se o status existe
    const existingStatus = await prisma.status.findUnique({
      where: { id: statusId },
      include: {
        _count: {
          select: {
            atividades: true
          }
        }
      }
    })

    if (!existingStatus) {
      return NextResponse.json({ error: 'Status não encontrado' }, { status: 404 })
    }

    // Verificar se há atividades associadas
    if (existingStatus._count.atividades > 0) {
      return NextResponse.json(
        { 
          error: 'Não é possível deletar um status que possui atividades associadas',
          activitiesCount: existingStatus._count.atividades
        }, 
        { status: 409 }
      )
    }

    await prisma.status.delete({
      where: { id: statusId }
    })

    return NextResponse.json({ message: 'Status deletado com sucesso' })
  } catch (error) {
    console.error('Erro ao deletar status:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}