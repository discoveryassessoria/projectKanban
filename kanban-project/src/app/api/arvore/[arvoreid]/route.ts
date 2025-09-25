import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number.parseInt(params.id)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const arvore = await prisma.arvore.findUnique({
      where: { id },
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

    if (!arvore) {
      return NextResponse.json({ error: "Árvore não encontrada" }, { status: 404 })
    }

    return NextResponse.json(arvore)
  } catch (error) {
    console.error("Erro ao buscar árvore:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number.parseInt(params.id)
    const { nome, descricao } = await request.json()

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const arvoreAtualizada = await prisma.arvore.update({
      where: { id },
      data: {
        nome,
        descricao,
      },
      include: {
        pessoas: true,
      },
    })

    return NextResponse.json(arvoreAtualizada)
  } catch (error) {
    console.error("Erro ao atualizar árvore:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number.parseInt(params.id)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    await prisma.arvore.delete({
      where: { id },
    })

    return NextResponse.json({ message: "Árvore excluída com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir árvore:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
