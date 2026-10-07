// POST /api/torre/tarefas/{tarefaId}/atribuir — atribuir/transferir UMA tarefa à pessoa ESCOLHIDA (manual), SÓ COM CONFIRMAÇÃO EXPLÍCITA (L4, 06/10/2026).
// 1ª chamada (sem `confirmado`): devolve a prévia "Atribuir X a Y?" (428) e NADA é gravado. 2ª: `confirmado: true` + `assinatura` da prévia.
// A porta é a de sempre (`atribuirTarefa`: auditoria, notificação, trava otimista); o histórico registra a origem "manual".
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { atribuirTarefa } from '@/lib/operacional/tarefa-comandos'
import { previaDeAtribuir } from '@/src/services/torre-acoes-lote'
import { confirmacaoDoCorpo, pedirConfirmacao } from '@/src/lib/torre-confirmacao'

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const b = await request.json().catch(() => ({}))
  const responsavelId = Number(b?.responsavelId)
  if (!Number.isInteger(responsavelId) || responsavelId <= 0) return NextResponse.json({ error: 'responsavelId é obrigatório' }, { status: 400 })
  const previa = await previaDeAtribuir([tarefaId], responsavelId)
  if (!previa) return NextResponse.json({ ok: false, error: 'Tarefa ou pessoa não encontrada (ou tarefa já encerrada).' }, { status: 422 })
  const { confirmado, assinatura } = confirmacaoDoCorpo(b)
  if (!confirmado || assinatura == null) return pedirConfirmacao(previa)
  if (assinatura !== previa.assinatura) return NextResponse.json({ ok: false, error: 'A tarefa mudou desde que você confirmou. Revise e confirme de novo.', code: 'SUGESTAO_MUDOU', confirmacao: previa }, { status: 409 })
  const r = await atribuirTarefa({ tarefaId, responsavelId, autorId: usuario.userId, motivo: `manual: escolhido por ${usuario.nome}` })
  if (!r.ok) return NextResponse.json({ ok: false, error: r.mensagem }, { status: 422 })
  return NextResponse.json({ ok: true, mensagem: 'Responsável atribuído · fica no histórico', tarefaId, desfazer: { tipo: 'ATRIBUICAO', tarefaIds: [tarefaId] } })
}
