// src/app/api/processos/[processoId]/servicos/[servicoId]/route.ts

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// DELETE - Remover tipo de serviço
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; servicoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar')
    if (erro) return erro

    const { processoId, servicoId } = await params
    const procId = parseInt(processoId)
    const servId = parseInt(servicoId)

    if (isNaN(procId) || isNaN(servId)) {
      return NextResponse.json({ error: "IDs inválidos" }, { status: 400 })
    }

    // Verificar se existe
    const servico = await prisma.tipoServico.findFirst({
      where: { 
        id: servId,
        processoId: procId
      }
    })

    if (!servico) {
      return NextResponse.json({ error: "Tipo de serviço não encontrado" }, { status: 404 })
    }

    // Deletar (cascade vai remover os custos vinculados)
    await prisma.tipoServico.delete({
      where: { id: servId }
    })

    return NextResponse.json({ message: "Tipo de serviço removido com sucesso" })
  } catch (error) {
    console.error("Erro ao remover tipo de serviço:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// PUT - Atualizar tipo de serviço (nome ou ordem)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; servicoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar')
    if (erro) return erro

    const { processoId, servicoId } = await params
    const procId = parseInt(processoId)
    const servId = parseInt(servicoId)

    if (isNaN(procId) || isNaN(servId)) {
      return NextResponse.json({ error: "IDs inválidos" }, { status: 400 })
    }

    const body = await request.json()

    const servico = await prisma.tipoServico.findFirst({
      where: { 
        id: servId,
        processoId: procId
      }
    })

    if (!servico) {
      return NextResponse.json({ error: "Tipo de serviço não encontrado" }, { status: 404 })
    }

    const dataToUpdate: any = {}
    if (body.nome !== undefined) dataToUpdate.nome = body.nome.trim()
    if (body.ordem !== undefined) dataToUpdate.ordem = body.ordem

    const servicoAtualizado = await prisma.tipoServico.update({
      where: { id: servId },
      data: dataToUpdate
    })

    return NextResponse.json(servicoAtualizado)
  } catch (error) {
    console.error("Erro ao atualizar tipo de serviço:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}