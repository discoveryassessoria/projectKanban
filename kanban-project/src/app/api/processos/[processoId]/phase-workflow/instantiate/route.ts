// src/app/api/processos/[processoId]/phase-workflow/instantiate/route.ts
// CP-4B — instanciação versionada do Workflow Interno da fase (runtime v2).
// Só escreve quando kill switch global + Processo.workflowRuntime="v2".
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { instanciarWorkflowDaFase } from "@/src/services/phase-workflow"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const erro = await verificarPermissao(request, "workflow.avancar")
  if (erro) return erro
  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    if (!body.faseMacroKey) return NextResponse.json({ error: "faseMacroKey é obrigatório" }, { status: 400 })

    const resultado = await instanciarWorkflowDaFase({
      processoId,
      faseMacroKey: String(body.faseMacroKey),
      faseMacroId: body.faseMacroId,
      modoKey: body.modoKey,
      ciclo: body.ciclo,
      correlationId: body.correlationId,
      causationId: body.causationId,
      origem: body.origem,
      solicitadoPorId: body.solicitadoPorId,
    })

    if (!resultado.success) {
      // Diagnóstico explícito; nenhuma escrita/instância parcial ocorreu.
      return NextResponse.json(resultado, { status: 409 })
    }
    return NextResponse.json(resultado, { status: resultado.created ? 201 : 200 })
  } catch (error) {
    console.error("Erro ao instanciar workflow da fase:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
