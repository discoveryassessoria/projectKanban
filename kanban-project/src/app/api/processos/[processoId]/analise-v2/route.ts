// src/app/api/processos/[processoId]/analise-v2/route.ts
//
// GET  — pessoas da LINHA RETA + documentos (campos AD2) + gate de prontidão (dados crus).
// POST — RODA a análise: mapeia a árvore pro motor (ad-v2-engine), roda buildCanonical +
//        ad2CompareDoc e retorna as comparações; marca analysisStatus="ready" nos docs
//        revisados. Espelha o ad2RunAnalysis do mockup: só roda se ad2Readiness liberar.
//
// Mesma leitura da árvore do analise/route.ts (arvoreId + linhaReta), agora trazendo
// paiId/maeId (o motor usa pra identificar o ancestral-base = raiz da linha).

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { TipoDocumento } from "@prisma/client"
import {
  initADModel,
  ad2Readiness,
  ad2CompareDoc,
  type TreePerson,
  type DocTipo,
} from "@/src/lib/process-stage/ad-v2-engine"

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

// enum TipoDocumento (MAIÚSCULO) → DocTipo do motor
function dtipo(tipoEnum: string): DocTipo {
  const t = (tipoEnum || "").toUpperCase()
  if (t.includes("CASAMENTO")) return "casamento"
  if (t.includes("OBITO")) return "obito"
  return "nascimento"
}
function mapSexo(s: string | null): string | undefined {
  if (!s) return undefined
  const t = s.toLowerCase()
  if (t.startsWith("f")) return "Feminino"
  if (t.startsWith("m")) return "Masculino"
  return undefined
}

// query única (reusada por GET e POST)
async function carregarPessoas(processoId: number) {
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, arvoreId: true },
  })
  if (!processo) return null
  if (!processo.arvoreId) return []
  return prisma.pessoa.findMany({
    where: { arvoreId: processo.arvoreId, linhaReta: true },
    orderBy: { numeroLinhagem: "asc" },
    select: {
      id: true, nome: true, sobrenome: true, sexo: true,
      data_nasc: true, data_obito: true, local_nasc: true,
      nacionalidade: true, numeroLinhagem: true, linhaReta: true, requerente: true,
      paiId: true, maeId: true,
      pai: { select: { nome: true, sobrenome: true } },
      mae: { select: { nome: true, sobrenome: true } },
      unioesComoPessoa1: { select: { pessoa2: { select: { nome: true, sobrenome: true } } } },
      unioesComoPessoa2: { select: { pessoa1: { select: { nome: true, sobrenome: true } } } },
      documentos: {
        where: { tipo: { in: TIPOS_ANALISADOS }, status: { notIn: ["CANCELADO", "INVALIDO"] } },
        orderBy: { id: "asc" },
        select: {
          id: true, tipo: true, status: true,
          structuredData: true, dataStatus: true, analysisStatus: true, registral: true,
        },
      },
    },
  })
}

// Prisma → TreePerson (shape que o motor espera)
function toTree(pessoasRaw: any[]): TreePerson[] {
  const arr = pessoasRaw
  const idsLinha = new Set(arr.map((p) => p.id))
  return arr.map((p) => {
    const temPaiNaLinha = p.paiId != null && idsLinha.has(p.paiId)
    const temMaeNaLinha = p.maeId != null && idsLinha.has(p.maeId)
    return {
      id: p.id,
      nome: nomeCompleto(p.nome, p.sobrenome),
      sobrenome: "",
      gen: p.numeroLinhagem != null ? "G" + p.numeroLinhagem : undefined,
      isLinha: p.linhaReta,
      ehRequerente: (p.requerente ?? "nao") !== "nao",
      // «AJUSTE» ancestral-base = raiz da linha (sem pai/mãe DENTRO da linha reta).
      // Se preferir derivar de numeroLinhagem, trocar por p.numeroLinhagem === min.
      ehAncestral: p.linhaReta && !temPaiNaLinha && !temMaeNaLinha,
      nascimento: p.data_nasc ? p.data_nasc.toISOString().slice(0, 10) : undefined,
      dataObito: p.data_obito ? p.data_obito.toISOString().slice(0, 10) : undefined,
      nacionalidade: p.nacionalidade || undefined,
      sexo: mapSexo(p.sexo),
      docs: p.documentos.map((d: any) => ({
        id: d.id,
        tipo: dtipo(d.tipo),
        status: d.status,
        structuredData: d.structuredData || null,
        dataStatus: d.dataStatus,
        analysisStatus: d.analysisStatus,
      })),
    }
  })
}

// ============================================================
// GET — dados crus pro front (planilha por geração, lista de docs)
// ============================================================
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ processoId: string }> },
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const pessoasRaw = await carregarPessoas(id)
    if (pessoasRaw === null) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const pessoas = (pessoasRaw as any[]).map((p) => {
      const conjugeNomes = [
        ...p.unioesComoPessoa1.map((u: any) => u.pessoa2),
        ...p.unioesComoPessoa2.map((u: any) => u.pessoa1),
      ].map((c: any) => nomeCompleto(c.nome, c.sobrenome))

      return {
        id: p.id,
        nome: nomeCompleto(p.nome, p.sobrenome),
        geracao: p.numeroLinhagem ?? null,
        linhaReta: p.linhaReta,
        requerente: p.requerente ?? "nao",
        sexo: p.sexo ?? null,
        nacionalidade: p.nacionalidade ?? null,
        localNasc: p.local_nasc ?? null,
        dataNasc: p.data_nasc ? p.data_nasc.toISOString() : null,
        dataObito: p.data_obito ? p.data_obito.toISOString() : null,
        paiId: p.paiId ?? null,
        maeId: p.maeId ?? null,
        paiNome: p.pai ? nomeCompleto(p.pai.nome, p.pai.sobrenome) : null,
        maeNome: p.mae ? nomeCompleto(p.mae.nome, p.mae.sobrenome) : null,
        conjugeNomes,
        documentos: p.documentos.map((d: any) => ({
          id: d.id,
          tipo: d.tipo,
          titulo: DOC_LABEL[d.tipo] || d.tipo,
          status: d.status,
          dataStatus: d.dataStatus,
          analysisStatus: d.analysisStatus,
          structuredData: d.structuredData,
          registral: d.registral,
        })),
      }
    })

    const todosDocs = pessoas.flatMap((p) => p.documentos.map((d: any) => ({ ...d, pessoaNome: p.nome })))
    const pendencias = todosDocs
      .filter((d) => d.dataStatus !== "reviewed")
      .map((d) => ({ docId: d.id, label: `${d.titulo} — ${d.pessoaNome}`, dataStatus: d.dataStatus }))

    const kpis = {
      pessoas: pessoas.length,
      totalDocs: todosDocs.length,
      revisados: todosDocs.filter((d) => d.dataStatus === "reviewed").length,
      pendentesRevisao: pendencias.length,
    }
    const readiness = { ready: todosDocs.length > 0 && pendencias.length === 0, pendencias }

    return NextResponse.json({ pessoas, kpis, readiness })
  } catch (error) {
    console.error("[GET /api/processos/[processoId]/analise-v2]", error)
    return NextResponse.json({ error: "Erro ao carregar Análise v2" }, { status: 500 })
  }
}

// ============================================================
// POST — roda a análise: compara (motor) e GRAVA as divergências em
// AnaliseDocumental/Divergencia (as MESMAS tabelas da Análise antiga),
// para que /analise/divergencias/[divId] (decidir) e /analise/concluir
// (ramificar + mover card) reaproveitem a infra já em produção.
// ============================================================
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ processoId: string }> },
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const pessoasRaw = await carregarPessoas(id)
    if (pessoasRaw === null) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const model = initADModel(toTree(pessoasRaw))
    const rd = ad2Readiness(model)
    if (!rd.ready) {
      return NextResponse.json(
        { error: "Resolva as pendências antes de rodar a análise.", readiness: rd },
        { status: 409 },
      )
    }

    // comparação campo-a-campo nos documentos revisados
    const docsRevisados = model.documents.filter((d) => d.dataStatus === "reviewed")
    const comparacoes = docsRevisados.flatMap((d) =>
      ad2CompareDoc(d, model.persons).map((c) => ({ c, gen: d.generation })),
    )
    // só viram Divergencia as que pedem decisão humana (userDecision === "pendente")
    const divergentes = comparacoes.filter((x) => x.c.userDecision === "pendente")

    const docsAnalisados = docsRevisados.length
    const camposComparados = comparacoes.length
    const currentStep = divergentes.length === 0 ? "decisao_juridica" : "revisao_humana"
    const now = new Date()

    const analise = await prisma.$transaction(
      async (tx) => {
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

        await tx.divergencia.deleteMany({ where: { analiseId: a.id } })
        if (divergentes.length > 0) {
          await tx.divergencia.createMany({
            data: divergentes.map(({ c, gen }) => ({
              analiseId: a.id,
              pessoaId: c.personId,
              pessoaNome: c.personName,
              geracao: gen ?? null,
              linhaReta: true,
              documentoId: c.documentId,
              documentoTitulo: c.documentLabel,
              campo: c.fieldKey,
              campoLabel: c.fieldLabel,
              valorArvore: c.expectedValue || null,
              valorDocumento: c.valueInDocument || null,
              tipo: c.divergenceType || "outro",
              severidade: c.severity,
              sugestaoIA: c.aiSuggestion || null,
              requerRetificacaoIA: c.operationalRecommendation === "retificar",
              status: "pendente",
            })),
          })
        }

        // marca os documentos analisados como prontos
        await tx.documento.updateMany({
          where: { id: { in: docsRevisados.map((d) => d.id) } },
          data: { analysisStatus: "ready" },
        })

        return tx.analiseDocumental.findUnique({
          where: { id: a.id },
          include: { divergencias: { orderBy: { id: "asc" } } },
        })
      },
      { timeout: 30000, maxWait: 10000 },
    )

    return NextResponse.json({ analise }, { status: 200 })
  } catch (error) {
    console.error("[POST /api/processos/[processoId]/analise-v2]", error)
    return NextResponse.json({ error: "Erro ao rodar análise" }, { status: 500 })
  }
}