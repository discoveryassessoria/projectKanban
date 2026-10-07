// POST /api/torre/equipe/mover-carteira { deUsuarioId, paraUsuarioId?, incluirNaoAptas? } (Bloco H1)
// MANUAL, pela porta da redistribuição (`redistribuirTarefas`): item a item, auditado. Sem destino,
// usa o sucessor SUGERIDO. Devolve `desfazer` para o toast de 6 s.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { moverCarteira } from '@/lib/operacional/torre-equipe'
import { previaDeMoverCarteira } from '@/lib/operacional/torre-equipe-previas'
import { confirmacaoDoCorpo, pedirConfirmacao } from '@/src/lib/torre-confirmacao'

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'usuarios.gerenciar', 'tarefas.editar')
  if (erro) return erro
  const b = await request.json().catch(() => ({}))
  const deUsuarioId = Number(b?.deUsuarioId)
  if (!Number.isInteger(deUsuarioId) || deUsuarioId <= 0) return NextResponse.json({ error: 'deUsuarioId é obrigatório' }, { status: 400 })
  const paraUsuarioId = b?.paraUsuarioId == null ? null : Number(b.paraUsuarioId)
  if (paraUsuarioId != null && (!Number.isInteger(paraUsuarioId) || paraUsuarioId <= 0)) return NextResponse.json({ error: 'paraUsuarioId inválido' }, { status: 400 })
  // PROPOSTA: sem `confirmado` + assinatura da prévia só devolve "Mover N tarefas de A para B?" (428) e não grava nada.
  const previa = await previaDeMoverCarteira({ deUsuarioId, paraUsuarioId, incluirNaoAptas: b?.incluirNaoAptas === true })
  if (previa) {
    const { confirmado, assinatura } = confirmacaoDoCorpo(b)
    if (!confirmado || assinatura == null) return pedirConfirmacao(previa)
    if (assinatura !== previa.assinatura) return NextResponse.json({ ok: false, mensagem: 'A carteira mudou desde que você confirmou. Revise e confirme de novo.', code: 'SUGESTAO_MUDOU', confirmacao: previa }, { status: 409 })
  }
  const r = await moverCarteira({ deUsuarioId, paraUsuarioId, autorId: usuario.userId, incluirNaoAptas: b?.incluirNaoAptas === true })
  if (!r.ok) return NextResponse.json({ ok: false, mensagem: r.erro }, { status: 422 })
  return NextResponse.json({
    ok: true, ...r.resultado,
    desfazer: r.resultado.movidas > 0 ? { tipo: 'ATRIBUICAO', tarefaIds: r.resultado.tarefaIds } : null,
  }, { status: r.resultado.falhas > 0 ? 207 : 200 })
}
