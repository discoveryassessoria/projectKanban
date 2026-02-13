// src/app/api/processos/[processoId]/faturas/[faturaId]/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

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
      },
      include: {
        pagamentos: {
          orderBy: { data: 'asc' }
        }
      }
    })

    if (!fatura) {
      return NextResponse.json(
        { error: "Fatura não encontrada" },
        { status: 404 }
      )
    }

    // Calcular valor pago
    const valorPago = fatura.pagamentos.reduce((acc, p) => acc + Number(p.valor), 0)

    return NextResponse.json({ 
      fatura: {
        ...fatura,
        valorPago,
        valorRestante: Number(fatura.valor) - valorPago
      }
    })
  } catch (error) {
    console.error('Erro ao buscar fatura:', error)
    return NextResponse.json(
      { error: "Erro ao buscar fatura" },
      { status: 500 }
    )
  }
}

// PUT - Atualizar fatura (apenas dados básicos, não pagamentos)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ processoId: string; faturaId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.pagamento_editar')
    if (erro) return erro

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
      dataVencimento,
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
    if (dataVencimento !== undefined) dataUpdate.dataVencimento = dataVencimento ? new Date(dataVencimento) : null
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

// DELETE - Excluir fatura (e todos os pagamentos vinculados - cascade)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ processoId: string; faturaId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.fatura_excluir')
    if (erro) return erro

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

    // Delete em cascade vai apagar os pagamentos também
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