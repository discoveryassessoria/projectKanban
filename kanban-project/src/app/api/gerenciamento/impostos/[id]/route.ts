// src/app/api/gerenciamento/impostos/[id]/route.ts
// PUT    - Atualizar imposto
// DELETE - Excluir imposto
//
// ✅ Next 15: params é Promise → await params.
// Imposto é tabela isolada → delete livre.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function parseDecimal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

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

    const atual = await prisma.imposto.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Imposto não encontrado' }, { status: 404 })
    }

    const b = await request.json()

    if (b.nome !== undefined && !String(b.nome).trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }

    const imposto = await prisma.imposto.update({
      where: { id },
      data: {
        codigo: b.codigo !== undefined ? s(b.codigo) : atual.codigo,
        nome: b.nome !== undefined ? String(b.nome).trim() : atual.nome,
        tipo: b.tipo !== undefined ? s(b.tipo) : atual.tipo,
        modoCalculo: b.modoCalculo !== undefined ? s(b.modoCalculo) : atual.modoCalculo,
        percentual: b.percentual !== undefined ? parseDecimal(b.percentual) : atual.percentual,
        valorFixo: b.valorFixo !== undefined ? parseDecimal(b.valorFixo) : atual.valorFixo,
        aplicaA: b.aplicaA !== undefined ? s(b.aplicaA) : atual.aplicaA,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })

    return NextResponse.json({ imposto })
  } catch (error) {
    console.error('Erro ao atualizar imposto:', error)
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

    const atual = await prisma.imposto.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Imposto não encontrado' }, { status: 404 })
    }

    await prisma.imposto.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir imposto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}