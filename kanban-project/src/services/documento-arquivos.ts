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
//
// UMA LINHA, TODOS OS VÍNCULOS
// ----------------------------
// `DocumentoArquivo` é o registro único do arquivo. Documento, solicitação, etapa,
// protocolo e classificação mestre são COLUNAS da mesma linha — não cinco tabelas
// de junção com cinco chances de divergir sobre o mesmo arquivo. As três telas
// (Anexos da etapa, Anexos do documento, Protocolo) consultam esta linha; nenhuma
// copia o binário, que continua sendo um só no R2.

import type { Prisma, TipoArquivoDocumento } from "@prisma/client"
import { chaveDeConteudo } from "@/src/lib/process-stage/andamento-etapa"

export interface EntradaVinculoArquivo {
  documentoId: number
  url: string
  nome: string
  mimeType?: string | null
  tamanho?: number | null
  /** Impressão digital do conteúdo (sha256:<hex>), quando a origem calculou. */
  hashConteudo?: string | null
  /** Finalidade do arquivo na operação (dimensão fechada). */
  tipo: TipoArquivoDocumento
  /** Classificação no Cadastro Mestre de Documentos — sempre ID, nunca nome. */
  documentTypeId?: number | null
  solicitacaoId?: number | null
  stepInstanceId?: number | null
  protocoloId?: number | null
  criadoPorId: number | null
  /** Registrado na versão ANTERIOR quando esta substitui outra. */
  motivoSubstituicao?: string | null
}

export interface ResultadoVinculoArquivo {
  id: number
  /** true = linha nova; false = o mesmo arquivo já estava vinculado. */
  criado: boolean
  /** Id da versão que esta substituiu (null = nada foi substituído). */
  substituiuId: number | null
}

/**
 * Vincula um arquivo ao documento. O binário já está no R2; aqui nasce (ou se
 * completa) a REFERÊNCIA.
 *
 * IDEMPOTÊNCIA: a unicidade (documentoId, url) faz duplo clique e retry caírem na
 * MESMA linha — o reenvio só completa vínculo que faltava.
 *
 * SUBSTITUIÇÃO: se a solicitação já tem uma versão VIGENTE do mesmo documento
 * mestre e o arquivo agora é outro, a anterior é marcada como substituída —
 * nunca apagada, nunca sobrescrita, com storageKey, autoria e data preservados.
 * A nova aponta para ela por `substituiId`, e só uma fica vigente (garantido pelo
 * índice único parcial, não pela boa vontade da aplicação).
 */
export async function vincularArquivoDocumentoTx(
  tx: Prisma.TransactionClient,
  args: EntradaVinculoArquivo,
): Promise<ResultadoVinculoArquivo> {
  const agora = new Date()

  const mesmaUrl = await tx.documentoArquivo.findUnique({
    where: { documentoId_url: { documentoId: args.documentoId, url: args.url } },
    select: { id: true, substituiId: true, documentTypeId: true },
  })

  // ── Versão anterior da MESMA evidência, na MESMA solicitação ──────────────
  // Só há substituição quando existe classificação mestre: sem ela não se sabe
  // que dois arquivos ocupam o mesmo lugar, e adivinhar por nome seria inventar.
  let substituiuId: number | null = null
  if (args.solicitacaoId != null && args.documentTypeId != null) {
    const anterior = await tx.documentoArquivo.findFirst({
      where: {
        solicitacaoId: args.solicitacaoId,
        documentTypeId: args.documentTypeId,
        vigente: true,
        ...(mesmaUrl ? { id: { not: mesmaUrl.id } } : {}),
      },
      select: { id: true },
      orderBy: { id: "desc" },
    })
    if (anterior) {
      // Desvigora ANTES de gravar a nova: o índice único parcial não admite duas
      // versões vigentes nem por um instante dentro da transação.
      await tx.documentoArquivo.update({
        where: { id: anterior.id },
        data: {
          vigente: false,
          substituidoEm: agora,
          motivoSubstituicao: args.motivoSubstituicao ?? null,
        },
      })
      substituiuId = anterior.id
    }
  }

  const vinculos = {
    solicitacaoId: args.solicitacaoId ?? undefined,
    stepInstanceId: args.stepInstanceId ?? undefined,
    protocoloId: args.protocoloId ?? undefined,
    documentTypeId: args.documentTypeId ?? undefined,
    hashConteudo: args.hashConteudo ?? undefined,
  }

  const r = await tx.documentoArquivo.upsert({
    where: { documentoId_url: { documentoId: args.documentoId, url: args.url } },
    create: {
      documentoId: args.documentoId,
      solicitacaoId: args.solicitacaoId ?? null,
      stepInstanceId: args.stepInstanceId ?? null,
      protocoloId: args.protocoloId ?? null,
      documentTypeId: args.documentTypeId ?? null,
      hashConteudo: args.hashConteudo ?? null,
      tipo: args.tipo,
      url: args.url,
      nome: args.nome,
      mimeType: args.mimeType ?? null,
      tamanho: args.tamanho ?? null,
      criadoPorId: args.criadoPorId,
      vigente: true,
      substituiId: substituiuId,
    },
    // Reenvio do MESMO arquivo só completa vínculo que faltava; autoria e data
    // de origem ficam como estão (quem anexou primeiro é quem anexou). O elo de
    // versão nunca é reescrito: a história de uma linha se escreve uma vez.
    update: {
      ...vinculos,
      vigente: true,
      ...(mesmaUrl?.substituiId == null && substituiuId != null ? { substituiId: substituiuId } : {}),
    },
    select: { id: true },
  })

  return { id: r.id, criado: mesmaUrl == null, substituiuId }
}

/**
 * Liga arquivos já registrados ao PROTOCOLO da solicitação. Roda depois que o
 * número chega (o protocolo pode nascer no envio ou dias depois) e por isso é um
 * passo separado: o arquivo não espera o protocolo para existir.
 *
 * Só preenche o que está vazio — protocolo já atribuído não é remanejado.
 */
export async function ligarArquivosAoProtocoloTx(
  tx: Prisma.TransactionClient,
  args: { solicitacaoId: number; protocoloId: number; apenasIds?: number[] },
): Promise<number> {
  const r = await tx.documentoArquivo.updateMany({
    where: {
      solicitacaoId: args.solicitacaoId,
      protocoloId: null,
      ...(args.apenasIds ? { id: { in: args.apenasIds } } : {}),
    },
    data: { protocoloId: args.protocoloId },
  })
  return r.count
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
