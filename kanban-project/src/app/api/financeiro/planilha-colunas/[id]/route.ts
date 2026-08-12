// Ativar/inativar e renomear UMA coluna. Inativar ESCONDE — não apaga serviço,
// preço nem custo histórico; reativar traz tudo de volta.
import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { definirAtiva, definirRotulo, removerColuna } from "@/lib/financeiro/leitura/planilha-colunas"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "financeiro.coluna_editar")
  if (erro) return erro
  const id = Number((await params).id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 })
  const body = await request.json().catch(() => ({}))
  if (typeof body?.ativa === "boolean") await definirAtiva(id, body.ativa)
  if (body?.rotuloOverride !== undefined) await definirRotulo(id, body.rotuloOverride)
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "financeiro.coluna_excluir")
  if (erro) return erro
  const id = Number((await params).id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 })
  await removerColuna(id)
  return NextResponse.json({ ok: true })
}
