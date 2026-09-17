// src/app/api/workflow-step-instances/[id]/subtarefas/[key]/reabrir/route.ts
//
// REABRIR UMA SUBTAREFA — só o ADMINISTRADOR.
//
// Decisão explícita do usuário (16/09/2026): "todos os usuários precisam ver
// as fases realizadas e as subtarefas... o que muda é que ela [a Daniela] não
// pode reabrir a tarefa, somente o adm pode fazer isso." Diferente da
// reabertura de PASSO (`.../reabrir`, permissão por perfil via cadastro),
// aqui a régua é literal por TIPO de usuário — não por permissão concedível,
// de propósito: ninguém deveria poder conceder isso a si mesmo via perfil.
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { reabrirSubtarefa, planejarReaberturaDeSubtarefa } from "@/src/services/execucao-da-subtarefa"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; key: string }> },
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })
  if (usuario.tipo !== "admin") {
    return NextResponse.json(
      { ok: false, code: "SOMENTE_ADMIN", mensagem: "Reabrir uma subtarefa é ação exclusiva do administrador." },
      { status: 403 },
    )
  }

  const { id: idParam, key } = await params
  const stepInstanceId = Number(idParam)
  if (!Number.isFinite(stepInstanceId) || !key) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 })
  }

  const plano = await planejarReaberturaDeSubtarefa(stepInstanceId, key)
  if (!plano) return NextResponse.json({ error: "Subtarefa não encontrada." }, { status: 404 })
  return NextResponse.json({ ok: true, plano })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; key: string }> },
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })
  if (usuario.tipo !== "admin") {
    return NextResponse.json(
      { ok: false, code: "SOMENTE_ADMIN", mensagem: "Reabrir uma subtarefa é ação exclusiva do administrador." },
      { status: 403 },
    )
  }

  const { id: idParam, key } = await params
  const stepInstanceId = Number(idParam)
  if (!Number.isFinite(stepInstanceId) || !key) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 })
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const justificativa = typeof body.justificativa === "string" ? body.justificativa.trim() : ""
  if (justificativa.length < 5) {
    return NextResponse.json(
      { ok: false, code: "JUSTIFICATIVA_OBRIGATORIA", mensagem: "Explique por que esta subtarefa está sendo reaberta." },
      { status: 400 },
    )
  }

  const r = await reabrirSubtarefa({
    stepInstanceId,
    subtaskKey: key,
    actorId: usuario.userId,
    justificativa,
    comDependentes: body.comDependentes === true,
    correlationId: typeof body.correlationId === "string" ? body.correlationId.slice(0, 120) : undefined,
  })
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}
