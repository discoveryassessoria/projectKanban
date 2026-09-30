// POST /api/torre/regras/{chave}/simular — o que a regra faria com os dados de HOJE (Bloco H3).
// SÓ LEITURA: nada é gravado, nem com a regra ligada.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { ehChaveRegra, simularRegra } from '@/lib/operacional/regras-torre'

export async function POST(request: NextRequest, ctx: { params: Promise<{ chave: string }> }) {
  const { erro } = await exigirTorre(request, 'usuarios.gerenciar')
  if (erro) return erro
  const chave = (await ctx.params).chave
  if (!ehChaveRegra(chave)) return NextResponse.json({ error: 'regra desconhecida; use r1, r2 ou r3' }, { status: 404 })
  return NextResponse.json(await simularRegra(chave))
}
