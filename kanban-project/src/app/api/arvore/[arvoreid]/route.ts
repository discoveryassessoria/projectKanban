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
            // ✅ ADICIONADO: Incluir documentos de cada pessoa
            documentos: {
              orderBy: { createdAt: 'desc' }
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
    const { nome, descricao, pessoaPrincipalId, commentPosX, commentPosY, posicoesNodes } = await request.json()

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Filtra apenas os campos que foram enviados na requisição para não sobrescrever com `undefined`
    const dataToUpdate: { [key: string]: any } = {}
    if (nome !== undefined) dataToUpdate.nome = nome
    if (descricao !== undefined) dataToUpdate.descricao = descricao
    if (pessoaPrincipalId !== undefined) dataToUpdate.pessoaPrincipalId = pessoaPrincipalId
    if (commentPosX !== undefined) dataToUpdate.commentPosX = commentPosX
    if (commentPosY !== undefined) dataToUpdate.commentPosY = commentPosY
    if (posicoesNodes !== undefined) dataToUpdate.posicoesNodes = posicoesNodes

    if (Object.keys(dataToUpdate).length === 0) {
      return NextResponse.json({ error: "Nenhum dado para atualizar" }, { status: 400 })
    }

    const updatedArvore = await prisma.arvore.update({
      where: { id },
      data: dataToUpdate,
    })

    return NextResponse.json(updatedArvore)
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
      await tx.uniao.deleteMany({ where: { pessoa1: { arvoreId: id } } })
      await tx.pessoa.deleteMany({ where: { arvoreId: id } })
      await tx.arvore.delete({ where: { id } })
    })

    return NextResponse.json({ message: "Árvore e todos os seus dados foram excluídos com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir árvore:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}