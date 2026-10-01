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
import { prisma } from '@/lib/prisma'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { dossieDaTarefa } from '@/lib/operacional/tarefa-projecoes'
import { rotuloDoMomento } from '@/lib/operacional/historico-filtros'

const LIMITE_DO_HISTORICO = 12

export async function GET(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) return NextResponse.json({ error: 'tarefa inválida' }, { status: 400 })
  const d = await dossieDaTarefa(tarefaId)
  if (!d) return NextResponse.json({ error: 'tarefa não encontrada' }, { status: 404 })

  const agora = new Date()
  // Quem fez cada fato da auditoria da tarefa (o `montarTimeline` não carrega o autor desse tipo): uma consulta em lote.
  const autores = new Map<number, string | null>()
  const ids = d.historico.map((h) => h.id)
  if (ids.length) {
    const logs = await prisma.logAuditoria.findMany({ where: { id: { in: ids } }, select: { id: true, usuarioId: true } })
    const usuarioIds = [...new Set(logs.map((l) => l.usuarioId).filter((x): x is number => x != null))]
    const nomes = new Map((usuarioIds.length ? await prisma.usuario.findMany({ where: { id: { in: usuarioIds } }, select: { id: true, nome: true } }) : []).map((u) => [u.id, u.nome]))
    for (const l of logs) autores.set(l.id, l.usuarioId != null ? nomes.get(l.usuarioId) ?? null : null)
  }
  const autorPorEmETexto = new Map<string, string | null>()
  for (const h of d.historico) autorPorEmETexto.set(`${h.criadoEm.toISOString()}|${h.descricao ?? h.acao}`, autores.get(h.id) ?? null)

  return NextResponse.json({
    taskId: tarefaId,
    etapas: d.etapas.map((e) => ({ ordem: e.ordem, titulo: e.titulo, status: e.status, atual: e.atual, concluidaEm: e.concluidaEm })),
    historico: d.timeline.slice(0, LIMITE_DO_HISTORICO).map((f) => ({
      em: f.em,
      quando: rotuloDoMomento(f.em, agora).replace(', ', ' '),
      texto: f.texto,
      autor: f.autor ?? autorPorEmETexto.get(`${f.em}|${f.texto}`) ?? null,
    })),
  })
}
