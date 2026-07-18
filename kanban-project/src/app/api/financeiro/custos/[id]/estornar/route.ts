// §11 — estornar Custo (lançamento liquidado): cria movimento inverso. Idempotente.
import { NextRequest, NextResponse } from 'next/server'
import { estornarLancamento } from '@/lib/financeiro/cancelamento-estorno'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const b = await req.json().catch(() => ({}))
    const r = await estornarLancamento('custo', Number(id), { motivo: b.motivo, atorId: b.atorId ?? null, eventoRef: b.eventoRef ?? null, ocorrencia: b.ocorrencia ?? null })
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  } catch (e) {
    console.error('POST custos/[id]/estornar', e)
    return NextResponse.json({ error: 'Erro ao estornar' }, { status: 500 })
  }
}
