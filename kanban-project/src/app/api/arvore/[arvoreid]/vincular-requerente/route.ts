// src/app/api/arvore/[arvoreid]/vincular-requerente/route.ts
// ============================================================================
// Vincula um Requerente do processo como nó da Árvore REUSANDO a Pessoa (dedup).
// A lógica de reuso/criação vive em lib/genealogia/vincular-requerente (função
// pura/testável); a rota apenas a orquestra e dispara os efeitos externos que a
// criação de uma Pessoa-requerente já disparava (evento de domínio + materialização),
// mantendo paridade com POST /api/pessoas e sem duplicar Pessoa.
// ============================================================================

import { type NextRequest, NextResponse } from "next/server"
import { vincularRequerente } from "@/lib/genealogia/vincular-requerente"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { emitirEDrenarEventoRequerente } from "@/src/services/genealogia/emitir-evento-requerente"
import { dispararMaterializacaoPorArvore } from "@/src/services/genealogia/materializar-genealogia"

const STATUS_POR_ERRO: Record<string, number> = {
  ARVORE_NAO_ENCONTRADA: 404,
  REQUERENTE_NAO_ENCONTRADO: 404,
  PESSOA_EM_OUTRA_ARVORE: 409,
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ arvoreid: string }> }
) {
  const erro = await verificarPermissao(request, "arvore.criar")
  if (erro) return erro

  try {
    const { arvoreid } = await params
    const arvoreId = Number.parseInt(arvoreid)
    if (isNaN(arvoreId)) {
      return NextResponse.json({ error: "ID de árvore inválido" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const requerenteId = Number(body?.requerenteId)
    if (!requerenteId || isNaN(requerenteId)) {
      return NextResponse.json({ error: "requerenteId é obrigatório" }, { status: 400 })
    }

    const result = await vincularRequerente({
      arvoreId,
      requerenteId,
      x: body?.x ?? undefined,
      y: body?.y ?? undefined,
      paiId: body?.paiId ?? undefined,
      maeId: body?.maeId ?? undefined,
    })

    if (!result.ok) {
      const status = STATUS_POR_ERRO[result.code] ?? 400
      return NextResponse.json({ error: result.message, code: result.code }, { status })
    }

    // Efeitos externos (mesmos de POST /api/pessoas quando a Pessoa é requerente):
    // evento de domínio REQUERENTE_ADICIONADO (idempotente) + reavaliação das
    // NecessidadeDocumental. Best-effort — nunca derruba o vínculo já persistido.
    const actorId = (await extrairUsuarioComPermissoes(request))?.userId ?? null
    await emitirEDrenarEventoRequerente({ pessoaId: result.pessoaId, arvoreId, actorId }).catch(
      () => {}
    )
    await dispararMaterializacaoPorArvore(arvoreId).catch(() => {})

    return NextResponse.json({ pessoaId: result.pessoaId, criada: result.criada })
  } catch (error) {
    console.error("[POST /api/arvore/[arvoreid]/vincular-requerente]", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
