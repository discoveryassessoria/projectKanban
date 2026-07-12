// src/services/passo-tarefa.ts
// CP-4C — serviço CANÔNICO: Passo humano aplicável → 1 Tarefa real.
//
// Reutiliza o model Tarefa. Idempotente, transacional, auditável, versionado
// pelo SNAPSHOT do Passo (nunca relê a definição). NÃO sincroniza, NÃO conclui
// Passo, NÃO avança fase, NÃO gera efeito financeiro, NÃO faz dual-write.
// Regra: gera só quando tipo=HUMANO && geraTarefa=true && status=DISPONIVEL &&
// aplicável ao contexto. Passos não aplicáveis não geram Tarefa.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import type { Tarefa, Prisma } from "@prisma/client"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import {
  type FailureCodeC,
  type TarefaGenIssue,
  TASK_ROLE_PADRAO,
  montarChaveTarefa,
  mapearPrioridade,
  calcularPrazo,
  resolverResponsavel,
  passoGeraTarefa,
} from "@/src/services/passo-tarefa-helpers"

export interface GarantirTarefaInput {
  stepInstanceId: number
  taskRole?: string
  correlationId?: string
  causationId?: string
  origem?: string
  solicitadoPorId?: number
}

export type GarantirTarefaResultado =
  | { success: true; created: boolean; tarefa: Tarefa; warnings: TarefaGenIssue[]; correlationId: string }
  | { success: false; code: FailureCodeC; errors: TarefaGenIssue[]; correlationId: string }

interface SnapshotPasso {
  titulo?: string
  descricao?: string | null
  prioridade?: string | null
  sla?: number | null
  aplicavel?: boolean
}

/** Aplicabilidade ao contexto (seam do CP-4E). No 4C: não bloqueado e não
 *  explicitamente marcado inaplicável no snapshot. */
function ehPassoAplicavel(step: { bloqueadoManual: boolean }, snap: SnapshotPasso | null): boolean {
  if (step.bloqueadoManual) return false
  if (snap && snap.aplicavel === false) return false
  return true
}

export async function garantirTarefaDePasso(
  input: GarantirTarefaInput,
  txExterno?: Prisma.TransactionClient
): Promise<GarantirTarefaResultado> {
  const correlationId = input.correlationId ?? randomUUID()
  const taskRole = input.taskRole ?? TASK_ROLE_PADRAO
  const fail = (code: FailureCodeC, errors: TarefaGenIssue[] = []): GarantirTarefaResultado => ({
    success: false, code, errors, correlationId,
  })

  // Sob txExterno, as leituras DEVEM usar a mesma tx para enxergar Passos
  // recém-criados dentro da transação (ex.: instanciação da próxima fase no advance).
  const db = txExterno ?? prisma

  const step = await db.phaseWorkflowStepInstance.findUnique({
    where: { id: input.stepInstanceId },
    include: { workflowInstance: { select: { status: true } } },
  })
  if (!step) return fail("STEP_NAO_ENCONTRADO")

  // runtime v2 + feature flag
  const processo = await db.processo.findUnique({
    where: { id: step.processoId },
    select: { workflowRuntime: true },
  })
  const cfg = await db.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  const v2Global = cfg?.runtimeV2Habilitado ?? false
  if (!v2Global) return fail("RUNTIME_V2_DESABILITADO")
  if (resolveWorkflowRuntime(processo?.workflowRuntime, v2Global) !== "v2") return fail("PROCESSO_LEGACY")

  // instância ativa
  if (!["ATIVO", "AGUARDANDO", "BLOQUEADO"].includes(step.workflowInstance.status)) {
    return fail("WORKFLOW_INSTANCE_INATIVA")
  }

  const snap = (step.snapshot as SnapshotPasso | null) ?? null
  const aplicavel = ehPassoAplicavel(step, snap)

  // regra normativa
  const regra = passoGeraTarefa({ tipo: step.tipo, geraTarefa: step.geraTarefa, status: step.status, aplicavel })
  if (!regra.gera) return fail(regra.code!)

  // campos derivados EXCLUSIVAMENTE do snapshot/instância
  const titulo = String(snap?.titulo ?? `Passo ${step.stepKey}`).slice(0, 200)
  const descricao = snap?.descricao ?? null
  const prioridade = mapearPrioridade(step.prioridade ?? snap?.prioridade)
  const sla = step.slaDays ?? snap?.sla ?? null
  const dataPrazo = calcularPrazo(new Date(), sla)
  const resp = resolverResponsavel({ responsavelId: step.responsavelId, papel: step.papel, equipe: step.equipe, stepKey: step.stepKey })
  const warnings: TarefaGenIssue[] = resp.warning ? [resp.warning] : []

  const chaveTarefa = montarChaveTarefa({ stepInstanceId: step.id, taskRole, ciclo: step.ciclo })
  const causationId = input.causationId ?? step.chaveIdempotencia
  const origem = input.origem ?? "workflow"

  // txExterno: compõe DENTRO de uma transação já aberta (ex.: PhaseAdvanceService).
  const corpo = async (tx: Prisma.TransactionClient): Promise<GarantirTarefaResultado> => {
      const existente = await tx.tarefa.findFirst({ where: { chaveIdempotencia: chaveTarefa } })
      if (existente) return { success: true, created: false, tarefa: existente, warnings, correlationId }

      const tarefa = await tx.tarefa.create({
        data: {
          titulo,
          descricao,
          processoId: step.processoId,
          prioridade,
          statusTarefa: "NAO_INICIADA",
          concluida: false,
          dataPrazo,
          responsavelId: resp.responsavelId,
          // vínculos do runtime v2 (papel/equipe permanecem na step instance)
          workflowInstanceId: step.workflowInstanceId,
          workflowStepInstanceId: step.id,
          necessidadeId: step.necessidadeId,
          documentoId: step.documentoId,
          faseMacroKey: step.faseMacroKey,
          ciclo: step.ciclo,
          taskRole,
          origem,
          correlationId,
          chaveIdempotencia: chaveTarefa,
        },
      })

      await tx.workflowEvento.create({
        data: {
          tipo: "TAREFA_GERADA", entityType: "tarefa", entityId: tarefa.id,
          processoId: step.processoId, workflowInstanceId: step.workflowInstanceId,
          stepInstanceId: step.id, tarefaId: tarefa.id,
          correlationId, causationId,
          chaveIdempotencia: `evt|TAREFA_GERADA|${chaveTarefa}`,
          dados: { stepKey: step.stepKey, taskRole, ciclo: step.ciclo, prioridade, temResponsavel: resp.responsavelId != null },
        },
      })
      await tx.domainOutbox.create({
        data: {
          tipo: "tarefa.generated", aggregateType: "Tarefa", aggregateId: tarefa.id,
          correlationId, causationId, chaveIdempotencia: `outbox|tarefa|${chaveTarefa}`,
          payload: { processoId: step.processoId, stepInstanceId: step.id, taskRole, ciclo: step.ciclo, tarefaId: tarefa.id },
        },
      })

      return { success: true, created: true, tarefa, warnings, correlationId }
  }
  try {
    return txExterno ? await corpo(txExterno) : await prisma.$transaction(corpo)
  } catch (e) {
    // Convergência só no modo standalone; sob txExterno, propaga p/ rollback do chamador.
    if (!txExterno && (e as { code?: string })?.code === "P2002") {
      const existente = await prisma.tarefa.findFirst({ where: { chaveIdempotencia: chaveTarefa } })
      if (existente) return { success: true, created: false, tarefa: existente, warnings, correlationId }
    }
    throw e
  }
}
