// src/app/api/processos/[processoId]/faturas/[faturaId]/pagar/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// POST - Registrar pagamento (cria um novo registro de pagamento)
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
      comprovanteNome,
      observacao
    } = body

    // Verificar se fatura existe
    const faturaExistente = await prisma.fatura.findFirst({
      where: { 
        id: fId,
        processoId: pId 
      },
      include: {
        pagamentos: true
      }
    })

    if (!faturaExistente) {
      return NextResponse.json(
        { error: "Fatura não encontrada" },
        { status: 404 }
      )
    }

    // Verificar se já foi paga totalmente
    if (faturaExistente.status === 'PAGO') {
      return NextResponse.json(
        { error: "Fatura já está totalmente paga" },
        { status: 400 }
      )
    }

    // Calcular valores
    const valorFatura = Number(faturaExistente.valor)
    const valorJaPago = faturaExistente.pagamentos.reduce((acc, p) => acc + Number(p.valor), 0)
    const valorRestante = valorFatura - valorJaPago
    
    // Valor do pagamento (se não informado, usa o restante)
    const valorPagamentoAtual = valorPago ? parseFloat(valorPago) : valorRestante
    
    // Validar que não está pagando mais do que deve
    if (valorPagamentoAtual > valorRestante + 0.01) {
      return NextResponse.json(
        { error: `Valor do pagamento (${valorPagamentoAtual}) excede o valor restante (${valorRestante})` },
        { status: 400 }
      )
    }

    // Criar o pagamento
    const pagamento = await prisma.pagamentoFatura.create({
      data: {
        faturaId: fId,
        valor: valorPagamentoAtual,
        data: dataPagamento ? new Date(dataPagamento) : new Date(),
        formaPagamento: formaPagamento || null,
        comprovanteUrl: comprovanteUrl || null,
        comprovanteNome: comprovanteNome || null,
        observacao: observacao || null
      }
    })

    // Calcular novo total pago
    const novoTotalPago = valorJaPago + valorPagamentoAtual
    const novoRestante = valorFatura - novoTotalPago

    // Determinar novo status
    let novoStatus: 'PAGO' | 'PARCIAL'
    if (novoTotalPago >= valorFatura - 0.01) {
      novoStatus = 'PAGO'
    } else {
      novoStatus = 'PARCIAL'
    }

    // Atualizar status da fatura
    await prisma.fatura.update({
      where: { id: fId },
      data: { status: novoStatus }
    })

    return NextResponse.json({ 
      pagamento,
      novoStatus,
      totalPago: novoTotalPago,
      valorRestante: novoRestante,
      message: novoStatus === 'PAGO' 
        ? 'Fatura paga totalmente' 
        : `Pagamento registrado. Restam ${novoRestante.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
    })
  } catch (error) {
    console.error('Erro ao registrar pagamento:', error)
    return NextResponse.json(
      { error: "Erro ao processar pagamento" },
      { status: 500 }
    )
  }
}