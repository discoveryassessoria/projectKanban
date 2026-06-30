// src/app/api/gerenciamento/regras-comissao/route.ts
// GET  - Listar regras de comissao
// POST - Criar regra de comissao
//
// Tabela RegraComissao (nova). Mockup fin_comm:
//   name(req), appliesToRoleId(->Papeis), calculationMode, percent,
//   fixedAmount, paymentMoment.
// OBS: o catalogo de Papeis ainda nao existe em React -> 'papel' guardado
//   como texto livre por ora (vira FK quando o catalogo de Papeis existir).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MODOS = ['percentage', 'fixed']
const MOMENTOS = ['first_payment_received', 'contract_signed', 'process_finalized']

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

    const regras = await prisma.regraComissao.findMany({
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ regras })
  } catch (error) {
    console.error('Erro ao listar regras de comissão:', error)
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
    if (b.modoCalculo && !MODOS.includes(b.modoCalculo)) {
      return NextResponse.json({ error: 'Modo de cálculo inválido' }, { status: 400 })
    }
    if (b.momento && !MOMENTOS.includes(b.momento)) {
      return NextResponse.json({ error: 'Momento inválido' }, { status: 400 })
    }

    const regra = await prisma.regraComissao.create({
      data: {
        name: String(b.name).trim(),
        papel: b.papel?.trim() || null,
        modoCalculo: b.modoCalculo || 'percentage',
        percent: parseNum(b.percent),
        valorFixo: parseNum(b.valorFixo),
        momento: b.momento || 'first_payment_received',
        ativo: b.ativo === undefined ? true : !!b.ativo,
      },
    })

    return NextResponse.json({ regra }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar regra de comissão:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}