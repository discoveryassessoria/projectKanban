// Reordenar. A chave de ordenação é POSIÇÃO — nunca nome.
import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { reordenarColunas } from "@/lib/financeiro/leitura/planilha-colunas"

export async function PATCH(request: NextRequest) {
  const erro = await verificarPermissao(request, "financeiro.coluna_editar")
  if (erro) return erro
  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isInteger) : null
  if (!ids?.length) return NextResponse.json({ error: "ids é obrigatório" }, { status: 400 })
  await reordenarColunas(ids)
  return NextResponse.json({ ok: true })
}
