// src/app/api/processos/[processoId]/faturas/[faturaId]/pagamentos/[pagamentoId]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// DELETE - Excluir um pagamento específico
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ processoId: string; faturaId: string; pagamentoId: string }> }
) {
  try {
    const { processoId, faturaId, pagamentoId } = await params
    const pId = parseInt(processoId)
    const fId = parseInt(faturaId)
    const pgId = parseInt(pagamentoId)

    if (isNaN(pId) || isNaN(fId) || isNaN(pgId)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    // Verificar se pagamento existe e pertence à fatura correta
    const pagamento = await prisma.pagamentoFatura.findFirst({
      where: { 
        id: pgId,
        faturaId: fId,
        fatura: {
          processoId: pId
        }
      }
    })

    if (!pagamento) {
      return NextResponse.json(
        { error: "Pagamento não encontrado" },
        { status: 404 }
      )
    }

    // Deletar o pagamento
    await prisma.pagamentoFatura.delete({
      where: { id: pgId }
    })

    // Recalcular status da fatura
    const fatura = await prisma.fatura.findUnique({
      where: { id: fId },
      include: { pagamentos: true }
    })

    if (fatura) {
      const valorPago = fatura.pagamentos.reduce((acc, p) => acc + Number(p.valor), 0)
      const valorFatura = Number(fatura.valor)

      let novoStatus: 'PAGO' | 'PARCIAL' | 'PENDENTE' | 'VENCIDO'
      
      if (valorPago >= valorFatura - 0.01) {
        novoStatus = 'PAGO'
      } else if (valorPago > 0) {
        novoStatus = 'PARCIAL'
      } else if (fatura.dataVencimento) {
        const hoje = new Date()
        hoje.setHours(0, 0, 0, 0)
        const dataVenc = new Date(fatura.dataVencimento)
        dataVenc.setHours(0, 0, 0, 0)
        novoStatus = dataVenc < hoje ? 'VENCIDO' : 'PENDENTE'
      } else {
        novoStatus = 'PENDENTE'
      }

      await prisma.fatura.update({
        where: { id: fId },
        data: { status: novoStatus }
      })
    }

    return NextResponse.json({ message: "Pagamento excluído com sucesso" })
  } catch (error) {
    console.error('Erro ao excluir pagamento:', error)
    return NextResponse.json(
      { error: "Erro ao excluir pagamento" },
      { status: 500 }
    )
  }
}