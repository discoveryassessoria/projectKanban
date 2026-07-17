// src/lib/process-stage/legacy-status-map.ts
// FONTE ÚNICA e DETERMINÍSTICA do espelhamento de estado legado → V2, usada pela
// PRÓPRIA migração/backfill (não é ferramenta separada nem passo posterior).
// Puro (sem Prisma/sem I/O) → importável em testes via tsx. Renomear/adicionar um
// status legado = ajustar só aqui.

import type { StepInstanceStatus, WorkflowInstanceStatus } from "@prisma/client"

/**
 * REVERSO: StepInstanceStatus (v2) → string legada (para o adaptador que serve o
 * contrato antigo do frontend a partir da fonte V2). Não persiste legado.
 */
export function stepInstanceStatusToLegacy(s: StepInstanceStatus): string {
  switch (s) {
    case "CONCLUIDO": return "concluida"
    case "EM_ANDAMENTO": return "em_andamento"
    case "AGUARDANDO": return "aguardando_terceiro"
    case "BLOQUEADO": return "bloqueada"
    case "CANCELADO":
    case "SUPERSEDIDO": return "cancelada"
    case "DISPENSADO": return "cancelada"
    case "PENDENTE": return "bloqueada"
    // DISPONIVEL = liberado para trabalhar (não "futuro/travado"). Na aba Workflow
    // um passo "em_andamento" é acionável ("Central da Etapa →"); "nao_iniciada"
    // aparece bloqueado sem botão. O passo materializado da Genealogia
    // (localizar_registro) nasce DISPONIVEL e precisa ser clicável.
    case "DISPONIVEL": return "em_andamento"
    default: return "nao_iniciada"
  }
}

/**
 * WorkflowStep.status (legado, String) → StepInstanceStatus (v2).
 * Default seguro = PENDENTE (nunca marca como concluído por engano).
 */
export function mapLegacyStepStatus(legacy: string | null | undefined): StepInstanceStatus {
  switch (String(legacy ?? "").trim().toLowerCase()) {
    case "concluida":
    case "concluído":
    case "concluido":
    case "finalizada":
    case "finalizado":
      return "CONCLUIDO"
    case "em_andamento":
    case "em_execucao":
    case "em execução":
    case "em_execução":
      return "EM_ANDAMENTO"
    case "bloqueada":
    case "bloqueado":
      return "BLOQUEADO"
    case "cancelada":
    case "cancelado":
      return "CANCELADO"
    case "dispensada":
    case "dispensado":
      return "DISPENSADO"
    default:
      return "PENDENTE"
  }
}

/**
 * Workflow.status (legado, String) → WorkflowInstanceStatus (v2).
 * Fase passada (arquivado/concluído) → CONCLUIDO; corrente (em_andamento) → ATIVO.
 * Default seguro = ATIVO.
 */
export function mapLegacyWorkflowStatus(legacy: string | null | undefined): WorkflowInstanceStatus {
  switch (String(legacy ?? "").trim().toLowerCase()) {
    case "arquivado":
    case "concluido":
    case "concluído":
    case "concluida":
    case "finalizado":
      return "CONCLUIDO"
    case "cancelado":
    case "cancelada":
      return "CANCELADO"
    case "bloqueado":
    case "bloqueada":
      return "BLOQUEADO"
    case "em_andamento":
    case "ativo":
    default:
      return "ATIVO"
  }
}
