// src/app/api/gerenciamento/plano-contas/route.ts
// GET  - Listar contas do plano de contas
// POST - Criar conta contábil
//
// Tabela PlanoConta (nova). Mockup fin_coa:
//   codigo(req), nome(req), tipo(asset/liability/revenue/expense/cost/tax/transfer/equity),
//   natureza(debit/credit).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const contas = await prisma.planoConta.findMany({ orderBy: { codigo: 'asc' } })
    return NextResponse.json({ contas })
  } catch (error) {
    console.error('Erro ao listar plano de contas:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()

    if (!b.codigo || !String(b.codigo).trim()) {
      return NextResponse.json({ error: 'Código é obrigatório' }, { status: 400 })
    }
    if (!b.nome || !String(b.nome).trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }

    const conta = await prisma.planoConta.create({
      data: {
        codigo: String(b.codigo).trim(),
        nome: String(b.nome).trim(),
        tipo: s(b.tipo),
        natureza: s(b.natureza),
        ativo: b.ativo === undefined ? true : !!b.ativo,
      },
    })

    return NextResponse.json({ conta }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar conta contábil:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}