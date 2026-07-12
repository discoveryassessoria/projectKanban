// src/lib/motor/observability.ts
// CP-4G — observabilidade do runtime v2. SOMENTE LEITURA (counts/agregações).
// Não é um dashboard analítico completo — expõe os sinais essenciais do §7.

import { prisma } from "@/lib/prisma"
import { contarResultados, mapaRuntime, type AdvanceCounters } from "@/src/lib/motor/observability-helpers"

export interface RuntimeObservability {
  scope: "global" | "processo"
  processoId: number | null
  runtimePorProcesso: { legacy: number; v2: number }
  instanciasCriadas: number
  passosCriados: number
  tarefasV2: number
  advance: AdvanceCounters
  ativacoesNegadas: number
  ativacoesEfetivadas: number
  fallbacksDualRead: number
  killSwitchGlobal: boolean
}

export async function getRuntimeObservability(processoId?: number): Promise<RuntimeObservability> {
  const whereProc = processoId ? { processoId } : {}
  const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })

  const [grupos, instancias, passos, tarefasV2, logs, ativNeg, ativOk] = await Promise.all([
    prisma.processo.groupBy({
      by: ["workflowRuntime"],
      where: processoId ? { id: processoId } : {},
      _count: { _all: true },
    }),
    prisma.phaseWorkflowInstance.count({ where: whereProc }),
    prisma.phaseWorkflowStepInstance.count({ where: whereProc }),
    prisma.tarefa.count({ where: { ...whereProc, workflowStepInstanceId: { not: null } } }),
    prisma.phaseAdvanceLog.findMany({ where: whereProc, select: { resultado: true } }),
    prisma.domainOutbox.count({ where: { tipo: "runtime.v2.activation_denied", ...(processoId ? { aggregateId: processoId } : {}) } }),
    prisma.domainOutbox.count({ where: { tipo: "runtime.v2.activated", ...(processoId ? { aggregateId: processoId } : {}) } }),
  ])

  const fallbacks = await prisma.domainOutbox.count({ where: { tipo: "dualread.fallback" } }).catch(() => 0)

  return {
    scope: processoId ? "processo" : "global",
    processoId: processoId ?? null,
    runtimePorProcesso: mapaRuntime(grupos.map((g) => ({ runtime: String(g.workflowRuntime), total: g._count._all }))),
    instanciasCriadas: instancias,
    passosCriados: passos,
    tarefasV2,
    advance: contarResultados(logs.map((l) => String(l.resultado))),
    ativacoesNegadas: ativNeg,
    ativacoesEfetivadas: ativOk,
    fallbacksDualRead: fallbacks,
    killSwitchGlobal: cfg?.runtimeV2Habilitado ?? false,
  }
}
