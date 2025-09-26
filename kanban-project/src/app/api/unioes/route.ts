import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const unioes = await prisma.uniao.findMany({
      include: {
        pessoa1: true,
        pessoa2: true,
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
    const { pessoa1Id, pessoa2Id, data_inicio, data_fim, tipo, arvoreId } = await request.json()

    if (!pessoa1Id || !pessoa2Id) {
      return NextResponse.json({ error: "IDs das duas pessoas são obrigatórios" }, { status: 400 })
    }

    if (pessoa1Id === pessoa2Id) {
      return NextResponse.json({ error: "Uma pessoa não pode ter união consigo mesma" }, { status: 400 })
    }

    const pessoa1 = await prisma.pessoa.findUnique({ where: { id: Number.parseInt(pessoa1Id) } })
    const pessoa2 = await prisma.pessoa.findUnique({ where: { id: Number.parseInt(pessoa2Id) } })

    if (!pessoa1 || !pessoa2) {
      return NextResponse.json({ error: "Uma ou ambas as pessoas não foram encontradas" }, { status: 404 })
    }

    if (
      arvoreId &&
      (pessoa1.arvoreId !== Number.parseInt(arvoreId) || pessoa2.arvoreId !== Number.parseInt(arvoreId))
    ) {
      return NextResponse.json({ error: "As pessoas devem pertencer à mesma árvore" }, { status: 400 })
    }

    const novaUniao = await prisma.uniao.create({
      data: {
        pessoa1Id: Number.parseInt(pessoa1Id),
        pessoa2Id: Number.parseInt(pessoa2Id),
        data_inicio: data_inicio ? new Date(data_inicio) : null,
        data_fim: data_fim ? new Date(data_fim) : null,
        tipo,
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
