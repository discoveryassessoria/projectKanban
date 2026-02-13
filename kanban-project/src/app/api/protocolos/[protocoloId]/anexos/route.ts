// src/app/api/protocolos/[protocoloId]/anexos/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Buscar anexos de um protocolo
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

    const anexos = await prisma.anexoProtocolo.findMany({
      where: { protocoloId: id },
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

// POST - Criar novo anexo
export async function POST(
  request: Request,
  { params }: { params: Promise<{ protocoloId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar_paginas')
    if (erro) return erro

    const { protocoloId } = await params
    const id = parseInt(protocoloId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { nome, tipo, nomeArquivo, urlArquivo, tamanho, mimeType } = body

    if (!urlArquivo) {
      return NextResponse.json(
        { error: "URL do arquivo é obrigatória" },
        { status: 400 }
      )
    }

    // Verificar se protocolo existe
    const protocolo = await prisma.protocolo.findUnique({
      where: { id }
    })

    if (!protocolo) {
      return NextResponse.json(
        { error: "Protocolo não encontrado" },
        { status: 404 }
      )
    }

    const anexo = await prisma.anexoProtocolo.create({
      data: {
        protocoloId: id,
        nome: nome || nomeArquivo || "Documento",
        tipo: tipo || null,
        nomeArquivo: nomeArquivo || "arquivo",
        urlArquivo,
        tamanho: tamanho || null,
        mimeType: mimeType || null
      }
    })

    return NextResponse.json({ anexo }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar anexo:", error)
    return NextResponse.json(
      { error: "Erro ao criar anexo" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir todos os anexos de um protocolo (opcional)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ protocoloId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar_paginas')
    if (erro) return erro

    const { protocoloId } = await params
    const id = parseInt(protocoloId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    await prisma.anexoProtocolo.deleteMany({
      where: { protocoloId: id }
    })

    return NextResponse.json({ message: "Anexos excluídos com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir anexos:", error)
    return NextResponse.json(
      { error: "Erro ao excluir anexos" },
      { status: 500 }
    )
  }
}