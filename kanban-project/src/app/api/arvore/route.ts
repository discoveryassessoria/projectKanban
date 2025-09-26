import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const arvores = await prisma.arvore.findMany({
      include: {
        pessoas: true,
      },
    })
    return NextResponse.json(arvores)
  } catch (error) {
    console.error("Erro ao buscar árvores:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { nome, descricao } = await request.json()

    if (!nome) {
      return NextResponse.json({ error: "O nome da árvore é obrigatório" }, { status: 400 })
    }

    const novaArvore = await prisma.arvore.create({
      data: {
        nome,
        descricao,
      },
      include: {
        pessoas: true,
      },
    })

    return NextResponse.json(novaArvore, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar árvore:", error)
    // Adiciona mais detalhes do erro no log do servidor para depuração
    if (error instanceof Error) {
      console.error(error.message);
    }
    return NextResponse.json({ error: "Erro interno do servidor ao criar árvore" }, { status: 500 })
  }
}