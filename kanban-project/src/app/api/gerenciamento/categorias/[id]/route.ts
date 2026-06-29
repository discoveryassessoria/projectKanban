// src/app/api/gerenciamento/categorias/[id]/route.ts
// PUT    - Atualizar categoria
// DELETE - Excluir categoria (bloqueia se estiver em uso)
//
// ✅ Next 15: params é Promise → await params.
// ⚠ CategoriaFinanceira TEM relações (subcategorias, contasPagar, transacoes),
//    então só excluímos se não estiver em uso (igual perfis com usuários).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const TIPOS = ['ENTRADA', 'SAIDA']

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

    const atual = await prisma.categoriaFinanceira.findUnique({ where: { id } })
    if (!atual) {
      return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })
    }

    const body = await request.json()
    const { nome, tipo, cor, icone, descricao, categoriaPaiId, ativo } = body

    if (nome !== undefined && !nome.trim()) {
      return NextResponse.json({ error: 'Nome não pode ficar vazio' }, { status: 400 })
    }
    if (tipo !== undefined && !TIPOS.includes(tipo)) {
      return NextResponse.json({ error: 'Tipo deve ser ENTRADA ou SAIDA' }, { status: 400 })
    }
    // não deixar a categoria ser pai de si mesma
    const novoPaiId = categoriaPaiId ? Number(categoriaPaiId) : null
    if (novoPaiId === id) {
      return NextResponse.json({ error: 'Uma categoria não pode ser pai de si mesma' }, { status: 400 })
    }

    const categoria = await prisma.categoriaFinanceira.update({
      where: { id },
      data: {
        nome: nome?.trim() ?? atual.nome,
        tipo: tipo ?? atual.tipo,
        cor: cor !== undefined ? (cor || null) : atual.cor,
        icone: icone !== undefined ? (icone || null) : atual.icone,
        descricao: descricao !== undefined ? (descricao?.trim() || null) : atual.descricao,
        categoriaPaiId: categoriaPaiId !== undefined ? novoPaiId : atual.categoriaPaiId,
        ativo: ativo !== undefined ? !!ativo : atual.ativo,
      },
    })

    return NextResponse.json({ categoria })
  } catch (error) {
    console.error('Erro ao atualizar categoria:', error)
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

    const atual = await prisma.categoriaFinanceira.findUnique({
      where: { id },
      include: { _count: { select: { subcategorias: true, contasPagar: true, transacoes: true } } },
    })
    if (!atual) {
      return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 })
    }

    const { subcategorias, contasPagar, transacoes } = atual._count
    if (subcategorias > 0 || contasPagar > 0 || transacoes > 0) {
      const partes: string[] = []
      if (subcategorias > 0) partes.push(`${subcategorias} subcategoria(s)`)
      if (contasPagar > 0) partes.push(`${contasPagar} conta(s) a pagar`)
      if (transacoes > 0) partes.push(`${transacoes} transação(ões)`)
      return NextResponse.json(
        { error: `Categoria em uso (${partes.join(', ')}). Remova ou reatribua antes de excluir.` },
        { status: 409 }
      )
    }

    await prisma.categoriaFinanceira.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir categoria:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}