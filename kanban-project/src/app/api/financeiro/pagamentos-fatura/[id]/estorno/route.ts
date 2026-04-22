// src/app/api/financeiro/pagamentos-fatura/[id]/estorno/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const idNum = Number(id)
    const body = await request.json().catch(() => ({}))

    const pagamento = await prisma.pagamentoFatura.update({
      where: { id: idNum },
      data: {
        estornado: true,
        estornadoEm: new Date(),
        estornoMotivo: body.motivo || "Estornado pelo usuário"
      }
    })

    return NextResponse.json({ pagamento })
  } catch (error: any) {
    console.error("Erro ao estornar:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const idNum = Number(id)
    const pagamento = await prisma.pagamentoFatura.update({
      where: { id: idNum },
      data: {
        estornado: false,
        estornadoEm: null,
        estornoMotivo: null
      }
    })
    return NextResponse.json({ pagamento })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}