import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const unioes = await prisma.uniao.findMany({
      include: {
        pessoa1: {
          include: {
            pai: true,
            mae: true
          }
        },
        pessoa2: {
          include: {
            pai: true,
            mae: true
          }
        },
      },
    })
    return NextResponse.json(unioes)
  } catch (error) {
    console.error("Erro ao buscar uniões:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const novaUniao = await prisma.uniao.create({
      data: {
        pessoa1Id: Number(body.pessoa1Id),
        pessoa2Id: Number(body.pessoa2Id),
        data_inicio: body.data_inicio ? new Date(body.data_inicio) : null,
        data_fim: body.data_fim ? new Date(body.data_fim) : null,
        tipo: body.tipo || 'casamento',
        local: body.local || null,
      },
      include: {
        pessoa1: {
          include: {
            pai: true,
            mae: true
          }
        },
        pessoa2: {
          include: {
            pai: true,
            mae: true
          }
        },
      },
    })
    
    return NextResponse.json(novaUniao, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar união:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}