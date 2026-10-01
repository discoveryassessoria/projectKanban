// POST /api/torre/tarefas/{tarefaId}/cobrar — "Cobrar o cartório" de UMA linha da aba Tarefas (Torre nova, 01/10/2026).
// body: { canal?, observacao? }. É a MESMA porta das cobranças em massa (`cobrarTarefas` → `registrarCobranca`): um fato
// `ContatoTerceiro`, o reagendamento e a escalada do cadastro. Canal ausente = o canal CADASTRADO da tarefa (solicitação →
// cadastro do órgão). A justificativa do modal entra como observação do contato (aparece no histórico da tarefa e do órgão).
// Devolve também o próximo acompanhamento (a tela diz "próxima em N dias" com o que a régua REALMENTE marcou).
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { cobrarTarefas, CANAIS_VALIDOS } from '@/src/services/cobranca-terceiros'
import { justificativaValida } from '@/src/services/torre-tarefas-justificativa'

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const b = await request.json().catch(() => ({}))
  const observacao = justificativaValida(b?.observacao)
  if (!observacao) return NextResponse.json({ ok: false, mensagem: 'Escreva pelo menos 5 letras na justificativa.' }, { status: 400 })
  const canalBruto = typeof b?.canal === 'string' ? b.canal.toUpperCase() : ''
  const canal = CANAIS_VALIDOS.has(canalBruto) ? canalBruto : null

  const { cobradas, ignoradas } = await cobrarTarefas({
    tarefaIds: [tarefaId], autor: { userId: usuario.userId, tipo: usuario.tipo }, canal, observacao, exigirAguardando: true,
  })
  if (cobradas.length === 0) return NextResponse.json({ ok: false, mensagem: ignoradas[0]?.motivo ?? 'Não foi possível cobrar.' }, { status: 422 })
  const contato = await prisma.contatoTerceiro.findUnique({ where: { id: cobradas[0].contatoId }, select: { subtaskExecution: { select: { proximoAcompanhamentoEm: true } } } })
  return NextResponse.json({ ok: true, canal: cobradas[0].canal, proximoAcompanhamentoEm: contato?.subtaskExecution?.proximoAcompanhamentoEm?.toISOString() ?? null })
}
