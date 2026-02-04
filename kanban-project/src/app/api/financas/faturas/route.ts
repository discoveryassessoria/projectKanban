// CRIAR EM: src/app/api/financas/faturas/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Decimal } from "@prisma/client/runtime/library"

function toNumber(value: Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'string') return parseFloat(value) || 0
  return parseFloat(value.toString()) || 0
}

function converterParaBRL(valor: number, moeda: string, cambio: number | null): number {
  if (moeda === 'BRL') return valor
  if (!cambio || cambio <= 0) return valor
  return valor * cambio
}

// GET - Listar TODAS as faturas de todos os processos
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const pais = searchParams.get("pais")
    const moeda = searchParams.get("moeda")
    const dataInicio = searchParams.get("dataInicio")
    const dataFim = searchParams.get("dataFim")

    const where: any = {}

    // Filtro por país do processo
    if (pais && pais !== "all") {
      where.processo = { pais }
    }

    // Filtro por moeda
    if (moeda && moeda !== "all") {
      where.moeda = moeda
    }

    // Filtro por data de vencimento
    if (dataInicio || dataFim) {
      where.dataVencimento = {}
      if (dataInicio) where.dataVencimento.gte = new Date(dataInicio)
      if (dataFim) where.dataVencimento.lte = new Date(dataFim)
    }

    const faturas = await prisma.fatura.findMany({
      where,
      include: {
        processo: {
          select: {
            id: true,
            nome: true,
            pais: true,
            status: { select: { nome: true } }
          }
        },
        pagamentos: {
          orderBy: { data: 'desc' },
          include: {
            destinatarios: {
              include: {
                requerente: { select: { id: true, nome: true } }
              }
            }
          }
        },
        destinatarios: {
          include: {
            requerente: { select: { id: true, nome: true } }
          }
        },
        parcelasBoleto: {
          orderBy: { numero: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    const hoje = new Date()
    hoje.setUTCHours(0, 0, 0, 0)

    const faturasComCalculos = faturas.map(fatura => {
      const valorTotal = toNumber(fatura.valor)
      const cambioFatura = toNumber(fatura.cambio)

      const valorPagoPagamentos = fatura.pagamentos.reduce(
        (sum: number, pag: any) => sum + toNumber(pag.valor), 0
      )
      const valorPagoParcelas = fatura.parcelasBoleto
        .filter(p => p.pago)
        .reduce((sum, p) => sum + toNumber(p.valor), 0)

      const valorPago = valorPagoPagamentos + valorPagoParcelas
      const valorRestante = Math.max(0, valorTotal - valorPago)

      const valorTotalBRL = converterParaBRL(valorTotal, fatura.moeda, cambioFatura)
      const valorPagoBRL = converterParaBRL(valorPago, fatura.moeda, cambioFatura)
      const valorRestanteBRL = converterParaBRL(valorRestante, fatura.moeda, cambioFatura)

      // Determinar status real
      let statusCalculado: string = fatura.status
      if (valorPago >= valorTotal) {
        statusCalculado = 'PAGO'
      } else if (valorPago > 0) {
        statusCalculado = 'PARCIAL'
      } else if (fatura.dataVencimento) {
        const vencimento = new Date(fatura.dataVencimento)
        vencimento.setUTCHours(0, 0, 0, 0)
        if (vencimento < hoje) statusCalculado = 'VENCIDO'
      }

      // Calcular vencido e pendente (considerando boletos)
      const isBoleto = fatura.metodoPagamento === 'BOLETO'
      const temParcelas = fatura.parcelasBoleto && fatura.parcelasBoleto.length > 0
      let vencidoFatura = 0
      let pendenteFatura = 0

      if (isBoleto && temParcelas) {
        fatura.parcelasBoleto.forEach(p => {
          if (p.pago) return
          const pVal = toNumber(p.valor)
          pendenteFatura += pVal
          const venc = new Date(p.dataVencimento)
          venc.setUTCHours(0, 0, 0, 0)
          if (venc < hoje) vencidoFatura += pVal
        })
      } else {
        pendenteFatura = valorRestante
        if (statusCalculado === 'VENCIDO') vencidoFatura = valorRestante
      }

      return {
        id: fatura.id,
        descricao: fatura.descricao,
        moeda: fatura.moeda,
        valor: valorTotal,
        valorPago,
        valorRestante,
        valorTotalBRL,
        valorPagoBRL,
        valorRestanteBRL,
        vencidoFatura,
        pendenteFatura,
        vencidoBRL: converterParaBRL(vencidoFatura, fatura.moeda, cambioFatura),
        pendenteBRL: converterParaBRL(pendenteFatura, fatura.moeda, cambioFatura),
        cambio: cambioFatura,
        status: statusCalculado,
        metodoPagamento: fatura.metodoPagamento,
        parcelas: fatura.parcelas,
        dataEmissao: fatura.dataEmissao,
        dataVencimento: fatura.dataVencimento,
        processo: fatura.processo ? {
          id: fatura.processo.id,
          nome: fatura.processo.nome,
          pais: fatura.processo.pais,
          statusNome: fatura.processo.status?.nome || '-'
        } : null,
        destinatarios: fatura.destinatarios.map(d => d.requerente),
        pagamentos: fatura.pagamentos.map(p => ({
          id: p.id,
          valor: toNumber(p.valor),
          data: p.data,
          formaPagamento: p.formaPagamento,
          destinatarios: (p as any).destinatarios?.map((d: any) => d.requerente) || []
        })),
        parcelasBoleto: fatura.parcelasBoleto.map(p => ({
          ...p,
          valor: toNumber(p.valor)
        })),
        createdAt: fatura.createdAt
      }
    })

    // Filtrar por status calculado (após cálculo)
    let faturasFinais = faturasComCalculos
    if (status && status !== "all") {
      faturasFinais = faturasComCalculos.filter(f => f.status === status)
    }

    // Totais por moeda
    const totaisPorMoeda: Record<string, { total: number; pago: number; pendente: number; vencido: number }> = {}
    faturasFinais.forEach(f => {
      if (!totaisPorMoeda[f.moeda]) {
        totaisPorMoeda[f.moeda] = { total: 0, pago: 0, pendente: 0, vencido: 0 }
      }
      totaisPorMoeda[f.moeda].total += f.valor
      totaisPorMoeda[f.moeda].pago += f.valorPago
      totaisPorMoeda[f.moeda].pendente += f.pendenteFatura
      totaisPorMoeda[f.moeda].vencido += f.vencidoFatura
    })

    // Totais gerais em BRL
    const totaisGeralBRL = faturasFinais.reduce((acc, f) => ({
      total: acc.total + f.valorTotalBRL,
      pago: acc.pago + f.valorPagoBRL,
      pendente: acc.pendente + f.pendenteBRL,
      vencido: acc.vencido + f.vencidoBRL
    }), { total: 0, pago: 0, pendente: 0, vencido: 0 })

    // Resumo por processo
    const porProcesso: Record<number, { nome: string; pais: string; totalBRL: number; pagoBRL: number; pendenteBRL: number; vencidoBRL: number; qtdFaturas: number }> = {}
    faturasFinais.forEach(f => {
      if (!f.processo) return
      const pid = f.processo.id
      if (!porProcesso[pid]) {
        porProcesso[pid] = { nome: f.processo.nome, pais: f.processo.pais, totalBRL: 0, pagoBRL: 0, pendenteBRL: 0, vencidoBRL: 0, qtdFaturas: 0 }
      }
      porProcesso[pid].totalBRL += f.valorTotalBRL
      porProcesso[pid].pagoBRL += f.valorPagoBRL
      porProcesso[pid].pendenteBRL += f.pendenteBRL
      porProcesso[pid].vencidoBRL += f.vencidoBRL
      porProcesso[pid].qtdFaturas++
    })

    return NextResponse.json({
      faturas: faturasFinais,
      totaisPorMoeda,
      totaisGeralBRL,
      porProcesso: Object.entries(porProcesso).map(([id, data]) => ({ id: parseInt(id), ...data })),
      totalFaturas: faturasFinais.length
    })

  } catch (error) {
    console.error("Erro ao buscar faturas gerais:", error)
    return NextResponse.json(
      { error: "Erro ao buscar faturas" },
      { status: 500 }
    )
  }
}