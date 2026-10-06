// POST /api/sincronizacao-registral/:logId/desfazer — devolve o valor que a árvore tinha antes de UMA sincronização (só se o campo não mudou depois).
import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { desfazerSincronizacao } from "@/src/services/genealogia/sincronizar-com-registro"

export async function POST(request: NextRequest, { params }: { params: Promise<{ logId: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.editar")
  if (semPermissao) return semPermissao
  const logId = Number.parseInt((await params).logId)
  if (!Number.isInteger(logId) || logId <= 0) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const usuario = await extrairUsuarioComPermissoes(request)
  const r = await desfazerSincronizacao(logId, usuario?.userId ?? null)
  if (!r.ok) return NextResponse.json({ ok: false, codigo: r.codigo, error: r.mensagem }, { status: r.codigo === "NAO_ENCONTRADO" ? 404 : 409 })
  return NextResponse.json({ ok: true })
}
