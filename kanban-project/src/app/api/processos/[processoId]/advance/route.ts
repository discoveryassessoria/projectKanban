// src/app/api/processos/[processoId]/advance/route.ts
// CP-4F — avanço NORMAL de fase (runtime v2) via serviço canônico PhaseAdvanceService.
// Requer permissão workflow.avancar. NÃO escreve faseAtualKey diretamente.
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { advance } from "@/src/lib/motor/phase-advance"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (!temPermissao(usuario.permissoes, "workflow.avancar")) {
    return NextResponse.json({ error: "Sem permissão para avançar de fase", permissao: "workflow.avancar" }, { status: 403 })
  }

  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const resultado = await advance(processoId, {
      correlationId: body?.correlationId, causationId: body?.causationId,
      solicitadoPorId: usuario.userId, origem: "advance-route",
    })

    const status = resultado.success ? 200 : resultado.resultado === "CONFLITO" ? 409 : resultado.resultado === "BLOQUEADO" ? 422 : 400
    return NextResponse.json(resultado, { status })
  } catch (error) {
    console.error("[POST .../advance]", error)
    return NextResponse.json({ error: "Erro interno no avanço de fase" }, { status: 500 })
  }
}
