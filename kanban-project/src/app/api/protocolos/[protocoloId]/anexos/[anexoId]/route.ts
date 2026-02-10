// src/app/api/protocolos/[protocoloId]/anexos/[anexoId]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// DELETE - Excluir anexo específico
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ protocoloId: string; anexoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'processos.editar')
    if (erro) return erro

    const { protocoloId, anexoId } = await params
    const protocoloIdNum = parseInt(protocoloId)
    const anexoIdNum = parseInt(anexoId)

    if (isNaN(protocoloIdNum) || isNaN(anexoIdNum)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    // Verificar se anexo existe e pertence ao protocolo
    const anexo = await prisma.anexoProtocolo.findFirst({
      where: {
        id: anexoIdNum,
        protocoloId: protocoloIdNum
      }
    })

    if (!anexo) {
      return NextResponse.json(
        { error: "Anexo não encontrado" },
        { status: 404 }
      )
    }

    await prisma.anexoProtocolo.delete({
      where: { id: anexoIdNum }
    })

    return NextResponse.json({ message: "Anexo excluído com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir anexo:", error)
    return NextResponse.json(
      { error: "Erro ao excluir anexo" },
      { status: 500 }
    )
  }
}