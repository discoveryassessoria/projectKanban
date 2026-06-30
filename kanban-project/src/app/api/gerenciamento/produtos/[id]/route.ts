// src/app/api/gerenciamento/produtos/[id]/route.ts
// PUT    - Atualizar produto financeiro
// DELETE - Excluir produto financeiro
//
// ✅ Next 15: params é Promise → await params.
// Nada referencia ProdutoFinanceiro → delete livre.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
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

    const atual = await prisma.produtoFinanceiro.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
    }

    const b = await request.json()

    if (b.codigo !== undefined && !String(b.codigo).trim()) {
      return NextResponse.json({ error: 'Código não pode ficar vazio' }, { status: 400 })
    }
    if (b.nome !== undefined && !String(b.nome).trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }
    if (b.moedaPadrao !== undefined && b.moedaPadrao && !MOEDAS.includes(b.moedaPadrao)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    const produto = await prisma.produtoFinanceiro.update({
      where: { id },
      data: {
        codigo: b.codigo !== undefined ? String(b.codigo).trim() : atual.codigo,
        nome: b.nome !== undefined ? String(b.nome).trim() : atual.nome,
        especie: b.especie !== undefined ? s(b.especie) : atual.especie,
        tipoFinanceiro: b.tipoFinanceiro !== undefined ? s(b.tipoFinanceiro) : atual.tipoFinanceiro,
        categoriaId: b.categoriaId !== undefined ? (b.categoriaId ? Number(b.categoriaId) : null) : atual.categoriaId,
        planoContaId: b.planoContaId !== undefined ? (b.planoContaId ? Number(b.planoContaId) : null) : atual.planoContaId,
        moedaPadrao: b.moedaPadrao !== undefined ? (b.moedaPadrao || 'BRL') : atual.moedaPadrao,
        valorPadrao: b.valorPadrao !== undefined ? parseDecimal(b.valorPadrao) : atual.valorPadrao,
        aplicaA: b.aplicaA !== undefined ? s(b.aplicaA) : atual.aplicaA,
        cobravelDoCliente: b.cobravelDoCliente !== undefined ? !!b.cobravelDoCliente : atual.cobravelDoCliente,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
        naturezaFinanceira: b.naturezaFinanceira !== undefined ? (b.naturezaFinanceira || 'revenue') : atual.naturezaFinanceira,
        custoInterno: b.custoInterno !== undefined ? !!b.custoInterno : atual.custoInterno,
        repasse: b.repasse !== undefined ? !!b.repasse : atual.repasse,
        reembolsavel: b.reembolsavel !== undefined ? !!b.reembolsavel : atual.reembolsavel,
      },
    })

    return NextResponse.json({ produto })
  } catch (error) {
    console.error('Erro ao atualizar produto:', error)
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

    const atual = await prisma.produtoFinanceiro.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
    }

    await prisma.produtoFinanceiro.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir produto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}