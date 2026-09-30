// POST /api/torre/tarefas/{tarefaId}/canal — TROCAR CANAL da solicitação (Bloco G5).
// body: { canal }. Grava na SOLICITAÇÃO e UMA linha de auditoria sob a tarefa (aparece no
// Andamento da tarefa e no histórico do órgão). Permissão de quem edita a tarefa.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { trocarCanal } from '@/src/services/precisa-de-voce-acoes'

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const b = await request.json().catch(() => ({}))
  const r = await trocarCanal(tarefaId, String(b?.canal ?? '').toUpperCase(), usuario.userId)
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}
