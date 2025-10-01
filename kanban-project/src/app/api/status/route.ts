import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(request: NextRequest) {
  try {
    const { nome, projetoId } = await request.json()

    if (!nome || !projetoId) {
      return NextResponse.json({ error: "Nome do status e ID do projeto são obrigatórios" }, { status: 400 })
    }

    const newStatus = await prisma.status.create({
      data: {
        nome,
        projeto: {
          connect: {
            id: projetoId,
          },
        },
      },
    })

    return NextResponse.json(newStatus, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar status:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
