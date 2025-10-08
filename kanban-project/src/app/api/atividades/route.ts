import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projetoId = searchParams.get("projetoId")

    if (!projetoId) {
      return NextResponse.json({ error: "O ID do projeto é obrigatório" }, { status: 400 })
    }

    const atividades = await prisma.atividade.findMany({
      where: {
        projetoId: Number.parseInt(projetoId),
      },
      include: {
        status: true,
        usuarios: {
          include: {
            usuario: true
          }
        }
      },
      orderBy: {
        data_criacao: 'desc'
      }
    })

    return NextResponse.json({ atividades }, { status: 200 })
  } catch (error) {
    console.error("Erro ao buscar atividades:", error)
    return NextResponse.json({ error: "Erro interno do servidor ao buscar atividades" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { nome, statusId, projetoId } = body

    if (!nome || !statusId || !projetoId) {
      return NextResponse.json({ error: "Nome, statusId e projetoId são obrigatórios" }, { status: 400 })
    }

    const novaAtividade = await prisma.atividade.create({
      data: {
        nome,
        statusId,
        projetoId,
      },
      include: {
        status: true,
        usuarios: {
          include: {
            usuario: true
          }
        }
      },
    })

    return NextResponse.json({ atividade: novaAtividade }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar atividade:", error)
    return NextResponse.json({ error: "Erro interno do servidor ao criar atividade" }, { status: 500 })
  }
}
