// src/app/api/documentos/[id]/observacoes/route.ts
//
// OBSERVAÇÕES OPERACIONAIS DO DOCUMENTO — append-only, com autor e carimbo.
// `?stepInstanceId=` restringe às da etapa; sem filtro, é o documento inteiro.
// Nada aqui edita ou apaga observação: registrar é acrescentar.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import {
  listarObservacoesDocumento,
  registrarObservacaoDocumentoTx,
} from "@/src/services/solicitacao-documento"

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
      observacoes: await listarObservacoesDocumento(
        documentoId,
        stepInstanceId && !isNaN(stepInstanceId) ? { stepInstanceId } : undefined,
      ),
    })
  } catch (error) {
    console.error("[GET /api/documentos/[id]/observacoes]", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 401 })
    if (usuario.permissoes["workflow.iniciarPasso"] !== true) {
      return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 403 })
    }

    const body = (await request.json()) as { texto?: string; stepInstanceId?: number | null }
    const texto = String(body.texto ?? "").trim()
    if (!texto) return NextResponse.json({ error: "VALIDATION_ERROR:OBSERVACAO_VAZIA" }, { status: 422 })

    // IDOR: a etapa informada TEM de ser deste documento.
    if (body.stepInstanceId) {
      const passo = await prisma.phaseWorkflowStepInstance.findUnique({
        where: { id: body.stepInstanceId }, select: { documentoId: true },
      })
      if (!passo || passo.documentoId !== documentoId) {
        return NextResponse.json({ error: "STEP_NOT_FOUND" }, { status: 404 })
      }
    }

    await prisma.$transaction((tx) =>
      registrarObservacaoDocumentoTx(tx, {
        documentoId,
        texto,
        criadoPorId: usuario.userId,
        stepInstanceId: body.stepInstanceId ?? null,
      }),
    )

    return NextResponse.json({ observacoes: await listarObservacoesDocumento(documentoId) })
  } catch (error) {
    console.error("[POST /api/documentos/[id]/observacoes]", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
