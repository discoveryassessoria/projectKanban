// GET /api/torre/foco/{processoId} — o FOCO DA FAMÍLIA (Bloco I3). Só leitura das fontes existentes
// (ver `lib/operacional/torre-foco.ts`). Comentários: /api/comentarios?familiaId=… (Bloco E4).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { focoDaFamilia } from '@/lib/operacional/torre-foco'

export async function GET(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const processoId = Number((await ctx.params).processoId)
  if (!Number.isInteger(processoId) || processoId <= 0) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })
  const foco = await focoDaFamilia(processoId)
  if (!foco) return NextResponse.json({ error: 'processo não encontrado' }, { status: 404 })
  return NextResponse.json(foco)
}
