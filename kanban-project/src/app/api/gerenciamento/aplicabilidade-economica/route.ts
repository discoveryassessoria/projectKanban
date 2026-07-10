// src/app/api/gerenciamento/aplicabilidade-economica/route.ts
// LOTE D — Aplicabilidade Econômica (PhaseEconomicRule): fase → componente → produtos.
// É a tela que liga Tradução/Apostila/Retificação SEM seed. GET lista + refs; POST cria.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim(); return s === '' ? null : s
}
function toIntOrNull(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null
}

export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const [regras, produtos, tiposProcesso, docTypes] = await Promise.all([
      prisma.phaseEconomicRule.findMany({ orderBy: [{ phaseKey: 'asc' }, { ordem: 'asc' }] }),
      prisma.produtoFinanceiro.findMany({ where: { ativo: true }, select: { codigo: true, nome: true, naturezaFinanceira: true, moedaPadrao: true }, orderBy: { nome: 'asc' } }),
      prisma.tipoProcessoNacionalidade.findMany({ where: { ativo: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.tipoDocumentoCadastro.findMany({ where: { ativo: true }, select: { code: true, name: true }, orderBy: { name: 'asc' } }),
    ])
    return NextResponse.json({ regras, produtos, tiposProcesso, docTypes })
  } catch (error) {
    console.error('Erro ao listar aplicabilidade econômica:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const b = await request.json()
    if (!toStrOrNull(b.phaseKey)) return NextResponse.json({ error: 'Informe a fase (phaseKey).' }, { status: 400 })
    if (!toStrOrNull(b.componentName)) return NextResponse.json({ error: 'Informe o nome do componente.' }, { status: 400 })
    const regra = await prisma.phaseEconomicRule.create({
      data: {
        tipoProcessoId: toIntOrNull(b.tipoProcessoId),
        phaseKey: String(b.phaseKey).trim(),
        documentTypeCode: toStrOrNull(b.documentTypeCode),
        appliesTo: toStrOrNull(b.appliesTo) || 'any',
        componentKey: toStrOrNull(b.componentKey) || String(b.componentName).trim().toUpperCase().replace(/\s+/g, '_'),
        componentName: String(b.componentName).trim(),
        custoProdutoCode: toStrOrNull(b.custoProdutoCode),
        receitaProdutoCode: toStrOrNull(b.receitaProdutoCode),
        participaPlanilha: b.participaPlanilha !== false,
        ordem: toIntOrNull(b.ordem) ?? 0,
        ativo: b.ativo !== false,
      },
    })
    return NextResponse.json(regra, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar regra econômica:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}