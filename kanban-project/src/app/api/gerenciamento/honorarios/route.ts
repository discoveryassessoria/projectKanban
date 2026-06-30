// src/app/api/gerenciamento/honorarios/route.ts
// GET  - Listar honorarios
// POST - Criar honorario
//
// Tabela Honorario (nova). Mockup fin_honorariums:
//   code(req), name(req), honorariumType, serviceId(->Servicos),
//   defaultCurrency, defaultAmount, billingMoment.
// OBS: o catalogo de Servicos ainda nao existe em React -> 'servico'
//   guardado como texto livre por ora (vira FK quando Servicos existir).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']
const TIPOS = ['main', 'rectification', 'judicial', 'administrative', 'extra_requirement', 'success_fee', 'protocol', 'consulting', 'urgent', 'addendum', 'other']
const MOMENTOS = ['contract_signed', 'phase_entered', 'protocol_created', 'process_finalized', 'manual']

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

    const honorarios = await prisma.honorario.findMany({
      orderBy: { code: 'asc' },
    })

    return NextResponse.json({ honorarios })
  } catch (error) {
    console.error('Erro ao listar honorários:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()

    if (!b.code || !String(b.code).trim()) {
      return NextResponse.json({ error: 'Código é obrigatório' }, { status: 400 })
    }
    if (!b.name || !String(b.name).trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }
    if (b.tipo && !TIPOS.includes(b.tipo)) {
      return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
    }
    if (b.momentoCobranca && !MOMENTOS.includes(b.momentoCobranca)) {
      return NextResponse.json({ error: 'Momento de cobrança inválido' }, { status: 400 })
    }
    if (b.moeda && !MOEDAS.includes(b.moeda)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    const honorario = await prisma.honorario.create({
      data: {
        code: String(b.code).trim(),
        name: String(b.name).trim(),
        tipo: b.tipo || 'main',
        servico: b.servico?.trim() || null,
        moeda: b.moeda || 'EUR',
        valorPadrao: parseNum(b.valorPadrao),
        momentoCobranca: b.momentoCobranca || 'contract_signed',
        ativo: b.ativo === undefined ? true : !!b.ativo,
      },
    })

    return NextResponse.json({ honorario }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar honorário:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}