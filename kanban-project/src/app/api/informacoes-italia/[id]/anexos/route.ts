// src/app/api/informacoes-italia/[id]/anexos/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Listar anexos de uma informação
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const informacaoItaliaId = parseInt(id)

    const anexos = await prisma.anexoInformacaoItalia.findMany({
      where: { informacaoItaliaId },
      orderBy: { createdAt: "desc" }
    })

    return NextResponse.json({ anexos })
  } catch (error) {
    console.error("Erro ao buscar anexos:", error)
    return NextResponse.json(
      { error: "Erro ao buscar anexos" },
      { status: 500 }
    )
  }
}

// POST - Criar anexo
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const informacaoItaliaId = parseInt(id)
    const body = await request.json()
    const { nome, nomeArquivo, urlArquivo, tamanho, mimeType, tipo } = body

    if (!nome || !nomeArquivo || !urlArquivo) {
      return NextResponse.json(
        { error: "nome, nomeArquivo e urlArquivo são obrigatórios" },
        { status: 400 }
      )
    }

    const anexo = await prisma.anexoInformacaoItalia.create({
      data: {
        informacaoItaliaId,
        nome,
        nomeArquivo,
        urlArquivo,
        tamanho: tamanho || null,
        mimeType: mimeType || null,
        tipo: tipo || null
      }
    })

    return NextResponse.json(anexo, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar anexo:", error)
    return NextResponse.json(
      { error: "Erro ao criar anexo" },
      { status: 500 }
    )
  }
}