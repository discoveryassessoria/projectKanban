// ============================================================
// src/app/api/processos/[processoId]/traducao/route.ts
// ------------------------------------------------------------
// GET → carrega a pasta de tradução do processo.
// Se o processo está na fase TRADUCAO_JURAMENTADA e ainda não existe
// pasta, cria na hora montando os documentos da LINHA RETA (espelha
// createTranslationFolder + getDocumentsForTranslation do mockup).
// ============================================================

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { StatusDocumento, TipoDocumento, Prisma } from "@prisma/client"
import {
  buildInitialWorkflow,
  calcProgress,
  DEFAULT_DOC_STATUS,
  type TrWorkflowStep,
} from "@/src/lib/process-stage/traducao-engine"

// Documentos "que temos em mãos" e podem entrar na pasta de tradução.
// (no mockup: recebido / validado / validado_retificado)
const READY_STATUSES: StatusDocumento[] = ["RECEBIDO", "EM_TRADUCAO", "TRADUZIDO"]

// Tipos que NÃO são documento-fonte para traduzir (são saídas do processo).
const SKIP_TIPOS: TipoDocumento[] = ["TRADUCAO_JURAMENTADA", "APOSTILA_HAIA"]

// Rótulo do documento para o snapshot. Troque por seu mapa canônico se houver.
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
  RG: "RG",
  CPF: "CPF",
  CNH: "CNH",
  PASSAPORTE_BRASILEIRO: "Passaporte Brasileiro",
  TITULO_ELEITOR: "Título de Eleitor",
  RESERVISTA: "Certificado de Reservista",
  PASSAPORTE_ESTRANGEIRO: "Passaporte Estrangeiro",
  CERTIDAO_CIDADANIA_ESTRANGEIRA: "Certidão de Cidadania Estrangeira",
  COMPROVANTE_RESIDENCIA: "Comprovante de Residência",
  FOTO_3X4: "Foto 3x4",
  PROCURACAO: "Procuração",
  ARVORE_GENEALOGICA_DOC: "Árvore Genealógica",
  OUTRO: "Outro documento",
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
      select: { id: true, pais: true, arvoreId: true, faseAtualKey: true, status: { select: { faseCode: true } } },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    // Já existe pasta? devolve.
    let pasta = await prisma.pastaTraducao.findUnique({
      where: { processoId: id },
      include: { documentos: { orderBy: { id: "asc" } } },
    })

    // Não existe: só cria se o processo estiver de fato na fase de Tradução.
    if (!pasta) {
      if ((processo.status?.faseCode ?? processo.faseAtualKey?.toUpperCase()) !== "TRADUCAO_JURAMENTADA") {
        return NextResponse.json({ pasta: null })
      }

      // Documentos da LINHA RETA da árvore do processo, prontos p/ tradução.
      const docs = processo.arvoreId
        ? await prisma.documento.findMany({
            where: {
              status: { in: READY_STATUSES },
              tipo: { notIn: SKIP_TIPOS },
              pessoa: { arvoreId: processo.arvoreId, linhaReta: true },
            },
            select: {
              id: true,
              tipo: true,
              descricao: true,
              pessoa: { select: { nome: true, sobrenome: true } },
            },
            orderBy: { id: "asc" },
          })
        : []

      try {
        pasta = await prisma.pastaTraducao.create({
          data: {
            processoId: id,
            status: "em_andamento",
            currentStep: "montar_pasta_traducao",
            sourceLanguage: "Português",
            targetLanguage: "Italiano",
            workflow: buildInitialWorkflow() as unknown as Prisma.InputJsonValue,
            documentos: {
              create: docs.map((d) => ({
                documentoId: d.id,
                pessoaNome: nomeCompleto(d.pessoa),
                documentoTitulo: d.descricao || (d.tipo ? TIPO_DOC_LABEL[d.tipo] : "") || d.tipo || "",
                origem: "Documento validado",
                status: DEFAULT_DOC_STATUS,
              })),
            },
          },
          include: { documentos: { orderBy: { id: "asc" } } },
        })
      } catch {
        // corrida: outra requisição criou primeiro → recarrega
        pasta = await prisma.pastaTraducao.findUnique({
          where: { processoId: id },
          include: { documentos: { orderBy: { id: "asc" } } },
        })
        if (!pasta) throw new Error("Falha ao criar a pasta de tradução.")
      }
    }

    const workflow = (pasta.workflow as unknown as TrWorkflowStep[]) ?? []
    return NextResponse.json({ pasta, progress: calcProgress(workflow) })
  } catch (error) {
    console.error("[GET .../traducao]", error)
    return NextResponse.json({ error: "Erro ao carregar a pasta de tradução" }, { status: 500 })
  }
}