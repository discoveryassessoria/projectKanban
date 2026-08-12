// src/services/passo-tarefa-helpers.ts
// CP-4C — helpers PUROS (sem prisma/sem alias @/): chave, prioridade, prazo,
// resolução de responsável e a regra normativa de geração de Tarefa.

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
/**
 * A IDENTIDADE DA TAREFA É A UNIDADE DE TRABALHO — não o passo.
 *
 * Esta chave era `stepinst{id}`: cada instância de passo ganhava a sua própria
 * tarefa. Com a Emissão Documental publicada em cinco passos (solicitar,
 * aguardar, receber, conferir, validar), UM documento produzia CINCO tarefas —
 * cinco prazos, cinco responsáveis, cinco linhas na fila — para um trabalho só.
 * E concluir "solicitar" fechava uma tarefa sem que nada tivesse sido obtido.
 *
 * A unidade de trabalho é a OBRIGAÇÃO: a necessidade documental (ou, na falta
 * dela, o documento) daquela pessoa naquele ciclo. Os cinco passos convergem
 * para a mesma chave e, portanto, para a MESMA tarefa — que é o que "etapa não
 * é tarefa" significa na prática.
 *
 * Granularidade preservada: dois documentos da mesma pessoa são duas
 * obrigações, logo duas chaves e duas tarefas. O que desaparece é a
 * multiplicação por passo, não a multiplicação por documento.
 *
 * `taskRole` continua na chave: papéis distintos sobre a mesma obrigação
 * (executar × aprovar) são trabalhos distintos de pessoas distintas.
 */
export function montarChaveTarefa(i: {
  stepInstanceId: number
  taskRole: string
  ciclo: number
  processoId: number
  necessidadeId?: number | null
  documentoId?: number | null
  pessoaId?: number | null
}): string {
  const obrigacao =
    i.necessidadeId != null ? `nec${i.necessidadeId}`
    : i.documentoId != null ? `doc${i.documentoId}`
    // Sem obrigação identificável o trabalho é do PASSO — passo administrativo
    // de fase, que não pertence a documento nem a pessoa nenhuma.
    : `stepinst${i.stepInstanceId}`
  return `unidade|proc${i.processoId}|${obrigacao}|pes${i.pessoaId ?? 0}|role${i.taskRole}|c${i.ciclo}`
}

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

/** Prazo a partir do SLA (dias úteis). Sem SLA (null/<=0) → null. */
export function calcularPrazo(base: Date, sla: number | null | undefined): Date | null {
  if (sla == null || sla <= 0) return null
  return addDiasUteis(base, sla)
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
