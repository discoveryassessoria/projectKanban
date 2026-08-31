// src/app/api/protocolos/opcoes/route.ts
//
// Opções para registrar uma protocolização DENTRO do processo: órgãos (fonte
// única — Órgãos e Organizações), responsáveis (equipe), documentos do processo
// (o que pode ter sido enviado) e as dimensões fechadas tipo/forma de envio.
//
// Somente leitura, sem dado sensível: quem enxerga as páginas do processo pode
// listar estas opções — a autorização de gerenciamento não entra aqui, senão o
// operador não conseguiria protocolar.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { FORMAS_ENVIO } from "@/src/services/protocolizacao"
import {
  cardinalidadeDoProcesso,
  FINALIDADES_DE_PROTOCOLO,
  SITUACOES_DE_PROTOCOLO,
  CARDINALIDADES,
} from "@/src/services/protocolo-canonico"

export async function GET(request: Request) {
  try {
    const erro = await verificarPermissao(request, "processos.ver_paginas")
    if (erro) return erro

    const processoId = parseInt(new URL(request.url).searchParams.get("processoId") || "")

    const [orgaos, responsaveis, tiposCadastro] = await Promise.all([
      prisma.orgaoProtocolo.findMany({
        where: { ativo: true },
        select: { id: true, name: true, type: true, city: true },
        orderBy: { name: "asc" },
      }),
      prisma.usuario.findMany({
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
      }),
      // TIPO DO ATO vem do CADASTRO (Gerenciamento → Documentos e Protocolos →
      // Tipos de Protocolo). Era um enum de 7 valores no schema: registrar um
      // tipo novo exigia deploy.
      prisma.tipoProtocoloCadastro.findMany({
        where: { ativo: true },
        select: { id: true, code: true, nome: true, descricao: true },
        orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      }),
    ])

    let documentos: { id: number; publicCode: string | null; tipo: string | null; descricao: string | null; pessoa: string }[] = []
    if (!isNaN(processoId)) {
      const processo = await prisma.processo.findUnique({
        where: { id: processoId },
        select: { arvore: { select: { pessoas: { select: { id: true } } } } },
      })
      const pessoaIds = processo?.arvore?.pessoas.map((p) => p.id) ?? []
      if (pessoaIds.length) {
        const docs = await prisma.documento.findMany({
          where: { pessoaId: { in: pessoaIds } },
          select: {
            id: true, publicCode: true, tipo: true, descricao: true,
            pessoa: { select: { nome: true } },
          },
          orderBy: [{ pessoaId: "asc" }, { id: "asc" }],
        })
        documentos = docs.map((d) => ({
          id: d.id,
          publicCode: d.publicCode,
          tipo: d.tipo ? String(d.tipo) : null,
          descricao: d.descricao,
          pessoa: d.pessoa?.nome ?? "—",
        }))
      }
    }

    // A TELA NÃO PERGUNTA O PAÍS. Ela pergunta ao cadastro quantos requerentes
    // cabem num requerimento desta rota, e desenha um seletor de um ou de vários.
    // É o mesmo formulário para Espanha e Itália; o que muda é este dado.
    const cardinalidade = isNaN(processoId)
      ? CARDINALIDADES.INDIVIDUAL
      : await cardinalidadeDoProcesso(prisma, processoId)

    // LACUNA DE CADASTRO TEM QUE APARECER. Sem enquadramento legal declarado, a
    // regra acima é um FALLBACK restritivo, não uma resposta — e a tela precisa
    // dizer isso em vez de restringir em silêncio. Cair calado na regra mais
    // apertada faz o operador achar que o sistema sabe algo que ele não sabe.
    const rota = isNaN(processoId) ? null : await prisma.processo.findUnique({
      where: { id: processoId },
      select: {
        enquadramentoLegal: {
          select: { id: true, nome: true, modalidadeLegal: { select: { id: true, nome: true, cardinalidadeRequerimento: true } } },
        },
      },
    })
    const cardinalidadeDeclarada = !!rota?.enquadramentoLegal?.modalidadeLegal

    return NextResponse.json({
      orgaos,
      responsaveis,
      documentos,
      formasEnvio: FORMAS_ENVIO,
      cardinalidade,
      cardinalidadeDeclarada,
      rota: rota?.enquadramentoLegal
        ? {
            enquadramento: rota.enquadramentoLegal.nome,
            modalidade: rota.enquadramentoLegal.modalidadeLegal?.nome ?? null,
          }
        : null,
      tiposCadastro,
      finalidades: Object.values(FINALIDADES_DE_PROTOCOLO),
      situacoes: Object.values(SITUACOES_DE_PROTOCOLO),
    })
  } catch (error) {
    console.error("Erro ao carregar opções de protocolo:", error)
    return NextResponse.json({ error: "Erro ao carregar opções de protocolo" }, { status: 500 })
  }
}
