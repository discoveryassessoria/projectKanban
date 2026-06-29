// src/app/api/gerenciamento/plano-contas/[id]/route.ts
// PUT    - Atualizar conta contábil
// DELETE - Excluir conta contábil
//
// ✅ Next 15: params é Promise → await params.
// PlanoConta é tabela isolada → delete livre.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

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

    const atual = await prisma.planoConta.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })
    }

    const b = await request.json()

    if (b.codigo !== undefined && !String(b.codigo).trim()) {
      return NextResponse.json({ error: 'Código não pode ficar vazio' }, { status: 400 })
    }
    if (b.nome !== undefined && !String(b.nome).trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }

    const conta = await prisma.planoConta.update({
      where: { id },
      data: {
        codigo: b.codigo !== undefined ? String(b.codigo).trim() : atual.codigo,
        nome: b.nome !== undefined ? String(b.nome).trim() : atual.nome,
        tipo: b.tipo !== undefined ? s(b.tipo) : atual.tipo,
        natureza: b.natureza !== undefined ? s(b.natureza) : atual.natureza,
        ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
      },
    })

    return NextResponse.json({ conta })
  } catch (error) {
    console.error('Erro ao atualizar conta contábil:', error)
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

    const atual = await prisma.planoConta.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })
    }

    await prisma.planoConta.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir conta contábil:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}