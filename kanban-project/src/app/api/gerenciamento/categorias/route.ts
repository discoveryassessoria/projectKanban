// src/app/api/gerenciamento/categorias/route.ts
// GET  - Listar categorias financeiras
// POST - Criar categoria financeira
//
// Mesmo padrão dos Centros de Custo.
// CategoriaFinanceira: nome, tipo (TipoTransacao ENTRADA/SAIDA), cor, icone,
//   descricao, categoriaPaiId (hierarquia), ativo.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const TIPOS = ['ENTRADA', 'SAIDA']

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const categorias = await prisma.categoriaFinanceira.findMany({
      orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
      include: {
        categoriaPai: { select: { id: true, nome: true } },
        _count: { select: { subcategorias: true, contasPagar: true, transacoes: true } },
      },
    })

    return NextResponse.json({ categorias })
  } catch (error) {
    console.error('Erro ao listar categorias:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const body = await request.json()
    const { nome, tipo, cor, icone, descricao, categoriaPaiId, ativo } = body

    if (!nome || !nome.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }
    if (!TIPOS.includes(tipo)) {
      return NextResponse.json({ error: 'Tipo deve ser ENTRADA ou SAIDA' }, { status: 400 })
    }

    const categoria = await prisma.categoriaFinanceira.create({
      data: {
        nome: nome.trim(),
        tipo,
        cor: cor || null,
        icone: icone || null,
        descricao: descricao?.trim() || null,
        categoriaPaiId: categoriaPaiId ? Number(categoriaPaiId) : null,
        ativo: ativo === undefined ? true : !!ativo,
      },
    })

    return NextResponse.json({ categoria }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar categoria:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}