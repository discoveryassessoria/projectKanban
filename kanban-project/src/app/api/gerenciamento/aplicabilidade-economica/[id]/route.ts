// src/app/api/gerenciamento/aplicabilidade-economica/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function toStrOrNull(v: any): string | null { if (v === undefined || v === null) return null; const s = String(v).trim(); return s === '' ? null : s }
function toIntOrNull(v: any): number | null { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null }

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params
    const b = await request.json()
    const data: any = {}
    if (b.tipoProcessoId !== undefined) data.tipoProcessoId = toIntOrNull(b.tipoProcessoId)
    if (b.phaseKey !== undefined) data.phaseKey = String(b.phaseKey).trim()
    if (b.documentTypeCode !== undefined) data.documentTypeCode = toStrOrNull(b.documentTypeCode)
    if (b.appliesTo !== undefined) data.appliesTo = toStrOrNull(b.appliesTo) || 'any'
    if (b.componentKey !== undefined) data.componentKey = toStrOrNull(b.componentKey)
    if (b.componentName !== undefined) data.componentName = String(b.componentName).trim()
    if (b.custoProdutoCode !== undefined) data.custoProdutoCode = toStrOrNull(b.custoProdutoCode)
    if (b.receitaProdutoCode !== undefined) data.receitaProdutoCode = toStrOrNull(b.receitaProdutoCode)
    if (b.participaPlanilha !== undefined) data.participaPlanilha = !!b.participaPlanilha
    if (b.ordem !== undefined) data.ordem = toIntOrNull(b.ordem) ?? 0
    if (b.ativo !== undefined) data.ativo = !!b.ativo
    const regra = await prisma.phaseEconomicRule.update({ where: { id: parseInt(id) }, data })
    return NextResponse.json(regra)
  } catch (error) {
    console.error('Erro ao editar regra econômica:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { id } = await params
    await prisma.phaseEconomicRule.delete({ where: { id: parseInt(id) } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir regra econômica:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}