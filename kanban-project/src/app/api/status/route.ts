import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const status = await prisma.status.findMany({
      orderBy: {
        ordem: 'asc'
      }
    })

    return NextResponse.json({ status })
  } catch (error) {
    console.error('Erro ao buscar status:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { nome } = await request.json()

    if (!nome) {
      return NextResponse.json({ error: "Nome do status é obrigatório" }, { status: 400 })
    }

    // Validação de comprimento
    if (nome.length > 20) {
      return NextResponse.json({ error: 'Nome deve ter no máximo 20 caracteres' }, { status: 400 })
    }

    // Verificar se já existe um status com o mesmo nome
    const existingStatus = await prisma.status.findFirst({
      where: {
        nome: {
          equals: nome.trim(),
          mode: 'insensitive'
        }
      }
    })

    if (existingStatus) {
      return NextResponse.json({ error: 'Já existe um status com este nome' }, { status: 409 })
    }

    // Pegar a maior ordem atual
    const lastStatus = await prisma.status.findFirst({
      orderBy: { ordem: 'desc' }
    })
    const nextOrdem = (lastStatus?.ordem ?? -1) + 1

    const newStatus = await prisma.status.create({
      data: {
        nome: nome.trim(),
        ordem: nextOrdem
      }
    })

    return NextResponse.json({ status: newStatus }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar status:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}