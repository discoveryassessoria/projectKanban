// src/app/api/protocolos/[protocoloId]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Consulado } from "@prisma/client"

// GET - Buscar protocolo por ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ protocoloId: string }> }
) {
  try {
    const { protocoloId } = await params
    const id = parseInt(protocoloId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const protocolo = await prisma.protocolo.findUnique({
      where: { id },
      include: {
        contratante: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true
          }
        },
        requerente: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true
          }
        },
        processo: {
          select: {
            id: true,
            nome: true,
            pais: true
          }
        }
      }
    })

    if (!protocolo) {
      return NextResponse.json(
        { error: "Protocolo não encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json({ protocolo })
  } catch (error) {
    console.error("Erro ao buscar protocolo:", error)
    return NextResponse.json(
      { error: "Erro ao buscar protocolo" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar protocolo
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ protocoloId: string }> }
) {
  try {
    const { protocoloId } = await params
    const id = parseInt(protocoloId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const {
      contratanteId,
      requerenteId,
      consulado,
      consuladoOutro,
      dataProtocolo,
      numeroProtocolo,
      observacoes
    } = body

    // Verificar se existe
    const protocoloExistente = await prisma.protocolo.findUnique({
      where: { id }
    })

    if (!protocoloExistente) {
      return NextResponse.json(
        { error: "Protocolo não encontrado" },
        { status: 404 }
      )
    }

    // Validar consulado se fornecido
    if (consulado && !Object.values(Consulado).includes(consulado)) {
      return NextResponse.json(
        { error: "Consulado inválido" },
        { status: 400 }
      )
    }

    // Montar dados de atualização
    const updateData: any = {}

    if (contratanteId !== undefined) {
      updateData.contratanteId = contratanteId || null
      // Se definiu contratante, limpa requerente
      if (contratanteId) updateData.requerenteId = null
    }

    if (requerenteId !== undefined) {
      updateData.requerenteId = requerenteId || null
      // Se definiu requerente, limpa contratante
      if (requerenteId) updateData.contratanteId = null
    }

    if (consulado !== undefined) {
      updateData.consulado = consulado
      updateData.consuladoOutro = consulado === "OUTROS" ? consuladoOutro : null
    }

    if (dataProtocolo !== undefined) {
      updateData.dataProtocolo = dataProtocolo ? new Date(dataProtocolo) : null
    }

    if (numeroProtocolo !== undefined) {
      updateData.numeroProtocolo = numeroProtocolo || null
    }

    if (observacoes !== undefined) {
      updateData.observacoes = observacoes || null
    }

    const protocolo = await prisma.protocolo.update({
      where: { id },
      data: updateData,
      include: {
        contratante: {
          select: {
            id: true,
            nome: true
          }
        },
        requerente: {
          select: {
            id: true,
            nome: true
          }
        }
      }
    })

    return NextResponse.json({ protocolo })
  } catch (error) {
    console.error("Erro ao atualizar protocolo:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar protocolo" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir protocolo
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ protocoloId: string }> }
) {
  try {
    const { protocoloId } = await params
    const id = parseInt(protocoloId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    // Verificar se existe
    const protocolo = await prisma.protocolo.findUnique({
      where: { id }
    })

    if (!protocolo) {
      return NextResponse.json(
        { error: "Protocolo não encontrado" },
        { status: 404 }
      )
    }

    await prisma.protocolo.delete({
      where: { id }
    })

    return NextResponse.json({ message: "Protocolo excluído com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir protocolo:", error)
    return NextResponse.json(
      { error: "Erro ao excluir protocolo" },
      { status: 500 }
    )
  }
}