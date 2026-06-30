// src/app/api/gerenciamento/condicoes-pagamento/route.ts
// GET  - Listar condicoes de pagamento (+ carteiras para o select)
// POST - Criar condicao de pagamento
//
// Tabela CondicaoPagamento (nova). Mockup fin_paycond:
//   name(req), currency, paymentMethodId, receivingWalletId(->Carteira),
//   entryEnabled, entryPercent, installments, dueDay, applyPaymentFees.
// OBS: o mockup usa o catalogo paymentMethods; aqui usamos o enum
//   FormaPagamento existente como stand-in (formaPagamento).
// GET ja devolve { condicoes, carteiras } -> a tela faz UM fetch so.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']
const FORMAS = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'CHEQUE', 'OUTRO']

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function parseIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [condicoes, carteiras] = await Promise.all([
      prisma.condicaoPagamento.findMany({
        orderBy: { name: 'asc' },
        include: { carteira: { select: { id: true, nome: true } } },
      }),
      prisma.carteiraRecebimento.findMany({
        where: { ativo: true },
        select: { id: true, nome: true },
        orderBy: { nome: 'asc' },
      }),
    ])

    return NextResponse.json({ condicoes, carteiras })
  } catch (error) {
    console.error('Erro ao listar condições de pagamento:', error)
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
    if (b.moeda && !MOEDAS.includes(b.moeda)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }
    if (b.formaPagamento && !FORMAS.includes(b.formaPagamento)) {
      return NextResponse.json({ error: 'Forma de pagamento inválida' }, { status: 400 })
    }

    const parcelas = parseIntOrNull(b.parcelas)

    const condicao = await prisma.condicaoPagamento.create({
      data: {
        name: String(b.name).trim(),
        moeda: b.moeda || 'BRL',
        formaPagamento: b.formaPagamento || null,
        carteiraId: b.carteiraId ? Number(b.carteiraId) : null,
        temEntrada: !!b.temEntrada,
        percentEntrada: parseNum(b.percentEntrada),
        parcelas: parcelas && parcelas > 0 ? parcelas : 1,
        diaVencimento: parseIntOrNull(b.diaVencimento),
        aplicarTaxas: !!b.aplicarTaxas,
        ativo: b.ativo === undefined ? true : !!b.ativo,
      },
    })

    return NextResponse.json({ condicao }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar condição de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}