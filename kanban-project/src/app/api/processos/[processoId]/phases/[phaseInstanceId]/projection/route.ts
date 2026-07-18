// src/app/api/processos/[processoId]/phases/[phaseInstanceId]/projection/route.ts
//
// Consulta HISTÓRICA (somente leitura) de uma instância de fase materializada.
// Gate de leitura: processos.ver. NUNCA materializa, avança, bloqueia ou recalcula.
// Chaveada por phaseInstanceId (contrato multi-ciclo).

import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { resolveHistoricalPhaseProjection } from "@/src/lib/motor/resolve-historical-phase-projection"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string; phaseInstanceId: string }> },
) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro

  const { processoId, phaseInstanceId } = await params
  const pid = parseInt(processoId)
  const iid = parseInt(phaseInstanceId)
  if (isNaN(pid) || isNaN(iid)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  }

  try {
    const res = await resolveHistoricalPhaseProjection({ processoId: pid, workflowInstanceId: iid })
    if (!res.ok) {
      const status = res.code === "NAO_ENCONTRADO" ? 404 : 403
      return NextResponse.json({ error: res.message, code: res.code }, { status })
    }
    return NextResponse.json(res.projection)
  } catch (error) {
    console.error("[GET .../phases/[phaseInstanceId]/projection]", error)
    return NextResponse.json({ error: "Erro ao carregar projeção histórica" }, { status: 500 })
  }
}
