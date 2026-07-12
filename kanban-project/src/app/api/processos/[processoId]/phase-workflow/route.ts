// src/app/api/processos/[processoId]/phase-workflow/route.ts
// CP-4B — leitura da instância ativa do Workflow Interno da fase.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { getInstanciaAtiva } from "@/src/services/phase-workflow"

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
    const { searchParams } = new URL(request.url)
    const faseMacroKey = searchParams.get("faseMacroKey")
    if (!faseMacroKey) return NextResponse.json({ error: "faseMacroKey é obrigatório" }, { status: 400 })

    const instancia = await getInstanciaAtiva(processoId, faseMacroKey)
    return NextResponse.json({ instancia })
  } catch (error) {
    console.error("Erro ao buscar instância de workflow:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
