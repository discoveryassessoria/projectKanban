// src/services/passo-tarefa-helpers.ts
// CP-4C — helpers PUROS (sem prisma/sem alias @/): chave, prioridade, prazo,
// resolução de responsável e a regra normativa de geração de Tarefa.

import { prazoOperacional } from "@/lib/operacional/tempo-operacional"
import { isDiaUtil } from "../lib/diasUteis"

export type PrioridadeTarefaStr = "BAIXA" | "MEDIA" | "ALTA" | "URGENTE"

export interface TarefaGenIssue {
  code: string
  message: string
  stepKey?: string
}

export type FailureCodeC =
  | "RUNTIME_V2_DESABILITADO"
  | "PROCESSO_LEGACY"
  | "STEP_NAO_ENCONTRADO"
  | "WORKFLOW_INSTANCE_INATIVA"
  | "PASSO_TIPO_NAO_HUMANO"
  | "PASSO_NAO_GERA_TAREFA"
  | "PASSO_ESTADO_INCOMPATIVEL"
  | "PASSO_NAO_APLICAVEL"
  | "CONFIGURACAO_INVALIDA"

export const TASK_ROLE_PADRAO = "principal"

/** Chave de idempotência da Tarefa: 1 principal por (passo, role, ciclo). */
/** Prioridade do snapshot (low|medium|high) → PrioridadeTarefa. Default MEDIA. */
export function mapearPrioridade(p: string | null | undefined): PrioridadeTarefaStr {
  switch ((p ?? "").toLowerCase()) {
    case "low": return "BAIXA"
    case "high": return "ALTA"
    case "medium": return "MEDIA"
    default: return "MEDIA"
  }
}

/** Adiciona N dias ÚTEIS a partir de uma data base (feriados BR via diasUteis). */
export function addDiasUteis(base: Date, n: number): Date {
  const d = new Date(base.getTime())
  let restantes = n
  while (restantes > 0) {
    d.setDate(d.getDate() + 1)
    if (isDiaUtil(d)) restantes--
  }
  return d
}

/**
 * Prazo a partir do SLA — DELEGA para a conta canônica.
 *
 * Existiam duas `calcularPrazo` com os argumentos trocados e dias diferentes
 * (úteis aqui, corridos em `tarefa-canonica`). A assinatura desta permanece
 * porque os chamadores a usam assim; a CONTA passou a ser uma só.
 */
export function calcularPrazo(base: Date, sla: number | null | undefined): Date | null {
  return prazoOperacional(sla, base)
}

/**
 * Responsável: só `responsavelId` explícito atribui. Senão papel/equipe
 * (do Passo) permanecem e geramos warning ATRIBUICAO_PENDENTE. Nunca arbitrário.
 */
export function resolverResponsavel(i: {
  responsavelId?: number | null
  papel?: string | null
  equipe?: string | null
  stepKey?: string
}): { responsavelId: number | null; warning?: TarefaGenIssue } {
  if (i.responsavelId != null) return { responsavelId: i.responsavelId }
  if (i.papel || i.equipe) {
    return {
      responsavelId: null,
      warning: { code: "ATRIBUICAO_PENDENTE", message: `Sem responsável individual; papel/equipe do Passo mantidos`, stepKey: i.stepKey },
    }
  }
  return {
    responsavelId: null,
    warning: { code: "ATRIBUICAO_PENDENTE", message: `Sem responsável, papel ou equipe definidos`, stepKey: i.stepKey },
  }
}

/**
 * Regra normativa (CP-4C, ajuste 2): gera Tarefa somente quando
 *  tipo=HUMANO && geraTarefa=true && status=DISPONIVEL && aplicável ao contexto.
 * Passos não aplicáveis NÃO geram Tarefa.
 */
export function passoGeraTarefa(i: {
  tipo: string
  geraTarefa: boolean
  status: string
  aplicavel: boolean
}): { gera: boolean; code?: FailureCodeC } {
  if (i.tipo !== "HUMANO") return { gera: false, code: "PASSO_TIPO_NAO_HUMANO" }
  if (!i.geraTarefa) return { gera: false, code: "PASSO_NAO_GERA_TAREFA" }
  if (i.status !== "DISPONIVEL") return { gera: false, code: "PASSO_ESTADO_INCOMPATIVEL" }
  if (!i.aplicavel) return { gera: false, code: "PASSO_NAO_APLICAVEL" }
  return { gera: true }
}
