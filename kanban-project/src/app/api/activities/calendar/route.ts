import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface CalendarActivity {
  date: string // YYYY-MM-DD
  type: 'creation' | 'deadline'
  activities: {
    id: number
    nome: string
    pais: string
    hora: string // HH:MM
    data_completa: string // ISO string completa
    tipo_evento: 'criacao' | 'prazo'
  }[]
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const year = searchParams.get('year')
    const month = searchParams.get('month')

    // Se year e month forem fornecidos, filtrar por eles, senão buscar todas
    let startDate: Date | undefined
    let endDate: Date | undefined

    if (year && month) {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1)
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999)
    }

    const whereClause: any = {}

    // Buscar atividades que tenham data de criação ou data de término no período
    if (startDate && endDate) {
      whereClause.OR = [
        {
          data_criacao: {
            gte: startDate,
            lte: endDate
          }
        },
        {
          data_termino: {
            gte: startDate,
            lte: endDate
          }
        }
      ]
    }

    const atividades = await prisma.atividade.findMany({
      where: whereClause,
      orderBy: {
        data_criacao: 'asc'
      }
    })

    // Agrupar atividades por data
    const calendarData: { [key: string]: CalendarActivity & { hasCreation?: boolean; hasDeadline?: boolean } } = {}

    atividades.forEach(atividade => {
      // Adicionar data de criação
      if (atividade.data_criacao) {
        const creationDate = new Date(atividade.data_criacao).toISOString().split('T')[0]
        
        if (!calendarData[creationDate]) {
          calendarData[creationDate] = {
            date: creationDate,
            type: 'creation',
            activities: [],
            hasCreation: true,
            hasDeadline: false
          }
        } else {
          calendarData[creationDate].hasCreation = true
        }

        calendarData[creationDate].activities.push({
          id: atividade.id,
          nome: atividade.nome,
          pais: atividade.pais,
          hora: new Date(atividade.data_criacao).toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
          }),
          data_completa: atividade.data_criacao.toISOString(),
          tipo_evento: 'criacao'
        })
      }

      // Adicionar data de término (prazo)
      if (atividade.data_termino) {
        const deadlineDate = new Date(atividade.data_termino).toISOString().split('T')[0]
        
        if (!calendarData[deadlineDate]) {
          calendarData[deadlineDate] = {
            date: deadlineDate,
            type: 'deadline',
            activities: [],
            hasCreation: false,
            hasDeadline: true
          }
        } else {
          calendarData[deadlineDate].hasDeadline = true
        }

        calendarData[deadlineDate].activities.push({
          id: atividade.id,
          nome: atividade.nome,
          pais: atividade.pais,
          hora: new Date(atividade.data_termino).toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
          }),
          data_completa: atividade.data_termino.toISOString(),
          tipo_evento: 'prazo'
        })
      }
    })

    // Ajustar tipos baseado no que cada dia tem
    Object.values(calendarData).forEach(dayData => {
      if (dayData.hasCreation && dayData.hasDeadline) {
        dayData.type = 'creation' // Será tratado como 'both' no frontend
      } else if (dayData.hasDeadline) {
        dayData.type = 'deadline'
      } else {
        dayData.type = 'creation'
      }
      // Remover propriedades auxiliares
      delete dayData.hasCreation
      delete dayData.hasDeadline
    })

    // Converter para array
    const result = Object.values(calendarData)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Erro ao buscar dados do calendário:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}