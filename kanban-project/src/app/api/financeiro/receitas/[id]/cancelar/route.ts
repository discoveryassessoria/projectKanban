// §10 — cancelar Receita (lançamento aberto). Idempotente.
import { NextRequest, NextResponse } from 'next/server'
import { cancelarLancamento } from '@/lib/financeiro/cancelamento-estorno'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const b = await req.json().catch(() => ({}))
    const r = await cancelarLancamento('receita', Number(id), { motivo: b.motivo, atorId: b.atorId ?? null, eventoRef: b.eventoRef ?? null, ocorrencia: b.ocorrencia ?? null })
    return NextResponse.json(r, { status: r.ok ? 200 : r.status === 'bloqueado' ? 409 : 400 })
  } catch (e) {
    console.error('POST receitas/[id]/cancelar', e)
    return NextResponse.json({ error: 'Erro ao cancelar' }, { status: 500 })
  }
}
