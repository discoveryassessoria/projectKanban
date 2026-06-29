// src/app/api/gerenciamento/bancos/[id]/route.ts
// PUT    - Atualizar banco
// DELETE - Excluir banco (bloqueia se houver contas usando)
//
// ✅ Next 15: params é Promise → await params.

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

    const atual = await prisma.banco.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Banco não encontrado' }, { status: 404 })
    }

    const body = await request.json()
    const { codigo, nome, sigla, pais, website, ativo } = body

    if (nome !== undefined && !nome.trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }

    const banco = await prisma.banco.update({
      where: { id },
      data: {
        codigo: codigo !== undefined ? (codigo?.trim() || null) : atual.codigo,
        nome: nome?.trim() ?? atual.nome,
        sigla: sigla !== undefined ? (sigla?.trim() || null) : atual.sigla,
        pais: pais !== undefined ? (pais?.trim() || null) : atual.pais,
        website: website !== undefined ? (website?.trim() || null) : atual.website,
        ativo: ativo !== undefined ? !!ativo : atual.ativo,
      },
    })

    return NextResponse.json({ banco })
  } catch (error) {
    console.error('Erro ao atualizar banco:', error)
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

    const atual = await prisma.banco.findUnique({
      where: { id },
      include: { _count: { select: { contas: true } } },
    })
    if (!atual) {
      return NextResponse.json({ error: 'Banco não encontrado' }, { status: 404 })
    }

    if (atual._count.contas > 0) {
      return NextResponse.json(
        { error: `Banco em uso por ${atual._count.contas} conta(s). Desvincule ou desative antes de excluir.` },
        { status: 409 }
      )
    }

    await prisma.banco.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir banco:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}