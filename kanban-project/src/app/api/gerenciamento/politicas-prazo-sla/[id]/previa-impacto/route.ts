// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/politicas-prazo-sla/[id]/previa-impacto/route.ts
//
// GET - quantas tarefas em andamento serão alcançadas pela publicação, para a
//       estratégia informada (?estrategia=). A UI mostra isto ANTES do
//       usuário confirmar a publicação — nunca escolhe estratégia sem prévia.

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { preverImpactoPublicacao } from "@/src/services/prazo-sla/politica-prazo-sla"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const estrategia = searchParams.get("estrategia") || "SOMENTE_NOVAS"
    const impacto = await preverImpactoPublicacao(Number(id), estrategia)
    return NextResponse.json(impacto)
  } catch (error) {
    console.error("Erro ao calcular prévia de impacto:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
