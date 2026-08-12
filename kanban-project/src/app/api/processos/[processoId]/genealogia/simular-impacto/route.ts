// src/app/api/processos/[processoId]/genealogia/simular-impacto/route.ts
//
// PREVIEW DE IMPACTO — POST que não escreve.
//
// É POST porque a simulação recebe um corpo (a mudança proposta), não porque
// altera estado. `simularImpactoPessoa` roda o materializador oficial dentro de
// uma transação que termina SEMPRE em rollback — o método HTTP é a única coisa
// que lembra escrita aqui.
//
// PERMISSÃO: `arvore.editar`. Quem não pode fazer a alteração não precisa
// prever o efeito dela — e o preview revela o dossiê documental do processo.
// O bloco financeiro depende, à parte, de `financeiro.ver`.

import { type NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes, verificarPermissao } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import {
  simularImpactoPessoa,
  type EntradaSimulacao,
  type MudancasPropostas,
  type UniaoProposta,
} from "@/src/services/genealogia/simular-impacto"

/** Campos aceitos. Lista fechada: o corpo não vira um update livre de Pessoa. */
const CAMPOS: Array<keyof MudancasPropostas> = [
  "vivo",
  "data_obito",
  "casado",
  "paiId",
  "maeId",
  "requerente",
  "linhaReta",
  "documentacao",
]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const semPermissao = await verificarPermissao(request, "arvore.editar")
  if (semPermissao) return semPermissao

  try {
    const { processoId: pid } = await params
    const processoId = Number.parseInt(pid)
    if (Number.isNaN(processoId)) {
      return NextResponse.json({ error: "processoId inválido" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const pessoaId = Number(body?.pessoaId)
    if (!Number.isFinite(pessoaId) || pessoaId <= 0) {
      return NextResponse.json({ error: "pessoaId é obrigatório" }, { status: 400 })
    }

    const mudancas: MudancasPropostas = {}
    for (const campo of CAMPOS) {
      const valor = body?.mudancas?.[campo]
      if (valor !== undefined) Object.assign(mudancas, { [campo]: valor })
    }

    let uniao: UniaoProposta | undefined
    if (body?.uniao?.acao === "criar" && Number.isFinite(Number(body.uniao.conjugeId))) {
      uniao = { acao: "criar", conjugeId: Number(body.uniao.conjugeId) }
    } else if (body?.uniao?.acao === "remover" && Number.isFinite(Number(body.uniao.uniaoId))) {
      uniao = { acao: "remover", uniaoId: Number(body.uniao.uniaoId) }
    }

    if (Object.keys(mudancas).length === 0 && !uniao) {
      return NextResponse.json(
        { error: "Nenhuma mudança proposta para simular." },
        { status: 400 },
      )
    }

    const usuario = await extrairUsuarioComPermissoes(request)
    const financeiroVisivel = Boolean(
      usuario && temPermissao(usuario.permissoes, "financeiro.ver"),
    )

    const entrada: EntradaSimulacao = { processoId, pessoaId, mudancas, uniao }
    const resultado = await simularImpactoPessoa(entrada, financeiroVisivel)

    return NextResponse.json(resultado)
  } catch (error) {
    console.error("POST genealogia/simular-impacto", error)
    return NextResponse.json(
      { error: "Não foi possível simular o impacto desta alteração." },
      { status: 500 },
    )
  }
}
