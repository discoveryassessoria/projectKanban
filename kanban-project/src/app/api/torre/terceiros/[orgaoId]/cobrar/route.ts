// POST /api/torre/terceiros/{orgaoId}/cobrar — COBRAR POR CARTÓRIO ("Cobrar este cartório (n)" do agrupamento — só para
// cobrar junto o que está no mesmo lugar).
// body: { tarefaIds?, canal?, resultado?, observacao?, dataContato?, proximaEmDias? } — canal ausente = o canal cadastrado de
// cada pedido; `tarefaIds` = o recorte que a tela mostra (ausente = todos os pedidos que estão com este órgão).
// Cobra SÓ o que está com este órgão (uma cobrança-fato por pedido) e audita. Permissão = a de "Cobrar" (`tarefas.ver`).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { cobrarOrgao } from '@/src/services/torre-terceiros'
import { lerOpcoesDeCobranca } from '@/src/lib/torre-terceiros-corpo'

export async function POST(request: NextRequest, ctx: { params: Promise<{ orgaoId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const orgaoId = Number((await ctx.params).orgaoId)
  if (!Number.isInteger(orgaoId) || orgaoId <= 0) return NextResponse.json({ error: 'órgão inválido' }, { status: 400 })
  const b = await request.json().catch(() => ({} as Record<string, unknown>))
  const opcoes = lerOpcoesDeCobranca(b)
  if (!opcoes.ok) return NextResponse.json({ ok: false, mensagem: opcoes.erro }, { status: 400 })
  const tarefaIds = Array.isArray(b.tarefaIds) ? (b.tarefaIds as unknown[]).map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : null
  const r = await cobrarOrgao({ orgaoId, autor: { userId: usuario.userId, tipo: usuario.tipo }, tarefaIds, ...opcoes.opcoes })
  if (!r.ok) return NextResponse.json({ ok: false, mensagem: r.erro }, { status: r.status })
  return NextResponse.json(r)
}
