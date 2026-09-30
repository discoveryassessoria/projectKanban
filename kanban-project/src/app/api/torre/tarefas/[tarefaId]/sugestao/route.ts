// GET /api/torre/tarefas/{tarefaId}/sugestao — QUEM a regra de atribuição sugere (Bloco G6).
// Alimenta o rótulo "Atribuir a {sugerido}" do painel: o nome nunca é fixo no código.
// A sugestão já considera aptidão, disponibilidade, carga e o sucessor de quem está ausente
// (`sugerirResponsavelPrecisaDeVoce`, a mesma do "Precisa de você"). Só leitura.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { sugerirResponsavelPrecisaDeVoce } from '@/lib/operacional/precisa-de-voce'

export async function GET(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { erro } = await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const sugestao = await sugerirResponsavelPrecisaDeVoce(tarefaId)
  return NextResponse.json({ tarefaId, sugestao })
}
