// CRIAR EM: src/app/api/contas-bancarias/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Listar contas bancárias
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const ativo = searchParams.get("ativo")

    const where: any = {}
    
    if (ativo !== null) {
      where.ativo = ativo === "true"
    }

    const contas = await prisma.contaBancaria.findMany({
      where,
      orderBy: [
        { principal: "desc" },
        { nome: "asc" }
      ],
    })

    // Converter Decimal para number
    const contasFormatadas = contas.map(conta => ({
      ...conta,
      saldoInicial: conta.saldoInicial.toNumber(),
      saldoAtual: conta.saldoAtual.toNumber(),
    }))

    return NextResponse.json(contasFormatadas)
  } catch (error) {
    console.error("Erro ao listar contas bancárias:", error)
    return NextResponse.json(
      { error: "Erro ao listar contas bancárias" },
      { status: 500 }
    )
  }
}

// POST - Criar conta bancária
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.ver')
    if (erro) return erro
    
    const body = await request.json()

    // Se for principal, desmarcar outras
    if (body.principal) {
      await prisma.contaBancaria.updateMany({
        where: { principal: true },
        data: { principal: false }
      })
    }

    const saldoInicial = parseFloat(body.saldoInicial || "0")

    const conta = await prisma.contaBancaria.create({
      data: {
        nome: body.nome,
        banco: body.banco || null,
        agencia: body.agencia || null,
        conta: body.conta || null,
        tipoConta: body.tipoConta || null,
        chavePix: body.chavePix || null,
        tipoChavePix: body.tipoChavePix || null,
        saldoInicial,
        saldoAtual: saldoInicial,
        cor: body.cor || null,
        ativo: true,
        principal: body.principal || false,
      },
    })

    return NextResponse.json({
      ...conta,
      saldoInicial: conta.saldoInicial.toNumber(),
      saldoAtual: conta.saldoAtual.toNumber(),
    }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar conta bancária:", error)
    return NextResponse.json(
      { error: "Erro ao criar conta bancária" },
      { status: 500 }
    )
  }
}