// src/app/api/processos/[processoId]/faturas/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Listar faturas do processo
export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const faturas = await prisma.fatura.findMany({
      where: { processoId: id },
      orderBy: { createdAt: 'desc' }
    })

    // Calcular totais
    const totais = {
      total: faturas.reduce((acc, f) => acc + Number(f.valor), 0),
      pago: faturas
        .filter(f => f.status === 'PAGO')
        .reduce((acc, f) => acc + Number(f.valorPago || f.valor), 0),
      pendente: faturas
        .filter(f => f.status === 'PENDENTE' || f.status === 'VENCIDO')
        .reduce((acc, f) => acc + Number(f.valor), 0),
      vencido: faturas
        .filter(f => f.status === 'VENCIDO')
        .reduce((acc, f) => acc + Number(f.valor), 0),
    }

    return NextResponse.json({ faturas, totais })
  } catch (error) {
    console.error('Erro ao buscar faturas:', error)
    return NextResponse.json(
      { error: "Erro ao buscar faturas" },
      { status: 500 }
    )
  }
}

// POST - Criar nova fatura
export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json(
        { error: "ID inválido" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { 
      descricao, 
      valor, 
      dataVencimento,
      observacoes 
    } = body

    if (!descricao || !valor) {
      return NextResponse.json(
        { error: "Descrição e valor são obrigatórios" },
        { status: 400 }
      )
    }

    // Verificar se processo existe
    const processo = await prisma.processo.findUnique({
      where: { id }
    })

    if (!processo) {
      return NextResponse.json(
        { error: "Processo não encontrado" },
        { status: 404 }
      )
    }

    const fatura = await prisma.fatura.create({
      data: {
        processoId: id,
        descricao,
        valor: parseFloat(valor),
        dataVencimento: dataVencimento ? new Date(dataVencimento) : null,
        observacoes: observacoes || null,
        status: 'PENDENTE'
      }
    })

    return NextResponse.json({ fatura }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar fatura:', error)
    return NextResponse.json(
      { error: "Erro ao criar fatura" },
      { status: 500 }
    )
  }
}