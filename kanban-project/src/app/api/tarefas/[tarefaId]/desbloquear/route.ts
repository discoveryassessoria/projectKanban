// src/app/api/tarefas/[tarefaId]/desbloquear/route.ts
// CP-4D — desbloqueia a Tarefa (v2) e restaura o Passo ao estado anterior válido.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { desbloquearTarefa } from "@/src/services/task-step-sync"

export async function POST(request: NextRequest, { params }: { params: Promise<{ tarefaId: string }> }) {
  const erro = await verificarPermissao(request, "tarefas.bloquear")
  if (erro) return erro
  const { tarefaId } = await params
  const id = parseInt(tarefaId)
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  try {
    const body = await request.json().catch(() => ({}))
    const r = await desbloquearTarefa(id, { origem: body.origem ?? "USER", usuarioId: body.usuarioId, correlationId: body.correlationId })
    return NextResponse.json(r, { status: r.success ? 200 : 409 })
  } catch (error) {
    console.error("Erro ao desbloquear tarefa:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
