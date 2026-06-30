import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
function toIdArray(v: any): number[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => Number(x)).filter((n) => Number.isFinite(n))
}

// PUT - Atualizar serviço
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.servicoProduto.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Serviço não encontrado' }, { status: 404 })

    const b = await request.json()
    const data: any = {
      code: b.code !== undefined ? String(b.code).trim() : atual.code,
      name: b.name !== undefined ? String(b.name).trim() : atual.name,
      category: b.category !== undefined ? toStrOrNull(b.category) : atual.category,
      nationality: b.nationality !== undefined ? ((String(b.nationality).trim()) || 'all') : atual.nationality,
      ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
    }
    // só mexe nos vínculos se o cliente mandou a lista
    if (b.itensFinanceirosIds !== undefined) {
      data.itensFinanceiros = { set: toIdArray(b.itensFinanceirosIds).map((id) => ({ id })) }
    }

    const servico = await prisma.servicoProduto.update({
      where: { id },
      data,
      include: { itensFinanceiros: { select: { id: true, codigo: true, nome: true } } },
    })

    return NextResponse.json({ servico })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe um serviço com esse código.' }, { status: 409 })
    }
    console.error('Erro ao atualizar produto/serviço:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir serviço (os vínculos M2M somem junto)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    await prisma.servicoProduto.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir produto/serviço:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}