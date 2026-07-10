// src/app/api/gerenciamento/catalogo-mestre/[id]/route.ts
// LOTE D — Catálogo Mestre: PUT (editar) e DELETE (só se não estiver em uso).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { NaturezaItem, UnidadeItem } from '@prisma/client'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim(); return s === '' ? null : s
}
const NATUREZAS = Object.values(NaturezaItem)
const UNIDADES = Object.values(UnidadeItem)

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params
    const b = await request.json()
    const data: any = {}
    if (b.code !== undefined) data.code = toStrOrNull(b.code)
    if (b.name !== undefined) data.name = toStrOrNull(b.name)
    if (b.descricao !== undefined) data.descricao = toStrOrNull(b.descricao)
    if (b.categoria !== undefined) data.categoria = toStrOrNull(b.categoria)
    if (b.natureza !== undefined && NATUREZAS.includes(b.natureza)) data.natureza = b.natureza
    if (b.unidade !== undefined && UNIDADES.includes(b.unidade)) data.unidade = b.unidade
    if (b.ativo !== undefined) data.ativo = !!b.ativo
    const item = await prisma.itemCatalogo.update({ where: { id: parseInt(id) }, data })
    return NextResponse.json(item)
  } catch (error) {
    console.error('Erro ao editar item do catálogo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params
    const itemId = parseInt(id)
    // não deixa apagar item EM USO (protege as ligações do Bloco 1)
    const usos = await prisma.itemCatalogo.findUnique({
      where: { id: itemId },
      include: { _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true } } },
    })
    if (!usos) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 })
    const total = usos._count.tiposDocumento + usos._count.produtos + usos._count.servicos + usos._count.precos
    if (total > 0) {
      return NextResponse.json({ error: `Item em uso (${total} vínculo(s)). Desative em vez de excluir.` }, { status: 400 })
    }
    await prisma.itemCatalogo.delete({ where: { id: itemId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir item do catálogo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}