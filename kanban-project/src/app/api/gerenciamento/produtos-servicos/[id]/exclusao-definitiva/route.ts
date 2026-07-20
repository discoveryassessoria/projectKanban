// src/app/api/gerenciamento/produtos-servicos/[id]/exclusao-definitiva/route.ts
// EXCLUSÃO DEFINITIVA de Serviço — requer permissão sistema.exclusaoDefinitiva (validado no
// backend). GET: prévia (config/preços/lançamentos + blockers de uso real). DELETE: executa com
// confirmação forte + cascata controlada de dados de teste.
import { NextRequest, NextResponse } from "next/server"
import { exigirPermissao } from "@/src/lib/verificar-permissao"
import { analisarExclusaoServico, excluirServicoDefinitivo, FRASE_CONFIRMACAO } from "@/src/services/exclusao-definitiva"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirPermissao(request, "sistema.exclusaoDefinitiva")
  if (erro) return erro
  const { id } = await params
  const servicoId = Number(id)
  if (!servicoId || Number.isNaN(servicoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const analise = await analisarExclusaoServico(servicoId)
  if (!analise) return NextResponse.json({ error: "Serviço não encontrado" }, { status: 404 })
  return NextResponse.json({ ...analise, fraseConfirmacao: FRASE_CONFIRMACAO })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { usuario, erro } = await exigirPermissao(request, "sistema.exclusaoDefinitiva")
  if (erro) return erro
  const { id } = await params
  const servicoId = Number(id)
  if (!servicoId || Number.isNaN(servicoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  if (String(body?.confirmacao ?? "").trim() !== FRASE_CONFIRMACAO) {
    return NextResponse.json({ error: `Confirmação inválida. Digite exatamente "${FRASE_CONFIRMACAO}".` }, { status: 400 })
  }
  try {
    const r = await excluirServicoDefinitivo(servicoId, { usuarioId: usuario.userId, motivo: typeof body?.motivo === "string" ? body.motivo : null })
    return NextResponse.json({ ok: true, excluidoDefinitivo: true, ...r })
  } catch (e) {
    const err = e as { code?: string; message?: string; blockers?: unknown; lancamentos?: unknown }
    if (err.code === "NAO_ENCONTRADA") return NextResponse.json({ error: err.message }, { status: 404 })
    if (err.code === "USO_REAL" || err.code === "USO_REAL_RACE") return NextResponse.json({ error: err.message, blockers: err.blockers, lancamentos: err.lancamentos }, { status: 409 })
    console.error("[DELETE exclusao-definitiva servico]", e)
    return NextResponse.json({ error: err.message ?? "Erro ao excluir definitivamente" }, { status: 500 })
  }
}
