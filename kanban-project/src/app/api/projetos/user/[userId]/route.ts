import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: userIdString } = await params;
    const userId = parseInt(userIdString)

    if (isNaN(userId)) {
      return Response.json(
        { error: 'ID do usuário inválido' },
        { status: 400 }
      )
    }

    // Buscar projetos do usuário através das atividades que ele participa
    const projetos = await prisma.projetoKanban.findMany({
      where: {
        atividades: {
          some: {
            usuarios: {
              some: {
                usuarioId: userId
              }
            }
          }
        }
      },
      include: {
        atividades: {
          include: {
            status: true,
            usuarios: {
              include: {
                usuario: true
              }
            }
          }
        }
      }
    })

    return Response.json({ projetos })

  } catch (error) {
    console.error('Erro ao buscar projetos do usuário:', error)
    return Response.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}