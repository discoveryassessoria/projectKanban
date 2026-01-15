// app/api/eventos/route.ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Listar eventos (todos ou filtrados por processo)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const processoId = searchParams.get("processoId")
    const dataInicio = searchParams.get("dataInicio")
    const dataFim = searchParams.get("dataFim")

    const where: any = {}

    if (processoId) {
      where.processoId = parseInt(processoId)
    }

    // Filtro por período
    if (dataInicio || dataFim) {
      where.dataInicio = {}
      if (dataInicio) {
        where.dataInicio.gte = new Date(dataInicio)
      }
      if (dataFim) {
        where.dataInicio.lte = new Date(dataFim)
      }
    }

    const eventos = await prisma.evento.findMany({
      where,
      include: {
        processo: {
          select: {
            id: true,
            nome: true,
            pais: true,
          },
        },
      },
      orderBy: { dataInicio: "asc" },
    })

    return NextResponse.json({ eventos })
  } catch (error) {
    console.error("Erro ao buscar eventos:", error)
    return NextResponse.json(
      { error: "Erro ao buscar eventos" },
      { status: 500 }
    )
  }
}

// POST - Criar evento
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      processoId,
      titulo,
      descricao,
      tipo,
      dataInicio,
      dataFim,
      diaInteiro,
      local,
      lembreteDias,
      cor,
      observacoes,
    } = body

    if (!processoId || !titulo || !dataInicio) {
      return NextResponse.json(
        { error: "Processo, título e data de início são obrigatórios" },
        { status: 400 }
      )
    }

    const evento = await prisma.evento.create({
      data: {
        processoId: parseInt(processoId),
        titulo,
        descricao,
        tipo: tipo || "OUTRO",
        dataInicio: new Date(dataInicio),
        dataFim: dataFim ? new Date(dataFim) : null,
        diaInteiro: diaInteiro || false,
        local,
        lembreteDias: lembreteDias ? parseInt(lembreteDias) : null,
        cor,
        observacoes,
      },
      include: {
        processo: {
          select: {
            id: true,
            nome: true,
            pais: true,
          },
        },
      },
    })

    return NextResponse.json({ evento }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar evento:", error)
    return NextResponse.json(
      { error: "Erro ao criar evento" },
      { status: 500 }
    )
  }
}