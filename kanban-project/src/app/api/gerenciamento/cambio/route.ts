// src/app/api/gerenciamento/cambio/route.ts
// GET  - Listar cotações de câmbio
// POST - Criar cotação
//
// Tabela CotacaoCambio (nova). Mockup fin_fx:
//   moedaDe(De), moedaPara(Para), taxa, data, fonte.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']

function parseDecimal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const cotacoes = await prisma.cotacaoCambio.findMany({
      orderBy: [{ data: 'desc' }, { criadoEm: 'desc' }],
    })

    return NextResponse.json({ cotacoes })
  } catch (error) {
    console.error('Erro ao listar câmbio:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()

    if (!MOEDAS.includes(b.moedaDe) || !MOEDAS.includes(b.moedaPara)) {
      return NextResponse.json({ error: 'Selecione as moedas (De e Para)' }, { status: 400 })
    }
    const taxa = parseDecimal(b.taxa)
    if (taxa === null || taxa <= 0) {
      return NextResponse.json({ error: 'Informe uma taxa válida' }, { status: 400 })
    }

    const cotacao = await prisma.cotacaoCambio.create({
      data: {
        moedaDe: b.moedaDe,
        moedaPara: b.moedaPara,
        taxa,
        data: b.data ? new Date(b.data) : null,
        fonte: b.fonte?.trim() || null,
        ativo: b.ativo === undefined ? true : !!b.ativo,
      },
    })

    return NextResponse.json({ cotacao }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar câmbio:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}