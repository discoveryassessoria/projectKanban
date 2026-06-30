// src/app/api/gerenciamento/regras-desconto/route.ts
// GET  - Listar regras de desconto
// POST - Criar regra de desconto
//
// Tabela RegraDesconto (nova). Mockup fin_disc:
//   name(req), maxPercentWithoutApproval, maxAmountWithoutApproval,
//   requiresApprovalAboveLimit.
// Nada referencia RegraDesconto -> delete livre, sem dependencias.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const regras = await prisma.regraDesconto.findMany({
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ regras })
  } catch (error) {
    console.error('Erro ao listar regras de desconto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()

    if (!b.name || !String(b.name).trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }

    const regra = await prisma.regraDesconto.create({
      data: {
        name: String(b.name).trim(),
        maxPercentSemAprovacao: parseNum(b.maxPercentSemAprovacao),
        maxValorSemAprovacao: parseNum(b.maxValorSemAprovacao),
        exigeAprovacaoAcima: b.exigeAprovacaoAcima === undefined ? true : !!b.exigeAprovacaoAcima,
        ativo: b.ativo === undefined ? true : !!b.ativo,
      },
    })

    return NextResponse.json({ regra }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar regra de desconto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}