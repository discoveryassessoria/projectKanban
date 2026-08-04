// src/app/api/documentos/[id]/solicitacoes/[solicitacaoId]/protocolos/route.ts
//
// PROTOCOLO INFORMADO DEPOIS. Canais como e-mail e WhatsApp podem não devolver
// número no envio; quando ele chega, entra AQUI — como linha nova no histórico da
// solicitação que já existe. Não nasce uma segunda solicitação nem um segundo
// cadastro de protocolo, e o número anterior nunca é sobrescrito.

import { NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import {
  informarProtocoloPosterior,
  carregarResumoProtocoloDocumento,
} from "@/src/services/solicitacao-documento"

const HTTP_DO_ERRO: Record<string, number> = {
  PROTOCOL_NOT_FOUND: 404,
  PERMISSION_REQUIRED: 403,
  VALIDATION_ERROR: 422,
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; solicitacaoId: string }> },
) {
  try {
    const { id, solicitacaoId } = await params
    const documentoId = parseInt(id)
    const idSolicitacao = parseInt(solicitacaoId)
    if (isNaN(documentoId) || isNaN(idSolicitacao)) {
      return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
    }

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 401 })

    const body = (await request.json()) as {
      numeroProtocolo?: string
      observacoes?: string | null
      comprovante?: { url: string; nome?: string | null; mimeType?: string | null; tamanho?: number | null } | null
    }

    const r = await informarProtocoloPosterior(
      documentoId,
      idSolicitacao,
      String(body.numeroProtocolo ?? ""),
      { usuarioId: usuario.userId, permissoes: usuario.permissoes },
      { observacoes: body.observacoes ?? null, comprovante: body.comprovante ?? null },
    )
    if (!r.ok) {
      const codigo = r.error.split(":")[0]
      return NextResponse.json({ error: r.error }, { status: HTTP_DO_ERRO[codigo] ?? r.status })
    }
    return NextResponse.json({
      protocoloId: r.protocoloId,
      resumo: await carregarResumoProtocoloDocumento(documentoId),
    })
  } catch (error) {
    console.error("[POST .../solicitacoes/[solicitacaoId]/protocolos]", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
