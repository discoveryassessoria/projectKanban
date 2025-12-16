import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Pais } from "@prisma/client"

// GET - Buscar atividades (filtrado por país opcionalmente)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const pais = searchParams.get("pais") as Pais | null

    const where = pais ? { pais } : {}

    const atividades = await prisma.atividade.findMany({
      where,
      include: {
        status: true,
        contratante: true,
        arvore: true,
        requerentes: {
          include: {
            requerente: true
          }
        }
      },
      orderBy: { data_criacao: "desc" }
    })

    // Formatar para incluir requerentes como array simples
    const atividadesFormatadas = atividades.map(a => ({
      ...a,
      requerentes: a.requerentes.map(r => r.requerente)
    }))

    return NextResponse.json({ atividades: atividadesFormatadas })
  } catch (error) {
    console.error("Erro ao buscar atividades:", error)
    return NextResponse.json(
      { error: "Erro ao buscar atividades" },
      { status: 500 }
    )
  }
}

// POST - Criar nova atividade
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { nome, descricao, statusId, pais, contratanteId, arvore_id } = body

    if (!nome) {
      return NextResponse.json(
        { error: "Nome é obrigatório" },
        { status: 400 }
      )
    }

    if (!statusId) {
      return NextResponse.json(
        { error: "Status é obrigatório" },
        { status: 400 }
      )
    }

    if (!pais) {
      return NextResponse.json(
        { error: "País é obrigatório" },
        { status: 400 }
      )
    }

    // Validar se o país é válido
    if (!Object.values(Pais).includes(pais)) {
      return NextResponse.json(
        { error: "País inválido" },
        { status: 400 }
      )
    }

    // Verificar se o status existe e pertence ao país correto
    const status = await prisma.status.findUnique({
      where: { id: statusId }
    })

    if (!status) {
      return NextResponse.json(
        { error: "Status não encontrado" },
        { status: 404 }
      )
    }

    if (status.pais !== pais) {
      return NextResponse.json(
        { error: "Status não pertence a este país" },
        { status: 400 }
      )
    }

    const atividade = await prisma.atividade.create({
      data: {
        nome,
        descricao: descricao || null,
        pais,
        statusId,
        contratanteId: contratanteId || null,
        arvore_id: arvore_id || null
      },
      include: {
        status: true,
        contratante: true
      }
    })

    return NextResponse.json({ atividade }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar atividade:", error)
    return NextResponse.json(
      { error: "Erro ao criar atividade" },
      { status: 500 }
    )
  }
}