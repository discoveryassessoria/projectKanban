// src/services/reconciliar-fase.ts
//
// RECONCILIAÇÃO da fase ATIVA de um processo com o workflow PUBLICADO dela.
//
// Existe porque a instância da fase e os passos publicados podem divergir: a
// instância nasceu sob uma regra que descartava os passos do template, ou o
// cadastro ganhou um passo depois que a fase já estava ativa. Reconciliar é
// CONVERGIR — cria o que falta, recupera o que existe, não duplica, não conclui,
// não avança fase, não apaga histórico.
//
// Não é um caminho paralelo: delega a decisão ao MESMO serviço canônico de
// instanciação (instanciarWorkflowDaFase) e ao MESMO serviço canônico de geração de
// tarefa (garantirTarefaDePasso). Aqui só há orquestração.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { instanciarWorkflowDaFase } from "@/src/services/phase-workflow"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import type { WorkflowValidationIssue } from "@/src/services/phase-workflow-helpers"

export interface ReconciliarFaseResultado {
  processoId: number
  faseMacroKey: string | null
  ciclo: number | null
  workflowInstanceId: number | null
  passosTotais: number
  passosCriados: number
  tarefasCriadas: number
  avisos: WorkflowValidationIssue[]
  erro: string | null
}

/**
 * Garante que a fase ATIVA do processo tenha as instâncias dos seus passos publicados
 * e as tarefas correspondentes. Idempotente: rodar N vezes gera o mesmo estado.
 */
export async function reconciliarFaseAtiva(
  processoId: number,
  opts: { correlationId?: string; solicitadoPorId?: number } = {},
): Promise<ReconciliarFaseResultado> {
  const correlationId = opts.correlationId ?? randomUUID()
  const base: ReconciliarFaseResultado = {
    processoId, faseMacroKey: null, ciclo: null, workflowInstanceId: null,
    passosTotais: 0, passosCriados: 0, tarefasCriadas: 0, avisos: [], erro: null,
  }

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, faseAtualKey: true },
  })
  if (!processo) return { ...base, erro: "Processo não encontrado." }
  if (!processo.faseAtualKey) return { ...base, erro: "Processo sem fase ativa." }
  base.faseMacroKey = processo.faseAtualKey

  // Ciclo da instância ATIVA: reconciliar NUNCA cria um ciclo novo (isso é retorno de
  // fase, outro fluxo). Sem instância ativa, o ciclo é 1 (primeira ativação).
  const ativa = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey: processo.faseAtualKey, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
    orderBy: { ciclo: "desc" },
    select: { id: true, ciclo: true },
  })
  const antes = ativa
    ? await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: ativa.id } })
    : 0

  const inst = await instanciarWorkflowDaFase({
    processoId,
    faseMacroKey: processo.faseAtualKey,
    ciclo: ativa?.ciclo ?? 1,
    correlationId,
    origem: "MOTOR",
    solicitadoPorId: opts.solicitadoPorId,
  })

  if (!inst.success) {
    return {
      ...base,
      erro: inst.errors[0]?.message ?? `Não foi possível resolver o workflow da fase (${inst.code}).`,
      avisos: inst.errors,
    }
  }

  base.workflowInstanceId = inst.workflowInstance.id
  base.ciclo = inst.workflowInstance.ciclo
  base.passosTotais = inst.stepInstances.length
  base.passosCriados = Math.max(0, inst.stepInstances.length - antes)
  base.avisos = inst.warnings

  // TAREFAS: o serviço canônico se auto-filtra (só passo HUMANO, geraTarefa,
  // DISPONIVEL e aplicável). Passo bloqueado por sequência não gera tarefa agora —
  // gera quando for liberado.
  for (const step of inst.stepInstances) {
    const g = await garantirTarefaDePasso({
      stepInstanceId: step.id, correlationId, causationId: step.chaveIdempotencia, origem: "reconciliacao",
    })
    if (g.success && g.created) base.tarefasCriadas++
  }

  return base
}
