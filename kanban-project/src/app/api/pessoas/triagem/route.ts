// src/app/api/pessoas/triagem/route.ts
//
// MDM-3 F2 — Triagem OFICIAL de duplicidade e registro da decisão.
//
// Este é o portão: nenhuma Pessoa deve nascer sem passar por aqui. O endpoint
// faz duas coisas, nesta ordem:
//   POST /api/pessoas/triagem            → lista candidatos (não escreve nada)
//   POST /api/pessoas/triagem/decisao    → registra a decisão e devolve o id
//
// O `decisaoDedupId` devolvido é o que `POST /api/pessoas` vai exigir na F3.
// Enquanto a fusão (MDM-4) não existir, cada duplicata criada é permanente —
// por isso a decisão é registrada com os candidatos que foram EXIBIDOS, e não
// apenas com o veredito.

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import {
  avaliarCriacao,
  termosBusca,
  triar,
  type DadosPessoaNova,
  type PessoaCandidata,
} from "@/src/lib/cadastro-mestre/dedup"

/** Busca no Cadastro Mestre os candidatos plausíveis. */
async function buscarCandidatos(dados: DadosPessoaNova): Promise<PessoaCandidata[]> {
  const termos = termosBusca(dados)
  if (termos.length === 0) return []

  const cpfLimpo = (dados.cpf ?? "").replace(/\D/g, "")

  // A busca é ampla de propósito: o objetivo é achar quem já existe em OUTRA
  // árvore ou processo. Restringir por árvore esconderia justamente o caso que
  // interessa.
  const where: Record<string, unknown> = {
    OR: [
      ...termos.map((t) => ({ nome: { contains: t, mode: "insensitive" as const } })),
      ...termos.map((t) => ({ sobrenome: { contains: t, mode: "insensitive" as const } })),
      // Nomes alternativos (MDM-5) entram na varredura: é o que faz a triagem
      // achar a ficha cadastrada com a grafia antiga.
      { nomes: { some: { OR: termos.map((t) => ({ nome: { contains: t, mode: "insensitive" as const } })) } } },
    ],
  }

  const candidatos = await prisma.pessoa.findMany({
    where,
    select: {
      id: true,
      nome: true,
      sobrenome: true,
      sexo: true,
      data_nasc: true,
      local_nasc: true,
      paiId: true,
      maeId: true,
      arvoreId: true,
    },
    take: 120,
    orderBy: { id: "asc" },
  })

  void cpfLimpo // Pessoa não tem CPF próprio; o documento vive no papel (Requerente/Contratante).
  return candidatos as unknown as PessoaCandidata[]
}

export async function POST(request: NextRequest) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao

  try {
    const body = await request.json().catch(() => ({}))
    const dados: DadosPessoaNova = {
      nome: String(body.nome ?? "").trim(),
      sobrenome: body.sobrenome ?? null,
      sexo: body.sexo ?? null,
      cpf: body.cpf ?? null,
      dataNascimento: body.dataNascimento ?? body.data_nasc ?? null,
      localNascimento: body.localNascimento ?? body.local_nasc ?? null,
      paiId: body.paiId ?? null,
      maeId: body.maeId ?? null,
    }

    if (!dados.nome) {
      return NextResponse.json({ error: "Nome é obrigatório para a triagem." }, { status: 400 })
    }

    const candidatos = await buscarCandidatos(dados)
    const triagem = triar(dados, candidatos)

    // Devolve os dados que a tela precisa para o operador decidir com evidência.
    const porId = new Map(candidatos.map((c) => [c.id, c]))
    return NextResponse.json({
      nivel: triagem.nivel,
      chaveDedup: triagem.chaveDedup,
      criacaoLivre: triagem.criacaoLivre,
      candidatos: triagem.candidatos.map((c) => ({
        ...c,
        pessoa: porId.get(c.pessoaId) ?? null,
      })),
    })
  } catch (error) {
    console.error("Erro na triagem de duplicidade:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

/**
 * Registra a decisão do operador. Devolve `decisaoDedupId`, que a criação vai
 * exigir. Idempotente: a mesma decisão reenviada devolve o mesmo id.
 */
export async function PUT(request: NextRequest) {
  const semPermissao = await verificarPermissao(request, "arvore.criar")
  if (semPermissao) return semPermissao

  try {
    const usuario = await extrairUsuarioComPermissoes(request)
    const body = await request.json().catch(() => ({}))

    const dados: DadosPessoaNova = {
      nome: String(body.nome ?? "").trim(),
      sobrenome: body.sobrenome ?? null,
      sexo: body.sexo ?? null,
      cpf: body.cpf ?? null,
      dataNascimento: body.dataNascimento ?? body.data_nasc ?? null,
      localNascimento: body.localNascimento ?? body.local_nasc ?? null,
      paiId: body.paiId ?? null,
      maeId: body.maeId ?? null,
    }
    if (!dados.nome) {
      return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 })
    }

    const tipo = body.decisao === "VINCULOU_EXISTENTE" ? "VINCULOU_EXISTENTE" : "CRIOU_NOVA"
    const decisao = {
      tipo: tipo as "CRIOU_NOVA" | "VINCULOU_EXISTENTE",
      justificativa: body.justificativa ?? null,
      pessoaEscolhidaId: body.pessoaEscolhidaId ?? null,
    }

    // A triagem é REFEITA no servidor. Confiar na que o cliente mandou
    // permitiria criar duplicata mandando uma lista de candidatos vazia.
    const candidatos = await buscarCandidatos(dados)
    const triagem = triar(dados, candidatos)
    const veredito = avaliarCriacao(triagem, decisao)

    if (!veredito.permitido) {
      return NextResponse.json(
        { error: veredito.mensagem, codigo: veredito.codigo, nivel: triagem.nivel },
        { status: 409 },
      )
    }

    const chaveIdempotencia = [
      "dedup",
      triagem.chaveDedup,
      tipo,
      decisao.pessoaEscolhidaId ?? "-",
      usuario?.userId ?? "-",
    ]
      .join(":")
      .slice(0, 200)

    const registro = await prisma.decisaoDeduplicacao.upsert({
      where: { chaveIdempotencia },
      update: {},
      create: {
        chaveDedup: triagem.chaveDedup,
        candidatosAvaliados: triagem.candidatos as unknown as object,
        nivelTriagem: triagem.nivel,
        decisao: tipo,
        pessoaResultanteId: tipo === "VINCULOU_EXISTENTE" ? decisao.pessoaEscolhidaId : null,
        justificativa: decisao.justificativa?.slice(0, 500) ?? null,
        decididoPorId: usuario?.userId ?? null,
        chaveIdempotencia,
      },
      select: { id: true, nivelTriagem: true, decisao: true },
    })

    return NextResponse.json({ decisaoDedupId: registro.id, ...registro })
  } catch (error) {
    console.error("Erro ao registrar decisão de deduplicação:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
