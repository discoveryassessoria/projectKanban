// src/services/workflow-activation.ts
// CP-4G — ativação CONTROLADA do runtime v2 por Processo (operação administrativa).
// prepararAtivacaoV2: dry-run de compatibilidade (NÃO escreve).
// ativarProcessoV2: só efetiva quando TODOS os critérios passam E o kill switch
// global está ON; grava auditoria. Kill switch OFF ⇒ nunca ativa (retorna preparação).
// Não faz rollout automático. NÃO ativa nenhum processo real neste checkpoint
// porque o kill switch permanece OFF por padrão.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { resolverWorkflowAplicavel } from "@/src/services/phase-workflow"
import { validarDefinicao } from "@/src/services/workflow-definition-validator"
import { backfillCp4Workflow } from "../../prisma/backfill-cp4-workflow"
import {
  avaliarCriterios, type AvaliacaoAtivacao, type EntradaCriterios,
} from "@/src/services/workflow-activation-helpers"

export interface PreparacaoAtivacao {
  processoId: number
  faseAtual: string
  runtimeAtual: "legacy" | "v2"
  killSwitchGlobal: boolean
  unresolvedCount: number
  breakdown: Record<string, number>
  avaliacao: AvaliacaoAtivacao
  correlationId: string
}

async function coletarEntrada(processoId: number): Promise<
  | { erro: string }
  | { processo: { faseAtual: string; tipoProcessoMotorId: number | null; workflowRuntime: string }; killSwitchGlobal: boolean; entrada: EntradaCriterios; breakdown: Record<string, number>; unresolvedCount: number }
> {
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, faseAtualKey: true, tipoProcessoMotorId: true, workflowRuntime: true },
  })
  if (!processo) return { erro: "Processo não encontrado" }

  const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  const killSwitchGlobal = cfg?.runtimeV2Habilitado ?? false
  const faseAtual = processo.faseAtualKey ?? ""

  // Compatibilidade: backfill DRY-RUN restrito ao processo (não escreve).
  const rel = await backfillCp4Workflow({ dryRun: true, processoId })

  // Workflow Interno válido + fase macro resolvida + snapshot possível.
  const resolvido = await resolverWorkflowAplicavel(processo.tipoProcessoMotorId, faseAtual)
  let workflowInternoValido = false
  let snapshotPossivel = false
  if (!("erro" in resolvido)) {
    const val = validarDefinicao(resolvido.workflow, resolvido.steps)
    workflowInternoValido = val.valid
    snapshotPossivel = val.valid && resolvido.steps.length > 0
  }
  const faseMacro = await prisma.faseMacro.findFirst({
    where: { phaseKey: faseAtual, macroWorkflow: { tipoProcessoId: processo.tipoProcessoMotorId ?? -1 } },
    select: { id: true },
  })

  const entrada: EntradaCriterios = {
    killSwitchGlobal,
    unresolvedCount: rel.unresolvedCount,
    workflowInternoValido,
    faseMacroResolvida: faseMacro != null,
    snapshotPossivel,
    conflitos: rel.conflicts.length,
    justificativaPresente: true, // preenchido na avaliação final da ativação
  }
  return {
    processo: { faseAtual, tipoProcessoMotorId: processo.tipoProcessoMotorId, workflowRuntime: processo.workflowRuntime },
    killSwitchGlobal, entrada, breakdown: rel.breakdown as unknown as Record<string, number>, unresolvedCount: rel.unresolvedCount,
  }
}

/** Dry-run de compatibilidade — NÃO escreve. Mostra critérios e elegibilidade. */
export async function prepararAtivacaoV2(processoId: number): Promise<PreparacaoAtivacao | { erro: string }> {
  const correlationId = randomUUID()
  const base = await coletarEntrada(processoId)
  if ("erro" in base) return base
  const avaliacao = avaliarCriterios(base.entrada)
  return {
    processoId, faseAtual: base.processo.faseAtual,
    runtimeAtual: base.processo.workflowRuntime === "v2" ? "v2" : "legacy",
    killSwitchGlobal: base.killSwitchGlobal, unresolvedCount: base.unresolvedCount,
    breakdown: base.breakdown, avaliacao, correlationId,
  }
}

export interface AtivacaoInput {
  justificativa: string
  motivoCodigo?: string
  solicitadoPorId?: number
}

export interface AtivacaoResultado {
  ativado: boolean
  processoId: number
  runtimeResultante: "legacy" | "v2"
  motivo: string
  avaliacao: AvaliacaoAtivacao
  correlationId: string
}

/**
 * Ativa o runtime v2 no Processo SOMENTE se todos os critérios passarem E o kill
 * switch estiver ON. Com kill switch OFF (default), retorna ativado=false com a
 * preparação — nenhum processo real é ativado neste checkpoint.
 */
export async function ativarProcessoV2(processoId: number, input: AtivacaoInput): Promise<AtivacaoResultado | { erro: string }> {
  const correlationId = randomUUID()
  const base = await coletarEntrada(processoId)
  if ("erro" in base) return base

  const entrada: EntradaCriterios = { ...base.entrada, justificativaPresente: !!input.justificativa?.trim() }
  const avaliacao = avaliarCriterios(entrada)

  const auditar = async (ativado: boolean, motivo: string) => {
    await prisma.domainOutbox.create({
      data: {
        tipo: ativado ? "runtime.v2.activated" : "runtime.v2.activation_denied",
        aggregateType: "Processo", aggregateId: processoId, correlationId,
        chaveIdempotencia: `outbox|ativacao|${processoId}|${correlationId}`,
        payload: {
          processoId, ativado, motivo, justificativa: input.justificativa ?? null,
          motivoCodigo: input.motivoCodigo ?? null, solicitadoPorId: input.solicitadoPorId ?? null,
          bloqueios: avaliacao.bloqueios, killSwitchGlobal: base.killSwitchGlobal,
        } as Prisma.InputJsonValue,
      },
    }).catch(() => {})
  }

  if (!avaliacao.podeAtivarEfetivo) {
    const motivo = !base.killSwitchGlobal
      ? "Kill switch global desligado — apenas preparação/simulação permitida"
      : `Critérios não satisfeitos: ${avaliacao.bloqueios.join(", ")}`
    await auditar(false, motivo)
    return { ativado: false, processoId, runtimeResultante: base.processo.workflowRuntime === "v2" ? "v2" : "legacy", motivo, avaliacao, correlationId }
  }

  // Ativação efetiva (só alcançável com kill switch ON): marca o Processo como v2.
  await prisma.$transaction(async (tx) => {
    await tx.processo.update({ where: { id: processoId }, data: { workflowRuntime: "v2" } })
    await tx.domainOutbox.create({
      data: {
        tipo: "runtime.v2.activated", aggregateType: "Processo", aggregateId: processoId, correlationId,
        chaveIdempotencia: `outbox|ativacao-ok|${processoId}|${correlationId}`,
        payload: { processoId, justificativa: input.justificativa, motivoCodigo: input.motivoCodigo ?? null, solicitadoPorId: input.solicitadoPorId ?? null } as Prisma.InputJsonValue,
      },
    })
  })
  return { ativado: true, processoId, runtimeResultante: "v2", motivo: "Runtime v2 ativado para o processo", avaliacao, correlationId }
}
