import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(request: NextRequest) {
  try {
    const { pessoa1Id, pessoa2Id, tipo } = await request.json()

    if (!pessoa1Id || !pessoa2Id) {
      return NextResponse.json({ error: "IDs das pessoas são obrigatórios" }, { status: 400 })
    }

    const novaUniao = await prisma.uniao.create({
      data: {
        pessoa1Id: Number(pessoa1Id),
        pessoa2Id: Number(pessoa2Id),
        tipo,
      },
    })

    return NextResponse.json(novaUniao, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar união:", error)
    if (error instanceof Error) {
      console.error(error.message);
    }
    return NextResponse.json({ error: "Erro interno do servidor ao criar união" }, { status: 500 })
  }
}