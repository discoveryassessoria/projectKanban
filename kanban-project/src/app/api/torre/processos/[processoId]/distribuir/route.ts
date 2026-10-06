// POST /api/torre/processos/{processoId}/distribuir — "Distribuir as N" do Detalhe do Processo (Torre nova, frente H).
// Distribui as tarefas abertas SEM responsável deste processo por aptidão e carga, pela regra existente do motor de elegibilidade
// e pela porta canônica de atribuição em lote (ver `src/services/torre-processo-distribuir.ts`). Devolve `desfazer` para o toast.
// Régua: gestor da Torre + `tarefas.editar` (a mesma de atribuir).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { distribuirProcesso, previaDeDistribuirProcesso } from '@/src/services/torre-processo-distribuir'
import { confirmacaoDoCorpo, pedirConfirmacao } from '@/src/lib/torre-confirmacao'

export async function POST(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro
  const processoId = Number((await ctx.params).processoId)
  if (!Number.isInteger(processoId) || processoId <= 0) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })
  try {
    // SUGESTÃO NUNCA ATRIBUI SOZINHA: sem `confirmado` + assinatura da prévia, só devolve "Atribuir … a …?" (428) e não grava nada.
    const { confirmado, assinatura } = confirmacaoDoCorpo(await request.json().catch(() => ({})))
    const previa = await previaDeDistribuirProcesso(processoId)
    if (previa && (!confirmado || assinatura == null)) return pedirConfirmacao(previa)
    if (previa && assinatura !== previa.assinatura) return NextResponse.json({ ok: false, erro: 'A sugestão mudou desde que você confirmou. Revise e confirme de novo.', confirmacao: previa, code: 'SUGESTAO_MUDOU' }, { status: 409 })
    const r = await distribuirProcesso({ processoId, autorId: usuario.userId, autorNome: usuario.nome })
    return NextResponse.json(r, { status: r.total > 0 && r.atribuidas === 0 ? 422 : 200 })
  } catch (e) {
    console.error('[torre/processos/distribuir]', e)
    return NextResponse.json({ error: 'erro ao distribuir as tarefas do processo' }, { status: 500 })
  }
}
