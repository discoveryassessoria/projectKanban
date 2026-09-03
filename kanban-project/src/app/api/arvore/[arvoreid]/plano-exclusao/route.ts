// src/app/api/arvore/[arvoreid]/plano-exclusao/route.ts
//
// PRÉVIA da exclusão da árvore inteira. Mostra o que sai e quem impede ANTES
// de agir — mesmo padrão do plano de remoção de UMA pessoa
// (`GET /api/pessoas/[id]/plano-remocao`), só que somado para toda a árvore.
//
// `analisarExclusaoArvore` é o MESMO motor que o `DELETE` re-roda dentro da
// transação: esta rota não calcula nada, só expõe o veredito.
import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { analisarExclusaoArvore } from "@/src/services/pessoa-ciclo-vida"

export async function GET(request: NextRequest, { params }: { params: Promise<{ arvoreid: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.excluir")
  if (semPermissao) return semPermissao

  const { arvoreid } = await params
  const id = Number.parseInt(arvoreid)
  if (isNaN(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  }

  const plano = await analisarExclusaoArvore(id)
  if (!plano) {
    return NextResponse.json({ error: "Árvore não encontrada" }, { status: 404 })
  }

  return NextResponse.json(plano)
}
