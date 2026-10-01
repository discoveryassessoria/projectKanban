// POST /api/torre/processos/{processoId}/distribuir — "Distribuir as N" do Detalhe do Processo (Torre nova, frente H).
// Distribui as tarefas abertas SEM responsável deste processo por aptidão e carga, pela regra existente do motor de elegibilidade
// e pela porta canônica de atribuição em lote (ver `src/services/torre-processo-distribuir.ts`). Devolve `desfazer` para o toast.
// Régua: gestor da Torre + `tarefas.editar` (a mesma de atribuir).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { distribuirProcesso } from '@/src/services/torre-processo-distribuir'

export async function POST(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro
  const processoId = Number((await ctx.params).processoId)
  if (!Number.isInteger(processoId) || processoId <= 0) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })
  try {
    const r = await distribuirProcesso({ processoId, autorId: usuario.userId })
    return NextResponse.json(r, { status: r.total > 0 && r.atribuidas === 0 ? 422 : 200 })
  } catch (e) {
    console.error('[torre/processos/distribuir]', e)
    return NextResponse.json({ error: 'erro ao distribuir as tarefas do processo' }, { status: 500 })
  }
}
