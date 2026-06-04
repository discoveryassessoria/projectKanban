// src/app/api/processos/[processoId]/analise/route.ts
//
// GET  → estado atual da análise (pro painel da Fase 4)
// POST → roda a análise: compara árvore × documentos e grava as divergências

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { TipoDocumento } from "@prisma/client"
import {
  gerarDivergencias,
  type PessoaParaAnalise,
  type DocumentoParaAnalise,
} from "@/src/lib/process-stage/analise-engine"

// Rótulos dos tipos que entram na análise (e a lista pro filtro)
const DOC_LABEL: Record<string, string> = {
  CERTIDAO_NASCIMENTO: "Certidão de Nascimento",
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: "Certidão de Nascimento (IT)",
  CERTIDAO_CASAMENTO: "Certidão de Casamento",
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: "Certidão de Casamento (IT)",
  CERTIDAO_OBITO: "Certidão de Óbito",
  CERTIDAO_OBITO_INTEIRO_TEOR: "Certidão de Óbito (IT)",
}
const TIPOS_ANALISADOS = Object.keys(DOC_LABEL) as TipoDocumento[]

const nomeCompleto = (nome: string, sobrenome: string | null) =>
  `${nome}${sobrenome ? " " + sobrenome : ""}`.trim()

const fmtData = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toLocaleDateString("pt-BR") : null

const camposCount = (tipo: string): number => {
  if (tipo.includes("NASCIMENTO")) return 4
  if (tipo.includes("CASAMENTO")) return 2
  if (tipo.includes("OBITO")) return 1
  return 1
}

// ============================================================
// GET — estado atual da análise
// ============================================================
export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const analise = await prisma.analiseDocumental.findUnique({
      where: { processoId: id },
      include: { divergencias: { orderBy: { id: "asc" } } },
    })

    return NextResponse.json({ analise })
  } catch (error) {
    console.error("[GET /api/processos/[processoId]/analise]", error)
    return NextResponse.json({ error: "Erro ao buscar análise" }, { status: 500 })
  }
}

// ============================================================
// POST — roda a análise (compara e grava divergências)
// ============================================================
export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    // 1. Processo + árvore
    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, arvoreId: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    // 2. Pessoas da LINHA RETA, com pai/mãe e documentos relevantes
    const pessoas = processo.arvoreId
      ? await prisma.pessoa.findMany({
          where: { arvoreId: processo.arvoreId, linhaReta: true },
          select: {
            id: true, nome: true, sobrenome: true, local_nasc: true,
            numeroLinhagem: true, linhaReta: true,
            pai: { select: { nome: true, sobrenome: true } },
            mae: { select: { nome: true, sobrenome: true } },
            documentos: {
              where: { tipo: { in: TIPOS_ANALISADOS }, status: { notIn: ["CANCELADO", "INVALIDO"] } },
              select: {
                id: true, tipo: true,
                nome_registrado: true, pai_registrado: true, mae_registrada: true,
                conjuge_registrado: true, cidade_registro: true,
                data_evento_documento: true, data_evento: true, data_registro: true,
              },
            },
          },
        })
      : []

    // 3. Mapeia pro formato da engine
    const pessoasParaAnalise: PessoaParaAnalise[] = pessoas.map((p) => ({
      id: p.id,
      nome: nomeCompleto(p.nome, p.sobrenome),
      geracao: p.numeroLinhagem ?? null,
      linhaReta: p.linhaReta,
      paiNome: p.pai ? nomeCompleto(p.pai.nome, p.pai.sobrenome) : null,
      maeNome: p.mae ? nomeCompleto(p.mae.nome, p.mae.sobrenome) : null,
      conjugeNome: null, // cônjuge resolvido numa rodada futura
      localNasc: p.local_nasc ?? null,
      documentos: p.documentos.map<DocumentoParaAnalise>((d) => ({
        id: d.id,
        tipo: d.tipo,
        titulo: DOC_LABEL[d.tipo] || d.tipo,
        nomeRegistrado: d.nome_registrado ?? null,
        paiRegistrado: d.pai_registrado ?? null,
        maeRegistrada: d.mae_registrada ?? null,
        conjugeRegistrado: d.conjuge_registrado ?? null,
        cidadeRegistro: d.cidade_registro ?? null,
        dataDocumento: fmtData(d.data_evento_documento ?? d.data_evento ?? d.data_registro),
      })),
    }))

    // 4. Roda a engine
    const divergencias = gerarDivergencias(pessoasParaAnalise)

    // 5. KPIs
    const docsAnalisados = pessoasParaAnalise.reduce((a, p) => a + p.documentos.length, 0)
    const camposComparados = pessoasParaAnalise.reduce(
      (a, p) => a + p.documentos.reduce((s, d) => s + camposCount(d.tipo), 0), 0
    )
    // Sem divergência pendente → já pode ir pra decisão (sem retificação)
    const currentStep = divergencias.length === 0 ? "decisao_juridica" : "revisao_humana"

    // 6. Grava (transação): upsert da análise + regrava as divergências
    const now = new Date()
    const analise = await prisma.$transaction(async (tx) => {
      const a = await tx.analiseDocumental.upsert({
        where: { processoId: id },
        create: {
          processoId: id, status: "em_andamento", currentStep,
          totalDocumentos: docsAnalisados, documentosAnalisados: docsAnalisados,
          camposComparados, startedAt: now,
        },
        update: {
          status: "em_andamento", currentStep,
          totalDocumentos: docsAnalisados, documentosAnalisados: docsAnalisados,
          camposComparados, decisaoJuridica: null, requerRetificacao: false,
          completedAt: null, startedAt: now,
        },
      })

      // Re-rodar regenera: apaga as antigas e cria as novas
      await tx.divergencia.deleteMany({ where: { analiseId: a.id } })
      if (divergencias.length > 0) {
        await tx.divergencia.createMany({
          data: divergencias.map((d) => ({ ...d, analiseId: a.id })),
        })
      }

      return tx.analiseDocumental.findUnique({
        where: { id: a.id },
        include: { divergencias: { orderBy: { id: "asc" } } },
      })
    }, { timeout: 30000, maxWait: 10000 })

    return NextResponse.json({ analise }, { status: 200 })
  } catch (error) {
    console.error("[POST /api/processos/[processoId]/analise]", error)
    return NextResponse.json({ error: "Erro ao rodar análise" }, { status: 500 })
  }
}