// src/app/api/outros-custos/[id]/pagamentos/route.ts
//
// 🆕 LOTE 5: Outros Custos — pagamentos parciais.
//
// POST /api/outros-custos/:id/pagamentos
//   Body: { valor, data?, forma?, pagadorTipo?, pagadorId?, pagadorNome?,
//           comprovanteUrl?, comprovanteNome?, observacao? }
//   Cria um novo pagamento parcial vinculado ao OutroCusto.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

interface RouteContext {
  params: Promise<{ id: string }>
}

function jsonError(status: number, mensagem: string, detalhes?: unknown) {
  return NextResponse.json({ erro: mensagem, detalhes }, { status })
}

async function lerCorpoJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const texto = await req.text()
    if (!texto || !texto.trim()) return null
    return JSON.parse(texto)
  } catch {
    return null
  }
}

function parseDataOuNull(valor: unknown): Date | null {
  if (!valor) return null
  if (typeof valor !== 'string') return null
  const d = new Date(valor)
  return isNaN(d.getTime()) ? null : d
}

function parseNumeroOuNull(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  return isNaN(n) ? null : n
}

const FORMAS_VALIDAS = [
  'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO',
  'TRANSFERENCIA', 'DINHEIRO', 'CHEQUE', 'OUTRO',
]

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const outroCustoId = Number(id)
    if (!outroCustoId || isNaN(outroCustoId)) {
      return jsonError(400, 'ID de lançamento inválido')
    }

    const body = await lerCorpoJson(req)
    if (!body) {
      return jsonError(400, 'Corpo da requisição vazio ou inválido')
    }

    // Valida valor
    const valor = parseNumeroOuNull(body.valor)
    if (valor === null || valor <= 0) {
      return jsonError(400, 'Valor é obrigatório e deve ser positivo')
    }

    // Valida forma (opcional)
    let forma: string | null = null
    if (body.forma) {
      const f = String(body.forma).toUpperCase()
      if (!FORMAS_VALIDAS.includes(f)) {
        return jsonError(400, 'Forma de pagamento inválida')
      }
      forma = f
    }

    // Valida pagadorTipo (opcional)
    let pagadorTipo: string | null = null
    if (body.pagadorTipo) {
      const pt = String(body.pagadorTipo).toUpperCase()
      if (!['REQUERENTE', 'CONTRATANTE', 'OUTRO'].includes(pt)) {
        return jsonError(400, 'pagadorTipo deve ser REQUERENTE, CONTRATANTE ou OUTRO')
      }
      pagadorTipo = pt
    }

    // Verifica se OutroCusto existe
    const oc = await prisma.outroCusto.findUnique({
      where: { id: outroCustoId },
      select: { id: true },
    })
    if (!oc) return jsonError(404, 'Lançamento não encontrado')

    const pagamento = await prisma.pagamentoOutroCusto.create({
      data: {
        outroCustoId,
        valor,
        data: parseDataOuNull(body.data) || new Date(),
        forma: forma as
          | 'PIX' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'BOLETO'
          | 'TRANSFERENCIA' | 'DINHEIRO' | 'CHEQUE' | 'OUTRO' | null,
        pagadorTipo,
        pagadorId: body.pagadorId ? Number(body.pagadorId) : null,
        pagadorNome: body.pagadorNome ? String(body.pagadorNome) : null,
        comprovanteUrl: body.comprovanteUrl ? String(body.comprovanteUrl) : null,
        comprovanteNome: body.comprovanteNome
          ? String(body.comprovanteNome)
          : null,
        observacao: body.observacao ? String(body.observacao) : null,
      },
    })

    return NextResponse.json({ pagamento }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/outros-custos/:id/pagamentos] erro:', e)
    return jsonError(500, 'Erro interno ao criar pagamento')
  }
}