// CRIAR EM: src/app/api/financas/resumo/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.ver')
    if (erro) return erro

    const { searchParams } = new URL(request.url)
    const mes = searchParams.get("mes") // formato: "2026-01"
    
    const hoje = new Date()
    let inicioMes: Date
    let fimMes: Date

    if (mes) {
      const [ano, mesNum] = mes.split("-").map(Number)
      inicioMes = new Date(ano, mesNum - 1, 1)
      fimMes = new Date(ano, mesNum, 0, 23, 59, 59)
    } else {
      inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59)
    }

    // Total a receber (faturas pendentes)
    const totalReceber = await prisma.fatura.aggregate({
      where: {
        status: { in: ["PENDENTE", "PARCIAL"] }
      },
      _sum: { valor: true }
    })

    // Total a receber vencido
    const totalReceberVencido = await prisma.fatura.aggregate({
      where: {
        status: "VENCIDO"
      },
      _sum: { valor: true }
    })

    // Total a pagar
    const totalPagar = await prisma.contaPagar.aggregate({
      where: {
        status: { in: ["PENDENTE", "AGENDADO"] }
      },
      _sum: { valor: true }
    })

    // Total a pagar vencido
    const totalPagarVencido = await prisma.contaPagar.aggregate({
      where: {
        status: "VENCIDO"
      },
      _sum: { valor: true }
    })

    // Saldo em contas bancárias
    const saldoContas = await prisma.contaBancaria.aggregate({
      where: { ativo: true },
      _sum: { saldoAtual: true }
    })

    // Entradas do mês (transações)
    const entradasMes = await prisma.transacao.aggregate({
      where: {
        tipo: "ENTRADA",
        data: {
          gte: inicioMes,
          lte: fimMes
        }
      },
      _sum: { valor: true }
    })

    // Saídas do mês (transações)
    const saidasMes = await prisma.transacao.aggregate({
      where: {
        tipo: "SAIDA",
        data: {
          gte: inicioMes,
          lte: fimMes
        }
      },
      _sum: { valor: true }
    })

    // Contas vencendo nos próximos 7 dias
    const em7Dias = new Date()
    em7Dias.setDate(em7Dias.getDate() + 7)

    const contasVencendo = await prisma.contaPagar.findMany({
      where: {
        status: { in: ["PENDENTE", "AGENDADO"] },
        dataVencimento: {
          gte: hoje,
          lte: em7Dias
        }
      },
      orderBy: { dataVencimento: "asc" },
      take: 5,
      select: {
        id: true,
        descricao: true,
        valor: true,
        dataVencimento: true,
      }
    })

    const faturasVencendo = await prisma.fatura.findMany({
      where: {
        status: { in: ["PENDENTE"] },
        dataVencimento: {
          gte: hoje,
          lte: em7Dias
        }
      },
      orderBy: { dataVencimento: "asc" },
      take: 5,
      select: {
        id: true,
        descricao: true,
        valor: true,
        dataVencimento: true,
      }
    })

    const entradas = entradasMes._sum.valor?.toNumber() || 0
    const saidas = saidasMes._sum.valor?.toNumber() || 0

    return NextResponse.json({
      resumo: {
        totalReceber: totalReceber._sum.valor?.toNumber() || 0,
        totalReceberVencido: totalReceberVencido._sum.valor?.toNumber() || 0,
        totalPagar: totalPagar._sum.valor?.toNumber() || 0,
        totalPagarVencido: totalPagarVencido._sum.valor?.toNumber() || 0,
        saldoContas: saldoContas._sum.saldoAtual?.toNumber() || 0,
        entradasMes: entradas,
        saidasMes: saidas,
        saldoMes: entradas - saidas,
      },
      contasVencendo: [
        ...contasVencendo.map(c => ({
          id: c.id,
          descricao: c.descricao,
          valor: c.valor.toNumber(),
          dataVencimento: c.dataVencimento.toISOString(),
          tipo: 'pagar' as const
        })),
        ...faturasVencendo.map(f => ({
          id: f.id,
          descricao: f.descricao,
          valor: f.valor.toNumber(),
          dataVencimento: f.dataVencimento?.toISOString() || '',
          tipo: 'receber' as const
        }))
      ].sort((a, b) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime())
    })
  } catch (error) {
    console.error("Erro ao buscar resumo financeiro:", error)
    return NextResponse.json(
      { error: "Erro ao buscar resumo financeiro" },
      { status: 500 }
    )
  }
}