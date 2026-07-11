// src/app/api/fornecedores/[id]/route.ts
// @deprecated CP-2 — ROTA LEGADA. Use a canônica /api/gerenciamento/fornecedores/[id].
// Adaptador sobre o MESMO service canônico. Preserva o comportamento histórico:
// DELETE desativa (em vez de bloquear) quando há contas vinculadas.

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { obterFornecedor, atualizarFornecedor, removerFornecedor } from "@/src/services/fornecedor"

// GET - Buscar por ID (com últimas contas)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    const fornecedor = await obterFornecedor(id, { incluirContas: true })
    if (!fornecedor) return NextResponse.json({ error: "Fornecedor não encontrado" }, { status: 404 })
    return NextResponse.json(fornecedor)
  } catch (error) {
    console.error("Erro ao buscar fornecedor:", error)
    return NextResponse.json({ error: "Erro ao buscar fornecedor" }, { status: 500 })
  }
}

// PUT - Atualizar (envelope legado: fornecedor "cru")
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const erro = await verificarPermissao(request, "financeiro.ver")
  if (erro) return erro
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    const body = await request.json()
    const fornecedor = await atualizarFornecedor(id, body)
    if (!fornecedor) return NextResponse.json({ error: "Fornecedor não encontrado" }, { status: 404 })
    return NextResponse.json(fornecedor)
  } catch (error) {
    console.error("Erro ao atualizar fornecedor:", error)
    return NextResponse.json({ error: "Erro ao atualizar fornecedor" }, { status: 500 })
  }
}

// DELETE - Excluir (ou desativar se possuir contas vinculadas — comportamento legado)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const erro = await verificarPermissao(request, "financeiro.ver")
  if (erro) return erro
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    const r = await removerFornecedor(id, { seEmUso: "deactivate" })
    if (r.status === "not_found") return NextResponse.json({ error: "Fornecedor não encontrado" }, { status: 404 })
    if (r.status === "deactivated") {
      return NextResponse.json({ message: "Fornecedor desativado (possui contas vinculadas)" })
    }
    return NextResponse.json({ message: "Fornecedor excluído com sucesso" })
  } catch (error) {
    console.error("Erro ao excluir fornecedor:", error)
    return NextResponse.json({ error: "Erro ao excluir fornecedor" }, { status: 500 })
  }
}
