// CRIAR EM: src/app/api/transacoes/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Listar transações
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.ver')
    if (erro) return erro
    
    const { searchParams } = new URL(request.url)
    const tipo = searchParams.get("tipo") // ENTRADA ou SAIDA
    const contaBancariaId = searchParams.get("contaBancariaId")
    const mes = searchParams.get("mes") // formato: "2026-01"

    const where: any = {}
    
    if (tipo && tipo !== "todos") {
      where.tipo = tipo
    }
    
    if (contaBancariaId) {
      where.contaBancariaId = parseInt(contaBancariaId)
    }

    if (mes) {
      const [ano, mesNum] = mes.split("-").map(Number)
      const inicioMes = new Date(ano, mesNum - 1, 1)
      const fimMes = new Date(ano, mesNum, 0, 23, 59, 59)
      where.data = {
        gte: inicioMes,
        lte: fimMes
      }
    }

    const transacoes = await prisma.transacao.findMany({
      where,
      orderBy: { data: "desc" },
      include: {
        categoria: {
          select: { id: true, nome: true }
        },
        contaBancaria: {
          select: { id: true, nome: true }
        }
      }
    })

    // Converter Decimal para number
    const transacoesFormatadas = transacoes.map(t => ({
      ...t,
      valor: t.valor.toNumber(),
    }))

    return NextResponse.json(transacoesFormatadas)
  } catch (error) {
    console.error("Erro ao listar transações:", error)
    return NextResponse.json(
      { error: "Erro ao listar transações" },
      { status: 500 }
    )
  }
}

// POST - Criar transação manual
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.pagamento_criar')
    if (erro) return erro
    
    const body = await request.json()

    const valor = parseFloat(body.valor)
    const contaBancariaId = parseInt(body.contaBancariaId)

    const transacao = await prisma.transacao.create({
      data: {
        tipo: body.tipo,
        descricao: body.descricao,
        observacoes: body.observacoes || null,
        valor,
        data: body.data ? new Date(body.data) : new Date(),
        dataCompetencia: body.dataCompetencia ? new Date(body.dataCompetencia) : null,
        contaBancariaId,
        categoriaId: body.categoriaId ? parseInt(body.categoriaId) : null,
        processoId: body.processoId ? parseInt(body.processoId) : null,
      },
      include: {
        categoria: {
          select: { id: true, nome: true }
        },
        contaBancaria: {
          select: { id: true, nome: true }
        }
      }
    })

    // Atualizar saldo da conta bancária
    await prisma.contaBancaria.update({
      where: { id: contaBancariaId },
      data: {
        saldoAtual: {
          [body.tipo === "ENTRADA" ? "increment" : "decrement"]: valor
        }
      }
    })

    return NextResponse.json({
      ...transacao,
      valor: transacao.valor.toNumber(),
    }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar transação:", error)
    return NextResponse.json(
      { error: "Erro ao criar transação" },
      { status: 500 }
    )
  }
}