import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
function toIntOrNull(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

// PUT - Atualizar forma de pagamento
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.formaPagamentoCadastro.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Forma de pagamento não encontrada' }, { status: 404 })

    const b = await request.json()
    const forma = await prisma.formaPagamentoCadastro.update({
      where: { id },
      data: {
        code: b.code !== undefined ? toStrOrNull(b.code) : atual.code,
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        type: b.type !== undefined ? toStrOrNull(b.type) : atual.type,
        moeda: b.moeda !== undefined ? toStrOrNull(b.moeda) : atual.moeda,
        permiteParcelas: b.permiteParcelas !== undefined ? !!b.permiteParcelas : atual.permiteParcelas,
        maxParcelas: b.maxParcelas !== undefined ? toIntOrNull(b.maxParcelas) : atual.maxParcelas,
      },
    })

    return NextResponse.json({ forma })
  } catch (error) {
    console.error('Erro ao atualizar forma de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir forma de pagamento
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    await prisma.formaPagamentoCadastro.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir forma de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}