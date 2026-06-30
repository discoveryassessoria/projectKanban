// src/app/api/gerenciamento/regras-comissao/[id]/route.ts
// PUT    - Atualizar regra de comissao
// DELETE - Excluir regra de comissao
// Next 15: params e Promise -> await params. Delete livre (nada referencia).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MODOS = ['percentage', 'fixed']
const MOMENTOS = ['first_payment_received', 'contract_signed', 'process_finalized']

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

    const atual = await prisma.regraComissao.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Regra não encontrada' }, { status: 404 })
    }

    const b = await request.json()

    if (b.name !== undefined && !String(b.name).trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }
    if (b.modoCalculo !== undefined && b.modoCalculo && !MODOS.includes(b.modoCalculo)) {
      return NextResponse.json({ error: 'Modo de cálculo inválido' }, { status: 400 })
    }
    if (b.momento !== undefined && b.momento && !MOMENTOS.includes(b.momento)) {
      return NextResponse.json({ error: 'Momento inválido' }, { status: 400 })
    }

    const regra = await prisma.regraComissao.update({
      where: { id },
      data: {
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        papel: b.papel !== undefined ? (b.papel?.trim() || null) : atual.papel,
        modoCalculo: b.modoCalculo !== undefined ? (b.modoCalculo || 'percentage') : atual.modoCalculo,
        percent: b.percent !== undefined ? parseNum(b.percent) : atual.percent,
        valorFixo: b.valorFixo !== undefined ? parseNum(b.valorFixo) : atual.valorFixo,
        momento: b.momento !== undefined ? (b.momento || 'first_payment_received') : atual.momento,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })

    return NextResponse.json({ regra })
  } catch (error) {
    console.error('Erro ao atualizar regra de comissão:', error)
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

    const atual = await prisma.regraComissao.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Regra não encontrada' }, { status: 404 })
    }

    await prisma.regraComissao.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir regra de comissão:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}