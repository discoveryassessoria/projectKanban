import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const projectId = parseInt(id)
    
    if (isNaN(projectId)) {
      return NextResponse.json(
        { error: 'ID do projeto inválido' },
        { status: 400 }
      )
    }

    // Primeiro, deletar todas as atividades relacionadas
    await prisma.atividade.deleteMany({
      where: { projetoId: projectId }
    })

    // Depois, deletar todos os status relacionados
    await prisma.status.deleteMany({
      where: { projetoId: projectId }
    })

    // Por último, deletar o projeto
    const deletedProject = await prisma.projetoKanban.delete({
      where: { id: projectId }
    })

    return NextResponse.json({
      message: 'Projeto deletado com sucesso',
      projeto: deletedProject
    })

  } catch (error) {
    console.error('Erro ao deletar projeto:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor ao deletar projeto' },
      { status: 500 }
    )
  }
}