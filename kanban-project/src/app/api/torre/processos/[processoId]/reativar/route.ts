// POST /api/torre/processos/{processoId}/reativar { justificativa?, desfazer? } — REATIVA o processo pausado (e é o
// "Desfazer" da pausa). Volta à Torre exatamente como estava. Registra quem reativou e quando (LogAuditoria).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { reativarProcesso } from '@/src/services/processo-pausa'
import { dentroDaJanelaDoDesfazer, JANELA_DO_DESFAZER_TEXTO } from '@/lib/operacional/torre-desfazer'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.bloquear')
  if (erro) return erro
  const processoId = Number((await ctx.params).processoId)
  if (!Number.isInteger(processoId) || processoId <= 0) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })
  const b = await request.json().catch(() => ({}))
  // "Desfazer da pausa" usa a janela ÚNICA do Desfazer da Torre e só vale para quem pausou (reativar sem `desfazer` segue livre).
  if (b?.desfazer === true) {
    const pausa = await prisma.processoPausa.findFirst({ where: { processoId, retomadoEm: null }, orderBy: { pausadoEm: 'desc' }, select: { pausadoEm: true, pausadoPorId: true } })
    if (pausa && (pausa.pausadoPorId !== usuario.userId || !dentroDaJanelaDoDesfazer(pausa.pausadoEm))) {
      return NextResponse.json({ ok: false, codigo: 'FORA_DA_JANELA', erro: `só se desfaz a pausa recente, feita por você (até ${JANELA_DO_DESFAZER_TEXTO}) — reative o processo pelo botão Reativar` }, { status: 409 })
    }
  }
  const r = await reativarProcesso({ processoId, usuarioId: usuario.userId, justificativa: b?.justificativa, desfazer: b?.desfazer === true })
  const status = r.ok ? 200 : r.codigo === 'PROCESSO_INEXISTENTE' ? 404 : r.codigo === 'JUSTIFICATIVA_CURTA' ? 400 : 409
  return NextResponse.json(r, { status })
}
