import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Listar todas as árvores
export async function GET() {
  try {
    const arvores = await prisma.arvore.findMany({
      include: {
        pessoaPrincipal: true,
        _count: {
          select: { pessoas: true }
        }
      },
      orderBy: { id: 'desc' }
    })

    return NextResponse.json({ arvores })
  } catch (error) {
    console.error("Erro ao listar árvores:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST - Criar nova árvore
export async function POST(request: NextRequest) {
  try {
    const { nome, descricao, processoId } = await request.json()

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

    // Se foi passado processoId, vincular ao processo
    if (processoId) {
      await prisma.processo.update({
        where: { id: processoId },
        data: { arvoreId: novaArvore.id }
      })
    }

    return NextResponse.json(novaArvore, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar árvore:", error)
    if (error instanceof Error) {
      console.error(error.message)
    }
    return NextResponse.json({ error: "Erro interno do servidor ao criar árvore" }, { status: 500 })
  }
}