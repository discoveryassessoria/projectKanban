// src/app/api/pessoas/[id]/plano-remocao/route.ts
// ============================================================================
// PLANO DE REMOÇÃO — o que a tela mostra ANTES de excluir alguém da árvore.
//
// Somente leitura. Devolve o mesmo plano que a exclusão vai recalcular dentro da
// transação: o que sai, o que fica, e qual das duas ações está disponível.
//
// Existe para que a confirmação deixe de ser genérica. "Confirmar?" não diz que
// 16 tarefas e uma receita de R$ 2.800 vão junto — nem que um pagamento já
// recebido impede a exclusão definitiva.
// ============================================================================

import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { analisarRemocaoPessoa } from "@/src/services/pessoa-ciclo-vida"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.excluir")
  if (semPermissao) return semPermissao

  const { id: idParam } = await params
  const id = Number.parseInt((idParam ?? "").trim())
  if (isNaN(id) || id <= 0) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  }

  try {
    const plano = await analisarRemocaoPessoa(id)
    if (!plano) return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 })
    return NextResponse.json(plano)
  } catch (error) {
    console.error("[GET /api/pessoas/[id]/plano-remocao]", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
