// src/app/api/gerenciamento/centros-custo/[id]/route.ts
// PUT    - Atualizar centro de custo
// DELETE - Excluir centro de custo
//
// ✅ Next 15: `params` é Promise → assinatura `Promise<{ id: string }>`
//    e `const { id } = await params`.
// CentroCusto é tabela isolada (nenhuma FK aponta pra ela) → excluir é seguro.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

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

    const atual = await prisma.centroCusto.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Centro de custo não encontrado' }, { status: 404 })
    }

    const body = await request.json()
    const { nome, descricao, cor, ativo } = body

    if (nome !== undefined && !nome.trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }

    const centro = await prisma.centroCusto.update({
      where: { id },
      data: {
        nome: nome?.trim() ?? atual.nome,
        descricao: descricao !== undefined ? (descricao?.trim() || null) : atual.descricao,
        cor: cor !== undefined ? (cor || null) : atual.cor,
        ativo: ativo !== undefined ? !!ativo : atual.ativo,
      },
    })

    return NextResponse.json({ centro })
  } catch (error) {
    console.error('Erro ao atualizar centro de custo:', error)
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

    const atual = await prisma.centroCusto.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Centro de custo não encontrado' }, { status: 404 })
    }

    await prisma.centroCusto.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir centro de custo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}