// src/app/api/tarefas/[tarefaId]/cancelar/route.ts
// CP-4D — cancela a Tarefa (v2) com política de destino explícita do Passo.
// Exige motivoCodigo + justificativa + politica (REFAZER|INVALIDO|SUPERSESSAO|ADMINISTRATIVO).
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { negarSeNaoForDonoDaTarefa } from "@/src/lib/tarefa-acesso"
import { extrairUsuarioKanban } from "@/lib/kanban-auth"
import { cancelarTarefa } from "@/src/services/task-step-sync"

export async function POST(request: NextRequest, { params }: { params: Promise<{ tarefaId: string }> }) {
  const erro = await verificarPermissao(request, "tarefas.excluir")
  if (erro) return erro
  const { tarefaId } = await params
  const id = parseInt(tarefaId)
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const tarefa = await prisma.tarefa.findUnique({ where: { id }, select: { responsavelId: true } })
  if (!tarefa) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 })
  // 🔒 E4 — mesma régua de `negarSeNaoForDonoDaTarefa`.
  const negado = await negarSeNaoForDonoDaTarefa(request, tarefa.responsavelId)
  if (negado) return negado

  try {
    const body = await request.json().catch(() => ({}))
    const usuario = await extrairUsuarioKanban(request)
    const r = await cancelarTarefa(id, {
      origem: "USER", usuarioId: usuario?.userId,
      motivoCodigo: body.motivoCodigo, justificativa: body.justificativa, politica: body.politica,
      correlationId: body.correlationId,
    })
    return NextResponse.json(r, { status: r.success ? 200 : 409 })
  } catch (error) {
    console.error("Erro ao cancelar tarefa:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
