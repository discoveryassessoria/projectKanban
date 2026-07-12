// src/app/api/processos/[processoId]/phase/return/route.ts
// CP-4F — retorno CONTROLADO a uma fase anterior (runtime v2), ex.: voltar à
// Genealogia quando um documento não é localizado. Novo ciclo da fase-alvo.
// Requer workflow.retornarFase + faseAlvo + justificativa + código de motivo.
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { returnPhase } from "@/src/lib/motor/phase-advance"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (!temPermissao(usuario.permissoes, "workflow.retornarFase")) {
    return NextResponse.json({ error: "Sem permissão para retorno controlado", permissao: "workflow.retornarFase" }, { status: 403 })
  }

  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const resultado = await returnPhase(processoId, {
      faseAlvo: String(body?.faseAlvo ?? ""),
      justificativa: String(body?.justificativa ?? ""),
      motivoCodigo: String(body?.motivoCodigo ?? ""),
      correlationId: body?.correlationId, causationId: body?.causationId,
      solicitadoPorId: usuario.userId, origem: "return-route",
    })

    const status = resultado.success ? 200
      : resultado.resultado === "CONFLITO" ? 409
      : resultado.code === "JUSTIFICATIVA_OBRIGATORIA" || resultado.code === "MOTIVO_OBRIGATORIO"
        || resultado.code === "FASE_ALVO_INVALIDA" || resultado.code === "FASE_ALVO_NAO_ANTERIOR" ? 422
      : 400
    return NextResponse.json(resultado, { status })
  } catch (error) {
    console.error("[POST .../phase/return]", error)
    return NextResponse.json({ error: "Erro interno no retorno de fase" }, { status: 500 })
  }
}
