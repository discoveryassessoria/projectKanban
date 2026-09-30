// POST /api/torre/tarefas/{tarefaId}/atribuir-sugerido — atribui à pessoa SUGERIDA (Bloco G2/G6).
// A porta é a de sempre (`atribuirTarefa`, auditada); a permissão é a de atribuir (`tarefas.editar`).
// Devolve `desfazer` para o toast de 6 s.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { atribuirSugerido } from '@/src/services/precisa-de-voce-acoes'

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const r = await atribuirSugerido(tarefaId, usuario.userId)
  if (!r.ok) return NextResponse.json(r, { status: 422 })
  return NextResponse.json({ ...r, desfazer: { tipo: 'ATRIBUICAO', tarefaIds: [tarefaId] } })
}
