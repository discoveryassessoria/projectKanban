// src/app/api/processos/[processoId]/faturas/[faturaId]/parcelas/[parcelaId]/pagar/route.ts

import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; faturaId: string; parcelaId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.pagamento_criar')
    if (erro) return erro

    const { processoId, faturaId, parcelaId } = await params
    const parcelaIdNum = parseInt(parcelaId)
    const faturaIdNum = parseInt(faturaId)

    // Verificar se a parcela existe e pertence à fatura
    const parcela = await prisma.parcela.findFirst({
      where: {
        id: parcelaIdNum,
        faturaId: faturaIdNum
      }
    })

    if (!parcela) {
      return NextResponse.json(
        { error: 'Parcela não encontrada' },
        { status: 404 }
      )
    }

    // Marcar como paga
    const parcelaAtualizada = await prisma.parcela.update({
      where: { id: parcelaIdNum },
      data: {
        pago: true,
        dataPagamento: new Date()
      }
    })

    // Verificar se todas as parcelas foram pagas para atualizar status da fatura
    const todasParcelas = await prisma.parcela.findMany({
      where: { faturaId: faturaIdNum }
    })

    const todasPagas = todasParcelas.every(p => p.pago)
    const algumaPaga = todasParcelas.some(p => p.pago)

    // Atualizar status da fatura
    if (todasPagas) {
      await prisma.fatura.update({
        where: { id: faturaIdNum },
        data: { status: 'PAGO' }
      })
    } else if (algumaPaga) {
      await prisma.fatura.update({
        where: { id: faturaIdNum },
        data: { status: 'PARCIAL' }
      })
    }

    return NextResponse.json(parcelaAtualizada)

  } catch (error) {
    console.error('Erro ao marcar parcela como paga:', error)
    return NextResponse.json(
      { error: 'Erro ao marcar parcela como paga' },
      { status: 500 }
    )
  }
}

// ✅ NOVO: Desmarcar parcela (caso tenha marcado errado)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; faturaId: string; parcelaId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.pagamento_criar')
    if (erro) return erro

    const { processoId, faturaId, parcelaId } = await params
    const parcelaIdNum = parseInt(parcelaId)
    const faturaIdNum = parseInt(faturaId)

    // Verificar se a parcela existe
    const parcela = await prisma.parcela.findFirst({
      where: {
        id: parcelaIdNum,
        faturaId: faturaIdNum
      }
    })

    if (!parcela) {
      return NextResponse.json(
        { error: 'Parcela não encontrada' },
        { status: 404 }
      )
    }

    // Desmarcar pagamento
    const parcelaAtualizada = await prisma.parcela.update({
      where: { id: parcelaIdNum },
      data: {
        pago: false,
        dataPagamento: null
      }
    })

    // Atualizar status da fatura
    const todasParcelas = await prisma.parcela.findMany({
      where: { faturaId: faturaIdNum }
    })

    const algumaPaga = todasParcelas.some(p => p.id !== parcelaIdNum && p.pago)

    await prisma.fatura.update({
      where: { id: faturaIdNum },
      data: { status: algumaPaga ? 'PARCIAL' : 'PENDENTE' }
    })

    return NextResponse.json(parcelaAtualizada)

  } catch (error) {
    console.error('Erro ao desmarcar parcela:', error)
    return NextResponse.json(
      { error: 'Erro ao desmarcar parcela' },
      { status: 500 }
    )
  }
}