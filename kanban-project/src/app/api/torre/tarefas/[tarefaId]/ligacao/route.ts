// POST /api/torre/tarefas/{tarefaId}/ligacao — REGISTRAR LIGAÇÃO (Bloco G5).
// body: { resultado?, observacao? }. Grava o MESMO `ContatoTerceiro` (canal TELEFONE) que
// aparece no Andamento da tarefa e no histórico do órgão — um registro, sem duplicar.
// Permissão e posse = as da porta "Cobrar" (`tarefas.ver`; não-admin só a própria).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { negarSeNaoForDonoDaTarefaPorId } from '@/src/lib/tarefa-acesso'
import { registrarLigacao } from '@/src/services/precisa-de-voce-acoes'

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const negado = await negarSeNaoForDonoDaTarefaPorId(request, tarefaId)
  if (negado) return negado
  const b = await request.json().catch(() => ({}))
  const r = await registrarLigacao(
    tarefaId, usuario.userId,
    typeof b?.observacao === 'string' ? b.observacao.trim() || null : null,
    typeof b?.resultado === 'string' ? b.resultado.toUpperCase() : undefined,
  )
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}
