import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const arvoreId = searchParams.get("arvoreId")

    const where = arvoreId ? { arvoreId: Number.parseInt(arvoreId) } : {}

    const pessoas = await prisma.pessoa.findMany({
      where,
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

    return NextResponse.json(pessoas)
  } catch (error) {
    console.error("Erro ao buscar pessoas:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { nome, sobrenome, data_nasc, local_nasc, data_obito, batizado, arvoreId, paiId, maeId } =
      await request.json()

    if (!nome || !arvoreId) {
      return NextResponse.json({ error: "Nome e ID da árvore são obrigatórios" }, { status: 400 })
    }

    const novaPessoa = await prisma.pessoa.create({
      data: {
        nome,
        sobrenome,
        data_nasc: data_nasc ? new Date(data_nasc) : null,
        local_nasc,
        data_obito: data_obito ? new Date(data_obito) : null,
        batizado,
        arvoreId: Number.parseInt(arvoreId),
        paiId: paiId ? Number.parseInt(paiId) : null,
        maeId: maeId ? Number.parseInt(maeId) : null,
      },
      include: {
        pai: true,
        mae: true,
        arvore: true,
      },
    })

    return NextResponse.json(novaPessoa, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar pessoa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
