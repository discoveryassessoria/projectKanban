// app/api/eventos/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Buscar evento por ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const eventoId = parseInt(id)
    
    const evento = await prisma.evento.findUnique({
      where: { id: eventoId },
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

    if (!evento) {
      return NextResponse.json(
        { error: "Evento não encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json({ evento })
  } catch (error) {
    console.error("Erro ao buscar evento:", error)
    return NextResponse.json(
      { error: "Erro ao buscar evento" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar evento
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const eventoId = parseInt(id)
    const body = await request.json()
    
    const {
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

    const evento = await prisma.evento.update({
      where: { id: eventoId },
      data: {
        titulo,
        descricao,
        tipo,
        dataInicio: dataInicio ? new Date(dataInicio) : undefined,
        dataFim: dataFim ? new Date(dataFim) : null,
        diaInteiro,
        local,
        lembreteDias: lembreteDias !== undefined ? (lembreteDias ? parseInt(lembreteDias) : null) : undefined,
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

    return NextResponse.json({ evento })
  } catch (error) {
    console.error("Erro ao atualizar evento:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar evento" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir evento
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const eventoId = parseInt(id)

    await prisma.evento.delete({
      where: { id: eventoId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao excluir evento:", error)
    return NextResponse.json(
      { error: "Erro ao excluir evento" },
      { status: 500 }
    )
  }
}