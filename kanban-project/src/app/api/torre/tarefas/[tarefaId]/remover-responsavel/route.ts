// POST /api/torre/tarefas/{tarefaId}/remover-responsavel — "Remover responsável" de UMA tarefa (gaveta da certidão › Delegar).
// A porta é a MESMA do lote (`removerResponsavelEmLote` → `devolverAFila`): a tarefa fica sem responsável, o passo ativo é limpo, o histórico
// registra "removeu o responsável (X → ninguém)" com origem manual e o sino avisa quem perdeu a tarefa (nunca o autor).
// CONFIRMAÇÃO EXPLÍCITA: 1ª chamada devolve a prévia (428, nada gravado); a 2ª exige `confirmado` + `assinatura` (+ `confirmarAndamento` se já iniciada).
// Permissão: `tarefas.editar` (a de atribuir) — a mesma do "Delegar".
import { type NextRequest, NextResponse } from 'next/server'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { temPermissao } from '@/src/lib/permissoes'
import { previaDeRemoverResponsavel, removerResponsavelEmLote } from '@/src/services/torre-acoes-lote'
import { confirmacaoDoCorpo, pedirConfirmacao } from '@/src/lib/torre-confirmacao'

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  if (!temPermissao(usuario.permissoes, 'tarefas.editar')) return NextResponse.json({ error: 'Sem permissão para esta ação', permissao: 'tarefas.editar' }, { status: 403 })
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const b = await request.json().catch(() => ({}))
  const previa = await previaDeRemoverResponsavel([tarefaId])
  if (!previa) return NextResponse.json({ ok: false, error: 'Esta tarefa não tem responsável para remover.' }, { status: 422 })
  const { confirmado, assinatura } = confirmacaoDoCorpo(b)
  if (!confirmado || assinatura == null) return pedirConfirmacao(previa)
  if (assinatura !== previa.assinatura) return NextResponse.json({ ok: false, error: 'A tarefa mudou desde que você confirmou. Revise e confirme de novo.', code: 'SUGESTAO_MUDOU', confirmacao: previa }, { status: 409 })
  if (previa.exigeConfirmacaoDeAndamento && b?.confirmarAndamento !== true) return NextResponse.json({ ok: false, error: 'A tarefa já foi iniciada: confirme também que o andamento será preservado.', code: 'CONFIRMACAO_DE_ANDAMENTO', confirmacao: previa }, { status: 428 })
  const motivo = typeof b?.motivo === 'string' && b.motivo.trim() ? b.motivo.trim().slice(0, 300) : null
  const r = await removerResponsavelEmLote({ tarefaIds: [tarefaId], autorId: usuario.userId, motivo, confirmarAndamento: b?.confirmarAndamento === true })
  const item = r.itens[0]
  if (!item?.ok) return NextResponse.json({ ok: false, error: item?.mensagem ?? 'não foi possível remover o responsável' }, { status: 422 })
  return NextResponse.json({ ok: true, mensagem: 'Responsável removido: a tarefa voltou à fila de distribuição.', tarefaId })
}
