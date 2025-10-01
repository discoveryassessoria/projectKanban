import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET() {
  try {
    const projetos = await prisma.projetoKanban.findMany({
      select: {
        id: true,
        nome: true,
        descricao: true,
        _count: {
          select: {
            atividades: true
          }
        }
      },
      orderBy: {
        nome: 'asc'
      }
    })

    return NextResponse.json(projetos)
  } catch (error) {
    console.error('Erro ao buscar projetos:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { nome, descricao } = body

    // Validação básica
    if (!nome || nome.trim() === '') {
      return NextResponse.json({ error: 'Nome do projeto é obrigatório' }, { status: 400 })
    }

    // Criar o projeto
    const novoProjeto = await prisma.projetoKanban.create({
      data: {
        nome: nome.trim(),
        descricao: descricao?.trim() || null
      }
    })

    return NextResponse.json(novoProjeto, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar projeto:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}