// src/app/api/documentos/[id]/workflow/steps/[stepId]/andamento/route.ts
//
// REGISTRAR ANDAMENTO de uma etapa: salvar campos de acompanhamento, adicionar um
// contato ao histórico, adicionar observação e vincular anexos — sem concluir nada.
//
// Rota separada do PATCH do passo de propósito: PATCH muda ESTADO (e arrasta
// tarefa, necessidade, irmãos e avanço de fase junto). Andamento não muda estado,
// e por isso não pode entrar pelo caminho que dispara avanço.
//
// Tudo o que a rota decide vem do token: quem é o autor e o que ele pode fazer.
// O corpo da requisição só traz CONTEÚDO.

import { NextResponse } from "next/server"
import { registrarAndamentoPassoV2 } from "@/src/services/documento-operacao"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"

const HTTP_DO_ERRO: Record<string, number> = {
  STEP_NOT_FOUND: 404,
  STEP_NOT_AVAILABLE: 409,
  CONCURRENT_UPDATE: 409,
  PERMISSION_REQUIRED: 403,
  VALIDATION_ERROR: 422,
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  try {
    const { id, stepId } = await params
    const documentoId = parseInt(id)
    const stepInstanceId = parseInt(stepId)
    if (isNaN(documentoId) || isNaN(stepInstanceId)) {
      return NextResponse.json({ error: "VALIDATION_ERROR", detalhe: "IDs inválidos" }, { status: 400 })
    }

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 401 })

    const body = (await request.json()) as {
      campos?: Record<string, unknown>
      contato?: unknown
      lockVersion?: number
    }

    const r = await registrarAndamentoPassoV2(
      documentoId,
      stepInstanceId,
      {
        campos: body.campos,
        contato: body.contato,
        lockVersion: typeof body.lockVersion === "number" ? body.lockVersion : undefined,
      },
      { usuarioId: usuario.userId, permissoes: usuario.permissoes, isAdmin: usuario.tipo === "admin" },
    )

    if (!r.ok) {
      const codigo = r.error.split(":")[0]
      return NextResponse.json({ error: r.error }, { status: HTTP_DO_ERRO[codigo] ?? r.status })
    }
    return NextResponse.json({ workflow: r.workflow })
  } catch (error) {
    console.error("[POST /api/documentos/[id]/workflow/steps/[stepId]/andamento]", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
