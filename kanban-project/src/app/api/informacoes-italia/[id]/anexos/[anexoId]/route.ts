// src/app/api/informacoes-italia/[id]/anexos/[anexoId]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// DELETE - Excluir anexo específico
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; anexoId: string }> }
) {
  try {
    const { anexoId } = await params
    const anexoIdNum = parseInt(anexoId)

    await prisma.anexoInformacaoItalia.delete({
      where: { id: anexoIdNum }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao excluir anexo:", error)
    return NextResponse.json(
      { error: "Erro ao excluir anexo" },
      { status: 500 }
    )
  }
}