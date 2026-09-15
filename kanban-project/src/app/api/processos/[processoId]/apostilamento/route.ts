// ============================================================
// src/app/api/processos/[processoId]/apostilamento/route.ts
// GET → carrega/cria a pasta de apostilamento (clone da rota de tradução).
// Cria só se faseCode==APOSTILAMENTO; documentos = linha reta já traduzidos
// e ainda não apostilados (espelha getDocumentsForApostille ~3079).
// ============================================================

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { StatusDocumento, TipoDocumento, Prisma } from "@prisma/client"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import { estadoOperacionalDosDocumentos } from "@/lib/operacional/documento-estado"
import {
  buildInitialWorkflow,
  calcProgress,
  DEFAULT_DOC_STATUS,
  type ApWorkflowStep,
} from "@/src/lib/process-stage/apostilamento-engine"

// Documentos prontos para apostilar (recebidos/traduzidos), não-saída.
const READY_STATUSES: StatusDocumento[] = ["RECEBIDO", "TRADUZIDO", "EM_APOSTILAMENTO", "APOSTILADO"]
const SKIP_TIPOS: TipoDocumento[] = ["TRADUCAO_JURAMENTADA", "APOSTILA_HAIA"]

const TIPO_DOC_LABEL: Record<string, string> = {
  CERTIDAO_NASCIMENTO: "Certidão de Nascimento",
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: "Certidão de Nascimento (Inteiro Teor)",
  CERTIDAO_CASAMENTO: "Certidão de Casamento",
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: "Certidão de Casamento (Inteiro Teor)",
  CERTIDAO_OBITO: "Certidão de Óbito",
  CERTIDAO_OBITO_INTEIRO_TEOR: "Certidão de Óbito (Inteiro Teor)",
  CERTIDAO_BATISMO: "Certidão de Batismo",
  CNN: "Certidão de Não Naturalização (CNN)",
  CARTA_NATURALIZACAO: "Carta de Naturalização",
  RG: "RG", CPF: "CPF", CNH: "CNH",
  PASSAPORTE_BRASILEIRO: "Passaporte Brasileiro",
  TITULO_ELEITOR: "Título de Eleitor",
  RESERVISTA: "Certificado de Reservista",
  PASSAPORTE_ESTRANGEIRO: "Passaporte Estrangeiro",
  CERTIDAO_CIDADANIA_ESTRANGEIRA: "Certidão de Cidadania Estrangeira",
  COMPROVANTE_RESIDENCIA: "Comprovante de Residência",
  FOTO_3X4: "Foto 3x4", PROCURACAO: "Procuração",
  ARVORE_GENEALOGICA_DOC: "Árvore Genealógica", OUTRO: "Outro documento",
}

function nomeCompleto(p: { nome: string; sobrenome: string | null }): string {
  return p.sobrenome ? `${p.nome} ${p.sobrenome}` : p.nome
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }, arvoreId: true, faseAtualKey: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    let pasta = await prisma.pastaApostilamento.findUnique({
      where: { processoId: id },
      include: { documentos: { orderBy: { id: "asc" } } },
    })

    if (!pasta) {
      if (phaseKeyToFaseCode(processo.faseAtualKey) !== "APOSTILAMENTO") {
        return NextResponse.json({ pasta: null })
      }

      // `Documento.status` congela (memória "documento-status-legado") — a
      // segunda consulta é REDE DE SEGURANÇA por Tarefa concluída
      // (`jaRecebido`) para o que `READY_STATUSES` sozinho deixaria de fora,
      // nunca removendo o que já estava incluído (ver mesma correção em
      // .../traducao/route.ts).
      const escopoBase: Prisma.DocumentoWhereInput = {
        tipo: { notIn: SKIP_TIPOS },
        pessoa: { arvoreId: processo.arvoreId, linhaReta: true },
      }
      const selectDoc = {
        id: true as const, tipo: true as const, descricao: true as const, traduzido: true as const,
        pessoa: { select: { nome: true, sobrenome: true } },
      }
      const docs = processo.arvoreId
        ? await (async () => {
            const [porStatus, candidatosRestantes] = await Promise.all([
              prisma.documento.findMany({
                where: { ...escopoBase, status: { in: READY_STATUSES } },
                select: selectDoc,
                orderBy: { id: "asc" },
              }),
              prisma.documento.findMany({
                where: { ...escopoBase, status: { notIn: READY_STATUSES } },
                select: selectDoc,
                orderBy: { id: "asc" },
              }),
            ])
            const estados = await estadoOperacionalDosDocumentos(candidatosRestantes.map((d) => d.id))
            const viaTarefa = candidatosRestantes.filter((d) => estados.get(d.id)?.jaRecebido)
            return [...porStatus, ...viaTarefa]
          })()
        : []

      try {
        pasta = await prisma.pastaApostilamento.create({
          data: {
            processoId: id,
            status: "em_andamento",
            currentStep: "montar_pasta_apostilamento",
            workflow: buildInitialWorkflow() as unknown as Prisma.InputJsonValue,
            documentos: {
              create: docs.map((d) => ({
                documentoId: d.id,
                pessoaNome: nomeCompleto(d.pessoa),
                documentoTitulo: (d.descricao || (d.tipo ? TIPO_DOC_LABEL[d.tipo] : "") || d.tipo || "") + (d.traduzido ? " (traduzida)" : ""),
                origem: d.traduzido ? "Tradução juramentada validada" : "Documento validado",
                status: DEFAULT_DOC_STATUS,
              })),
            },
          },
          include: { documentos: { orderBy: { id: "asc" } } },
        })
      } catch {
        pasta = await prisma.pastaApostilamento.findUnique({
          where: { processoId: id },
          include: { documentos: { orderBy: { id: "asc" } } },
        })
        if (!pasta) throw new Error("Falha ao criar a pasta de apostilamento.")
      }
    }

    const workflow = (pasta.workflow as unknown as ApWorkflowStep[]) ?? []
    return NextResponse.json({ pasta, progress: calcProgress(workflow) })
  } catch (error) {
    console.error("[GET .../apostilamento]", error)
    return NextResponse.json({ error: "Erro ao carregar a pasta de apostilamento" }, { status: 500 })
  }
}