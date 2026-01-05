// CRIAR EM: src/app/api/contas-pagar/[id]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Buscar conta por ID
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

    const conta = await prisma.contaPagar.findUnique({
      where: { id },
      include: {
        fornecedor: true,
        categoria: true,
        contaBancaria: true,
        transacoes: true
      }
    })

    if (!conta) {
      return NextResponse.json(
        { error: "Conta não encontrada" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      ...conta,
      valor: conta.valor.toNumber(),
      valorPago: conta.valorPago?.toNumber() || null,
    })
  } catch (error) {
    console.error("Erro ao buscar conta:", error)
    return NextResponse.json(
      { error: "Erro ao buscar conta" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar conta
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    const body = await request.json()

    const conta = await prisma.contaPagar.update({
      where: { id },
      data: {
        descricao: body.descricao,
        observacoes: body.observacoes,
        fornecedorId: body.fornecedorId ? parseInt(body.fornecedorId) : null,
        categoriaId: body.categoriaId ? parseInt(body.categoriaId) : null,
        valor: body.valor ? parseFloat(body.valor) : undefined,
        dataVencimento: body.dataVencimento ? new Date(body.dataVencimento) : undefined,
        dataCompetencia: body.dataCompetencia ? new Date(body.dataCompetencia) : undefined,
        status: body.status,
        numeroDocumento: body.numeroDocumento,
        tipoDocumento: body.tipoDocumento,
      },
    })

    return NextResponse.json({
      ...conta,
      valor: conta.valor.toNumber(),
    })
  } catch (error) {
    console.error("Erro ao atualizar conta:", error)
    return NextResponse.json(
      { error: "Erro ao atualizar conta" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir conta
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

    await prisma.contaPagar.delete({
      where: { id },
    })

    return NextResponse.json({ message: "Conta excluída com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir conta:", error)
    return NextResponse.json(
      { error: "Erro ao excluir conta" },
      { status: 500 }
    )
  }
}