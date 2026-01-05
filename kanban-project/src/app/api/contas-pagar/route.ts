// CRIAR EM: src/app/api/contas-pagar/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Listar contas a pagar
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const fornecedorId = searchParams.get("fornecedorId")
    const dataInicio = searchParams.get("dataInicio")
    const dataFim = searchParams.get("dataFim")

    const where: any = {}
    
    if (status && status !== "todos") {
      where.status = status
    }
    
    if (fornecedorId) {
      where.fornecedorId = parseInt(fornecedorId)
    }

    if (dataInicio || dataFim) {
      where.dataVencimento = {}
      if (dataInicio) {
        where.dataVencimento.gte = new Date(dataInicio)
      }
      if (dataFim) {
        where.dataVencimento.lte = new Date(dataFim)
      }
    }

    const contas = await prisma.contaPagar.findMany({
      where,
      orderBy: { dataVencimento: "asc" },
      include: {
        fornecedor: {
          select: { id: true, nome: true, nomeFantasia: true }
        },
        categoria: {
          select: { id: true, nome: true }
        },
        contaBancaria: {
          select: { id: true, nome: true }
        }
      }
    })

    // Converter Decimal para number
    const contasFormatadas = contas.map(conta => ({
      ...conta,
      valor: conta.valor.toNumber(),
      valorPago: conta.valorPago?.toNumber() || null,
      desconto: conta.desconto?.toNumber() || 0,
      juros: conta.juros?.toNumber() || 0,
      multa: conta.multa?.toNumber() || 0,
    }))

    return NextResponse.json(contasFormatadas)
  } catch (error) {
    console.error("Erro ao listar contas a pagar:", error)
    return NextResponse.json(
      { error: "Erro ao listar contas a pagar" },
      { status: 500 }
    )
  }
}

// POST - Criar conta a pagar
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const conta = await prisma.contaPagar.create({
      data: {
        descricao: body.descricao,
        observacoes: body.observacoes || null,
        fornecedorId: body.fornecedorId ? parseInt(body.fornecedorId) : null,
        categoriaId: body.categoriaId ? parseInt(body.categoriaId) : null,
        valor: parseFloat(body.valor),
        dataEmissao: body.dataEmissao ? new Date(body.dataEmissao) : new Date(),
        dataVencimento: new Date(body.dataVencimento),
        dataCompetencia: body.dataCompetencia ? new Date(body.dataCompetencia) : null,
        status: "PENDENTE",
        numeroDocumento: body.numeroDocumento || null,
        tipoDocumento: body.tipoDocumento || null,
        recorrencia: body.recorrencia || "UNICA",
        processoId: body.processoId ? parseInt(body.processoId) : null,
      },
      include: {
        fornecedor: {
          select: { id: true, nome: true }
        },
        categoria: {
          select: { id: true, nome: true }
        }
      }
    })

    return NextResponse.json({
      ...conta,
      valor: conta.valor.toNumber(),
    }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar conta a pagar:", error)
    return NextResponse.json(
      { error: "Erro ao criar conta a pagar" },
      { status: 500 }
    )
  }
}