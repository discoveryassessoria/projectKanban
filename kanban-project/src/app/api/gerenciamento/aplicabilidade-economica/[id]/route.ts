// src/app/api/gerenciamento/aplicabilidade-economica/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { validarConfigGeraLancamento } from '@/lib/financeiro/regra-financeira-validacao'

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
    // F3 — deriva os FKs canônicos quando os códigos/ids mudam (dual-write até o cutover final)
    if (b.custoConfigId !== undefined) data.custoConfigId = toIntOrNull(b.custoConfigId)
    else if (b.custoProdutoCode !== undefined) data.custoConfigId = data.custoProdutoCode ? (await prisma.produtoFinanceiro.findFirst({ where: { codigo: data.custoProdutoCode, ativo: true }, select: { id: true } }))?.id ?? null : null
    if (b.receitaConfigId !== undefined) data.receitaConfigId = toIntOrNull(b.receitaConfigId)
    else if (b.receitaProdutoCode !== undefined) data.receitaConfigId = data.receitaProdutoCode ? (await prisma.produtoFinanceiro.findFirst({ where: { codigo: data.receitaProdutoCode, ativo: true }, select: { id: true } }))?.id ?? null : null
    if (b.tipoDocumentoId !== undefined) data.tipoDocumentoId = toIntOrNull(b.tipoDocumentoId)
    else if (b.documentTypeCode !== undefined) data.tipoDocumentoId = data.documentTypeCode ? (await prisma.tipoDocumentoCadastro.findFirst({ where: { code: data.documentTypeCode }, select: { id: true } }))?.id ?? null : null
    // §3 — valida natureza vs config quando os vínculos mudam (backend).
    if (data.custoConfigId !== undefined) {
      const v = await validarConfigGeraLancamento(data.custoConfigId, 'CUSTO')
      if (!v.ok) return NextResponse.json({ error: v.motivo }, { status: 400 })
    }
    if (data.receitaConfigId !== undefined) {
      const v = await validarConfigGeraLancamento(data.receitaConfigId, 'RECEITA')
      if (!v.ok) return NextResponse.json({ error: v.motivo }, { status: 400 })
    }
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