import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest, { params }: { params: Promise<{ arvoreid: string }> }) {
  try {
    const { arvoreid } = await params
    const id = Number.parseInt(arvoreid)

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

export async function PUT(request: NextRequest, { params }: { params: Promise<{ arvoreid: string }> }) {
  try {
    const { arvoreid } = await params
    const id = Number.parseInt(arvoreid)
    const { nome, descricao, pessoaPrincipalId } = await request.json()

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const arvoreAtualizada = await prisma.arvore.update({
      where: { id },
      data: {
        ...(nome && { nome }),
        ...(descricao && { descricao }),
        ...(pessoaPrincipalId && { pessoaPrincipalId: Number(pessoaPrincipalId) }),
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

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ arvoreid: string }> }) {
  try {
    const { arvoreid } = await params
    const id = Number.parseInt(arvoreid)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Usar uma transação para garantir que tudo seja deletado atomicamente
    await prisma.$transaction(async (tx) => {
      // 1. Deletar todas as pessoas associadas à árvore (onDelete: Cascade cuidará das uniões)
      await tx.pessoa.deleteMany({
        where: { arvoreId: id },
      });

      // 2. Deletar a árvore
      await tx.arvore.delete({
        where: { id },
      });
    })

    return NextResponse.json({ message: "Árvore excluída com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir árvore:", error)
    return NextResponse.json({ error: "Erro ao excluir árvore. Verifique se ela não possui dependências." }, { status: 500 })
  }
}