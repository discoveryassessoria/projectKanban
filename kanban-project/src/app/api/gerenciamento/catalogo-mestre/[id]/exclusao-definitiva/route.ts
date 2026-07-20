// src/app/api/gerenciamento/catalogo-mestre/[id]/exclusao-definitiva/route.ts
// EXCLUSÃO DEFINITIVA de item do Catálogo Mestre — SOMENTE ADMIN (limpeza explícita de dados de
// teste). GET: prévia. DELETE: executa com confirmação forte. Nunca destrói dados reais.
import { NextRequest, NextResponse } from "next/server"
import { exigirAdmin } from "@/src/lib/verificar-permissao"
import { analisarExclusaoItemCatalogo, excluirItemCatalogoDefinitivo, FRASE_CONFIRMACAO } from "@/src/services/exclusao-definitiva"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin(request)
  if (erro) return erro
  const { id } = await params
  const itemId = Number(id)
  if (!itemId || Number.isNaN(itemId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const analise = await analisarExclusaoItemCatalogo(itemId)
  if (!analise) return NextResponse.json({ error: "Item de catálogo não encontrado" }, { status: 404 })
  return NextResponse.json({ ...analise, fraseConfirmacao: FRASE_CONFIRMACAO })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { usuario, erro } = await exigirAdmin(request)
  if (erro) return erro
  const { id } = await params
  const itemId = Number(id)
  if (!itemId || Number.isNaN(itemId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  if (String(body?.confirmacao ?? "").trim() !== FRASE_CONFIRMACAO) {
    return NextResponse.json({ error: `Confirmação inválida. Digite exatamente "${FRASE_CONFIRMACAO}".` }, { status: 400 })
  }
  try {
    const r = await excluirItemCatalogoDefinitivo(itemId, { usuarioId: usuario.userId, motivo: typeof body?.motivo === "string" ? body.motivo : null })
    return NextResponse.json({ ok: true, excluidoDefinitivo: true, ...r })
  } catch (e) {
    const err = e as { code?: string; message?: string; blockers?: unknown }
    if (err.code === "NAO_ENCONTRADA") return NextResponse.json({ error: err.message }, { status: 404 })
    if (err.code === "USO_REAL" || err.code === "USO_REAL_RACE") return NextResponse.json({ error: err.message, blockers: err.blockers }, { status: 409 })
    console.error("[DELETE exclusao-definitiva item]", e)
    return NextResponse.json({ error: err.message ?? "Erro ao excluir definitivamente" }, { status: 500 })
  }
}
