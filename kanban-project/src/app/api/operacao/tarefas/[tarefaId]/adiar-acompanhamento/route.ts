// src/app/api/operacao/tarefas/[tarefaId]/adiar-acompanhamento/route.ts
// ============================================================================
// ADIAR ACOMPANHAMENTO — porta da Operação (Etapa 3, tela v3, 26/09/2026),
// pelo ID DA TAREFA. "Adiar +3 d" do protótipo: NUNCA mexe no prazo oficial
// da tarefa, só na dimensão D (acompanhamento) da subtarefa corrente.
//
//   POST /api/operacao/tarefas/{tarefaId}/adiar-acompanhamento
//   body: { motivo: string (10–300 chars), dias?: number (1–15, default 3) }
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
  // 10–300 caracteres — contrato do modal "Adiar" (Torre de Controle, Bloco B,
  // 29/09/2026); antes era só ">= 3", herança do window.prompt sem regra real.
  if (motivo.length < 10 || motivo.length > 300) {
    return NextResponse.json(
      { ok: false, code: "MOTIVO_INVALIDO", mensagem: "O motivo precisa ter entre 10 e 300 caracteres." },
      { status: 400 },
    )
  }
  const diasRaw = Number(body.dias)
  const dias = Number.isInteger(diasRaw) && diasRaw >= 1 && diasRaw <= 15 ? diasRaw : 3

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
