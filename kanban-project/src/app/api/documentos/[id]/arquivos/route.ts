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

    const stepParam = new URL(request.url).searchParams.get("stepInstanceId")
    const stepInstanceId = stepParam ? parseInt(stepParam) : undefined

    return NextResponse.json({
      arquivos: await listarArquivosDocumento(
        documentoId,
        stepInstanceId && !isNaN(stepInstanceId) ? { stepInstanceId } : undefined,
      ),
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
      tipo?: TipoArquivoDocumento
      stepInstanceId?: number | null
      solicitacaoId?: number | null
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

    const tipo = TIPOS_VALIDOS.includes(body.tipo as TipoArquivoDocumento)
      ? (body.tipo as TipoArquivoDocumento)
      : "OUTRO"

    const arquivoId = await prisma.$transaction((tx) =>
      vincularArquivoDocumentoTx(tx, {
        documentoId,
        url,
        nome: String(body.nome ?? "").trim() || url.split("/").pop() || "arquivo",
        mimeType: body.mimeType ?? null,
        tamanho: body.tamanho ?? null,
        tipo,
        stepInstanceId: body.stepInstanceId ?? null,
        solicitacaoId: body.solicitacaoId ?? null,
        criadoPorId: usuario.userId,
      }),
    )

    return NextResponse.json({ arquivoId, arquivos: await listarArquivosDocumento(documentoId) })
  } catch (error) {
    console.error("[POST /api/documentos/[id]/arquivos]", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
