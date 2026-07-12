// src/app/api/processos/[processoId]/operational-workflow/route.ts
// CP-4G — leitura unificada (dual-read) do workflow operacional. SOMENTE LEITURA.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { getOperationalWorkflow } from "@/src/services/operational-workflow"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const view = await getOperationalWorkflow(processoId)
    if ("error" in view) return NextResponse.json(view, { status: 404 })
    return NextResponse.json(view, { status: 200 })
  } catch (error) {
    console.error("[GET .../operational-workflow]", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
