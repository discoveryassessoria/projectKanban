// POST /api/torre/regras/{chave}/ativar { ativa: boolean } — Ativar / Desativar (Bloco H3), auditado.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { ehChaveRegra, definirRegra } from '@/lib/operacional/regras-torre'

export async function POST(request: NextRequest, ctx: { params: Promise<{ chave: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'usuarios.gerenciar')
  if (erro) return erro
  const chave = (await ctx.params).chave
  if (!ehChaveRegra(chave)) return NextResponse.json({ error: 'regra desconhecida; use r1, r2 ou r3' }, { status: 404 })
  const b = await request.json().catch(() => ({}))
  if (typeof b?.ativa !== 'boolean') return NextResponse.json({ error: 'ativa (true/false) é obrigatório' }, { status: 400 })
  const r = await definirRegra(chave, b.ativa, usuario.userId)
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}
