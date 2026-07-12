// src/app/api/processos/[processoId]/phase/reopen/route.ts
// CP-4F — reabertura da fase atual (runtime v2): novo ciclo, supersede o ciclo
// anterior (histórico preservado). Requer workflow.reabrirFase + justificativa + motivo.
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { reopenPhase } from "@/src/lib/motor/phase-advance"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (!temPermissao(usuario.permissoes, "workflow.reabrirFase")) {
    return NextResponse.json({ error: "Sem permissão para reabrir fase", permissao: "workflow.reabrirFase" }, { status: 403 })
  }

  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const resultado = await reopenPhase(processoId, {
      justificativa: String(body?.justificativa ?? ""),
      motivoCodigo: String(body?.motivoCodigo ?? ""),
      correlationId: body?.correlationId, causationId: body?.causationId,
      solicitadoPorId: usuario.userId, origem: "reopen-route",
    })

    const status = resultado.success ? 200
      : resultado.resultado === "CONFLITO" ? 409
      : resultado.code === "JUSTIFICATIVA_OBRIGATORIA" || resultado.code === "MOTIVO_OBRIGATORIO" ? 422
      : 400
    return NextResponse.json(resultado, { status })
  } catch (error) {
    console.error("[POST .../phase/reopen]", error)
    return NextResponse.json({ error: "Erro interno na reabertura de fase" }, { status: 500 })
  }
}
