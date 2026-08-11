// src/app/api/tarefas/[tarefaId]/dossie/route.ts
// ============================================================================
// O DOSSIÊ DA TAREFA — "por que eu existo?" respondido por completo.
//
// PROJEÇÃO, não entidade: lê a mesma `Tarefa` que todas as outras telas. Existe
// para que ninguém precise abrir quatro telas (ou o banco) para descobrir por
// que uma tarefa está onde está.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { dossieDaTarefa } from '@/lib/operacional/tarefa-projecoes'

export async function GET(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const erro = await verificarPermissao(request, 'tarefas.ver')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) {
    return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  }
  const dossie = await dossieDaTarefa(tarefaId)
  if (!dossie) return NextResponse.json({ error: 'tarefa não encontrada' }, { status: 404 })
  return NextResponse.json({ dossie })
}
