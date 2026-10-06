// POST /api/torre/tarefas/{tarefaId}/atribuir-sugerido — atribui à pessoa SUGERIDA, SÓ COM CONFIRMAÇÃO EXPLÍCITA (Bloco G2/G6 + regra de 06/10/2026).
// 1ª chamada (sem `confirmado`): devolve a prévia "Atribuir X a Y?" (428) e NADA é gravado. 2ª: `confirmado: true` + `assinatura` da prévia.
// A porta é a de sempre (`atribuirTarefa`, auditada, com a origem "via sugestão do Precisa de você (confirmada por …)"); a permissão é a de
// atribuir (`tarefas.editar`). Devolve `desfazer` para o toast de 6 s.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { atribuirSugerido, previaDaSugestaoDaTarefa } from '@/src/services/precisa-de-voce-acoes'
import { confirmacaoDoCorpo, pedirConfirmacao } from '@/src/lib/torre-confirmacao'

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const corpo = await request.json().catch(() => ({}))
  const { confirmado, assinatura } = confirmacaoDoCorpo(corpo)
  if (!confirmado || assinatura == null) {
    const previa = await previaDaSugestaoDaTarefa(tarefaId)
    if (!previa) return NextResponse.json({ ok: false, erro: 'Nenhum candidato apto e disponível encontrado.' }, { status: 422 })
    return pedirConfirmacao(previa)
  }
  const r = await atribuirSugerido(tarefaId, usuario.userId, { autorNome: usuario.nome, assinaturaConfirmada: assinatura })
  if (!r.ok) return NextResponse.json(r, { status: r.mudou ? 409 : 422 })
  return NextResponse.json({ ...r, desfazer: { tipo: 'ATRIBUICAO', tarefaIds: [tarefaId] } })
}
