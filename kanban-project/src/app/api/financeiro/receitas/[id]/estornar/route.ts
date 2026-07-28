// §11 — estornar Receita (lançamento liquidado): cria movimento inverso. Idempotente.
import { NextRequest, NextResponse } from 'next/server'
import { guardLegadoEscrita } from '@/lib/financeiro/legado-guard'
import { estornarLancamento } from '@/lib/financeiro/cancelamento-estorno'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const __bloqLegado = guardLegadoEscrita(); if (__bloqLegado) return __bloqLegado; // legado só-leitura após o corte
  try {
    const { id } = await ctx.params
    const b = await req.json().catch(() => ({}))
    const r = await estornarLancamento('receita', Number(id), { motivo: b.motivo, atorId: b.atorId ?? null, eventoRef: b.eventoRef ?? null, ocorrencia: b.ocorrencia ?? null })
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  } catch (e) {
    console.error('POST receitas/[id]/estornar', e)
    return NextResponse.json({ error: 'Erro ao estornar' }, { status: 500 })
  }
}
