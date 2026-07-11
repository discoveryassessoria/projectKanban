// src/app/api/gerenciamento/fornecedores/[id]/route.ts
// ROTA CANÔNICA (PUT/DELETE). Delega ao service único. DELETE bloqueia (409)
// se houver contas a pagar (política canônica).
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { atualizarFornecedor, removerFornecedor, s } from "@/src/services/fornecedor"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const b = await request.json()
    if (b.nome !== undefined && !s(b.nome)) return NextResponse.json({ error: "Nome não pode ficar vazio" }, { status: 400 })
    if (b.tipo !== undefined && !s(b.tipo)) return NextResponse.json({ error: "Tipo (categoria) é obrigatório" }, { status: 400 })

    const fornecedor = await atualizarFornecedor(id, b)
    if (!fornecedor) return NextResponse.json({ error: "Fornecedor não encontrado" }, { status: 404 })
    return NextResponse.json({ fornecedor })
  } catch (error) {
    console.error("Erro ao atualizar fornecedor:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id: idParam } = await params
    const id = Number(idParam)
    if (!id || Number.isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const r = await removerFornecedor(id, { seEmUso: "block" })
    if (r.status === "not_found") return NextResponse.json({ error: "Fornecedor não encontrado" }, { status: 404 })
    if (r.status === "in_use") {
      return NextResponse.json(
        { error: `Fornecedor em uso por ${r.count} conta(s) a pagar. Desative-o no lugar.` },
        { status: 409 }
      )
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Erro ao excluir fornecedor:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
