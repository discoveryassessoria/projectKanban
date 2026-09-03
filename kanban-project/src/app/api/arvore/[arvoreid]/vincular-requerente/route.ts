// src/app/api/arvore/[arvoreid]/vincular-requerente/route.ts
// ============================================================================
// Vincula um Requerente do processo como nó da Árvore REUSANDO a Pessoa (dedup).
//
// A rota TRADUZ HTTP: valida entrada, resolve o ator, chama a porta pública do
// domínio e mapeia o erro para status. Ela NÃO é dona de efeito de negócio.
//
// Até 09/08/2026 ela era: chamava o serviço e, depois, emitia o evento de domínio
// e disparava a materialização por conta própria. Quem entrasse pelo serviço não
// recebia nada disso — duas portas, dois estados finais. Os dois efeitos foram
// para dentro de `vincularRequerente`, onde toda porta os herda.
// ============================================================================

import { type NextRequest, NextResponse, after } from "next/server"
import { vincularRequerente, vincularPessoaExistenteAoRequerente } from "@/lib/genealogia/vincular-requerente"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"

const STATUS_POR_ERRO: Record<string, number> = {
  ARVORE_NAO_ENCONTRADA: 404,
  REQUERENTE_NAO_ENCONTRADO: 404,
  PESSOA_EM_OUTRA_ARVORE: 409,
  PESSOA_NAO_ENCONTRADA: 404,
  REQUERENTE_JA_VINCULADO: 409,
  PESSOA_JA_E_REQUERENTE: 409,
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

    const actorId = (await extrairUsuarioComPermissoes(request))?.userId ?? null

    // `pessoaId` explícito: quem opera já sabe qual pessoa da árvore corresponde
    // a este requerente (ex.: árvore importada, sem vínculo prévio) — porta
    // separada (`vincularPessoaExistenteAoRequerente`), mesma trilha de evento e
    // materialização. Sem `pessoaId`, comportamento de sempre: reusa por
    // `Requerente.personId` ou cria.
    const pessoaId = body?.pessoaId != null ? Number(body.pessoaId) : null
    if (body?.pessoaId != null && (!pessoaId || isNaN(pessoaId))) {
      return NextResponse.json({ error: "pessoaId inválido" }, { status: 400 })
    }

    // `deferirEfeitos: after` — o vínculo em si (rápido, na transação) já está
    // completo quando respondemos; a reavaliação de TODA a árvore (materializar
    // genealogia + regras documentais) roda depois de responder, sem o cliente
    // esperar. `after()` mantém a função viva até o efeito terminar — não é
    // "atirar e esquecer": só não trava a resposta.
    const result = pessoaId != null
      ? await vincularPessoaExistenteAoRequerente({ arvoreId, requerenteId, pessoaId, actorId }, { after })
      : await vincularRequerente({
          arvoreId,
          requerenteId,
          x: body?.x ?? undefined,
          y: body?.y ?? undefined,
          paiId: body?.paiId ?? undefined,
          maeId: body?.maeId ?? undefined,
          actorId,
        }, { after })

    if (!result.ok) {
      const status = STATUS_POR_ERRO[result.code] ?? 400
      return NextResponse.json({ error: result.message, code: result.code }, { status })
    }

    return NextResponse.json({ pessoaId: result.pessoaId, criada: "criada" in result ? result.criada : false })
  } catch (error) {
    console.error("[POST /api/arvore/[arvoreid]/vincular-requerente]", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
