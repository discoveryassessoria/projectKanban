// POST /api/torre/tarefas/{tarefaId}/iniciar — a AÇÃO RÁPIDA "Iniciar" (Bloco G2).
// Executa o passo de envio PELO MOTOR (`iniciarEnvioDaTarefa`), e só para a tarefa que
// realmente pode iniciar: fase atual, sem bloqueio, sem dependência aberta, com órgão.
// Fora disso a API recusa com o motivo — o botão da tela também nem aparece.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { iniciarEnvioDaTarefa } from '@/src/services/iniciar-envio'

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.iniciar_concluir')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const b = await request.json().catch(() => ({}))
  const r = await iniciarEnvioDaTarefa({
    tarefaId, usuario: { userId: usuario.userId, tipo: usuario.tipo },
    canalKey: typeof b?.canalKey === 'string' ? b.canalKey : undefined,
    protocolo: typeof b?.protocolo === 'string' ? b.protocolo : undefined,
    exigirElegibilidadeDaTorre: true,
  })
  if (!r.ok) return NextResponse.json({ ok: false, mensagem: r.motivo }, { status: 422 })
  return NextResponse.json({ ok: true, mensagem: 'Enviada ao cartório pelo motor.', tarefaId })
}
