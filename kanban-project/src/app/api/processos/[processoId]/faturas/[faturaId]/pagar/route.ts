// src/app/api/processos/[processoId]/faturas/[faturaId]/pagar/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// POST - Marcar fatura como paga
export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string; faturaId: string }> }
) {
  try {
    const { processoId, faturaId } = await params
    const pId = parseInt(processoId)
    const fId = parseInt(faturaId)

    if (isNaN(pId) || isNaN(fId)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { 
      formaPagamento, 
      valorPago,
      dataPagamento,
      comprovanteUrl,
      comprovanteNome 
    } = body

    // Verificar se fatura existe
    const faturaExistente = await prisma.fatura.findFirst({
      where: { 
        id: fId,
        processoId: pId 
      }
    })

    if (!faturaExistente) {
      return NextResponse.json(
        { error: "Fatura não encontrada" },
        { status: 404 }
      )
    }

    // Verificar se já foi paga
    if (faturaExistente.status === 'PAGO') {
      return NextResponse.json(
        { error: "Fatura já está paga" },
        { status: 400 }
      )
    }

    // Verificar se está cancelada
    if (faturaExistente.status === 'CANCELADO') {
      return NextResponse.json(
        { error: "Não é possível pagar uma fatura cancelada" },
        { status: 400 }
      )
    }

    const fatura = await prisma.fatura.update({
      where: { id: fId },
      data: {
        status: 'PAGO',
        formaPagamento: formaPagamento || null,
        valorPago: valorPago ? parseFloat(valorPago) : Number(faturaExistente.valor),
        dataPagamento: dataPagamento ? new Date(dataPagamento) : new Date(),
        comprovanteUrl: comprovanteUrl || null,
        comprovanteNome: comprovanteNome || null
      }
    })

    return NextResponse.json({ fatura })
  } catch (error) {
    console.error('Erro ao marcar fatura como paga:', error)
    return NextResponse.json(
      { error: "Erro ao processar pagamento" },
      { status: 500 }
    )
  }
}