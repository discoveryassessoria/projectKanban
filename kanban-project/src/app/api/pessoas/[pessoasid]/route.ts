import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number.parseInt(params.id)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const pessoa = await prisma.pessoa.findUnique({
      where: { id },
      include: {
        pai: true,
        mae: true,
        filhosComoPai: true,
        filhosComoMae: true,
        arvore: true,
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
    })

    if (!pessoa) {
      return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 })
    }

    return NextResponse.json(pessoa)
  } catch (error) {
    console.error("Erro ao buscar pessoa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number.parseInt(params.id)
    const { nome, sobrenome, data_nasc, local_nasc, data_obito, batizado, paiId, maeId } = await request.json()

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const pessoaAtualizada = await prisma.pessoa.update({
      where: { id },
      data: {
        nome,
        sobrenome,
        data_nasc: data_nasc ? new Date(data_nasc) : null,
        local_nasc,
        data_obito: data_obito ? new Date(data_obito) : null,
        batizado,
        paiId: paiId ? Number.parseInt(paiId) : null,
        maeId: maeId ? Number.parseInt(maeId) : null,
      },
      include: {
        pai: true,
        mae: true,
        arvore: true,
      },
    })

    return NextResponse.json(pessoaAtualizada)
  } catch (error) {
    console.error("Erro ao atualizar pessoa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number.parseInt(params.id)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Verificar se a pessoa tem filhos antes de excluir
    const pessoa = await prisma.pessoa.findUnique({
      where: { id },
      include: {
        filhosComoPai: true,
        filhosComoMae: true,
      },
    })

    if (!pessoa) {
      return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 })
    }

    if (pessoa.filhosComoPai.length > 0 || pessoa.filhosComoMae.length > 0) {
      return NextResponse.json({ error: "Não é possível excluir uma pessoa que possui filhos" }, { status: 400 })
    }

    await prisma.pessoa.delete({
      where: { id },
    })

    return NextResponse.json({ message: "Pessoa excluída com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir pessoa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
