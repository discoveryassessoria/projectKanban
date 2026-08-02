// ============================================================================
// GET /api/processos/[processoId]/sla — SLA operacional de UM processo
// ----------------------------------------------------------------------------
// Alimenta o card "SLA" do detalhe do processo. Não calcula nada: delega à
// ENGINE ÚNICA (resolveSlaProjection → sla-core), a mesma que a Central
// Operacional e a listagem consomem. Somente leitura.
// ============================================================================

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { prisma } from "@/lib/prisma"
import { resolveSlaProjection } from "@/src/lib/process-stage/sla-projection"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro

  try {
    const { processoId } = await params
    const id = Number.parseInt(processoId, 10)
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const existe = await prisma.processo.count({ where: { id } })
    if (existe === 0) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    return NextResponse.json(await resolveSlaProjection(id))
  } catch (e) {
    console.error("[/api/processos/:id/sla] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar o SLA do processo" }, { status: 500 })
  }
}
