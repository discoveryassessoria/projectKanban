// GET/POST /api/torre/foco/{processoId}/historico — o MESMO Histórico do processo, dentro do Foco da família.
// Porta da Torre: gestor operacional + `tarefas.ver` (a mesma do Foco). A fonte e as exportações são as da aba Histórico.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { getHistorico, postHistorico, idDoProcesso } from '@/src/lib/historico-rota'

export async function GET(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const id = idDoProcesso((await ctx.params).processoId)
  if (id == null) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })
  return getHistorico(request, id, usuario)
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const id = idDoProcesso((await ctx.params).processoId)
  if (id == null) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })
  return postHistorico(request, id, usuario)
}
