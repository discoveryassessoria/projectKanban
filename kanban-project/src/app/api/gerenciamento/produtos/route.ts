// src/app/api/gerenciamento/produtos/route.ts
// GET  - Listar produtos financeiros / itens cobrados
// POST - Criar produto (Catálogo Financeiro)
// Campos do mockup: codigo(req), nome(req), especie, naturezaFinanceira,
//   categoriaId(→Categoria), planoContaId(→Conta contábil), moedaPadrao,
//   valorPadrao, cobravelDoCliente, custoInterno, repasse, reembolsavel.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const MOEDAS = ['BRL', 'EUR', 'USD']
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
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

    const produtos = await prisma.produtoFinanceiro.findMany({
      orderBy: { nome: 'asc' },
      include: {
        categoria: { select: { id: true, nome: true } },
        planoConta: { select: { id: true, codigo: true, nome: true } },
      },
    })

    return NextResponse.json({ produtos })
  } catch (error) {
    console.error('Erro ao listar produtos:', error)
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
    if (b.moedaPadrao && !MOEDAS.includes(b.moedaPadrao)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    const produto = await prisma.produtoFinanceiro.create({
      data: {
        codigo: String(b.codigo).trim(),
        nome: String(b.nome).trim(),
        especie: s(b.especie),
        naturezaFinanceira: b.naturezaFinanceira || 'revenue',
        categoriaId: b.categoriaId ? Number(b.categoriaId) : null,
        planoContaId: b.planoContaId ? Number(b.planoContaId) : null,
        moedaPadrao: b.moedaPadrao || 'BRL',
        valorPadrao: parseDecimal(b.valorPadrao),
        cobravelDoCliente: !!b.cobravelDoCliente,
        custoInterno: !!b.custoInterno,
        repasse: !!b.repasse,
        reembolsavel: !!b.reembolsavel,
        ativo: b.ativo === undefined ? true : !!b.ativo,
      },
    })

    return NextResponse.json({ produto }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar produto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}