// POST /api/torre/processos/{processoId}/pausar { justificativa } — PAUSA o processo (Torre nova, Etapa A · M2).
// Sai da Torre até ser reativado; a Operação não muda. Justificativa de 5+ letras vai para o histórico (LogAuditoria).
// Régua: gestor da Torre + `tarefas.bloquear` (a mesma permissão do "pausar" da operação do documento).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { pausarProcesso } from '@/src/services/processo-pausa'

export async function POST(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.bloquear')
  if (erro) return erro
  const processoId = Number((await ctx.params).processoId)
  if (!Number.isInteger(processoId) || processoId <= 0) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })
  const b = await request.json().catch(() => ({}))
  const r = await pausarProcesso({ processoId, usuarioId: usuario.userId, justificativa: b?.justificativa })
  const status = r.ok ? 200 : r.codigo === 'PROCESSO_INEXISTENTE' ? 404 : r.codigo === 'JUSTIFICATIVA_CURTA' ? 400 : 409
  return NextResponse.json(r, { status })
}
