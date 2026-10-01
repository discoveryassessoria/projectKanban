// GET /api/torre/funil — o que o FUNIL POR FASE da Visão geral não tem no cliente: fases do cadastro, tempo médio real por fase,
// meta (só exibição) e o resumo da semana, geral e por país. Só leitura; a origem de cada número está em `lib/operacional/torre-funil.ts`.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { funilDaTorre } from '@/lib/operacional/torre-funil'

export async function GET(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  return NextResponse.json(await funilDaTorre())
}
