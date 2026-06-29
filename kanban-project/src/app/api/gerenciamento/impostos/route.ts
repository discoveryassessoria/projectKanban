// src/app/api/gerenciamento/impostos/route.ts
// GET  - Listar impostos
// POST - Criar imposto
//
// Tabela Imposto (nova). Mockup fin_taxes:
//   codigo, nome(req), tipo(taxType), modoCalculo, percentual, valorFixo, aplicaA.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function parseDecimal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const impostos = await prisma.imposto.findMany({ orderBy: { nome: 'asc' } })
    return NextResponse.json({ impostos })
  } catch (error) {
    console.error('Erro ao listar impostos:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()

    if (!b.nome || !String(b.nome).trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }

    const imposto = await prisma.imposto.create({
      data: {
        codigo: s(b.codigo),
        nome: String(b.nome).trim(),
        tipo: s(b.tipo),
        modoCalculo: s(b.modoCalculo),
        percentual: parseDecimal(b.percentual),
        valorFixo: parseDecimal(b.valorFixo),
        aplicaA: s(b.aplicaA),
        ativo: b.ativo === undefined ? true : !!b.ativo,
      },
    })

    return NextResponse.json({ imposto }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar imposto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}