// src/app/api/gerenciamento/regras-desconto/[id]/route.ts
// PUT    - Atualizar regra de desconto
// DELETE - Excluir regra de desconto
// Next 15: params e Promise -> await params. Delete livre (nada referencia).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
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

    const atual = await prisma.regraDesconto.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Regra não encontrada' }, { status: 404 })
    }

    const b = await request.json()

    if (b.name !== undefined && !String(b.name).trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }

    const regra = await prisma.regraDesconto.update({
      where: { id },
      data: {
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        maxPercentSemAprovacao: b.maxPercentSemAprovacao !== undefined ? parseNum(b.maxPercentSemAprovacao) : atual.maxPercentSemAprovacao,
        maxValorSemAprovacao: b.maxValorSemAprovacao !== undefined ? parseNum(b.maxValorSemAprovacao) : atual.maxValorSemAprovacao,
        exigeAprovacaoAcima: b.exigeAprovacaoAcima !== undefined ? !!b.exigeAprovacaoAcima : atual.exigeAprovacaoAcima,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })

    return NextResponse.json({ regra })
  } catch (error) {
    console.error('Erro ao atualizar regra de desconto:', error)
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

    const atual = await prisma.regraDesconto.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Regra não encontrada' }, { status: 404 })
    }

    await prisma.regraDesconto.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir regra de desconto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}