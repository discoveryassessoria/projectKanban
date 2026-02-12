// src/app/api/informacoes-italia/[id]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Buscar informação por ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const idNum = parseInt(id)

    const informacao = await prisma.informacaoItalia.findUnique({
      where: { id: idNum },
      include: {
        anexos: {
          orderBy: { createdAt: "desc" }
        }
      }
    })

    if (!informacao) {
      return NextResponse.json(
        { error: "Informação não encontrada" },
        { status: 404 }
      )
    }

    return NextResponse.json(informacao)
  } catch (error) {
    console.error("Erro ao buscar informação:", error)
    return NextResponse.json(
      { error: "Erro ao buscar informação" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar informação
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'arvore.editar')
    if (erro) return erro

    const { id } = await params
    const idNum = parseInt(id)
    const body = await request.json()
    const { 
      tribunal, 
      dataProtocolo, 
      dataDistribuicao, 
      numeroRuoloGenerale, 
      observacoes 
    } = body

    const informacao = await prisma.informacaoItalia.update({
      where: { id: idNum },
      data: {
        tribunal: tribunal || undefined,
        dataProtocolo: dataProtocolo ? new Date(dataProtocolo) : null,
        dataDistribuicao: dataDistribuicao ? new Date(dataDistribuicao) : null,
        numeroRuoloGenerale: numeroRuoloGenerale || null,
        observacoes: observacoes || null
      },
      include: {
        anexos: true
      }
    })

    return NextResponse.json(informacao)
  } catch (error) {
    console.error("Erro ao atualizar informação:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar informação" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir informação
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar')
    if (erro) return erro
    
    const { id } = await params
    const idNum = parseInt(id)

    await prisma.informacaoItalia.delete({
      where: { id: idNum }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao excluir informação:", error)
    return NextResponse.json(
      { error: "Erro ao excluir informação" },
      { status: 500 }
    )
  }
}