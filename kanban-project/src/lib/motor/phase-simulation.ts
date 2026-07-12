// src/lib/motor/phase-simulation.ts
// CP-4E — simulateAdvance: dry-run 100% SEM ESCRITA de domínio (decisão aprovada).
// Não altera faseAtualKey, não cria Tarefa, não grava WorkflowEvento/DomainOutbox,
// não executa financeiro/automação, não ativa runtime. Apenas resposta determinística.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import { resolverWorkflowAplicavel } from "@/src/services/phase-workflow"
import { calcularPendencias } from "@/src/lib/motor/blocking-engine"
import type { BlockingIssue } from "@/src/lib/motor/blocking-helpers"

export interface SimulateAdvanceResult {
  success: true
  processoId: number
  runtime: "legacy" | "v2"
  faseAtual: string
  proximaFase: string | null
  podeAvancar: boolean
  necessitaForcar: boolean
  policy: "ALL_REQUIRED_COMPLETED"
  blockingIssues: BlockingIssue[]
  warnings: BlockingIssue[]
  regrasAvaliadas: unknown[]
  preview: {
    workflowDefinitionId?: number
    workflowVersion?: number
    stepKeys: string[]
    tarefasPrevistas: Array<{ stepKey: string; taskRole: string; titulo: string }>
    automacoesPrevistas: unknown[]
  }
  correlationId: string
  timestamp: string
}

export async function simulateAdvance(
  processoId: number,
  ctx: { correlationId?: string } = {}
): Promise<SimulateAdvanceResult | { success: false; code: string; message: string; correlationId: string }> {
  const correlationId = ctx.correlationId ?? randomUUID()
  const timestamp = new Date().toISOString()

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, faseAtualKey: true, tipoProcessoMotorId: true, workflowRuntime: true },
  })
  if (!processo) return { success: false, code: "PROCESSO_NAO_ENCONTRADO", message: "Processo inexistente", correlationId }

  const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  const v2Global = cfg?.runtimeV2Habilitado ?? false
  const runtime = resolveWorkflowRuntime(processo.workflowRuntime, v2Global)

  const faseAtual = processo.faseAtualKey ?? ""
  const proximaFase = await resolverProximaFase(processo.tipoProcessoMotorId, faseAtual)

  // Pendências (somente leitura) — sempre calculáveis
  const pend = await calcularPendencias(processoId, faseAtual, { correlationId })
  const regrasAvaliadas: unknown[] = [{ policy: "ALL_REQUIRED_COMPLETED", faseAtual, totalIssues: pend.issues.length }]

  const blockingIssues = [...pend.blocking]
  const warnings = [...pend.warnings]

  // Kill switch / runtime não-v2 → diagnóstico claro, sem executar runtime v2
  if (runtime !== "v2") {
    blockingIssues.push({
      code: v2Global ? "PROCESSO_LEGACY" : "RUNTIME_V2_DESABILITADO",
      category: "REGRA", severity: "BLOCKING", entityType: "Processo", entityId: processoId,
      message: v2Global ? "Processo em runtime legacy (v2 não aplicável)" : "Kill switch global do runtime v2 desabilitado",
    })
    return {
      success: true, processoId, runtime, faseAtual, proximaFase, policy: "ALL_REQUIRED_COMPLETED",
      podeAvancar: false, necessitaForcar: false,
      blockingIssues, warnings, regrasAvaliadas,
      preview: { stepKeys: [], tarefasPrevistas: [], automacoesPrevistas: [] },
      correlationId, timestamp,
    }
  }

  // Preview da PRÓXIMA fase (o que SERIA instanciado) — leitura do template, sem escrever.
  const preview: SimulateAdvanceResult["preview"] = { stepKeys: [], tarefasPrevistas: [], automacoesPrevistas: [] }
  if (proximaFase) {
    const resolvido = await resolverWorkflowAplicavel(processo.tipoProcessoMotorId, proximaFase)
    if (!("erro" in resolvido)) {
      preview.workflowDefinitionId = resolvido.workflow.id
      preview.workflowVersion = resolvido.workflow.versao
      preview.stepKeys = resolvido.steps.map((s) => s.key)
      preview.tarefasPrevistas = resolvido.steps
        .filter((s) => s.createsTask)
        .map((s) => ({ stepKey: s.key, taskRole: "principal", titulo: s.label }))
    }
    if (processo.tipoProcessoMotorId != null) {
      const autos = await prisma.phaseAutomationRule.findMany({
        where: { tipoProcessoId: processo.tipoProcessoMotorId, phaseKey: proximaFase, active: true, arquivado: false },
        select: { id: true, name: true, kind: true },
      })
      preview.automacoesPrevistas = autos
    }
  }

  const podeAvancar = pend.canAdvance
  return {
    success: true, processoId, runtime, faseAtual, proximaFase, policy: "ALL_REQUIRED_COMPLETED",
    podeAvancar, necessitaForcar: !podeAvancar,
    blockingIssues, warnings, regrasAvaliadas, preview, correlationId, timestamp,
  }
}

/** Próxima fase pela ordem do Workflow Macro (definição), não por label. */
async function resolverProximaFase(tipoProcessoMotorId: number | null, faseAtualKey: string): Promise<string | null> {
  if (tipoProcessoMotorId == null) return null
  const wf = await prisma.macroWorkflow.findUnique({
    where: { tipoProcessoId: tipoProcessoMotorId },
    include: { fases: { orderBy: { ordem: "asc" }, select: { phaseKey: true } } },
  })
  if (!wf) return null
  const idx = wf.fases.findIndex((f) => f.phaseKey === faseAtualKey)
  if (idx === -1 || idx + 1 >= wf.fases.length) return null
  return wf.fases[idx + 1].phaseKey
}
