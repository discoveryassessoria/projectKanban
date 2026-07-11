// src/app/api/gerenciamento/fornecedores/route.ts
// ROTA CANÔNICA de Fornecedor (Regra 1/9). Delega ao service único
// src/services/fornecedor.ts — sem CRUD/validação duplicados.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { listarFornecedores, criarFornecedor, s } from "@/src/services/fornecedor"

// GET - Listar
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const fornecedores = await listarFornecedores()
    return NextResponse.json({ fornecedores })
  } catch (error) {
    console.error("Erro ao listar fornecedores:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

// POST - Criar (contrato canônico: nome e tipo obrigatórios)
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const b = await request.json()
    if (!s(b.nome)) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    if (!s(b.tipo)) return NextResponse.json({ error: "Tipo (categoria) é obrigatório" }, { status: 400 })
    const fornecedor = await criarFornecedor(b)
    return NextResponse.json({ fornecedor }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar fornecedor:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
