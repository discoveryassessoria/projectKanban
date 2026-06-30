import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// PUT - Atualizar moeda
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.moedaCadastro.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Moeda não encontrada' }, { status: 404 })

    const b = await request.json()
    const moeda = await prisma.moedaCadastro.update({
      where: { id },
      data: {
        code: b.code !== undefined ? String(b.code).trim().toUpperCase() : atual.code,
        name: b.name !== undefined ? toStrOrNull(b.name) : atual.name,
        symbol: b.symbol !== undefined ? toStrOrNull(b.symbol) : atual.symbol,
      },
    })

    return NextResponse.json({ moeda })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe uma moeda com esse código.' }, { status: 409 })
    }
    console.error('Erro ao atualizar moeda:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir moeda
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    await prisma.moedaCadastro.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir moeda:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}