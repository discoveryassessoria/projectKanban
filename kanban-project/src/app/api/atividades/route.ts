import { NextRequest, NextResponse } from "next/server"
import { PrismaClient, Pais } from "@prisma/client"

const prisma = new PrismaClient()

// GET - Buscar atividades
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const pais = searchParams.get("pais") as Pais | null

    const where = pais ? { pais } : {}

    const atividades = await prisma.atividade.findMany({
      where,
      include: {
        status: true,
        contratante: true,
        usuarios: {
          include: {
            usuario: {
              select: {
                id: true,
                nome: true,
                email: true
              }
            }
          }
        },
        requerentes: {
          include: {
            requerente: true
          }
        },
        arvore: {
          select: {
            id: true,
            nome: true
          }
        }
      },
      orderBy: {
        data_criacao: 'desc'
      }
    })

    return NextResponse.json({ atividades })
  } catch (error) {
    console.error("Erro ao buscar atividades:", error)
    return NextResponse.json(
      { error: "Erro ao buscar atividades" },
      { status: 500 }
    )
  }
}

// POST - Criar nova atividade
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      nome, 
      descricao, 
      pais,
      statusId, 
      contratanteId,
      requerenteIds,
      arvore_id,
      data_termino 
    } = body

    if (!nome) {
      return NextResponse.json(
        { error: "Nome é obrigatório" },
        { status: 400 }
      )
    }

    if (!pais || !Object.values(Pais).includes(pais)) {
      return NextResponse.json(
        { error: "País inválido. Use: PORTUGAL, ESPANHA, ALEMANHA ou ITALIA" },
        { status: 400 }
      )
    }

    if (!statusId) {
      return NextResponse.json(
        { error: "Status é obrigatório" },
        { status: 400 }
      )
    }

    const atividade = await prisma.atividade.create({
      data: {
        nome,
        descricao,
        pais,
        statusId,
        contratanteId: contratanteId || null,
        arvore_id: arvore_id || null,
        data_termino: data_termino ? new Date(data_termino) : null,
        ...(requerenteIds?.length > 0 && {
          requerentes: {
            create: requerenteIds.map((requerenteId: number) => ({
              requerenteId
            }))
          }
        })
      },
      include: {
        status: true,
        contratante: true,
        requerentes: {
          include: {
            requerente: true
          }
        }
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