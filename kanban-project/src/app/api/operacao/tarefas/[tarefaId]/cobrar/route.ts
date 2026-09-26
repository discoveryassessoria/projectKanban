// src/app/api/operacao/tarefas/[tarefaId]/cobrar/route.ts
// ============================================================================
// COBRAR — porta da Operação (Etapa 3, tela v3, 26/09/2026), pelo ID DA
// TAREFA (a tela não conhece stepInstanceId nem subtaskKey — só o taskId).
//
//   POST /api/operacao/tarefas/{tarefaId}/cobrar
//
// Resolve a subtarefa CORRENTE por baixo e delega para `registrarCobranca`
// (`src/services/subtarefas-da-etapa.ts`) — a mesma porta que
// `/api/workflow-step-instances/[id]/subtarefas/[key]/cobranca` já usa; esta
// rota é só uma fachada por taskId, nunca uma segunda implementação.
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { negarSeNaoForDonoDaTarefaPorId } from "@/src/lib/tarefa-acesso"
import { registrarCobranca, subtarefaCorrenteDaTarefa } from "@/src/services/subtarefas-da-etapa"

const CANAIS_VALIDOS = new Set(["EMAIL", "TELEFONE", "PORTAL", "CORREIO", "PRESENCIAL", "OUTRO"])

export async function POST(request: NextRequest, ctx: { params: Promise<{ tarefaId: string }> }) {
  const tarefaId = Number((await ctx.params).tarefaId)
  if (!Number.isInteger(tarefaId) || tarefaId <= 0) {
    return NextResponse.json({ error: "tarefa inválida" }, { status: 400 })
  }

  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })

  const negado = await negarSeNaoForDonoDaTarefaPorId(request, tarefaId)
  if (negado) return negado

  const corrente = await subtarefaCorrenteDaTarefa(tarefaId)
  if (!corrente) {
    return NextResponse.json(
      { ok: false, code: "SEM_SUBTAREFA_CORRENTE", mensagem: "Esta tarefa não tem subtarefa em aberto para cobrar." },
      { status: 422 },
    )
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const canal = String(body.canal ?? "").toUpperCase()
  if (!CANAIS_VALIDOS.has(canal)) {
    return NextResponse.json(
      { ok: false, code: "CANAL_INVALIDO", mensagem: `Canal deve ser um de: ${[...CANAIS_VALIDOS].join(", ")}.` },
      { status: 400 },
    )
  }

  const r = await registrarCobranca({
    stepInstanceId: corrente.stepInstanceId,
    subtaskKey: corrente.subtaskKey,
    canal,
    observacao: typeof body.observacao === "string" ? body.observacao.trim() || null : null,
    documentoId: Number.isFinite(Number(body.documentoId)) ? Number(body.documentoId) : null,
    orgaoId: Number.isFinite(Number(body.orgaoId)) ? Number(body.orgaoId) : null,
    registradoPorId: usuario.userId,
  })
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}
