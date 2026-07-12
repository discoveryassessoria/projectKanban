// src/app/api/processos/[processoId]/workflow-runtime/route.ts
// CP-4G — ativação controlada do runtime v2 por processo.
//   GET  → preparação/dry-run de compatibilidade (não escreve).
//   POST → tentativa de ativação (só efetiva com kill switch ON + todos critérios).
// Ambas gated por workflow.ativarV2. NÃO ativa nada com kill switch OFF (default).
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { prepararAtivacaoV2, ativarProcessoV2 } from "@/src/services/workflow-activation"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (!temPermissao(usuario.permissoes, "workflow.ativarV2")) {
    return NextResponse.json({ error: "Sem permissão", permissao: "workflow.ativarV2" }, { status: 403 })
  }
  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const prep = await prepararAtivacaoV2(processoId)
    if ("erro" in prep) return NextResponse.json(prep, { status: 404 })
    return NextResponse.json(prep, { status: 200 })
  } catch (error) {
    console.error("[GET .../workflow-runtime]", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (!temPermissao(usuario.permissoes, "workflow.ativarV2")) {
    return NextResponse.json({ error: "Sem permissão", permissao: "workflow.ativarV2" }, { status: 403 })
  }
  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const body = await request.json().catch(() => ({}))
    if (!String(body?.justificativa ?? "").trim()) {
      return NextResponse.json({ error: "Justificativa obrigatória" }, { status: 422 })
    }
    const r = await ativarProcessoV2(processoId, {
      justificativa: String(body.justificativa), motivoCodigo: body?.motivoCodigo, solicitadoPorId: usuario.userId,
    })
    if ("erro" in r) return NextResponse.json(r, { status: 404 })
    // ativado=false não é erro do cliente: é o comportamento seguro (kill switch OFF).
    return NextResponse.json(r, { status: r.ativado ? 200 : 409 })
  } catch (error) {
    console.error("[POST .../workflow-runtime]", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
