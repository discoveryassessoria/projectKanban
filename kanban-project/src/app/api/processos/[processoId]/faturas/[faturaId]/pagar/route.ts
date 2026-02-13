// src/app/api/processos/[processoId]/faturas/[faturaId]/pagar/route.ts
// ✅ CORRIGIDO - Pagamento sempre na moeda da fatura

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string; faturaId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.pagamento_criar')
    if (erro) return erro

    const { processoId, faturaId } = await params
    const pId = parseInt(processoId)
    const fId = parseInt(faturaId)

    if (isNaN(pId) || isNaN(fId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()
    const { 
      formaPagamento, 
      valorPago,        // ✅ Valor NA MOEDA DA FATURA (ex: €1.000)
      valorEmReais,     // ✅ NOVO: Valor em BRL (ex: R$5.000) - apenas informativo
      cambio,           // ✅ Taxa de câmbio usada
      dataPagamento,
      comprovanteUrl,
      comprovanteNome,
      observacao,
      destinatarioIds
    } = body

    // Verificar se fatura existe
    const faturaExistente = await prisma.fatura.findFirst({
      where: { id: fId, processoId: pId },
      include: { pagamentos: true }
    })

    if (!faturaExistente) {
      return NextResponse.json({ error: "Fatura não encontrada" }, { status: 404 })
    }

    if (faturaExistente.status === 'PAGO') {
      return NextResponse.json({ error: "Fatura já está totalmente paga" }, { status: 400 })
    }

    // Calcular valores - TUDO NA MOEDA DA FATURA
    const valorFatura = Number(faturaExistente.valor)
    const valorJaPago = faturaExistente.pagamentos.reduce((acc, p) => acc + Number(p.valor), 0)
    const valorRestante = valorFatura - valorJaPago
    
    // ✅ valorPago já vem na moeda da fatura
    const valorPagamentoAtual = valorPago ? parseFloat(valorPago) : valorRestante

    if (valorPagamentoAtual > valorRestante + 0.01) {
      return NextResponse.json(
        { error: `Valor do pagamento (${valorPagamentoAtual}) excede o valor restante (${valorRestante})` },
        { status: 400 }
      )
    }

    // Criar o pagamento
    // ✅ valor = moeda da fatura
    // ✅ valorOriginal = valor em BRL (se moeda estrangeira)
    const pagamento = await prisma.pagamentoFatura.create({
      data: {
        faturaId: fId,
        valor: valorPagamentoAtual,  // ✅ Na moeda da fatura (€1.000)
        valorOriginal: valorEmReais ? parseFloat(valorEmReais) : null,  // ✅ Em BRL (R$5.000)
        cambio: cambio ? parseFloat(cambio) : null,
        data: dataPagamento ? new Date(dataPagamento) : new Date(),
        formaPagamento: formaPagamento || null,
        comprovanteUrl: comprovanteUrl || null,
        comprovanteNome: comprovanteNome || null,
        observacao: observacao || null
      }
    })

    // Criar destinatários se fornecidos
    if (destinatarioIds && destinatarioIds.length > 0) {
      await prisma.pagamentoDestinatario.createMany({
        data: destinatarioIds.map((requerenteId: number) => ({
          pagamentoId: pagamento.id,
          requerenteId
        }))
      })
    }

    // Calcular novo status
    const novoTotalPago = valorJaPago + valorPagamentoAtual
    const novoRestante = valorFatura - novoTotalPago
    const novoStatus = novoTotalPago >= valorFatura - 0.01 ? 'PAGO' : 'PARCIAL'

    await prisma.fatura.update({
      where: { id: fId },
      data: { status: novoStatus }
    })

    return NextResponse.json({ 
      pagamento,
      novoStatus,
      totalPago: novoTotalPago,
      valorRestante: novoRestante
    })

  } catch (error) {
    console.error('Erro ao registrar pagamento:', error)
    return NextResponse.json({ error: "Erro ao processar pagamento" }, { status: 500 })
  }
}