// src/app/api/processos/[processoId]/planilha-override/route.ts
// ============================================================================
// O VALOR COMBINADO DE UMA CÉLULA — escrita, e só dela.
//
// PUT     define/atualiza o combinado desta célula neste processo
// DELETE  remove o combinado; a célula volta a valer o preço da Tabela
//
// Esta rota NÃO toca em TabelaValor, em ProdutoFinanceiro nem em obrigação
// lançada. O combinado vale para uma interseção de um processo — é essa a
// diferença entre "cobrei diferente neste caso" e "o preço mudou".
// ============================================================================
import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { definirOverride, removerOverride, type CelulaAlvo } from "@/lib/financeiro/planilha-celula-override"

/** A célula vem inteira no corpo, por IDs. Faltando um, não há o que gravar. */
function lerAlvo(processoId: number, body: Record<string, unknown>): CelulaAlvo | null {
  const pessoaId = Number(body?.pessoaId)
  const tipoDocumentoId = Number(body?.tipoDocumentoId)
  const colunaId = Number(body?.colunaId)
  const ok = [pessoaId, tipoDocumentoId, colunaId].every((v) => Number.isInteger(v) && v > 0)
  return ok ? { processoId, pessoaId, tipoDocumentoId, colunaId } : null
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "financeiro.custo_editar")
  if (erro) return erro

  const processoId = Number((await ctx.params).processoId)
  if (!Number.isInteger(processoId) || processoId <= 0) {
    return NextResponse.json({ error: "processo inválido" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const alvo = lerAlvo(processoId, body)
  if (!alvo) return NextResponse.json({ error: "pessoaId, tipoDocumentoId e colunaId são obrigatórios" }, { status: 400 })

  const valor = Number(body?.valor)
  if (!Number.isFinite(valor) || valor < 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 })
  }

  try {
    const autorId = (await extrairUsuarioComPermissoes(request))?.userId ?? null
    const gravado = await definirOverride(alvo, {
      valor,
      moeda: typeof body?.moeda === "string" ? body.moeda : "BRL",
      autorId,
      motivo: typeof body?.motivo === "string" ? body.motivo.slice(0, 300) : null,
    })
    return NextResponse.json({ override: gravado })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 })
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "financeiro.custo_editar")
  if (erro) return erro

  const processoId = Number((await ctx.params).processoId)
  const body = await request.json().catch(() => ({}))
  const alvo = lerAlvo(processoId, body)
  if (!alvo) return NextResponse.json({ error: "pessoaId, tipoDocumentoId e colunaId são obrigatórios" }, { status: 400 })

  try {
    const autorId = (await extrairUsuarioComPermissoes(request))?.userId ?? null
    // Remover duas vezes não é erro: um duplo-clique não pode quebrar a tela.
    const removido = await removerOverride(alvo, { autorId })
    return NextResponse.json({ removido })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 })
  }
}
