// src/app/api/documentos/[id]/arquivos/route.ts
//
// ARQUIVOS DO DOCUMENTO — consulta consolidada e vínculo de novos arquivos.
//
// `?stepInstanceId=` filtra para a aba Anexos da ETAPA; sem filtro, é a aba do
// DOCUMENTO (todas as origens agrupadas). O binário está no R2; aqui só existe a
// referência — o mesmo arquivo nunca aparece duas vezes, porque a unicidade é do
// banco (documentoId, url), não da tela.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { listarArquivosDocumento, vincularArquivoDocumentoTx } from "@/src/services/solicitacao-documento"
import type { TipoArquivoDocumento } from "@prisma/client"

const TIPOS_VALIDOS: TipoArquivoDocumento[] = [
  "REQUERIMENTO_ENVIADO", "COMPROVANTE_PROTOCOLO", "COMPROVANTE_CONTATO", "DOCUMENTO_RECEBIDO", "OUTRO",
]

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 401 })

    const q = new URL(request.url).searchParams
    const numero = (nome: string) => {
      const v = q.get(nome)
      if (!v) return undefined
      const n = parseInt(v)
      return isNaN(n) ? undefined : n
    }

    return NextResponse.json({
      arquivos: await listarArquivosDocumento(documentoId, {
        stepInstanceId: numero("stepInstanceId"),
        protocoloId: numero("protocoloId"),
        // O histórico de substituições é pedido explicitamente: a operação vê o
        // vigente por padrão, e a versão trocada continua acessível quando se quer.
        incluirHistorico: q.get("historico") === "1",
      }),
    })
  } catch (error) {
    console.error("[GET /api/documentos/[id]/arquivos]", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

/** POST — vincula ao documento um arquivo já enviado ao storage. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 401 })
    if (usuario.permissoes["arvore.editar_documento"] !== true) {
      return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 403 })
    }

    const body = (await request.json()) as {
      url?: string
      nome?: string
      mimeType?: string | null
      tamanho?: number | null
      hash?: string | null
      tipo?: TipoArquivoDocumento
      documentTypeId?: number | null
      stepInstanceId?: number | null
      solicitacaoId?: number | null
      protocoloId?: number | null
      motivoSubstituicao?: string | null
    }
    const url = String(body.url ?? "").trim()
    if (!url) return NextResponse.json({ error: "VALIDATION_ERROR:URL" }, { status: 422 })

    // IDOR: a etapa informada TEM de ser deste documento.
    if (body.stepInstanceId) {
      const passo = await prisma.phaseWorkflowStepInstance.findUnique({
        where: { id: body.stepInstanceId }, select: { documentoId: true },
      })
      if (!passo || passo.documentoId !== documentoId) {
        return NextResponse.json({ error: "STEP_NOT_FOUND" }, { status: 404 })
      }
    }
    // IDOR: a solicitação informada TEM de ser deste documento.
    if (body.solicitacaoId) {
      const s = await prisma.solicitacaoDocumento.findUnique({
        where: { id: body.solicitacaoId }, select: { documentoId: true },
      })
      if (!s || s.documentoId !== documentoId) {
        return NextResponse.json({ error: "STEP_NOT_FOUND" }, { status: 404 })
      }
    }
    // IDOR: o protocolo informado TEM de estar vinculado a este documento.
    if (body.protocoloId) {
      const vinculo = await prisma.protocoloDocumento.findFirst({
        where: { protocoloId: body.protocoloId, documentoId }, select: { id: true },
      })
      if (!vinculo) return NextResponse.json({ error: "PROTOCOL_NOT_FOUND" }, { status: 404 })
    }
    // A classificação mestre tem de EXISTIR e estar ativa no cadastro. Sem esta
    // verificação, um id inventado no payload viraria classificação de arquivo.
    if (body.documentTypeId != null) {
      const mestre = await prisma.tipoDocumentoCadastro.findUnique({
        where: { id: body.documentTypeId }, select: { id: true, ativo: true },
      })
      if (!mestre || !mestre.ativo) {
        return NextResponse.json({ error: "VALIDATION_ERROR:DOCUMENT_TYPE" }, { status: 422 })
      }
    }

    const tipo = TIPOS_VALIDOS.includes(body.tipo as TipoArquivoDocumento)
      ? (body.tipo as TipoArquivoDocumento)
      : "OUTRO"

    const vinculo = await prisma.$transaction((tx) =>
      vincularArquivoDocumentoTx(tx, {
        documentoId,
        url,
        nome: String(body.nome ?? "").trim() || url.split("/").pop() || "arquivo",
        mimeType: body.mimeType ?? null,
        tamanho: body.tamanho ?? null,
        hashConteudo: body.hash ?? null,
        tipo,
        documentTypeId: body.documentTypeId ?? null,
        stepInstanceId: body.stepInstanceId ?? null,
        solicitacaoId: body.solicitacaoId ?? null,
        protocoloId: body.protocoloId ?? null,
        motivoSubstituicao: body.motivoSubstituicao ?? null,
        criadoPorId: usuario.userId,
      }),
    )

    return NextResponse.json({
      arquivoId: vinculo.id,
      substituiuArquivoId: vinculo.substituiuId,
      arquivos: await listarArquivosDocumento(documentoId),
    })
  } catch (error) {
    console.error("[POST /api/documentos/[id]/arquivos]", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
