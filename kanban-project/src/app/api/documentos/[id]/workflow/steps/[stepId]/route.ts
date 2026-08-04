// src/app/api/documentos/[id]/workflow/steps/[stepId]/route.ts
// CUTOVER V2 — atualização de passo opera sobre PhaseWorkflowStepInstance (V2),
// nunca sobre WorkflowStep legado. stepId é o id da instância V2 do passo.
// Lock-step entre documentos irmãos e progresso ficam no serviço; o avanço de
// fase é derivado do V2 por recalcularFaseDoProcesso. Contrato ({ workflow }) mantido.
//
// AUTORIZAÇÃO: o middleware garante que existe um JWT válido; QUEM é o usuário e o
// QUE ele pode fazer neste passo é decidido AQUI + no serviço, a partir do token —
// nunca a partir do corpo da requisição. O cliente mandava `completedById` lido do
// localStorage; agora esse campo é ignorado e a autoria vem do token.

import { NextResponse } from "next/server"
import { atualizarPassoV2 } from "@/src/services/documento-operacao"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"

interface PatchBody {
  status?: string
  assigneeId?: number | null
  dueAt?: string | null
  notes?: string | null
  motivoBloqueio?: string | null
  trackingCode?: string | null
  externalProtocol?: string | null
  requestChannel?: string | null
  reviewResult?: string | null
  validationResult?: string | null
  externalEntityName?: string | null
  costPaid?: number | null
  paymentMethod?: string | null
  documentMedium?: string | null
  physicalLocation?: string | null
  reviewChecklist?: Record<string, boolean> | null
  stepObservation?: string | null
  legalOpinion?: string | null
  /** Ato ADMINISTRATIVO auditado. Exige permissão própria + motivo + justificativa. */
  forcar?: boolean
  motivo?: string | null
  justificativa?: string | null
}

/**
 * Erros do domínio saem CODIFICADOS. A tela traduz o código para uma frase
 * operacional; nome de model, de coluna e stack não chegam ao usuário.
 */
const HTTP_DO_ERRO: Record<string, number> = {
  STEP_NOT_FOUND: 404,
  STEP_NOT_AVAILABLE: 409,
  CONCURRENT_UPDATE: 409,
  PERMISSION_REQUIRED: 403,
  VALIDATION_ERROR: 422,
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  try {
    const { id, stepId } = await params
    const documentoId = parseInt(id)
    const stepInstanceId = parseInt(stepId)
    if (isNaN(documentoId) || isNaN(stepInstanceId)) {
      return NextResponse.json({ error: "VALIDATION_ERROR", detalhe: "IDs inválidos" }, { status: 400 })
    }

    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "PERMISSION_REQUIRED" }, { status: 401 })

    const body = (await request.json()) as PatchBody
    // `completedById` do cliente é DESCARTADO aqui: a autoria da conclusão é
    // carimbada pelo serviço a partir do usuário do token.
    const { ...patch } = body as Record<string, unknown>
    delete patch.completedById

    const r = await atualizarPassoV2(documentoId, stepInstanceId, patch, {
      usuarioId: usuario.userId,
      permissoes: usuario.permissoes,
    })
    if (!r.ok) {
      const codigo = r.error.split(":")[0]
      return NextResponse.json({ error: r.error }, { status: HTTP_DO_ERRO[codigo] ?? r.status })
    }

    // O avanço de fase é disparado por atualizarPassoV2 (serviço), não aqui: assim
    // ele vale para qualquer caminho que conclua um passo, não só para esta rota.

    return NextResponse.json({ workflow: r.workflow })
  } catch (error) {
    console.error("[PATCH /api/documentos/[id]/workflow/steps/[stepId]]", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
