// src/services/modelos/documentos-gerados.ts
//
// LEITURA E ATOS SOBRE O DOCUMENTO GERADO.
//
// A tela do cliente, a do processo e a de uma etapa futura leem TODAS daqui.
// Nenhuma delas copia arquivo: o que circula é a referência (documento gerado +
// versão), e o binário continua sendo um só, no storage privado.

import type { Prisma } from "@prisma/client"
import { prisma } from "@/src/lib/prisma"
import { vincularArquivoDocumentoTx } from "@/src/services/documento-arquivos"
import { urlAssinadaDeLeitura, MIME_DOCX, MIME_PDF } from "@/src/lib/documentos/modelos/storage-privado"

export class ErroDocumentoGerado extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly detalhe?: unknown,
  ) {
    super(mensagem)
    this.name = "ErroDocumentoGerado"
  }
}

export type FormatoArquivo = "docx" | "pdf"

const INCLUSAO = {
  modelo: { select: { id: true, codigo: true, nome: true, categoria: true } },
  documentType: { select: { id: true, name: true, publicCode: true } },
  contratante: { select: { id: true, nome: true, publicCode: true } },
  requerente: { select: { id: true, nome: true, publicCode: true } },
  processo: { select: { id: true, codigo: true, nome: true, pais: true } },
  servico: { select: { id: true, name: true } },
  criadoPor: { select: { id: true, nome: true } },
  versoes: {
    orderBy: { numero: "desc" as const },
    include: {
      geradoPor: { select: { id: true, nome: true } },
      modeloVersao: { select: { id: true, numero: true, checksum: true } },
    },
  },
} satisfies Prisma.DocumentoGeradoInclude

export interface FiltroDocumentosGerados {
  contratanteId?: number
  requerenteId?: number
  processoId?: number
  pessoaId?: number
}

export async function listarDocumentosGerados(filtro: FiltroDocumentosGerados) {
  const where: Prisma.DocumentoGeradoWhereInput = {}
  if (filtro.contratanteId != null) where.contratanteId = filtro.contratanteId
  if (filtro.requerenteId != null) where.requerenteId = filtro.requerenteId
  if (filtro.processoId != null) where.processoId = filtro.processoId
  if (filtro.pessoaId != null) where.pessoaId = filtro.pessoaId

  if (Object.keys(where).length === 0) {
    throw new ErroDocumentoGerado(
      "FILTRO_OBRIGATORIO",
      "Informe cliente, pessoa ou processo — a lista nunca é global.",
    )
  }

  return prisma.documentoGerado.findMany({
    where,
    include: INCLUSAO,
    orderBy: { createdAt: "desc" },
  })
}

export async function obterDocumentoGerado(id: number) {
  return prisma.documentoGerado.findUnique({ where: { id }, include: INCLUSAO })
}

/**
 * URL assinada de UM arquivo de UMA versão.
 *
 * ANTI-IDOR: a chave do storage NUNCA vem do cliente. O pedido diz "documento
 * gerado X, versão Y, formato Z"; o servidor confere que a versão pertence
 * mesmo àquele documento e só então resolve a chave. Adivinhar id não abre
 * arquivo de outro, e chave de storage não é aceita como entrada.
 */
export async function urlDoArquivo(args: {
  documentoGeradoId: number
  versaoId?: number | null
  formato: FormatoArquivo
  download: boolean
}): Promise<{ url: string; nome: string; validadeSegundos: number }> {
  const versao = args.versaoId
    ? await prisma.documentoGeradoVersao.findFirst({
        where: { id: args.versaoId, documentoGeradoId: args.documentoGeradoId },
      })
    : await prisma.documentoGeradoVersao.findFirst({
        where: { documentoGeradoId: args.documentoGeradoId, status: "VIGENTE" },
      })

  if (!versao) {
    throw new ErroDocumentoGerado(
      "VERSAO_INEXISTENTE",
      "Versão não encontrada para este documento gerado.",
    )
  }

  const chave = args.formato === "docx" ? versao.docxChave : versao.pdfChave
  const nome = args.formato === "docx" ? versao.docxNome : versao.pdfNome
  const mime = args.formato === "docx" ? MIME_DOCX : MIME_PDF

  const url = await urlAssinadaDeLeitura({
    chave,
    nomeParaDownload: nome,
    mime,
    download: args.download,
  })
  return { url, nome, validadeSegundos: 300 }
}

/** Vincula (ou revincula) o documento gerado a um processo. */
export async function vincularAoProcesso(args: {
  documentoGeradoId: number
  processoId: number
  usuarioId: number
}) {
  return prisma.$transaction(async (tx) => {
    const atual = await tx.documentoGerado.findUnique({
      where: { id: args.documentoGeradoId },
      select: { id: true, processoId: true, chaveIdentidade: true, documentTypeId: true },
    })
    if (!atual) throw new ErroDocumentoGerado("INEXISTENTE", "Documento gerado não encontrado.")

    const processo = await tx.processo.findUnique({
      where: { id: args.processoId },
      select: { id: true },
    })
    if (!processo) throw new ErroDocumentoGerado("PROCESSO_INEXISTENTE", "Processo não encontrado.")

    // A identidade do agregado inclui o processo. Trocar o processo mudaria a
    // identidade — o que é permitido apenas quando o documento ainda não tinha
    // processo. Reapontar um documento já vinculado seria reescrever história.
    if (atual.processoId != null && atual.processoId !== args.processoId) {
      throw new ErroDocumentoGerado(
        "PROCESSO_JA_VINCULADO",
        "Este documento já pertence a outro processo. Gere um documento para o processo desejado.",
      )
    }
    if (atual.processoId === args.processoId) return atual

    const novaIdentidade = atual.chaveIdentidade.replace(/\|proc:[^|]*$/, `|proc:${args.processoId}`)

    const atualizado = await tx.documentoGerado.update({
      where: { id: atual.id },
      data: { processoId: args.processoId, chaveIdentidade: novaIdentidade },
    })

    await tx.logAuditoria.create({
      data: {
        acao: "DOCUMENTO_GERADO_VINCULADO_PROCESSO",
        entidade: "DocumentoGerado",
        entidadeId: atual.id,
        descricao: `Documento gerado vinculado ao processo ${args.processoId}.`,
        detalhes: { processoId: args.processoId },
        usuarioId: args.usuarioId,
      },
    })

    return atualizado
  })
}

/**
 * Vincula o documento gerado a um Documento Operacional EXISTENTE.
 *
 * O documento operacional não é criado aqui — o motor documental é dono da
 * criação, e inventar documento por fora romperia a materialização. O que
 * acontece é REFERÊNCIA: os dois arquivos passam a aparecer nos Anexos daquele
 * documento apontando para o MESMO binário, pela rota autenticada. Nenhum
 * upload novo, nenhuma cópia.
 */
export async function vincularAoDocumentoOperacional(args: {
  documentoGeradoId: number
  documentoId: number
  stepInstanceId?: number | null
  usuarioId: number
}) {
  return prisma.$transaction(async (tx) => {
    const gerado = await tx.documentoGerado.findUnique({
      where: { id: args.documentoGeradoId },
      select: {
        id: true,
        documentTypeId: true,
        versoes: {
          where: { status: "VIGENTE" },
          select: { id: true, numero: true, docxNome: true, pdfNome: true, docxChecksum: true, pdfChecksum: true },
        },
      },
    })
    if (!gerado) throw new ErroDocumentoGerado("INEXISTENTE", "Documento gerado não encontrado.")

    const vigente = gerado.versoes[0]
    if (!vigente) {
      throw new ErroDocumentoGerado("SEM_VERSAO_VIGENTE", "Não há versão vigente para vincular.")
    }

    const documento = await tx.documento.findUnique({
      where: { id: args.documentoId },
      select: { id: true },
    })
    if (!documento) {
      throw new ErroDocumentoGerado("DOCUMENTO_INEXISTENTE", "Documento operacional não encontrado.")
    }

    for (const formato of ["docx", "pdf"] as const) {
      await vincularArquivoDocumentoTx(tx, {
        documentoId: args.documentoId,
        url: urlInternaDoArquivo(gerado.id, vigente.id, formato),
        nome: formato === "docx" ? vigente.docxNome : vigente.pdfNome,
        mimeType: formato === "docx" ? MIME_DOCX : MIME_PDF,
        hashConteudo: formato === "docx" ? vigente.docxChecksum : vigente.pdfChecksum,
        tipo: "OUTRO",
        documentTypeId: gerado.documentTypeId,
        stepInstanceId: args.stepInstanceId ?? null,
        criadoPorId: args.usuarioId,
      })
    }

    await tx.documentoGerado.update({
      where: { id: gerado.id },
      data: { documentoId: args.documentoId },
    })

    return { documentoGeradoId: gerado.id, documentoId: args.documentoId, versaoId: vigente.id }
  })
}

/**
 * Endereço interno do arquivo — sempre a rota autenticada, nunca o storage.
 *
 * É este endereço que vai para qualquer lugar que precise "apontar" para o
 * arquivo. Ele não vaza chave, exige sessão e sai assinado com validade curta.
 */
export function urlInternaDoArquivo(
  documentoGeradoId: number,
  versaoId: number,
  formato: FormatoArquivo,
): string {
  return `/api/documentos-gerados/${documentoGeradoId}/arquivo?versaoId=${versaoId}&formato=${formato}`
}

/** INVALIDAÇÃO — ato administrativo. Não apaga arquivo nem versão. */
export async function invalidarVersao(args: {
  documentoGeradoId: number
  versaoId: number
  motivo: string
  usuarioId: number
}) {
  return prisma.$transaction(async (tx) => {
    const versao = await tx.documentoGeradoVersao.findFirst({
      where: { id: args.versaoId, documentoGeradoId: args.documentoGeradoId },
      select: { id: true, numero: true, status: true },
    })
    if (!versao) throw new ErroDocumentoGerado("VERSAO_INEXISTENTE", "Versão não encontrada.")
    if (versao.status === "INVALIDADA") return versao

    const invalidada = await tx.documentoGeradoVersao.update({
      where: { id: versao.id },
      data: {
        status: "INVALIDADA",
        invalidadaEm: new Date(),
        invalidadaPorId: args.usuarioId,
        motivoInvalidacao: args.motivo.slice(0, 300),
      },
    })

    const restaVigente = await tx.documentoGeradoVersao.count({
      where: { documentoGeradoId: args.documentoGeradoId, status: "VIGENTE" },
    })
    if (restaVigente === 0) {
      await tx.documentoGerado.update({
        where: { id: args.documentoGeradoId },
        data: { status: "INVALIDADO" },
      })
    }

    await tx.logAuditoria.create({
      data: {
        acao: "DOCUMENTO_GERADO_INVALIDADO",
        entidade: "DocumentoGeradoVersao",
        entidadeId: invalidada.id,
        descricao: `Versão ${invalidada.numero} invalidada.`,
        detalhes: { documentoGeradoId: args.documentoGeradoId, motivo: args.motivo },
        usuarioId: args.usuarioId,
      },
    })

    return invalidada
  })
}
