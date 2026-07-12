// src/app/api/processos/[processoId]/observability/route.ts
// CP-4G — observabilidade do runtime v2 do processo. SOMENTE LEITURA.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { getRuntimeObservability } from "@/src/lib/motor/observability"

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
    const obs = await getRuntimeObservability(processoId)
    return NextResponse.json(obs, { status: 200 })
  } catch (error) {
    console.error("[GET .../observability]", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
