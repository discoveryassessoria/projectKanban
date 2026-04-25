// src/app/api/pagamentos-outro-custo/[id]/route.ts
//
// 🆕 LOTE 5: Pagamentos de OutroCusto — operações em um pagamento específico.
//
// PUT    /api/pagamentos-outro-custo/:id   → atualiza ou estorna pagamento
//   - Para estornar: body { estornado: true, estornoMotivo?: '...' }
//   - Para reverter estorno: body { estornado: false }
//   - Para editar dados: outros campos
// DELETE /api/pagamentos-outro-custo/:id   → deleta um pagamento

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
// PUT
// ---------------------------------------------------------------------------

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const pagamentoId = Number(id)
    if (!pagamentoId || isNaN(pagamentoId)) {
      return jsonError(400, 'ID inválido')
    }

    const body = await lerCorpoJson(req)
    if (!body) {
      return jsonError(400, 'Corpo da requisição vazio ou inválido')
    }

    const existente = await prisma.pagamentoOutroCusto.findUnique({
      where: { id: pagamentoId },
      select: { id: true, estornado: true },
    })
    if (!existente) return jsonError(404, 'Pagamento não encontrado')

    const dadosUpdate: Record<string, unknown> = {}

    // Estorno (caminho mais comum)
    if (body.estornado !== undefined) {
      const estornar = Boolean(body.estornado)
      dadosUpdate.estornado = estornar
      if (estornar) {
        dadosUpdate.estornadoEm = new Date()
        dadosUpdate.estornoMotivo = body.estornoMotivo
          ? String(body.estornoMotivo)
          : 'Estorno manual'
      } else {
        dadosUpdate.estornadoEm = null
        dadosUpdate.estornoMotivo = null
      }
    }

    // Edição de dados
    if (body.valor !== undefined) {
      const v = parseNumeroOuNull(body.valor)
      if (v === null || v <= 0) return jsonError(400, 'Valor inválido')
      dadosUpdate.valor = v
    }
    if (body.data !== undefined) {
      const d = parseDataOuNull(body.data)
      if (!d) return jsonError(400, 'Data inválida')
      dadosUpdate.data = d
    }
    if (body.forma !== undefined) {
      dadosUpdate.forma = body.forma ? String(body.forma).toUpperCase() : null
    }
    if (body.pagadorNome !== undefined) {
      dadosUpdate.pagadorNome = body.pagadorNome ? String(body.pagadorNome) : null
    }
    if (body.observacao !== undefined) {
      dadosUpdate.observacao = body.observacao ? String(body.observacao) : null
    }

    const atualizado = await prisma.pagamentoOutroCusto.update({
      where: { id: pagamentoId },
      data: dadosUpdate,
    })

    return NextResponse.json({ pagamento: atualizado })
  } catch (e) {
    console.error('[PUT /api/pagamentos-outro-custo/:id] erro:', e)
    return jsonError(500, 'Erro interno ao atualizar pagamento')
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const pagamentoId = Number(id)
    if (!pagamentoId || isNaN(pagamentoId)) {
      return jsonError(400, 'ID inválido')
    }

    const existente = await prisma.pagamentoOutroCusto.findUnique({
      where: { id: pagamentoId },
      select: { id: true },
    })
    if (!existente) return jsonError(404, 'Pagamento não encontrado')

    await prisma.pagamentoOutroCusto.delete({ where: { id: pagamentoId } })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/pagamentos-outro-custo/:id] erro:', e)
    return jsonError(500, 'Erro interno ao deletar pagamento')
  }
}