// src/app/api/documentos/[id]/solicitacoes/route.ts
//
// SOLICITAÇÃO DE CERTIDÃO — registro do ato e conclusão da etapa, num COMMIT só.
//
// Substitui o par de chamadas que o editor fazia antes (PUT no documento + PATCH
// no passo): duas requisições, duas transações e nenhuma garantia de que as duas
// aconteciam. Agora é uma rota, um serviço, uma transação.
//
// Autoria e permissão vêm do token. O corpo traz só CONTEÚDO.

import { NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import {
  registrarSolicitacaoDocumento,
  carregarResumoProtocoloDocumento,
  type EntradaSolicitacao,
} from "@/src/services/solicitacao-documento"

const HTTP_DO_ERRO: Record<string, number> = {
  STEP_NOT_FOUND: 404,
  STEP_NOT_AVAILABLE: 409,
  PROTOCOL_NOT_FOUND: 404,
  PERMISSION_REQUIRED: 403,
  VALIDATION_ERROR: 422,
  CONCURRENT_UPDATE: 409,
}

/** GET — solicitações do documento (mesma fonte da aba Protocolo). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 401 })

    return NextResponse.json({ resumo: await carregarResumoProtocoloDocumento(documentoId) })
  } catch (error) {
    console.error("[GET /api/documentos/[id]/solicitacoes]", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

/** POST — registra a solicitação e (opcionalmente) conclui a etapa. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const documentoId = parseInt(id)
    if (isNaN(documentoId)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 401 })

    const body = (await request.json()) as EntradaSolicitacao & { stepInstanceId?: number }
    const stepInstanceId = Number(body.stepInstanceId)
    if (!Number.isFinite(stepInstanceId)) {
      return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
    }

    const r = await registrarSolicitacaoDocumento(documentoId, stepInstanceId, body, {
      usuarioId: usuario.userId,
      permissoes: usuario.permissoes,
    })
    if (!r.ok) {
      const codigo = r.error.split(":")[0]
      return NextResponse.json({ error: r.error }, { status: HTTP_DO_ERRO[codigo] ?? r.status })
    }
    return NextResponse.json({
      solicitacaoId: r.solicitacaoId,
      protocoloId: r.protocoloId,
      arquivoId: r.arquivoId,
      workflow: r.workflow,
      resumo: await carregarResumoProtocoloDocumento(documentoId),
    })
  } catch (error) {
    console.error("[POST /api/documentos/[id]/solicitacoes]", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
