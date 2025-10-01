import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

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
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    const body = await request.json()
    const { statusId } = body

    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'ID inválido' },
        { status: 400 }
      )
    }

    if (!statusId) {
      return NextResponse.json(
        { error: 'Status é obrigatório' },
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

    // Atualizar o status da atividade
    const atividadeAtualizada = await prisma.atividade.update({
      where: { id },
      data: { statusId: parseInt(statusId) },
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

    return NextResponse.json(atividadeAtualizada)
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