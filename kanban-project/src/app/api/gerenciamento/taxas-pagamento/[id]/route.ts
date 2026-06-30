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
function toNumOrNull(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// PUT - Atualizar taxa
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.taxaPagamento.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Taxa não encontrada' }, { status: 404 })

    const b = await request.json()
    const taxa = await prisma.taxaPagamento.update({
      where: { id },
      data: {
        code: b.code !== undefined ? toStrOrNull(b.code) : atual.code,
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        formaPagamentoId: b.formaPagamentoId !== undefined ? toIntOrNull(b.formaPagamentoId) : atual.formaPagamentoId,
        moeda: b.moeda !== undefined ? toStrOrNull(b.moeda) : atual.moeda,
        feeType: b.feeType !== undefined ? toStrOrNull(b.feeType) : atual.feeType,
        feePercent: b.feePercent !== undefined ? toNumOrNull(b.feePercent) : atual.feePercent,
        fixedFee: b.fixedFee !== undefined ? toNumOrNull(b.fixedFee) : atual.fixedFee,
        anticipationEnabled: b.anticipationEnabled !== undefined ? !!b.anticipationEnabled : atual.anticipationEnabled,
        anticipationPercent: b.anticipationPercent !== undefined ? toNumOrNull(b.anticipationPercent) : atual.anticipationPercent,
        installmentsFrom: b.installmentsFrom !== undefined ? toIntOrNull(b.installmentsFrom) : atual.installmentsFrom,
        installmentsTo: b.installmentsTo !== undefined ? toIntOrNull(b.installmentsTo) : atual.installmentsTo,
      },
    })

    return NextResponse.json({ taxa })
  } catch (error) {
    console.error('Erro ao atualizar taxa de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - Excluir taxa
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    await prisma.taxaPagamento.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir taxa de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}