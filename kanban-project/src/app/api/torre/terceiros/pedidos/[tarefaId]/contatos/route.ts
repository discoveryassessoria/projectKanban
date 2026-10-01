// GET /api/torre/terceiros/pedidos/{tarefaId}/contatos — os CONTATOS de um pedido (Torre › Terceiros, "Contatos"): o histórico
// da certidão — cobranças, ligações, trocas de canal e o envio do pedido —, do mais novo ao mais antigo. São os MESMOS
// registros que o Andamento da tarefa lê.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { contatosDoPedido } from '@/src/services/torre-terceiros'

export async function GET(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'pedido inválido' }, { status: 400 })
  const r = await contatosDoPedido(tarefaId)
  if (!r) return NextResponse.json({ error: 'pedido não encontrado' }, { status: 404 })
  return NextResponse.json(r)
}
