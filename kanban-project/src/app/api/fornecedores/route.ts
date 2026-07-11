// src/app/api/fornecedores/route.ts
// @deprecated CP-2 — ROTA LEGADA. Use a canônica /api/gerenciamento/fornecedores.
// Mantida temporariamente como ADAPTADOR sobre o MESMO service canônico
// (src/services/fornecedor.ts). Não reimplementa CRUD nem validação.
// Preserva o envelope de resposta histórico (array + totais).

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { listarFornecedores, criarFornecedor } from "@/src/services/fornecedor"

// GET - Listar (com busca/ativo/totais — envelope legado: array)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const ativoParam = searchParams.get("ativo")
    const busca = searchParams.get("busca")
    const fornecedores = await listarFornecedores({
      busca: busca || undefined,
      ativo: ativoParam !== null ? ativoParam === "true" : undefined,
      comTotais: true,
    })
    return NextResponse.json(fornecedores)
  } catch (error) {
    console.error("Erro ao listar fornecedores:", error)
    return NextResponse.json({ error: "Erro ao listar fornecedores" }, { status: 500 })
  }
}

// POST - Criar (envelope legado: fornecedor "cru")
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "financeiro.ver")
  if (erro) return erro
  try {
    const body = await request.json()
    const fornecedor = await criarFornecedor(body)
    return NextResponse.json(fornecedor, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VALIDATION:")) {
      return NextResponse.json({ error: error.message.replace("VALIDATION:", "") }, { status: 400 })
    }
    console.error("Erro ao criar fornecedor:", error)
    return NextResponse.json({ error: "Erro ao criar fornecedor" }, { status: 500 })
  }
}
