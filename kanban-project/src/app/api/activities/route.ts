import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Extrair parâmetros de filtro
    const dataInicio = searchParams.get('dataInicio')
    const dataFim = searchParams.get('dataFim')
    const projetoId = searchParams.get('projeto')
    const statusId = searchParams.get('status')
    const responsavel = searchParams.get('responsavel')

    // Construir filtros dinâmicos
    const whereClause: any = {}

    // Filtro por data de criação
    if (dataInicio || dataFim) {
      whereClause.data_criacao = {}
      if (dataInicio) {
        whereClause.data_criacao.gte = new Date(dataInicio)
      }
      if (dataFim) {
        whereClause.data_criacao.lte = new Date(dataFim + 'T23:59:59.999Z')
      }
    }

    // Filtro por projeto
    if (projetoId && projetoId !== '' && projetoId !== 'all') {
      whereClause.projetoId = parseInt(projetoId)
    }

    // Filtro por status
    if (statusId && statusId !== '' && statusId !== 'all') {
      whereClause.statusId = parseInt(statusId)
    }

    // Filtro por responsável
    if (responsavel && responsavel !== '' && responsavel !== 'all') {
      whereClause.usuarios = {
        some: {
          usuario: {
            email: responsavel
          }
        }
      }
    }

    const atividades = await prisma.atividade.findMany({
      where: whereClause,
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
      },
      orderBy: {
        id: 'desc'
      }
    })

    return NextResponse.json(atividades)
  } catch (error) {
    console.error('Erro ao buscar atividades:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { nome, descricao, data_termino, projeto_id, status_id } = body

    // Validações básicas
    if (!nome || !projeto_id || !status_id) {
      return NextResponse.json(
        { error: 'Nome, projeto e status são obrigatórios' },
        { status: 400 }
      )
    }

    // Criar a atividade
    const atividade = await prisma.atividade.create({
      data: {
        nome,
        descricao: descricao || null,
        data_termino: data_termino ? new Date(data_termino) : null,
        projetoId: parseInt(projeto_id),
        statusId: parseInt(status_id)
      },
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

    return NextResponse.json(atividade, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar atividade:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}