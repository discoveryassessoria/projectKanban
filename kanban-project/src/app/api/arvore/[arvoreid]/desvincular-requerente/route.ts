// src/app/api/arvore/[arvoreid]/desvincular-requerente/route.ts
// ============================================================================
// Desfaz o vínculo requerente↔pessoa desta árvore, MANTENDO a pessoa no nó.
//
// A rota TRADUZ HTTP: valida entrada, resolve o ator, chama a porta pública do
// domínio (`desvincularRequerenteMantendoPessoa`, pessoa-ciclo-vida.ts) e mapeia
// o erro para status. Ela não decide nada sozinha.
// ============================================================================

import { type NextRequest, NextResponse } from "next/server"
import { desvincularRequerenteMantendoPessoa } from "@/src/services/pessoa-ciclo-vida"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"

const STATUS_POR_ERRO: Record<string, number> = {
  PESSOA_NAO_ENCONTRADA: 404,
  NAO_E_REQUERENTE: 409,
  FATO_PROTEGIDO: 409,
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ arvoreid: string }> },
) {
  // Mesma permissão de `vincular-requerente`: quem pode ligar o vínculo pode
  // desfazê-lo — não é uma capacidade nova, é o inverso da mesma.
  const erro = await verificarPermissao(request, "arvore.criar")
  if (erro) return erro

  try {
    const { arvoreid } = await params
    const arvoreId = Number.parseInt(arvoreid)
    if (isNaN(arvoreId)) {
      return NextResponse.json({ error: "ID de árvore inválido" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const pessoaId = Number(body?.pessoaId)
    if (!pessoaId || isNaN(pessoaId)) {
      return NextResponse.json({ error: "pessoaId é obrigatório" }, { status: 400 })
    }

    const actorId = (await extrairUsuarioComPermissoes(request))?.userId ?? null

    const result = await desvincularRequerenteMantendoPessoa(pessoaId, actorId)
    if (!result.ok) {
      const status = STATUS_POR_ERRO[result.code ?? ""] ?? 400
      return NextResponse.json({ error: result.message, code: result.code, fatosProtegidos: result.fatosProtegidos }, { status })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[POST /api/arvore/[arvoreid]/desvincular-requerente]", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
