// src/app/api/processos/[processoId]/faturas/[faturaId]/pagamentos/[pagamentoId]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Decimal } from "@prisma/client/runtime/library"

function toNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  return parseFloat(value.toString()) || 0
}

// PATCH - Editar pagamento
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; faturaId: string; pagamentoId: string }> }
) {
  try {
    const { processoId, faturaId, pagamentoId } = await params
    const body = await request.json()
    
    const {
      valor,
      valorOriginal,
      cambio,
      data,
      formaPagamento,
      observacao,
      destinatarioIds
    } = body

    // Buscar pagamento atual para calcular diferença
    const pagamentoAtual = await prisma.pagamentoFatura.findUnique({
      where: { id: parseInt(pagamentoId) }
    })

    if (!pagamentoAtual) {
      return NextResponse.json(
        { error: "Pagamento não encontrado" },
        { status: 404 }
      )
    }

    const valorAtual = toNumber(pagamentoAtual.valor)
    const valorNovo = parseFloat(valor)
    const diferencaValor = valorNovo - valorAtual

    // Atualizar pagamento
    await prisma.pagamentoFatura.update({
      where: { id: parseInt(pagamentoId) },
      data: {
        valor: valorNovo,
        valorOriginal: valorOriginal ? parseFloat(valorOriginal) : null,
        cambio: cambio ? parseFloat(cambio) : null,
        data: data ? new Date(data) : undefined,
        formaPagamento: formaPagamento || null,
        observacao: observacao || null
      }
    })

    // Atualizar destinatários se fornecidos
    if (destinatarioIds !== undefined) {
      // Remover destinatários antigos
      await prisma.pagamentoDestinatario.deleteMany({
        where: { pagamentoId: parseInt(pagamentoId) }
      })
      
      // Adicionar novos destinatários
      if (destinatarioIds && destinatarioIds.length > 0) {
        await prisma.pagamentoDestinatario.createMany({
          data: destinatarioIds.map((requerenteId: number) => ({
            pagamentoId: parseInt(pagamentoId),
            requerenteId
          }))
        })
      }
    }

    // Recalcular status da fatura se houve mudança de valor
    if (diferencaValor !== 0) {
      const fatura = await prisma.fatura.findUnique({
        where: { id: parseInt(faturaId) },
        include: { pagamentos: true }
      })

      if (fatura) {
        const totalPago = fatura.pagamentos.reduce(
          (sum, pag) => sum + toNumber(pag.valor), 0
        )
        const valorFatura = toNumber(fatura.valor)

        let novoStatus: 'PENDENTE' | 'PAGO' | 'PARCIAL' | 'VENCIDO' = 'PENDENTE'
        if (totalPago >= valorFatura) {
          novoStatus = 'PAGO'
        } else if (totalPago > 0) {
          novoStatus = 'PARCIAL'
        } else if (fatura.dataVencimento && new Date(fatura.dataVencimento) < new Date()) {
          novoStatus = 'VENCIDO'
        }

        await prisma.fatura.update({
          where: { id: parseInt(faturaId) },
          data: { status: novoStatus }
        })
      }
    }

    // Retornar pagamento atualizado com destinatários
    const pagamentoCompleto = await prisma.pagamentoFatura.findUnique({
      where: { id: parseInt(pagamentoId) },
      include: {
        destinatarios: {
          include: {
            requerente: { select: { id: true, nome: true } }
          }
        }
      }
    })

    return NextResponse.json(pagamentoCompleto)
  } catch (error) {
    console.error("Erro ao editar pagamento:", error)
    return NextResponse.json(
      { error: "Erro ao editar pagamento" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir pagamento
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; faturaId: string; pagamentoId: string }> }
) {
  try {
    const { processoId, faturaId, pagamentoId } = await params

    const pagamento = await prisma.pagamentoFatura.findUnique({
      where: { id: parseInt(pagamentoId) }
    })

    if (!pagamento) {
      return NextResponse.json(
        { error: "Pagamento não encontrado" },
        { status: 404 }
      )
    }

    // Excluir pagamento (destinatários são excluídos em cascata)
    await prisma.pagamentoFatura.delete({
      where: { id: parseInt(pagamentoId) }
    })

    // Recalcular status da fatura
    const fatura = await prisma.fatura.findUnique({
      where: { id: parseInt(faturaId) },
      include: { pagamentos: true }
    })

    if (fatura) {
      const totalPago = fatura.pagamentos.reduce(
        (sum, pag) => sum + toNumber(pag.valor), 0
      )
      const valorFatura = toNumber(fatura.valor)

      let novoStatus: 'PENDENTE' | 'PAGO' | 'PARCIAL' | 'VENCIDO' = 'PENDENTE'
      if (totalPago >= valorFatura) {
        novoStatus = 'PAGO'
      } else if (totalPago > 0) {
        novoStatus = 'PARCIAL'
      } else if (fatura.dataVencimento && new Date(fatura.dataVencimento) < new Date()) {
        novoStatus = 'VENCIDO'
      }

      await prisma.fatura.update({
        where: { id: parseInt(faturaId) },
        data: { status: novoStatus }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao excluir pagamento:", error)
    return NextResponse.json(
      { error: "Erro ao excluir pagamento" },
      { status: 500 }
    )
  }
}