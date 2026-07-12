// src/services/phase-workflow.ts
// CP-4B — serviço CANÔNICO de instanciação versionada de Workflow Interno → Passos.
//
// Só ESCREVE quando runtime v2 permitido (kill switch global) E Processo.workflowRuntime="v2".
// Falha => diagnóstico explícito, ZERO escrita, sem tocar legado, sem instância parcial.
// Idempotente (chaves determinísticas). Snapshot imutável/versionado. Transação única.
// NÃO cria Tarefa, NÃO sincroniza, NÃO avança fase, NÃO toca legado.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { Prisma, type PhaseWorkflowInstance, type PhaseWorkflowStepInstance } from "@prisma/client"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import { validarDefinicao } from "@/src/services/workflow-definition-validator"
import {
  type DefWorkflow,
  type DefStep,
  type WorkflowValidationIssue,
  montarChaveWorkflow,
  montarChavePasso,
  montarChaveEvento,
  mapearTipoPasso,
  estadoInicialPasso,
  ordenarStepsDeterministico,
  construirSnapshotWorkflow,
  construirSnapshotPasso,
} from "@/src/services/phase-workflow-helpers"

export type OrigemInstanciaStr = "MOTOR" | "MANUAL" | "MIGRACAO" | "REABERTURA"

export interface InstanciarWorkflowDaFaseInput {
  processoId: number
  faseMacroKey: string
  faseMacroId?: number
  modoKey?: string
  ciclo?: number
  correlationId?: string
  causationId?: string
  origem?: OrigemInstanciaStr
  solicitadoPorId?: number
}

export type FailureCode =
  | "RUNTIME_V2_DESABILITADO"
  | "PROCESSO_LEGACY"
  | "WORKFLOW_NAO_ENCONTRADO"
  | "MODO_AMBIGUO"
  | "SEM_VERSAO_ATIVA"
  | "WORKFLOW_SEM_PASSOS"
  | "STEP_SEM_KEY"
  | "DEPENDENCIA_INVALIDA"
  | "CICLO_DE_DEPENDENCIA"
  | "CONFIGURACAO_TIPO_INVALIDA"
  | "CONFIGURACAO_INVALIDA"

export type InstanciarResultado =
  | {
      success: true
      created: boolean
      workflowInstance: PhaseWorkflowInstance
      stepInstances: PhaseWorkflowStepInstance[]
      warnings: WorkflowValidationIssue[]
      correlationId: string
    }
  | {
      success: false
      code: FailureCode
      errors: WorkflowValidationIssue[]
      correlationId: string
    }

const CODES = new Set<FailureCode>([
  "SEM_VERSAO_ATIVA", "WORKFLOW_SEM_PASSOS", "STEP_SEM_KEY", "DEPENDENCIA_INVALIDA",
  "CICLO_DE_DEPENDENCIA", "CONFIGURACAO_TIPO_INVALIDA", "CONFIGURACAO_INVALIDA",
])

/** Resolve o Workflow Interno aplicável (precedência: tipo específico > 'all'). */
export async function resolverWorkflowAplicavel(
  tipoProcessoId: number | null,
  faseMacroKey: string
): Promise<{ workflow: DefWorkflow; steps: DefStep[] } | { erro: FailureCode }> {
  const base = { phaseKey: faseMacroKey, arquivado: false, active: true }
  // 1) específico do tipo
  let wf =
    tipoProcessoId != null
      ? await prisma.phaseInternalWorkflow.findFirst({ where: { ...base, tipoProcessoId } })
      : null
  // 2) fallback 'all'
  if (!wf) wf = await prisma.phaseInternalWorkflow.findFirst({ where: { ...base, tipoProcessoId: null } })
  if (!wf) return { erro: "WORKFLOW_NAO_ENCONTRADO" }

  const passos = await prisma.phaseInternalWorkflowStep.findMany({
    where: { workflowId: wf.id },
    orderBy: { ordem: "asc" },
  })
  const workflow: DefWorkflow = {
    id: wf.id, wfUid: wf.wfUid, name: wf.name, phaseKey: wf.phaseKey,
    tipoProcessoId: wf.tipoProcessoId, versao: wf.versao, active: wf.active, arquivado: wf.arquivado,
  }
  const steps: DefStep[] = passos.map((p) => ({
    id: p.id, key: p.key, label: p.label, description: p.description, ordem: p.ordem,
    createsTask: p.createsTask, required: p.required, owner: p.owner, priority: p.priority,
    slaDays: p.slaDays, completionRule: p.completionRule, checklist: p.checklist, versao: p.versao,
    tipo: null, dependeDeStepKeys: null, // definição atual não possui; default linear
  }))
  return { workflow, steps }
}

export async function instanciarWorkflowDaFase(
  input: InstanciarWorkflowDaFaseInput,
  txExterno?: Prisma.TransactionClient
): Promise<InstanciarResultado> {
  const correlationId = input.correlationId ?? randomUUID()
  const ciclo = input.ciclo && input.ciclo > 0 ? input.ciclo : 1
  const origem: OrigemInstanciaStr = input.origem ?? "MOTOR"

  const fail = (code: FailureCode, errors: WorkflowValidationIssue[] = []): InstanciarResultado => ({
    success: false, code, errors, correlationId,
  })

  // 1) runtime + feature flag (só escreve com v2 permitido)
  const processo = await prisma.processo.findUnique({
    where: { id: input.processoId },
    select: { id: true, workflowRuntime: true, tipoProcessoMotorId: true },
  })
  if (!processo) return fail("CONFIGURACAO_INVALIDA", [{ code: "PROCESSO_NAO_ENCONTRADO", message: "Processo inexistente" }])

  const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  const runtime = resolveWorkflowRuntime(processo.workflowRuntime, cfg?.runtimeV2Habilitado ?? false)
  if (!(cfg?.runtimeV2Habilitado ?? false)) return fail("RUNTIME_V2_DESABILITADO")
  if (runtime !== "v2") return fail("PROCESSO_LEGACY")

  // 2) fase macro (identidade estável + versão)
  const fase = await prisma.faseMacro.findFirst({
    where: { phaseKey: input.faseMacroKey, macroWorkflow: { tipoProcessoId: processo.tipoProcessoMotorId ?? -1 } },
    select: { id: true, versao: true, macroWorkflow: { select: { id: true, versao: true } } },
  })
  if (!fase) return fail("CONFIGURACAO_INVALIDA", [{ code: "FASE_MACRO_INVALIDA", message: `Fase ${input.faseMacroKey} inexistente no macro do processo` }])

  // 3) workflow aplicável
  const resolvido = await resolverWorkflowAplicavel(processo.tipoProcessoMotorId, input.faseMacroKey)
  if ("erro" in resolvido) return fail(resolvido.erro)
  const { workflow, steps } = resolvido

  // 4) validação completa da definição ANTES de escrever
  const val = validarDefinicao(workflow, steps)
  if (!val.valid) {
    const primeiro = val.errors[0]?.code as FailureCode | undefined
    const code: FailureCode = primeiro && CODES.has(primeiro) ? primeiro : "CONFIGURACAO_INVALIDA"
    return fail(code, val.errors)
  }

  // 5) chave de idempotência do workflow
  const chaveWorkflow = montarChaveWorkflow({
    processoId: processo.id, faseMacroId: fase.id, faseMacroKey: input.faseMacroKey,
    faseMacroVersion: fase.versao, workflowDefinitionId: workflow.id, workflowVersion: workflow.versao, ciclo,
  })
  const instantiatedAt = new Date().toISOString()

  // 6) transação única (rollback integral em falha).
  // txExterno: compõe DENTRO de uma transação já aberta (ex.: PhaseAdvanceService).
  const corpo = async (tx: Prisma.TransactionClient): Promise<InstanciarResultado> => {
      const existente = await tx.phaseWorkflowInstance.findUnique({ where: { chaveIdempotencia: chaveWorkflow } })
      if (existente) {
        const stepInstances = await tx.phaseWorkflowStepInstance.findMany({
          where: { workflowInstanceId: existente.id }, orderBy: { ordem: "asc" },
        })
        return { success: true, created: false, workflowInstance: existente, stepInstances, warnings: val.warnings, correlationId }
      }

      const instancia = await tx.phaseWorkflowInstance.create({
        data: {
          processoId: processo.id,
          faseMacroKey: input.faseMacroKey,
          faseMacroId: fase.id,
          faseMacroVersion: fase.versao,
          macroWorkflowId: fase.macroWorkflow.id,
          macroVersion: fase.macroWorkflow.versao,
          workflowDefinitionId: workflow.id,
          workflowVersion: workflow.versao,
          snapshot: construirSnapshotWorkflow({
            workflowDefinitionId: workflow.id, workflowVersion: workflow.versao, name: workflow.name,
            faseMacroId: fase.id, faseMacroKey: input.faseMacroKey, faseMacroVersion: fase.versao,
            modoKey: input.modoKey ?? null, tipoProcessoId: workflow.tipoProcessoId, instantiatedAt,
          }) as Prisma.InputJsonValue,
          snapshotSchemaVersion: 1,
          ciclo,
          status: "ATIVO", // nasce ATIVO (decisão 8) — tudo numa transação
          origem,
          instanciadoPor: input.solicitadoPorId != null ? String(input.solicitadoPorId) : "MOTOR",
          correlationId,
          causationId: input.causationId ?? null,
          chaveIdempotencia: chaveWorkflow,
        },
      })

      const ordenados = ordenarStepsDeterministico(steps)
      const stepInstances: PhaseWorkflowStepInstance[] = []
      for (const def of ordenados) {
        const tipoRes = mapearTipoPasso(def)
        const deps = def.dependeDeStepKeys ?? []
        const status = estadoInicialPasso(deps.length > 0)
        const chavePasso = montarChavePasso({
          workflowInstanceId: instancia.id, stepDefinitionId: def.id, stepKey: def.key,
          stepDefinitionVersion: def.versao, ciclo,
        })
        const si = await tx.phaseWorkflowStepInstance.create({
          data: {
            workflowInstanceId: instancia.id,
            stepDefinitionId: def.id,
            stepDefinitionVersion: def.versao,
            stepKey: def.key,
            snapshot: construirSnapshotPasso(def, { tipo: tipoRes.tipo, dependeDeStepKeys: deps, instantiatedAt }) as Prisma.InputJsonValue,
            snapshotSchemaVersion: 1,
            processoId: processo.id,
            faseMacroKey: input.faseMacroKey,
            ordem: def.ordem,
            tipo: tipoRes.tipo,
            obrigatorio: def.required,
            geraTarefa: def.createsTask,
            ciclo,
            status,
            prioridade: def.priority,
            papel: def.owner ?? null,
            slaDays: def.slaDays,
            dependeDeStepKeys: deps,
            chaveIdempotencia: chavePasso,
            correlationId,
            causationId: chaveWorkflow, // causa imediata = a instanciação do workflow
          },
        })
        stepInstances.push(si)

        await tx.workflowEvento.create({
          data: {
            tipo: "PASSO_INSTANCIADO", entityType: "step_instance", entityId: si.id,
            processoId: processo.id, workflowInstanceId: instancia.id, stepInstanceId: si.id,
            correlationId, causationId: chaveWorkflow,
            chaveIdempotencia: montarChaveEvento({ correlationId, tipo: "PASSO_INSTANCIADO", entityType: "step_instance", entityId: si.id, operationKey: chavePasso }),
            dados: { stepKey: def.key, ordem: def.ordem, tipo: tipoRes.tipo, ciclo },
          },
        })
      }

      // Evento e outbox do workflow (mesma transação)
      await tx.workflowEvento.create({
        data: {
          tipo: "WORKFLOW_INSTANCIADO", entityType: "workflow_instance", entityId: instancia.id,
          processoId: processo.id, workflowInstanceId: instancia.id,
          correlationId, causationId: input.causationId ?? null,
          chaveIdempotencia: montarChaveEvento({ correlationId, tipo: "WORKFLOW_INSTANCIADO", entityType: "workflow_instance", entityId: instancia.id, operationKey: chaveWorkflow }),
          dados: { faseMacroKey: input.faseMacroKey, ciclo, steps: stepInstances.map((s) => ({ id: s.id, stepKey: s.stepKey })) },
        },
      })
      await tx.domainOutbox.create({
        data: {
          tipo: "phase-workflow.instanced", aggregateType: "PhaseWorkflowInstance", aggregateId: instancia.id,
          correlationId, causationId: input.causationId ?? null,
          chaveIdempotencia: `outbox|${chaveWorkflow}`,
          payload: {
            processoId: processo.id, faseMacroKey: input.faseMacroKey, ciclo,
            workflowInstanceId: instancia.id, stepInstanceIds: stepInstances.map((s) => s.id),
            stepKeys: stepInstances.map((s) => s.stepKey), workflowVersion: workflow.versao,
          },
        },
      })

      return { success: true, created: true, workflowInstance: instancia, stepInstances, warnings: val.warnings, correlationId }
  }
  try {
    return txExterno ? await corpo(txExterno) : await prisma.$transaction(corpo)
  } catch (e) {
    // Concorrência: unique da chave do workflow → converge (só no modo standalone;
    // sob txExterno, propaga para o chamador tratar como conflito e dar rollback).
    if (!txExterno && (e as { code?: string })?.code === "P2002") {
      const existente = await prisma.phaseWorkflowInstance.findUnique({ where: { chaveIdempotencia: chaveWorkflow } })
      if (existente) {
        const stepInstances = await prisma.phaseWorkflowStepInstance.findMany({
          where: { workflowInstanceId: existente.id }, orderBy: { ordem: "asc" },
        })
        return { success: true, created: false, workflowInstance: existente, stepInstances, warnings: val.warnings, correlationId }
      }
    }
    throw e
  }
}

/** Leitura: instância ativa (mais recente) da fase. */
export async function getInstanciaAtiva(processoId: number, faseMacroKey: string) {
  return prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
    orderBy: { ciclo: "desc" },
    include: { steps: { orderBy: { ordem: "asc" } } },
  })
}
