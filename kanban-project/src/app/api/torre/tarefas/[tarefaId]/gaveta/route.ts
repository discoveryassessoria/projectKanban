// src/app/api/torre/tarefas/[tarefaId]/gaveta/route.ts
// ============================================================================
// TORRE — O QUE A GAVETA DA TAREFA MOSTRA ALÉM DA LINHA (Torre nova, aba Tarefas, 01/10/2026).
//
//   GET /api/torre/tarefas/{tarefaId}/gaveta
//
// "Passos desta certidão" e "Histórico desta certidão" são REAIS: os passos são os da unidade de trabalho da tarefa (a
// certidão — não os da fase inteira) e o histórico é a linha do tempo do dossiê (`dossieDaTarefa`: auditoria da tarefa,
// eventos do workflow, observações, anexos e protocolos), a MESMA que o drawer documental usa — uma história só. Nenhum
// passo ou fato de exemplo: sem registro, a lista vem vazia e a tela diz isso.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { dossieDaTarefa } from '@/lib/operacional/tarefa-projecoes'
import { historicoDaGaveta } from '@/src/services/torre-gaveta-historico'

export async function GET(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const d = await dossieDaTarefa(tarefaId)
  if (!d) return NextResponse.json({ error: 'tarefa não encontrada' }, { status: 404 })

  const historico = await historicoDaGaveta(d, new Date())

  return NextResponse.json({
    taskId: tarefaId,
    etapas: d.etapas.map((e) => ({ ordem: e.ordem, titulo: e.titulo, status: e.status, atual: e.atual, concluidaEm: e.concluidaEm })),
    historico,
  })
}
