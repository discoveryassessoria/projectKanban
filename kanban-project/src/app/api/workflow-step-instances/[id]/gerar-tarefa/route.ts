// src/app/api/workflow-step-instances/[id]/gerar-tarefa/route.ts
// CP-4C — gera a Tarefa real de um Passo humano aplicável (runtime v2).
// Permissão específica (gerar tarefa NÃO é avanço de workflow).
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const erro = await verificarPermissao(request, "workflow.gerarTarefa")
  if (erro) return erro
  try {
    const { id: idParam } = await params
    const stepInstanceId = parseInt(idParam)
    if (isNaN(stepInstanceId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const resultado = await garantirTarefaDePasso({
      stepInstanceId,
      taskRole: body.taskRole,
      correlationId: body.correlationId,
      causationId: body.causationId,
      origem: body.origem,
      solicitadoPorId: body.solicitadoPorId,
    })

    if (!resultado.success) {
      return NextResponse.json(resultado, { status: 409 })
    }
    return NextResponse.json(resultado, { status: resultado.created ? 201 : 200 })
  } catch (error) {
    console.error("Erro ao gerar tarefa do passo:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
