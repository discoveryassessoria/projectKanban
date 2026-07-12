// src/lib/motor/runtime-guard.ts
// CP-4H — trava FAIL-CLOSED: o motor/recálculo de fase LEGADO não pode operar em
// processos no runtime v2. No v2, a fase é escrita SOMENTE pelo PhaseAdvanceService
// e nenhum efeito financeiro é executado. Esta trava dispara apenas quando o kill
// switch global está ON E o processo é v2; com o kill switch OFF (default) SEMPRE
// retorna false → comportamento legacy 100% inalterado.

import { prisma } from "@/lib/prisma"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"

export async function processoEmRuntimeV2(processoId: number): Promise<boolean> {
  const [proc, cfg] = await Promise.all([
    prisma.processo.findUnique({ where: { id: processoId }, select: { workflowRuntime: true } }),
    prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } }),
  ])
  if (!proc) return false
  return resolveWorkflowRuntime(proc.workflowRuntime, cfg?.runtimeV2Habilitado ?? false) === "v2"
}
