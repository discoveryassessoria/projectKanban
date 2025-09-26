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
    console.log("[v0] DELETE request received")
    console.log("[v0] Raw params:", params)
    console.log("[v0] params.id:", params.id, "type:", typeof params.id)

    const resolvedParams = await params
    console.log("[v0] Resolved params:", resolvedParams)
    console.log("[v0] Resolved params.id:", resolvedParams.id, "type:", typeof resolvedParams.id)

    const id = Number.parseInt(resolvedParams.id)
    console.log("[v0] Parsed ID:", id, "isNaN:", isNaN(id))

    if (isNaN(id)) {
      console.log("[v0] Invalid ID detected, returning 400")
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Verificar se a pessoa existe e tem filhos antes de excluir
    console.log("[v0] Searching for person with ID:", id)
    const pessoa = await prisma.pessoa.findUnique({
      where: { id },
      include: {
        filhosComoPai: true,
        filhosComoMae: true,
      },
    })

    console.log("[v0] Person found:", pessoa ? "Yes" : "No")
    if (pessoa) {
      console.log("[v0] Children as father:", pessoa.filhosComoPai?.length || 0)
      console.log("[v0] Children as mother:", pessoa.filhosComoMae?.length || 0)
    }

    if (!pessoa) {
      console.log("[v0] Person not found, returning 404")
      return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 })
    }

    if (pessoa.filhosComoPai.length > 0 || pessoa.filhosComoMae.length > 0) {
      console.log("[v0] Person has children, cannot delete")
      return NextResponse.json({ error: "Não é possível excluir uma pessoa que possui filhos" }, { status: 400 })
    }

    console.log("[v0] Attempting to delete person...")
    await prisma.pessoa.delete({
      where: { id },
    })

    console.log("[v0] Person deleted successfully")
    return NextResponse.json({ message: "Pessoa excluída com sucesso" })
  } catch (error) {
    console.error("[v0] Error during delete operation:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
