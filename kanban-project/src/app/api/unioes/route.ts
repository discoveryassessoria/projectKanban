import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const unioes = await prisma.uniao.findMany({
      include: {
        pessoa1: true,
        pessoa2: true,
      },
      orderBy: {
        id: "asc",
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

    // Verificar se a união já existe
    const existingUnion = await prisma.uniao.findFirst({
      where: {
        OR: [
          {
            pessoa1Id: body.pessoa1Id,
            pessoa2Id: body.pessoa2Id,
          },
          {
            pessoa1Id: body.pessoa2Id,
            pessoa2Id: body.pessoa1Id,
          },
        ],
      },
    })

    if (existingUnion) {
      return NextResponse.json({ error: "Unique constraint failed: Esta união já existe" }, { status: 400 })
    }

    const novaUniao = await prisma.uniao.create({
      data: {
        pessoa1Id: Number(body.pessoa1Id),
        pessoa2Id: Number(body.pessoa2Id),
        tipo: body.tipo || "Casamento",
        data_inicio: body.data_inicio ? new Date(body.data_inicio) : null,
        data_fim: body.data_fim ? new Date(body.data_fim) : null,
      },
      include: {
        pessoa1: true,
        pessoa2: true,
      },
    })

    return NextResponse.json(novaUniao, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar união:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
