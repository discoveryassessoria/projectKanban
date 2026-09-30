// GET /api/torre/tendencias — o que falta aos KPIs (Bloco J3): a foto de referência de ~7 dias atrás (E10) e o backlog da semana.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { tendenciasDaTorre } from '@/lib/operacional/torre-tendencias'

export async function GET(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  return NextResponse.json(await tendenciasDaTorre())
}
