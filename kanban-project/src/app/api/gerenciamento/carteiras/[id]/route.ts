// src/app/api/gerenciamento/carteiras/[id]/route.ts
// PUT    - Atualizar carteira
// DELETE - Excluir carteira
//
// ✅ Next 15: params é Promise → await params.
// Nada referencia CarteiraRecebimento → delete livre.
// Só UMA carteira pode ser padrão (via transação).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']

function parseInt0(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

// PUT - Atualizar
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

    const atual = await prisma.carteiraRecebimento.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Carteira não encontrada' }, { status: 404 })
    }

    const b = await request.json()

    if (b.nome !== undefined && !String(b.nome).trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }
    if (b.moeda !== undefined && b.moeda && !MOEDAS.includes(b.moeda)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    const ehDefault = b.isDefault !== undefined ? !!b.isDefault : atual.isDefault

    const carteira = await prisma.$transaction(async (tx) => {
      if (ehDefault) {
        await tx.carteiraRecebimento.updateMany({ where: { id: { not: id } }, data: { isDefault: false } })
      }
      return tx.carteiraRecebimento.update({
        where: { id },
        data: {
          nome: b.nome !== undefined ? String(b.nome).trim() : atual.nome,
          tipo: b.tipo !== undefined ? (b.tipo?.trim() || null) : atual.tipo,
          contaBancariaId: b.contaBancariaId !== undefined ? (b.contaBancariaId ? Number(b.contaBancariaId) : null) : atual.contaBancariaId,
          moeda: b.moeda !== undefined ? (b.moeda || 'BRL') : atual.moeda,
          diasLiquidacao: b.diasLiquidacao !== undefined ? parseInt0(b.diasLiquidacao) : atual.diasLiquidacao,
          isDefault: ehDefault,
          ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
        },
      })
    })

    return NextResponse.json({ carteira })
  } catch (error) {
    console.error('Erro ao atualizar carteira:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir
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

    const atual = await prisma.carteiraRecebimento.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Carteira não encontrada' }, { status: 404 })
    }

    await prisma.carteiraRecebimento.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir carteira:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}