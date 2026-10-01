// POST /api/torre/terceiros/cobrar — COBRAR PEDIDOS (Torre › Terceiros, frente G): o "Cobrar" de uma linha e o
// "Cobrar todos os vencidos (N)".
// body: { tarefaIds: number[], canal?, resultado?, observacao?, dataContato?, proximaEmDias? }
//   canal ausente  = o canal cadastrado de cada pedido;  proximaEmDias ausente = a régua do cadastro (1 a 60, dias corridos).
// Cobra SÓ quem está com o terceiro (uma cobrança-fato por pedido, pela porta única `registrarCobranca`), recusa processo
// pausado, agenda a próxima e audita. Permissão = a de "Cobrar" (`tarefas.ver`; não-admin só as próprias tarefas).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { validarIds } from '@/src/services/torre-acoes-lote'
import { cobrarPedidos } from '@/src/services/torre-terceiros'
import { lerOpcoesDeCobranca } from '@/src/lib/torre-terceiros-corpo'

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const b = await request.json().catch(() => ({} as Record<string, unknown>))
  const ids = validarIds(b.tarefaIds)
  if (!ids.ok) return NextResponse.json({ ok: false, mensagem: ids.erro }, { status: 400 })
  const opcoes = lerOpcoesDeCobranca(b)
  if (!opcoes.ok) return NextResponse.json({ ok: false, mensagem: opcoes.erro }, { status: 400 })
  const r = await cobrarPedidos({ tarefaIds: ids.ids, autor: { userId: usuario.userId, tipo: usuario.tipo }, ...opcoes.opcoes })
  if (!r.ok) return NextResponse.json({ ok: false, mensagem: r.erro }, { status: r.status })
  return NextResponse.json(r)
}
