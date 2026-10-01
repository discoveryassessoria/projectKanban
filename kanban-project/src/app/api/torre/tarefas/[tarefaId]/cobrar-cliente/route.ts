// POST /api/torre/tarefas/{tarefaId}/cobrar-cliente — "Cobrar o cliente" de UMA linha da aba Tarefas (Torre nova, 01/10/2026).
// body: { justificativa, texto? }. A porta é a de sempre (`cobrarCliente`, precisa-de-voce-acoes.ts): manda a mensagem pelo chat
// do processo e audita. A justificativa (≥ 5 letras) entra como UMA linha sob a tarefa (`TORRE_JUSTIFICATIVA`). Permissão: editar a tarefa.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { cobrarCliente } from '@/src/services/precisa-de-voce-acoes'
import { justificativaValida, registrarJustificativa } from '@/src/services/torre-tarefas-justificativa'

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const b = await request.json().catch(() => ({}))
  const justificativa = justificativaValida(b?.justificativa)
  if (!justificativa) return NextResponse.json({ ok: false, mensagem: 'Escreva pelo menos 5 letras na justificativa.' }, { status: 400 })
  const r = await cobrarCliente(tarefaId, usuario.userId, typeof b?.texto === 'string' ? b.texto : null)
  if (!r.ok) return NextResponse.json({ ok: false, mensagem: r.erro }, { status: 422 })
  await registrarJustificativa({ tarefaId, usuarioId: usuario.userId, acao: 'cobrança ao cliente', justificativa })
  return NextResponse.json({ ok: true, mensagem: r.mensagem })
}
