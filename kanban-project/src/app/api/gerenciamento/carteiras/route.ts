// src/app/api/gerenciamento/carteiras/route.ts
// GET  - Listar carteiras de recebimento
// POST - Criar carteira
//
// Tabela CarteiraRecebimento (nova). Mockup fin_wallets:
//   nome(req), tipo, contaBancariaId(→ContaBancaria), moeda,
//   diasLiquidacao(settlementDays), isDefault.
// Só UMA carteira pode ser padrão (via transação).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']

function parseInt0(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const carteiras = await prisma.carteiraRecebimento.findMany({
      orderBy: [{ isDefault: 'desc' }, { nome: 'asc' }],
      include: { contaBancaria: { select: { id: true, nome: true, moeda: true } } },
    })

    return NextResponse.json({ carteiras })
  } catch (error) {
    console.error('Erro ao listar carteiras:', error)
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
    if (b.moeda && !MOEDAS.includes(b.moeda)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    const ehDefault = !!b.isDefault

    const carteira = await prisma.$transaction(async (tx) => {
      if (ehDefault) await tx.carteiraRecebimento.updateMany({ data: { isDefault: false } })
      return tx.carteiraRecebimento.create({
        data: {
          nome: String(b.nome).trim(),
          tipo: b.tipo?.trim() || null,
          contaBancariaId: b.contaBancariaId ? Number(b.contaBancariaId) : null,
          moeda: b.moeda || 'BRL',
          diasLiquidacao: parseInt0(b.diasLiquidacao),
          isDefault: ehDefault,
          ativo: b.ativo === undefined ? true : !!b.ativo,
        },
      })
    })

    return NextResponse.json({ carteira }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar carteira:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}