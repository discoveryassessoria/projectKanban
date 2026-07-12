// src/lib/workflow-runtime.ts
// CP-4A — resolução do feature flag do runtime de workflow (decisão 10).
// PURO (sem prisma). Regra inequívoca de quem é o runtime ESCRITOR:
//   - kill switch global desativado para v2  -> sempre "legacy";
//   - kill switch global permite v2 + Processo.workflowRuntime === "v2" -> "v2";
//   - qualquer outra condição -> "legacy".
// Nunca ativa v2 automaticamente. Default seguro = "legacy".

export type WorkflowRuntime = "legacy" | "v2"

export function resolveWorkflowRuntime(
  processoRuntime: string | null | undefined,
  globalV2Habilitado: boolean
): WorkflowRuntime {
  if (!globalV2Habilitado) return "legacy"
  return processoRuntime === "v2" ? "v2" : "legacy"
}

export function runtimeV2Ativo(
  processoRuntime: string | null | undefined,
  globalV2Habilitado: boolean
): boolean {
  return resolveWorkflowRuntime(processoRuntime, globalV2Habilitado) === "v2"
}
