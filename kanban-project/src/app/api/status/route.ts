import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const status = await prisma.status.findMany({
      include: {
        projeto: true,
        _count: {
          select: {
            atividades: true
          }
        }
      },
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
    const { nome, projetoId } = await request.json()

    if (!nome || !projetoId) {
      return NextResponse.json({ error: "Nome do status e ID do projeto são obrigatórios" }, { status: 400 })
    }

    // Validação de comprimento
    if (nome.length > 20) {
      return NextResponse.json({ error: 'Nome deve ter no máximo 20 caracteres' }, { status: 400 })
    }

    // Verificar se já existe um status com o mesmo nome no mesmo projeto
    const existingStatus = await prisma.status.findFirst({
      where: {
        nome: {
          equals: nome.trim(),
          mode: 'insensitive'
        },
        projetoId: projetoId
      }
    })

    if (existingStatus) {
      return NextResponse.json({ error: 'Já existe um status com este nome neste projeto' }, { status: 409 })
    }

    // Get the highest ordem value for this project to set the new status at the end
    const lastStatus = await prisma.status.findFirst({
      where: { projetoId },
      orderBy: { ordem: 'desc' }
    })

    const nextOrdem = (lastStatus?.ordem ?? -1) + 1

    const newStatus = await prisma.status.create({
      data: {
        nome: nome.trim(),
        ordem: nextOrdem,
        projeto: {
          connect: {
            id: projetoId,
          },
        },
      },
      include: {
        projeto: true,
        _count: {
          select: {
            atividades: true
          }
        }
      }
    })

    return NextResponse.json({ status: newStatus }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar status:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
