// src/app/api/processos/[processoId]/fase/route.ts
//
// Arrastar o card no Kanban = SOLICITAÇÃO de avanço (não escrita direta de fase).
// Aceita apenas mover para a PRÓXIMA fase (ordem do Workflow Macro), delegando ao
// PhaseAdvanceService (que valida Workflow Interno + BlockingEngine). Qualquer
// outro destino é rejeitado — o card volta à coluna de origem no cliente.
// faseAtualKey NUNCA é escrita aqui.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import { advance } from "@/src/lib/motor/phase-advance"

export async function PUT(request: Request, { params }: { params: Promise<{ processoId: string }> }) {
  // Item 1 da auditoria — alinhado ao gate canônico de avanço (antes: processos.editar_status).
  const erro = await verificarPermissao(request, "workflow.avancar")
  if (erro) return erro

  try {
    const { processoId: idStr } = await params
    const processoId = parseInt(idStr)
    if (!processoId) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const faseAtualKey = String(body?.faseAtualKey || "").trim()
    if (!faseAtualKey) return NextResponse.json({ error: "Informe a fase." }, { status: 400 })

    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true, tipoProcessoMotorId: true, faseAtualKey: true, workflowRuntime: true },
    })
    if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    if (!processo.tipoProcessoMotorId) {
      return NextResponse.json({ error: "Processo sem tipo do motor — não é possível mover de fase." }, { status: 400 })
    }

    // a fase de destino tem que existir no workflow do tipo
    const wf = await prisma.macroWorkflow.findUnique({
      where: { tipoProcessoId: processo.tipoProcessoMotorId },
      include: { fases: { where: { showInKanban: true }, select: { phaseKey: true } } },
    })
    const valida = wf?.fases.some((f) => f.phaseKey === faseAtualKey)
    if (!valida) {
      return NextResponse.json({ error: "Fase inválida para o tipo deste processo." }, { status: 400 })
    }

    // CONSOLIDAÇÃO DO AVANÇO DE FASE — faseAtualKey NUNCA é escrita diretamente
    // (regra suprema: só o PhaseAdvanceService escreve). Arrastar o card é apenas
    // uma SOLICITAÇÃO de avanço: só é aceita quando o destino é EXATAMENTE a
    // próxima fase pela ordem do Workflow Macro (delega ao avanço normal, que
    // valida Workflow Interno + BlockingEngine). Pular/voltar fases usa os
    // endpoints canônicos (/advance/force, /phase/return, /phase/reopen).
    const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
    if (resolveWorkflowRuntime(processo.workflowRuntime, cfg?.runtimeV2Habilitado ?? false) !== "v2") {
      return NextResponse.json(
        { error: "Runtime legado descontinuado. O avanço de fase é exclusivo do PhaseAdvanceService (runtime v2).", runtime: "legacy" },
        { status: 409 },
      )
    }

    const ordenadas = await prisma.macroWorkflow.findUnique({
      where: { tipoProcessoId: processo.tipoProcessoMotorId },
      include: { fases: { orderBy: { ordem: "asc" }, select: { phaseKey: true, ordem: true } } },
    })
    const fases = ordenadas?.fases ?? []
    const idxAtual = fases.findIndex((f) => f.phaseKey === (processo.faseAtualKey ?? ""))
    const proxima = idxAtual >= 0 && idxAtual + 1 < fases.length ? fases[idxAtual + 1].phaseKey : null
    if (faseAtualKey === proxima) {
      const r = await advance(processoId, { origem: "kanban-drag" })
      const status = r.success ? 200 : r.resultado === "CONFLITO" ? 409 : r.resultado === "BLOQUEADO" ? 422 : 400
      return NextResponse.json(r, { status })
    }
    return NextResponse.json(
      {
        error: "Só é possível mover o card para a PRÓXIMA fase (a ordem é do Workflow Macro). Para pular/voltar, use as ações canônicas do processo.",
        runtime: "v2", faseAtual: processo.faseAtualKey, destinoSolicitado: faseAtualKey, proximaFase: proxima,
      },
      { status: 409 },
    )
  } catch (error) {
    console.error("Erro ao mover processo de fase:", error)
    return NextResponse.json({ error: "Erro ao mover processo de fase" }, { status: 500 })
  }
}