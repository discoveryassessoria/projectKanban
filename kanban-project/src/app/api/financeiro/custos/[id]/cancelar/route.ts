// §10 — cancelar Custo (lançamento aberto). Idempotente.
import { NextRequest, NextResponse } from 'next/server'
import { guardLegadoEscrita } from '@/lib/financeiro/legado-guard'
import { cancelarLancamento } from '@/lib/financeiro/cancelamento-estorno'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { verificarPermissaoCusto } from '@/lib/financeiro/permissoes-custo'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const semCusto = await verificarPermissaoCusto(req, 'cancelar'); if (semCusto) return semCusto
  const __bloqLegado = guardLegadoEscrita(); if (__bloqLegado) return __bloqLegado; // legado só-leitura após o corte
  try {
    const { id } = await ctx.params
    const b = await req.json().catch(() => ({}))
    const r = await cancelarLancamento('custo', Number(id), { motivo: b.motivo, atorId: b.atorId ?? null, eventoRef: b.eventoRef ?? null, ocorrencia: b.ocorrencia ?? null })
    return NextResponse.json(r, { status: r.ok ? 200 : r.status === 'bloqueado' ? 409 : 400 })
  } catch (e) {
    console.error('POST custos/[id]/cancelar', e)
    return NextResponse.json({ error: 'Erro ao cancelar' }, { status: 500 })
  }
}
