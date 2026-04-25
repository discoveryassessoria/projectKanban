// src/app/api/processos/[id]/outros-custos/route.ts
//
// 🆕 LOTE 5: Outros Custos — listagem e criação.
//
// GET  /api/processos/:id/outros-custos
//   Retorna { outrosCustos: [...], totais: {...} }
//   Cada item inclui pagamentos relacionados.
//
// POST /api/processos/:id/outros-custos
//   Body: { natureza, tipo, descricao, fornecedor?, valor, moeda?, cambio?,
//           vencimento?, interno?, repassado?, pago?, observacao? }
//   Cria um novo lançamento.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

interface RouteContext {
  params: Promise<{ processoId: string }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GET — Lista todos os OutrosCustos do processo
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { processoId: processoIdParam } = await ctx.params
    const processoId = Number(processoIdParam)
    if (!processoId || isNaN(processoId)) {
      return jsonError(400, 'ID de processo inválido')
    }

    const outrosCustos = await prisma.outroCusto.findMany({
      where: { processoId },
      include: {
        pagamentos: {
          orderBy: { data: 'desc' },
        },
      },
      orderBy: [{ vencimento: 'asc' }, { createdAt: 'desc' }],
    })

    // Cálculo dos totais (em BRL, considerando câmbio)
    let totalCobrarBRL = 0
    let totalRepassarBRL = 0
    let totalRecebidoBRL = 0
    let totalPagoBRL = 0
    let totalInternoBRL = 0
    let totalRepassadoBRL = 0

    for (const oc of outrosCustos) {
      const cambio = oc.moeda !== 'BRL' ? Number(oc.cambio || 1) : 1
      const valorBRL = Number(oc.valor) * cambio

      const pagosAtivos = oc.pagamentos.filter(
        (p: { estornado: boolean }) => !p.estornado,
      )
      const totalPagoOcBRL = pagosAtivos.reduce(
        (s: number, p: { valor: unknown }) => s + Number(p.valor) * cambio,
        0,
      )

      if (oc.natureza === 'COBRAR') {
        totalCobrarBRL += valorBRL
        totalRecebidoBRL += totalPagoOcBRL
      } else {
        totalRepassarBRL += valorBRL
        totalPagoBRL += totalPagoOcBRL
        if (oc.interno) totalInternoBRL += valorBRL
        if (oc.repassado) totalRepassadoBRL += valorBRL
      }
    }

    return NextResponse.json({
      outrosCustos,
      totais: {
        totalCobrarBRL,
        totalRecebidoBRL,
        totalARecebidoBRL: Math.max(0, totalCobrarBRL - totalRecebidoBRL),
        totalRepassarBRL,
        totalPagoBRL,
        totalAPagarBRL: Math.max(0, totalRepassarBRL - totalPagoBRL),
        totalInternoBRL,
        totalRepassadoBRL,
        contagem: outrosCustos.length,
      },
    })
  } catch (e) {
    console.error('[GET /api/processos/:id/outros-custos] erro:', e)
    return jsonError(500, 'Erro interno ao listar outros custos')
  }
}

// ---------------------------------------------------------------------------
// POST — Cria um novo OutroCusto
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { processoId: processoIdParam } = await ctx.params
    const processoId = Number(processoIdParam)
    if (!processoId || isNaN(processoId)) {
      return jsonError(400, 'ID de processo inválido')
    }

    const body = await lerCorpoJson(req)
    if (!body) {
      return jsonError(400, 'Corpo da requisição vazio ou inválido')
    }

    // Validações
    const natureza = String(body.natureza || '').toUpperCase()
    if (natureza !== 'COBRAR' && natureza !== 'REPASSAR') {
      return jsonError(400, 'Natureza deve ser COBRAR ou REPASSAR')
    }

    const tipo = String(body.tipo || '').trim()
    if (!tipo) {
      return jsonError(400, 'Tipo é obrigatório')
    }

    const descricao = String(body.descricao || '').trim()
    if (!descricao) {
      return jsonError(400, 'Descrição é obrigatória')
    }

    const valor = parseNumeroOuNull(body.valor)
    if (valor === null || valor < 0) {
      return jsonError(400, 'Valor é obrigatório e deve ser positivo')
    }

    const moedaRaw = String(body.moeda || 'BRL').toUpperCase()
    if (!['BRL', 'EUR', 'USD'].includes(moedaRaw)) {
      return jsonError(400, 'Moeda deve ser BRL, EUR ou USD')
    }
    const moeda = moedaRaw as 'BRL' | 'EUR' | 'USD'

    const cambio = parseNumeroOuNull(body.cambio)
    if (moeda !== 'BRL' && (!cambio || cambio <= 0)) {
      return jsonError(400, 'Câmbio é obrigatório para moeda estrangeira')
    }

    // Verifica se processo existe
    const processoExiste = await prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true },
    })
    if (!processoExiste) {
      return jsonError(404, 'Processo não encontrado')
    }

    // Cria
    const novo = await prisma.outroCusto.create({
      data: {
        processoId,
        natureza,
        tipo,
        descricao,
        fornecedor: body.fornecedor ? String(body.fornecedor) : null,
        valor,
        moeda,
        cambio: cambio ?? null,
        vencimento: parseDataOuNull(body.vencimento),
        interno: Boolean(body.interno),
        repassado: Boolean(body.repassado),
        pago: Boolean(body.pago),
        observacao: body.observacao ? String(body.observacao) : null,
      },
      include: {
        pagamentos: true,
      },
    })

    return NextResponse.json({ outroCusto: novo }, { status: 201 })
  } catch (e) {
    console.error('[POST /api/processos/:id/outros-custos] erro:', e)
    return jsonError(500, 'Erro interno ao criar lançamento')
  }
}