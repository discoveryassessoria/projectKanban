// src/app/api/tarefas/[tarefaId]/bloquear/route.ts
// CP-4D — bloqueia a Tarefa (v2) e reflete no Passo (TaskStepSyncService).
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { bloquearTarefa } from "@/src/services/task-step-sync"

export async function POST(request: NextRequest, { params }: { params: Promise<{ tarefaId: string }> }) {
  const erro = await verificarPermissao(request, "tarefas.bloquear")
  if (erro) return erro
  const { tarefaId } = await params
  const id = parseInt(tarefaId)
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  try {
    const body = await request.json().catch(() => ({}))
    const r = await bloquearTarefa(id, { origem: body.origem ?? "USER", usuarioId: body.usuarioId, motivoCodigo: body.motivoCodigo, justificativa: body.justificativa, correlationId: body.correlationId })
    return NextResponse.json(r, { status: r.success ? 200 : 409 })
  } catch (error) {
    console.error("Erro ao bloquear tarefa:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
