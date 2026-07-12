// src/services/operational-workflow.ts
// CP-4G — DUAL-READ canônico: ponto ÚNICO de leitura do workflow operacional.
// SOMENTE LEITURA. Nunca escreve, nunca sincroniza retroativamente, nunca faz
// dual-write, nunca reinterpreta a instância pelo template atual (usa snapshot/estado).
//
// runtime=legacy  → lê Workflow/WorkflowStep/Tarefa legado; não toca v2.
// runtime=v2      → PhaseWorkflowInstance/StepInstance como fonte principal;
//                   fallback legado apenas para histórico/compatibilidade.

import { prisma } from "@/lib/prisma"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import { calcularPendencias } from "@/src/lib/motor/blocking-engine"
import {
  type OperationalWorkflowView, type OperationalPasso, type OperationalTarefa,
  iso, montarWarnings,
} from "@/src/services/operational-workflow-helpers"

export async function getOperationalWorkflow(
  processoId: number,
): Promise<OperationalWorkflowView | { error: string }> {
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, faseAtualKey: true, workflowRuntime: true, tipoProcessoMotorId: true },
  })
  if (!processo) return { error: "Processo não encontrado" }

  const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  const killSwitchGlobal = cfg?.runtimeV2Habilitado ?? false
  const runtime = resolveWorkflowRuntime(processo.workflowRuntime, killSwitchGlobal)
  const faseAtual = processo.faseAtualKey ?? ""

  // Instância v2 ativa da fase atual (fonte principal quando v2).
  const instancia = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey: faseAtual, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
    orderBy: { ciclo: "desc" },
    include: { steps: { orderBy: { ordem: "asc" }, include: { tarefas: true } } },
  })

  const { warnings, source } = montarWarnings({
    runtime, killSwitchGlobal, temInstanciaV2: instancia != null,
  })

  // Necessidades e documentos do processo (comuns às duas leituras).
  const necessidades = await prisma.necessidadeDocumental.findMany({
    where: { processoId },
    select: { id: true, status: true, obrigatoriedade: true, itemCatalogoId: true },
  })
  const documentosV2 = instancia
    ? await prisma.documento.findMany({
        where: { id: { in: instancia.steps.map((s) => s.documentoId).filter((x): x is number => x != null) } },
        select: { id: true, tipo: true, status: true },
      })
    : []

  // Passos e tarefas conforme a fonte.
  let passos: OperationalPasso[] = []
  let tarefas: OperationalTarefa[] = []

  if (source === "v2" && instancia) {
    passos = instancia.steps.map((s) => ({
      id: s.id, stepKey: s.stepKey, ordem: s.ordem, tipo: String(s.tipo), status: String(s.status),
      obrigatorio: s.obrigatorio, responsavelId: s.responsavelId, prioridade: s.prioridade,
      prazo: iso(s.prazo), bloqueadoManual: s.bloqueadoManual,
      necessidadeId: s.necessidadeId, documentoId: s.documentoId,
    }))
    tarefas = instancia.steps.flatMap((s) => s.tarefas).map((t) => ({
      id: t.id, titulo: t.titulo, statusTarefa: String(t.statusTarefa), responsavelId: t.responsavelId,
      prioridade: String(t.prioridade), dataPrazo: iso(t.dataPrazo), stepInstanceId: t.workflowStepInstanceId,
      necessidadeId: t.necessidadeId, documentoId: t.documentoId,
    }))
  } else {
    // Fallback/legacy: tarefas legadas do processo (histórico/compatibilidade).
    const legadas = await prisma.tarefa.findMany({
      where: { processoId },
      select: {
        id: true, titulo: true, statusTarefa: true, responsavelId: true, prioridade: true,
        dataPrazo: true, workflowStepInstanceId: true, necessidadeId: true, documentoId: true,
      },
      orderBy: { ordem: "asc" },
    })
    tarefas = legadas.map((t) => ({
      id: t.id, titulo: t.titulo, statusTarefa: String(t.statusTarefa), responsavelId: t.responsavelId,
      prioridade: String(t.prioridade), dataPrazo: iso(t.dataPrazo), stepInstanceId: t.workflowStepInstanceId,
      necessidadeId: t.necessidadeId, documentoId: t.documentoId,
    }))
    // passos legacy: WorkflowStep legado é doc-scoped; não representa fase v2 → vazio,
    // sinalizado por warning (evita reinterpretar template como estado).
  }

  // Pendências (somente leitura; determinísticas). Úteis nas duas fontes.
  const pend = await calcularPendencias(processoId, faseAtual)

  const view: OperationalWorkflowView = {
    processoId, runtime, killSwitchGlobal, faseAtual,
    ciclo: instancia?.ciclo ?? null,
    workflow: instancia
      ? {
          instanceId: instancia.id, workflowDefinitionId: instancia.workflowDefinitionId,
          workflowVersion: instancia.workflowVersion, macroWorkflowId: instancia.macroWorkflowId,
          macroVersion: instancia.macroVersion, status: String(instancia.status),
        }
      : null,
    passos, tarefas,
    necessidades: necessidades.map((n) => ({ id: n.id, status: String(n.status), obrigatoriedade: String(n.obrigatoriedade), itemCatalogoId: n.itemCatalogoId })),
    documentos: documentosV2.map((d) => ({ id: d.id, tipo: d.tipo ? String(d.tipo) : null, status: String(d.status) })),
    pendencias: {
      blocking: pend.blocking, warnings: pend.warnings, canAdvance: pend.canAdvance, policy: pend.policy,
    },
    versoes: { macro: instancia?.macroVersion ?? null, interno: instancia?.workflowVersion ?? null },
    source, warnings,
  }
  return view
}
