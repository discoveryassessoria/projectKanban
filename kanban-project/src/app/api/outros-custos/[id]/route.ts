// src/app/api/outros-custos/[id]/route.ts
//
// 🆕 LOTE 5: Outros Custos — operações em um lançamento específico.
//
// GET    /api/outros-custos/:id      → busca um lançamento (com pagamentos)
// PUT    /api/outros-custos/:id      → atualiza um lançamento
// DELETE /api/outros-custos/:id      → deleta um lançamento (e seus pagamentos)

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

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const ocId = Number(id)
    if (!ocId || isNaN(ocId)) {
      return jsonError(400, 'ID inválido')
    }

    const oc = await prisma.outroCusto.findUnique({
      where: { id: ocId },
      include: {
        pagamentos: {
          orderBy: { data: 'desc' },
        },
      },
    })

    if (!oc) return jsonError(404, 'Lançamento não encontrado')

    return NextResponse.json({ outroCusto: oc })
  } catch (e) {
    console.error('[GET /api/outros-custos/:id] erro:', e)
    return jsonError(500, 'Erro interno ao buscar lançamento')
  }
}

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const ocId = Number(id)
    if (!ocId || isNaN(ocId)) {
      return jsonError(400, 'ID inválido')
    }

    const body = await lerCorpoJson(req)
    if (!body) {
      return jsonError(400, 'Corpo da requisição vazio ou inválido')
    }

    // Verifica existência
    const existente = await prisma.outroCusto.findUnique({
      where: { id: ocId },
      select: { id: true },
    })
    if (!existente) return jsonError(404, 'Lançamento não encontrado')

    // Monta objeto de atualização (só com campos enviados)
    const dadosUpdate: Record<string, unknown> = {}

    if (body.natureza !== undefined) {
      const nat = String(body.natureza).toUpperCase()
      if (nat !== 'COBRAR' && nat !== 'REPASSAR') {
        return jsonError(400, 'Natureza deve ser COBRAR ou REPASSAR')
      }
      dadosUpdate.natureza = nat
    }

    if (body.tipo !== undefined) {
      const tipo = String(body.tipo).trim()
      if (!tipo) return jsonError(400, 'Tipo não pode ser vazio')
      dadosUpdate.tipo = tipo
    }

    if (body.descricao !== undefined) {
      const desc = String(body.descricao).trim()
      if (!desc) return jsonError(400, 'Descrição não pode ser vazia')
      dadosUpdate.descricao = desc
    }

    if (body.fornecedor !== undefined) {
      dadosUpdate.fornecedor = body.fornecedor ? String(body.fornecedor) : null
    }

    if (body.valor !== undefined) {
      const v = parseNumeroOuNull(body.valor)
      if (v === null || v < 0) return jsonError(400, 'Valor inválido')
      dadosUpdate.valor = v
    }

    if (body.moeda !== undefined) {
      const m = String(body.moeda).toUpperCase()
      if (!['BRL', 'EUR', 'USD'].includes(m)) {
        return jsonError(400, 'Moeda inválida')
      }
      dadosUpdate.moeda = m
    }

    if (body.cambio !== undefined) {
      dadosUpdate.cambio = parseNumeroOuNull(body.cambio)
    }

    if (body.vencimento !== undefined) {
      dadosUpdate.vencimento = parseDataOuNull(body.vencimento)
    }

    if (body.interno !== undefined) dadosUpdate.interno = Boolean(body.interno)
    if (body.repassado !== undefined) dadosUpdate.repassado = Boolean(body.repassado)
    if (body.pago !== undefined) dadosUpdate.pago = Boolean(body.pago)

    if (body.observacao !== undefined) {
      dadosUpdate.observacao = body.observacao ? String(body.observacao) : null
    }

    const atualizado = await prisma.outroCusto.update({
      where: { id: ocId },
      data: dadosUpdate,
      include: {
        pagamentos: { orderBy: { data: 'desc' } },
      },
    })

    return NextResponse.json({ outroCusto: atualizado })
  } catch (e) {
    console.error('[PUT /api/outros-custos/:id] erro:', e)
    return jsonError(500, 'Erro interno ao atualizar lançamento')
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const ocId = Number(id)
    if (!ocId || isNaN(ocId)) {
      return jsonError(400, 'ID inválido')
    }

    const existente = await prisma.outroCusto.findUnique({
      where: { id: ocId },
      select: { id: true },
    })
    if (!existente) return jsonError(404, 'Lançamento não encontrado')

    // Cascade delete — schema já remove pagamentos automaticamente
    await prisma.outroCusto.delete({ where: { id: ocId } })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/outros-custos/:id] erro:', e)
    return jsonError(500, 'Erro interno ao deletar lançamento')
  }
}