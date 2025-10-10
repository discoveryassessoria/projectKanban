import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const pessoas = await prisma.pessoa.findMany({
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
      orderBy: {
        nome: "asc",
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
    const body = await request.json()

    const novaPessoa = await prisma.pessoa.create({
      data: {
        nome: body.nome,
        sobrenome: body.sobrenome || null,
        sexo: body.sexo || null,
        data_nasc: body.data_nasc ? new Date(body.data_nasc) : null,
        local_nasc: body.local_nasc || null,
        data_obito: body.data_obito ? new Date(body.data_obito) : null,
        batizado: body.batizado || null,
        paiId: body.paiId ? Number(body.paiId) : null,
        maeId: body.maeId ? Number(body.maeId) : null,
        x: body.x || 0,
        y: body.y || 0,
        arvoreId: body.arvoreId ? Number(body.arvoreId) : 1, // Default tree ID
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
