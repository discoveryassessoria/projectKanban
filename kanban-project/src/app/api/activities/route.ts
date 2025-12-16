import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient, Pais } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Extrair parâmetros de filtro
    const dataInicio = searchParams.get('dataInicio')
    const dataFim = searchParams.get('dataFim')
    const pais = searchParams.get('pais')
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

    // Filtro por país
    if (pais && pais !== '' && pais !== 'all') {
      whereClause.pais = pais as Pais
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
        status: {
          select: {
            nome: true
          }
        },
        contratante: {
          select: {
            nome: true,
            email: true
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
    const { nome, descricao, data_termino, pais, status_id, prazo_category } = body

    // Validações básicas
    if (!nome || !pais || !status_id) {
      return NextResponse.json(
        { error: 'Nome, país e status são obrigatórios' },
        { status: 400 }
      )
    }

    // Validar se o país é válido
    if (!Object.values(Pais).includes(pais)) {
      return NextResponse.json(
        { error: 'País inválido' },
        { status: 400 }
      )
    }

    // Se prazo_category for fornecido, calcular data_termino automaticamente
    let calculatedDataTermino = data_termino ? new Date(data_termino) : null
    
    if (prazo_category && !data_termino) {
      calculatedDataTermino = calculateDateForCategory(prazo_category)
    }

    // Criar a atividade
    const atividade = await prisma.atividade.create({
      data: {
        nome,
        descricao: descricao || null,
        data_termino: calculatedDataTermino,
        pais: pais as Pais,
        statusId: parseInt(status_id)
      },
      include: {
        status: {
          select: {
            nome: true
          }
        },
        contratante: {
          select: {
            nome: true,
            email: true
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

// Função auxiliar para calcular data baseada na categoria de prazo
function calculateDateForCategory(category: string): Date | null {
  const now = new Date()
  
  switch (category) {
    case 'vencido':
      const yesterday = new Date(now)
      yesterday.setDate(now.getDate() - 1)
      return yesterday
      
    case 'hoje':
      const today = new Date(now)
      today.setHours(23, 59, 59, 999)
      return today
      
    case 'proximos-3-dias':
      const in2Days = new Date(now)
      in2Days.setDate(now.getDate() + 2)
      in2Days.setHours(23, 59, 59, 999)
      return in2Days
      
    case 'proxima-semana':
      const in5Days = new Date(now)
      in5Days.setDate(now.getDate() + 5)
      in5Days.setHours(23, 59, 59, 999)
      return in5Days
      
    case 'futuro':
      const in15Days = new Date(now)
      in15Days.setDate(now.getDate() + 15)
      in15Days.setHours(23, 59, 59, 999)
      return in15Days
      
    case 'sem-prazo':
      return null
      
    default:
      return null
  }
}