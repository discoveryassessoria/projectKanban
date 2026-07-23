// src/app/api/financeiro/receitas/[id]/supressao/route.ts
// GET    → estado da supressão e da origem operacional do lançamento
// DELETE → revoga a supressão: a próxima reconciliação volta a aplicar a regra
//          ativa (sem duplicar — a chave de idempotência é a mesma).

import { NextRequest, NextResponse } from 'next/server'
import { origemOperacionalDoLancamento, revogarSupressao } from '@/lib/financeiro/supressao-motor'
import { prisma } from '@/lib/prisma'
import { guardLegadoEscrita } from '@/lib/financeiro/legado-guard'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id: idStr } = await ctx.params
  const id = Number(idStr)
  if (!id || isNaN(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })
  const origem = await origemOperacionalDoLancamento('receita', id)
  return NextResponse.json({ origem, supressao: origem?.supressao ?? null })
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const __bloqLegado = guardLegadoEscrita(); if (__bloqLegado) return __bloqLegado; // legado só-leitura após o corte
  try {
    const { id: idStr } = await ctx.params
    const id = Number(idStr)
    if (!id || isNaN(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

    const b = await req.json().catch(() => ({}))
    const r = await revogarSupressao('receita', id, { motivo: b?.motivo, usuarioId: b?.atorId ?? null })
    if (!r.ok) return NextResponse.json(r, { status: 404 })

    if (r.status === 'revogado') {
      await prisma.eventoFinanceiro
        .create({
          data: {
            receitaId: id,
            usuarioId: b?.atorId ?? null,
            tipo: 'EDICAO',
            descricao: `Supressão revogada — a regra financeira ativa volta a valer na próxima reconciliação. ${b?.motivo ?? ''}`.trim().slice(0, 500),
          },
        })
        .catch(() => undefined)
    }
    return NextResponse.json(r)
  } catch (e) {
    console.error('DELETE receitas/[id]/supressao', e)
    return NextResponse.json({ error: 'Erro ao revogar supressão' }, { status: 500 })
  }
}
