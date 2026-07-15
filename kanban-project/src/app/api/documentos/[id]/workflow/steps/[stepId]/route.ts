// src/app/api/documentos/[id]/workflow/steps/[stepId]/route.ts
// CUTOVER V2 — atualização de passo opera sobre PhaseWorkflowStepInstance (V2),
// nunca sobre WorkflowStep legado. stepId é o id da instância V2 do passo.
// Lock-step entre documentos irmãos e progresso ficam no serviço; o avanço de
// fase é derivado do V2 por recalcularFaseDoProcesso. Contrato ({ workflow }) mantido.

import { NextResponse } from "next/server"
import { atualizarPassoV2 } from "@/src/services/documento-operacao"
import { recalcularFaseDoProcesso } from "@/src/lib/process-stage/recalcular-fase"

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
  completedById?: number | null
  externalEntityName?: string | null
  costPaid?: number | null
  paymentMethod?: string | null
  documentMedium?: string | null
  physicalLocation?: string | null
  reviewChecklist?: Record<string, boolean> | null
  stepObservation?: string | null
  legalOpinion?: string | null
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  try {
    const { id, stepId } = await params
    const documentoId = parseInt(id)
    const stepInstanceId = parseInt(stepId)
    if (isNaN(documentoId) || isNaN(stepInstanceId)) {
      return NextResponse.json({ error: "IDs inválidos" }, { status: 400 })
    }

    const body = (await request.json()) as PatchBody
    const r = await atualizarPassoV2(documentoId, stepInstanceId, body as Record<string, unknown>)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })

    // Avanço de fase derivado do V2 (idempotente). Só ao concluir um passo.
    if (body.status === "concluida") {
      try {
        const adv = await recalcularFaseDoProcesso(documentoId)
        if (adv.mudou) console.log(`[avanço de fase] doc ${documentoId}: ${adv.faseAnterior} → ${adv.faseNova}`)
      } catch (e) {
        console.error("[avanço de fase] erro ao recalcular:", e)
      }
    }

    return NextResponse.json({ workflow: r.workflow })
  } catch (error) {
    console.error("[PATCH /api/documentos/[id]/workflow/steps/[stepId]]", error)
    return NextResponse.json({ error: "Erro ao atualizar step" }, { status: 500 })
  }
}
