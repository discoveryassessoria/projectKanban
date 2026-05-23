// src/app/api/processos/[processoId]/estatisticas/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

type AlertaSev = "crit" | "warn" | "info"

interface EstatisticasResponse {
  linhagem: {
    emLinhaDireta: number
    origem: string | null
    requerentePrincipal: string | null
  }
  documentacao: {
    recebidos: number
    total: number
    percentual: number
  }
  risco: {
    bloqueantes: number
    graves: number
  }
  protocolo: {
    apto: boolean
    impeditivos: number
  }
  alertas: Array<{ sev: AlertaSev; label: string }>
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // 1) Carrega o processo (precisa do arvoreId e pais)
    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, arvoreId: true, pais: true },
    })

    if (!processo) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    // 2) Carrega as pessoas da árvore vinculada ao processo
    const pessoas = processo.arvoreId
      ? await prisma.pessoa.findMany({
          where: { arvoreId: processo.arvoreId },
          select: {
            id: true,
            nome: true,
            sobrenome: true,
            numeroLinhagem: true,
            requerente: true,
          },
        })
      : []

    const pessoasNaLinha = pessoas.filter((p) => p.numeroLinhagem != null)

    // Origem = pessoa com MAIOR numeroLinhagem (ascendente mais distante)
    const origemPessoa = pessoasNaLinha.reduce<typeof pessoas[number] | null>(
      (max, p) => (max == null || (p.numeroLinhagem ?? 0) > (max.numeroLinhagem ?? 0) ? p : max),
      null
    )

    // Requerente principal = pessoa com requerente='maior'
    const requerentePrincipal = pessoas.find((p) => p.requerente === "maior") || null

    const nomeCompleto = (p: { nome: string; sobrenome: string | null }) =>
      `${p.nome}${p.sobrenome ? " " + p.sobrenome : ""}`

    // 3) Conta documentos das pessoas da árvore
    const pessoaIds = pessoas.map((p) => p.id)

    const [totalDocs, recebidosDocs] = pessoaIds.length
      ? await Promise.all([
          prisma.documento.count({ where: { pessoaId: { in: pessoaIds } } }),
          prisma.documento.count({
            where: { pessoaId: { in: pessoaIds }, status: "RECEBIDO" },
          }),
        ])
      : [0, 0]

    const percentual = totalDocs > 0 ? Math.round((recebidosDocs / totalDocs) * 100) : 0

    // 4) Risco — ainda não existe conceito de "divergência" no schema.
    //    Mantemos zerado até o modelo ser implementado.
    const risco = { bloqueantes: 0, graves: 0 }

    // 5) Protocolo — para Espanha, conta os protocolos cadastrados.
    //    "Apto" ainda não tem regra formal no schema → false por enquanto.
    let protocoloImpeditivos = 0
    if (processo.pais === "ESPANHA") {
      protocoloImpeditivos = await prisma.protocolo.count({
        where: { processoId: id, dataProtocolo: null },
      })
    }
    const protocolo = { apto: false, impeditivos: protocoloImpeditivos }

    // 6) Alertas executivos — derivados dos contadores acima
    const alertas: Array<{ sev: AlertaSev; label: string }> = []

    if (!requerentePrincipal) {
      alertas.push({ sev: "warn", label: "Sem requerente principal definido" })
    }
    if (pessoasNaLinha.length === 0) {
      alertas.push({ sev: "warn", label: "Linhagem ainda não foi definida na árvore" })
    } else if (!origemPessoa) {
      alertas.push({ sev: "info", label: "Origem da linhagem não identificada" })
    }

    const pendentes = totalDocs - recebidosDocs
    if (pendentes > 0) {
      alertas.push({
        sev: "info",
        label: `${pendentes} documento(s) ainda não recebido(s)`,
      })
    }

    // 7) Monta resposta
    const response: EstatisticasResponse = {
      linhagem: {
        emLinhaDireta: pessoasNaLinha.length,
        origem: origemPessoa ? nomeCompleto(origemPessoa) : null,
        requerentePrincipal: requerentePrincipal ? nomeCompleto(requerentePrincipal) : null,
      },
      documentacao: {
        recebidos: recebidosDocs,
        total: totalDocs,
        percentual,
      },
      risco,
      protocolo,
      alertas,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("[GET /api/processos/[processoId]/estatisticas]", error)
    return NextResponse.json(
      { error: "Erro ao buscar estatísticas" },
      { status: 500 }
    )
  }
}