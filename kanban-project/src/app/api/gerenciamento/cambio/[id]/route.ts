// src/app/api/gerenciamento/cambio/[id]/route.ts
// PUT    - Atualizar cotação
// DELETE - Excluir cotação
//
// ✅ Next 15: params é Promise → await params.
// CotacaoCambio é tabela isolada → delete livre.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']

function parseDecimal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
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

    const atual = await prisma.cotacaoCambio.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Cotação não encontrada' }, { status: 404 })
    }

    const b = await request.json()

    if (b.moedaDe !== undefined && !MOEDAS.includes(b.moedaDe)) {
      return NextResponse.json({ error: 'Moeda (De) inválida' }, { status: 400 })
    }
    if (b.moedaPara !== undefined && !MOEDAS.includes(b.moedaPara)) {
      return NextResponse.json({ error: 'Moeda (Para) inválida' }, { status: 400 })
    }
    const taxa = b.taxa !== undefined ? parseDecimal(b.taxa) : undefined
    if (taxa !== undefined && (taxa === null || taxa <= 0)) {
      return NextResponse.json({ error: 'Taxa inválida' }, { status: 400 })
    }

    const cotacao = await prisma.cotacaoCambio.update({
      where: { id },
      data: {
        moedaDe: b.moedaDe ?? atual.moedaDe,
        moedaPara: b.moedaPara ?? atual.moedaPara,
        taxa: taxa ?? atual.taxa,
        data: b.data !== undefined ? (b.data ? new Date(b.data) : null) : atual.data,
        fonte: b.fonte !== undefined ? (b.fonte?.trim() || null) : atual.fonte,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })

    return NextResponse.json({ cotacao })
  } catch (error) {
    console.error('Erro ao atualizar câmbio:', error)
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

    const atual = await prisma.cotacaoCambio.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Cotação não encontrada' }, { status: 404 })
    }

    await prisma.cotacaoCambio.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir câmbio:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}