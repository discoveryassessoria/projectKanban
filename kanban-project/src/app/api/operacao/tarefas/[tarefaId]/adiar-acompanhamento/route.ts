// src/app/api/operacao/tarefas/[tarefaId]/adiar-acompanhamento/route.ts
// ============================================================================
// ADIAR ACOMPANHAMENTO — porta da Operação (Etapa 3, tela v3, 26/09/2026),
// pelo ID DA TAREFA. "Adiar +3 d" do protótipo: NUNCA mexe no prazo oficial
// da tarefa, só na dimensão D (acompanhamento) da subtarefa corrente.
//
//   POST /api/operacao/tarefas/{tarefaId}/adiar-acompanhamento
//   body: { motivo: string (obrigatório), dias?: number (default 3) }
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { negarSeNaoForDonoDaTarefaPorId } from "@/src/lib/tarefa-acesso"
import { adiarAcompanhamento, subtarefaCorrenteDaTarefa } from "@/src/services/subtarefas-da-etapa"

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) {
    return NextResponse.json({ error: "tarefa inválida" }, { status: 400 })
  }

  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })

  const negado = await negarSeNaoForDonoDaTarefaPorId(request, tarefaId)
  if (negado) return negado

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const motivo = typeof body.motivo === "string" ? body.motivo.trim() : ""
  if (motivo.length < 3) {
    return NextResponse.json(
      { ok: false, code: "MOTIVO_OBRIGATORIO", mensagem: "Explique por que o acompanhamento está sendo adiado." },
      { status: 400 },
    )
  }
  const dias = Number.isFinite(Number(body.dias)) && Number(body.dias) > 0 ? Number(body.dias) : 3

  const corrente = await subtarefaCorrenteDaTarefa(tarefaId)
  if (!corrente) {
    return NextResponse.json(
      { ok: false, code: "SEM_SUBTAREFA_CORRENTE", mensagem: "Esta tarefa não tem subtarefa em aberto para adiar." },
      { status: 422 },
    )
  }

  const r = await adiarAcompanhamento({
    stepInstanceId: corrente.stepInstanceId,
    subtaskKey: corrente.subtaskKey,
    motivo,
    dias,
    registradoPorId: usuario.userId,
  })
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}
