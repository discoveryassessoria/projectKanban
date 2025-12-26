// src/app/api/informacoes-italia/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Buscar informação por processoId
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const processoId = searchParams.get("processoId")

    if (!processoId) {
      return NextResponse.json(
        { error: "processoId é obrigatório" },
        { status: 400 }
      )
    }

    const informacao = await prisma.informacaoItalia.findUnique({
      where: { processoId: parseInt(processoId) },
      include: {
        anexos: {
          orderBy: { createdAt: "desc" }
        }
      }
    })

    return NextResponse.json({ informacao })
  } catch (error) {
    console.error("Erro ao buscar informação:", error)
    return NextResponse.json(
      { error: "Erro ao buscar informação" },
      { status: 500 }
    )
  }
}

// POST - Criar informação
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      processoId, 
      tribunal, 
      dataProtocolo, 
      dataDistribuicao, 
      numeroRuoloGenerale, 
      observacoes 
    } = body

    if (!processoId || !tribunal) {
      return NextResponse.json(
        { error: "processoId e tribunal são obrigatórios" },
        { status: 400 }
      )
    }

    // Verificar se já existe informação para este processo
    const existente = await prisma.informacaoItalia.findUnique({
      where: { processoId: parseInt(processoId) }
    })

    if (existente) {
      return NextResponse.json(
        { error: "Já existe uma informação cadastrada para este processo" },
        { status: 400 }
      )
    }

    const informacao = await prisma.informacaoItalia.create({
      data: {
        processoId: parseInt(processoId),
        tribunal,
        dataProtocolo: dataProtocolo ? new Date(dataProtocolo) : null,
        dataDistribuicao: dataDistribuicao ? new Date(dataDistribuicao) : null,
        numeroRuoloGenerale: numeroRuoloGenerale || null,
        observacoes: observacoes || null
      },
      include: {
        anexos: true
      }
    })

    return NextResponse.json(informacao, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar informação:", error)
    return NextResponse.json(
      { error: "Erro ao criar informação" },
      { status: 500 }
    )
  }
}