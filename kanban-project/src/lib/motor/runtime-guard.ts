// src/lib/motor/runtime-guard.ts
// CP-4H — trava FAIL-CLOSED: o motor/recálculo de fase LEGADO não pode operar em
// processos no runtime v2. No v2, a fase é escrita SOMENTE pelo PhaseAdvanceService
// e nenhum efeito financeiro é executado. Esta trava dispara apenas quando o kill
// switch global está ON E o processo é v2; com o kill switch OFF (default) SEMPRE
// retorna false → comportamento legacy 100% inalterado.

import type { PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"

/** Aceita o client global OU um TransactionClient (mesma leitura de runtime). */
type PrismaLike = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]

/**
 * Resolve o runtime efetivo lendo por um client arbitrário (global OU tx). Base de
 * todas as travas fail-closed; puro quanto ao client (sem singleton) → testável.
 */
export async function processoEmRuntimeV2Com(db: PrismaLike, processoId: number): Promise<boolean> {
  const [proc, cfg] = await Promise.all([
    db.processo.findUnique({ where: { id: processoId }, select: { workflowRuntime: true } }),
    db.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } }),
  ])
  if (!proc) return false
  return resolveWorkflowRuntime(proc.workflowRuntime, cfg?.runtimeV2Habilitado ?? false) === "v2"
}

export async function processoEmRuntimeV2(processoId: number): Promise<boolean> {
  return processoEmRuntimeV2Com(prisma, processoId)
}
