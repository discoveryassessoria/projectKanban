// src/app/api/processos/[processoId]/faturas/[faturaId]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET - Buscar fatura específica
export async function GET(
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

    const fatura = await prisma.fatura.findFirst({
      where: { 
        id: fId,
        processoId: pId 
      }
    })

    if (!fatura) {
      return NextResponse.json(
        { error: "Fatura não encontrada" },
        { status: 404 }
      )
    }

    return NextResponse.json({ fatura })
  } catch (error) {
    console.error('Erro ao buscar fatura:', error)
    return NextResponse.json(
      { error: "Erro ao buscar fatura" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar fatura
export async function PUT(
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
      descricao, 
      valor, 
      status,
      dataVencimento,
      dataPagamento,
      formaPagamento,
      valorPago,
      comprovanteUrl,
      comprovanteNome,
      observacoes 
    } = body

    // Verificar se fatura existe
    const faturaExistente = await prisma.fatura.findFirst({
      where: { 
        id: fId,
        processoId: pId 
      }
    })

    if (!faturaExistente) {
      return NextResponse.json(
        { error: "Fatura não encontrada" },
        { status: 404 }
      )
    }

    // Preparar dados para atualização
    const dataUpdate: any = {}
    
    if (descricao !== undefined) dataUpdate.descricao = descricao
    if (valor !== undefined) dataUpdate.valor = parseFloat(valor)
    if (status !== undefined) dataUpdate.status = status
    if (dataVencimento !== undefined) dataUpdate.dataVencimento = dataVencimento ? new Date(dataVencimento) : null
    if (dataPagamento !== undefined) dataUpdate.dataPagamento = dataPagamento ? new Date(dataPagamento) : null
    if (formaPagamento !== undefined) dataUpdate.formaPagamento = formaPagamento
    if (valorPago !== undefined) dataUpdate.valorPago = valorPago ? parseFloat(valorPago) : null
    if (comprovanteUrl !== undefined) dataUpdate.comprovanteUrl = comprovanteUrl
    if (comprovanteNome !== undefined) dataUpdate.comprovanteNome = comprovanteNome
    if (observacoes !== undefined) dataUpdate.observacoes = observacoes

    const fatura = await prisma.fatura.update({
      where: { id: fId },
      data: dataUpdate
    })

    return NextResponse.json({ fatura })
  } catch (error) {
    console.error('Erro ao atualizar fatura:', error)
    return NextResponse.json(
      { error: "Erro ao atualizar fatura" },
      { status: 500 }
    )
  }
}

// DELETE - Excluir fatura
export async function DELETE(
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

    // Verificar se fatura existe
    const faturaExistente = await prisma.fatura.findFirst({
      where: { 
        id: fId,
        processoId: pId 
      }
    })

    if (!faturaExistente) {
      return NextResponse.json(
        { error: "Fatura não encontrada" },
        { status: 404 }
      )
    }

    await prisma.fatura.delete({
      where: { id: fId }
    })

    return NextResponse.json({ message: "Fatura excluída com sucesso" })
  } catch (error) {
    console.error('Erro ao excluir fatura:', error)
    return NextResponse.json(
      { error: "Erro ao excluir fatura" },
      { status: 500 }
    )
  }
}