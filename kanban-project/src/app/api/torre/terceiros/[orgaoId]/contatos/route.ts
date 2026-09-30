// GET /api/torre/terceiros/{orgaoId}/contatos — CONTATOS do órgão (Bloco G4/G5): o histórico de
// cobranças, ligações e trocas de canal — os MESMOS registros que o Andamento de cada tarefa lê.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { contatosDoOrgao } from '@/src/services/torre-terceiros'

export async function GET(request: NextRequest, ctx: { params: Promise<{ orgaoId: string }> }) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const orgaoId = Number((await ctx.params).orgaoId)
  if (!Number.isInteger(orgaoId) || orgaoId <= 0) return NextResponse.json({ error: 'órgão inválido' }, { status: 400 })
  const r = await contatosDoOrgao(orgaoId)
  if (!r.orgao) return NextResponse.json({ error: 'órgão não encontrado' }, { status: 404 })
  return NextResponse.json(r)
}
