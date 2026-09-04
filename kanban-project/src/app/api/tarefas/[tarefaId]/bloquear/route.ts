// src/app/api/tarefas/[tarefaId]/bloquear/route.ts
// CP-4D — bloqueia a Tarefa (v2) e reflete no Passo (TaskStepSyncService).
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { negarSeNaoForDonoDaTarefa } from "@/src/lib/tarefa-acesso"
import { extrairUsuarioKanban } from "@/lib/kanban-auth"
import { bloquearTarefa } from "@/src/services/task-step-sync"

export async function POST(request: NextRequest, { params }: { params: Promise<{ tarefaId: string }> }) {
  const erro = await verificarPermissao(request, "tarefas.bloquear")
  if (erro) return erro
  const { tarefaId } = await params
  const id = parseInt(tarefaId)
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const tarefa = await prisma.tarefa.findUnique({ where: { id }, select: { responsavelId: true } })
  if (!tarefa) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 })
  // 🔒 E4 — mesma régua de `negarSeNaoForDonoDaTarefa`: sem isto, qualquer
  // operador com `tarefas.bloquear` bloqueava a tarefa de qualquer colega.
  const negado = await negarSeNaoForDonoDaTarefa(request, tarefa.responsavelId)
  if (negado) return negado

  try {
    const body = await request.json().catch(() => ({}))
    // IDENTIDADE DO SERVIDOR, não do corpo — `usuarioId` no corpo deixava o
    // cliente assinar a ação em nome de outra pessoa na auditoria.
    const usuario = await extrairUsuarioKanban(request)
    const r = await bloquearTarefa(id, { origem: "USER", usuarioId: usuario?.userId, motivoCodigo: body.motivoCodigo, justificativa: body.justificativa, correlationId: body.correlationId })
    return NextResponse.json(r, { status: r.success ? 200 : 409 })
  } catch (error) {
    console.error("Erro ao bloquear tarefa:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
