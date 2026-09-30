// GET /api/torre/processos — dados do RADAR (família × fases do cadastro) e da aba PROCESSOS (Bloco J4).
// Só leitura; ver `lib/operacional/torre-processos.ts` para a origem de cada campo.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { processosDaTorre } from '@/lib/operacional/torre-processos'

export async function GET(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  return NextResponse.json(await processosDaTorre())
}
