// src/app/api/processos/[processoId]/advance/simulate/route.ts
// CP-4E — simulação de avanço (dry-run). NÃO altera fase, NÃO cria Tarefa,
// NÃO grava evento/outbox, NÃO executa financeiro, NÃO ativa runtime.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { simulateAdvance } from "@/src/lib/motor/phase-simulation"

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
    const resultado = await simulateAdvance(processoId, { correlationId: body.correlationId })
    return NextResponse.json(resultado, { status: resultado.success ? 200 : 404 })
  } catch (error) {
    console.error("Erro na simulação de avanço:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
