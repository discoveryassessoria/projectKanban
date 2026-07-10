// src/app/api/gerenciamento/catalogo-mestre/route.ts
// LOTE D — Catálogo Mestre (ItemCatalogo): a FONTE ÚNICA de itens.
// GET lista; POST cria. Espelha o padrão de tabela-valores (verificarPermissao).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { NaturezaItem, UnidadeItem } from '@prisma/client'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
const NATUREZAS = Object.values(NaturezaItem)
const UNIDADES = Object.values(UnidadeItem)

// GET - lista itens do catálogo (+ contadores de uso, p/ mostrar ligações)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const itens = await prisma.itemCatalogo.findMany({
      orderBy: [{ natureza: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true } },
      },
    })
    return NextResponse.json({ itens, naturezas: NATUREZAS, unidades: UNIDADES })
  } catch (error) {
    console.error('Erro ao listar catálogo mestre:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - cria item
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const b = await request.json()
    const code = toStrOrNull(b.code)
    const name = toStrOrNull(b.name)
    if (!code) return NextResponse.json({ error: 'Informe o código do item.' }, { status: 400 })
    if (!name) return NextResponse.json({ error: 'Informe o nome do item.' }, { status: 400 })

    const natureza = NATUREZAS.includes(b.natureza) ? b.natureza : NaturezaItem.OUTRO
    const unidade = UNIDADES.includes(b.unidade) ? b.unidade : UnidadeItem.UNIDADE

    const jaExiste = await prisma.itemCatalogo.findUnique({ where: { code } })
    if (jaExiste) return NextResponse.json({ error: `Já existe item com o código "${code}".` }, { status: 400 })

    const item = await prisma.itemCatalogo.create({
      data: { code, name, descricao: toStrOrNull(b.descricao), natureza, categoria: toStrOrNull(b.categoria), unidade, ativo: b.ativo !== false },
    })
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar item do catálogo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}