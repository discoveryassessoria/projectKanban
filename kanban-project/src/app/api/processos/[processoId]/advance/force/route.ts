// src/app/api/processos/[processoId]/advance/force/route.ts
// CP-4F — avanço FORÇADO (runtime v2). Ignora pendências BLOCKING, mas EXIGE
// permissão específica workflow.forcarAvanco + justificativa + código de motivo.
// Não basta possuir permissão administrativa genérica.
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { forceAdvance } from "@/src/lib/motor/phase-advance"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (!temPermissao(usuario.permissoes, "workflow.forcarAvanco")) {
    return NextResponse.json({ error: "Sem permissão para forçar avanço", permissao: "workflow.forcarAvanco" }, { status: 403 })
  }

  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const resultado = await forceAdvance(processoId, {
      justificativa: String(body?.justificativa ?? ""),
      motivoCodigo: String(body?.motivoCodigo ?? ""),
      correlationId: body?.correlationId, causationId: body?.causationId,
      solicitadoPorId: usuario.userId, origem: "force-route",
    })

    const status = resultado.success ? 200
      : resultado.resultado === "CONFLITO" ? 409
      : resultado.code === "JUSTIFICATIVA_OBRIGATORIA" || resultado.code === "MOTIVO_OBRIGATORIO" ? 422
      : 400
    return NextResponse.json(resultado, { status })
  } catch (error) {
    console.error("[POST .../advance/force]", error)
    return NextResponse.json({ error: "Erro interno no avanço forçado" }, { status: 500 })
  }
}
