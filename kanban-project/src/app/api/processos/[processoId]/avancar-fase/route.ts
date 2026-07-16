// src/app/api/processos/[processoId]/avancar-fase/route.ts
//
// CONSOLIDAÇÃO DO AVANÇO DE FASE — esta rota é apenas um ADAPTADOR fino sobre o
// PhaseAdvanceService (único serviço autorizado a mudar Processo.faseAtualKey).
// NÃO escreve faseAtualKey diretamente. O cutover para runtime v2 está concluído;
// o antigo caminho legado (escrita direta + motor legado) foi removido.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import { advance } from "@/src/lib/motor/phase-advance"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  // Gate canônico: avançar de fase exige workflow.avancar.
  const erro = await verificarPermissao(request, "workflow.avancar")
  if (erro) return erro

  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, workflowRuntime: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })

    const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
    if (resolveWorkflowRuntime(processo.workflowRuntime, cfg?.runtimeV2Habilitado ?? false) !== "v2") {
      // Runtime legado desativado (cutover concluído). Não há escrita direta.
      return NextResponse.json(
        { error: "Runtime legado descontinuado. Avanço de fase é exclusivo do PhaseAdvanceService (runtime v2).", runtime: "legacy" },
        { status: 409 },
      )
    }

    // ÚNICA cadeia de avanço: Workflow Interno conclui + BlockingEngine libera +
    // Workflow Macro define a próxima fase → PhaseAdvanceService efetiva.
    const r = await advance(id, { origem: "avancar-fase" })
    const status = r.success ? 200 : r.resultado === "CONFLITO" ? 409 : r.resultado === "BLOQUEADO" ? 422 : 400
    return NextResponse.json(r, { status })
  } catch (error) {
    console.error("[POST .../avancar-fase]", error)
    return NextResponse.json({ error: "Erro ao avançar de fase" }, { status: 500 })
  }
}
