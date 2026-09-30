// POST /api/processos/{processoId}/reabrir-certidao   { tarefaId, motivo }
// "Reabrir certidão" do Histórico do processo e da Central Operacional: desfaz um cancelamento HUMANO pela porta
// `reabrirCertidaoCancelada` (mesma tarefa, mesmo taskId; documento, exigência e etapas voltam juntos; auditado).
// Permissão = a da porta individual `reabrir` da tarefa: `tarefas.editar`. Escopo: a tarefa tem de ser DESTE processo.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirPermissao } from '@/src/lib/verificar-permissao'
import { reabrirCertidaoCancelada } from '@/src/services/reabertura-de-certidao-cancelada'

const HTTP: Record<string, number> = { SEM_MOTIVO: 422, NAO_ENCONTRADA: 404, NAO_CANCELADA: 409, NAO_EXIGIDA_PELA_ARVORE: 409, CANCELADA_PELO_SISTEMA: 409, TERMINAL: 409, NAO_TERMINAL: 409 }

export async function POST(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const { usuario, erro } = await exigirPermissao(request, 'tarefas.editar')
  if (erro) return erro
  const processoId = Number((await ctx.params).processoId)
  if (!Number.isInteger(processoId) || processoId <= 0) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })
  const b = await request.json().catch(() => ({}))
  const tarefaId = Number(b?.tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefaId é obrigatório' }, { status: 400 })
  const r = await reabrirCertidaoCancelada({ processoId, tarefaId, autorId: usuario.userId, motivo: typeof b?.motivo === 'string' ? b.motivo.slice(0, 300) : '' })
  if (!r.ok) return NextResponse.json({ error: r.mensagem, codigo: r.codigo, mensagem: r.mensagem }, { status: HTTP[r.codigo] ?? 422 })
  return NextResponse.json({ ok: true, tarefaId: r.tarefaId, modo: r.modo })
}
