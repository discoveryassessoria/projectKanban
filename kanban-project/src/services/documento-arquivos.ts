// src/services/documento-arquivos.ts
//
// ARQUIVOS E OBSERVAÇÕES DO DOCUMENTO — escrita canônica, sem dependência do
// motor de passos.
//
// Mora aqui (e não junto da solicitação) porque estes dois blocos são usados por
// DOIS caminhos: o registro da solicitação de certidão e o andamento de qualquer
// etapa. Se ficassem no serviço da solicitação, o andamento teria de importá-lo e
// o serviço da solicitação importa o motor de passos — import circular. Um módulo
// pequeno, sem ciclo, e continua existindo UMA implementação de cada escrita.

import type { Prisma, TipoArquivoDocumento } from "@prisma/client"
import { chaveDeConteudo } from "@/src/lib/process-stage/andamento-etapa"

/**
 * Vincula um arquivo ao documento. O binário já está no R2; aqui nasce a
 * REFERÊNCIA. A unicidade (documentoId, url) faz o retry não duplicar linha.
 */
export async function vincularArquivoDocumentoTx(
  tx: Prisma.TransactionClient,
  args: {
    documentoId: number
    url: string
    nome: string
    mimeType?: string | null
    tamanho?: number | null
    tipo: TipoArquivoDocumento
    solicitacaoId?: number | null
    stepInstanceId?: number | null
    criadoPorId: number | null
  },
): Promise<number> {
  const r = await tx.documentoArquivo.upsert({
    where: { documentoId_url: { documentoId: args.documentoId, url: args.url } },
    create: {
      documentoId: args.documentoId,
      solicitacaoId: args.solicitacaoId ?? null,
      stepInstanceId: args.stepInstanceId ?? null,
      tipo: args.tipo,
      url: args.url,
      nome: args.nome,
      mimeType: args.mimeType ?? null,
      tamanho: args.tamanho ?? null,
      criadoPorId: args.criadoPorId,
    },
    // Reenvio do MESMO arquivo só completa vínculo que faltava; autoria e data
    // de origem ficam como estão (quem anexou primeiro é quem anexou).
    update: {
      solicitacaoId: args.solicitacaoId ?? undefined,
      stepInstanceId: args.stepInstanceId ?? undefined,
    },
    select: { id: true },
  })
  return r.id
}

/** Observação append-only do documento. Chave derivada do conteúdo = sem duplicata. */
export async function registrarObservacaoDocumentoTx(
  tx: Prisma.TransactionClient,
  args: {
    documentoId: number
    texto: string
    criadoPorId: number | null
    solicitacaoId?: number | null
    stepInstanceId?: number | null
    chaveIdempotencia?: string
  },
): Promise<number | null> {
  const chave =
    args.chaveIdempotencia ??
    `obs:doc${args.documentoId}:step${args.stepInstanceId ?? 0}:${chaveDeConteudo([args.texto, args.criadoPorId])}`
  const existente = await tx.documentoObservacao.findUnique({
    where: { chaveIdempotencia: chave },
    select: { id: true },
  })
  if (existente) return existente.id
  const r = await tx.documentoObservacao.create({
    data: {
      documentoId: args.documentoId,
      solicitacaoId: args.solicitacaoId ?? null,
      stepInstanceId: args.stepInstanceId ?? null,
      texto: args.texto,
      criadoPorId: args.criadoPorId,
      chaveIdempotencia: chave,
    },
    select: { id: true },
  })
  return r.id
}
