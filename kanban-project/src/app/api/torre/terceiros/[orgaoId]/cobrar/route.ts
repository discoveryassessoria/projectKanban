// POST /api/torre/terceiros/{orgaoId}/cobrar — COBRAR POR CARTÓRIO (Bloco G4).
// body: { canal?, resultado?, observacao?, dataContato? } — canal ausente = o canal cadastrado de
// cada pedido. Cobra SÓ o que está com este órgão (uma cobrança-fato por tarefa) e audita.
// Permissão = a de "Cobrar" (`tarefas.ver`; não-admin só as próprias tarefas).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { cobrarOrgao } from '@/src/services/torre-terceiros'

export async function POST(request: NextRequest, ctx: { params: Promise<{ orgaoId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const orgaoId = Number((await ctx.params).orgaoId)
  if (!Number.isInteger(orgaoId) || orgaoId <= 0) return NextResponse.json({ error: 'órgão inválido' }, { status: 400 })
  const b = await request.json().catch(() => ({} as Record<string, unknown>))
  const dataBruta = typeof b.dataContato === 'string' && b.dataContato.trim() ? new Date(b.dataContato) : null
  const r = await cobrarOrgao({
    orgaoId, autor: { userId: usuario.userId, tipo: usuario.tipo },
    canal: typeof b.canal === 'string' && b.canal ? b.canal.toUpperCase() : null,
    resultado: typeof b.resultado === 'string' && b.resultado ? b.resultado.toUpperCase() : undefined,
    observacao: typeof b.observacao === 'string' ? b.observacao.trim() || null : null,
    dataContato: dataBruta && !Number.isNaN(dataBruta.getTime()) ? dataBruta : null,
  })
  if (!r.ok) return NextResponse.json({ ok: false, mensagem: r.erro }, { status: r.status })
  return NextResponse.json(r)
}
