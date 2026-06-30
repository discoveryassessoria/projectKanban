// src/app/api/gerenciamento/condicoes-pagamento/[id]/route.ts
// PUT    - Atualizar condicao de pagamento
// DELETE - Excluir condicao de pagamento
// Next 15: params e Promise -> await params. Delete livre (nada referencia).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']
const FORMAS = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'CHEQUE', 'OUTRO']

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function parseIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const atual = await prisma.condicaoPagamento.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Condição não encontrada' }, { status: 404 })
    }

    const b = await request.json()

    if (b.name !== undefined && !String(b.name).trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }
    if (b.moeda !== undefined && b.moeda && !MOEDAS.includes(b.moeda)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }
    if (b.formaPagamento !== undefined && b.formaPagamento && !FORMAS.includes(b.formaPagamento)) {
      return NextResponse.json({ error: 'Forma de pagamento inválida' }, { status: 400 })
    }

    let parcelas = atual.parcelas
    if (b.parcelas !== undefined) {
      const p = parseIntOrNull(b.parcelas)
      parcelas = p && p > 0 ? p : 1
    }

    const condicao = await prisma.condicaoPagamento.update({
      where: { id },
      data: {
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        moeda: b.moeda !== undefined ? (b.moeda || 'BRL') : atual.moeda,
        formaPagamento: b.formaPagamento !== undefined ? (b.formaPagamento || null) : atual.formaPagamento,
        carteiraId: b.carteiraId !== undefined ? (b.carteiraId ? Number(b.carteiraId) : null) : atual.carteiraId,
        temEntrada: b.temEntrada !== undefined ? !!b.temEntrada : atual.temEntrada,
        percentEntrada: b.percentEntrada !== undefined ? parseNum(b.percentEntrada) : atual.percentEntrada,
        parcelas,
        diaVencimento: b.diaVencimento !== undefined ? parseIntOrNull(b.diaVencimento) : atual.diaVencimento,
        aplicarTaxas: b.aplicarTaxas !== undefined ? !!b.aplicarTaxas : atual.aplicarTaxas,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })

    return NextResponse.json({ condicao })
  } catch (error) {
    console.error('Erro ao atualizar condição de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const atual = await prisma.condicaoPagamento.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Condição não encontrada' }, { status: 404 })
    }

    await prisma.condicaoPagamento.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir condição de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}