import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'ID inválido' },
        { status: 400 }
      )
    }

    // Verificar se a atividade existe
    const atividade = await prisma.atividade.findUnique({
      where: { id }
    })

    if (!atividade) {
      return NextResponse.json(
        { error: 'Atividade não encontrada' },
        { status: 404 }
      )
    }

    // Excluir associações na tabela UserAtv primeiro
    await prisma.userAtv.deleteMany({
      where: { atividadeId: id }
    })

    // Excluir a atividade
    await prisma.atividade.delete({
      where: { id }
    })

    return NextResponse.json({ 
      message: 'Atividade excluída com sucesso',
      id: id
    })
  } catch (error) {
    return NextResponse.json(
      { 
        error: 'Erro interno do servidor', 
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    const body = await request.json()
    const { statusId, data_termino } = body

    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'ID inválido' },
        { status: 400 }
      )
    }

    // Verificar se pelo menos um campo foi enviado para atualização
    if (!statusId && data_termino === undefined) {
      return NextResponse.json(
        { error: 'Pelo menos um campo deve ser fornecido para atualização' },
        { status: 400 }
      )
    }

    // Verificar se a atividade existe
    const atividade = await prisma.atividade.findUnique({
      where: { id }
    })

    if (!atividade) {
      return NextResponse.json(
        { error: 'Atividade não encontrada' },
        { status: 404 }
      )
    }

    // Construir objeto de dados para atualização
    const updateData: any = {}
    if (statusId) {
      updateData.statusId = parseInt(statusId)
    }
    if (data_termino !== undefined) {
      updateData.data_termino = data_termino ? new Date(data_termino) : null
    }

    // Atualizar a atividade
    const atividadeAtualizada = await prisma.atividade.update({
      where: { id },
      data: updateData,
      include: {
        projeto: {
          select: {
            nome: true,
            descricao: true
          }
        },
        status: {
          select: {
            nome: true
          }
        },
        usuarios: {
          include: {
            usuario: {
              select: {
                nome: true,
                email: true
              }
            }
          }
        }
      }
    })

    return NextResponse.json({
      success: true,
      data: atividadeAtualizada,
      message: 'Atividade atualizada com sucesso'
    })
  } catch (error) {
    return NextResponse.json(
      { 
        error: 'Erro interno do servidor',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    )
  }
}