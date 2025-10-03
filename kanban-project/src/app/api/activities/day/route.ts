import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface DayActivity {
  id: number
  nome: string
  projeto: string
  hora: string
  data_completa: string
  tipo_evento: 'criacao' | 'prazo'
  descricao: string | null
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') // YYYY-MM-DD

    if (!date) {
      return NextResponse.json({ error: 'Data é obrigatória' }, { status: 400 })
    }

    // Converter para range de data (início e fim do dia)
    const startDate = new Date(date + 'T00:00:00.000Z')
    const endDate = new Date(date + 'T23:59:59.999Z')

    // Buscar atividades criadas neste dia
    const atividadesCriadas = await prisma.atividade.findMany({
      where: {
        data_criacao: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        projeto: {
          select: {
            nome: true
          }
        }
      }
    })

    // Buscar atividades com prazo neste dia
    const atividadesPrazo = await prisma.atividade.findMany({
      where: {
        data_termino: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        projeto: {
          select: {
            nome: true
          }
        }
      }
    })

    // Combinar e formatar todas as atividades
    const allActivities: DayActivity[] = []

    // Adicionar atividades criadas
    atividadesCriadas.forEach(atividade => {
      allActivities.push({
        id: atividade.id,
        nome: atividade.nome,
        projeto: atividade.projeto.nome,
        hora: new Date(atividade.data_criacao).toLocaleTimeString('pt-BR', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        }),
        data_completa: atividade.data_criacao.toISOString(),
        tipo_evento: 'criacao',
        descricao: atividade.descricao
      })
    })

    // Adicionar atividades com prazo
    atividadesPrazo.forEach(atividade => {
      // Verificar se não é duplicata (mesma atividade criada e com prazo no mesmo dia)
      const existingIndex = allActivities.findIndex(a => a.id === atividade.id)
      if (existingIndex !== -1) {
        // Se já existe, adicionar como entrada separada para o prazo
        allActivities.push({
          id: atividade.id,
          nome: atividade.nome,
          projeto: atividade.projeto.nome,
          hora: new Date(atividade.data_termino!).toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
          }),
          data_completa: atividade.data_termino!.toISOString(),
          tipo_evento: 'prazo',
          descricao: atividade.descricao
        })
      } else {
        allActivities.push({
          id: atividade.id,
          nome: atividade.nome,
          projeto: atividade.projeto.nome,
          hora: new Date(atividade.data_termino!).toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
          }),
          data_completa: atividade.data_termino!.toISOString(),
          tipo_evento: 'prazo',
          descricao: atividade.descricao
        })
      }
    })

    // Ordenar por horário
    allActivities.sort((a, b) => {
      const timeA = a.hora.split(':').map(Number)
      const timeB = b.hora.split(':').map(Number)
      
      if (timeA[0] !== timeB[0]) {
        return timeA[0] - timeB[0]
      }
      return timeA[1] - timeB[1]
    })

    return NextResponse.json({
      date,
      activities: allActivities
    })
  } catch (error) {
    console.error('Erro ao buscar atividades do dia:', error)
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}