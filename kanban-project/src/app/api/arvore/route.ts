import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const arvores = await prisma.arvore.findMany({
      include: {
        pessoas: {
          include: {
            pai: true,
            mae: true,
            filhosComoPai: true,
            filhosComoMae: true,
            unioesComoPessoa1: {
              include: {
                pessoa2: true,
              },
            },
            unioesComoPessoa2: {
              include: {
                pessoa1: true,
              },
            },
          },
        },
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
      return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
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
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
