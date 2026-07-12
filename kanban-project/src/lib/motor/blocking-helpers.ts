// src/lib/motor/blocking-helpers.ts
// CP-4E — helpers PUROS do Motor de Pendências (sem prisma/sem alias @/).
// Classificadores determinísticos + política. Códigos estáveis (sem msg livre).

export type BlockingCategory =
  | "NECESSIDADE_DOCUMENTAL"
  | "PASSO"
  | "TAREFA"
  | "TAREFA_TRANSVERSAL"
  | "BLOQUEIO_MANUAL"
  | "REGRA"
  | "APROVACAO"
  | "EVIDENCIA"
  | "INCIDENTE"

export type BlockingSeverity = "BLOCKING" | "WARNING"

export interface BlockingIssue {
  code: string
  category: BlockingCategory
  severity: BlockingSeverity
  entityType?: string
  entityId?: number | string
  message: string
  resolutionHint?: string
  resolvableByPermission?: string
  metadata?: Record<string, unknown>
}

export type Policy = "ALL_REQUIRED_COMPLETED"

// Estados terminais que NÃO bloqueiam
const PASSO_OK = new Set(["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO"])
const TAREFA_CONCLUIDA = new Set(["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"])
const TAREFA_INATIVA = new Set(["SUPERSEDIDA", "DISPENSADA"])
const NECESSIDADE_OK = new Set(["ATENDIDA", "DISPENSADA"])

// ---------------- NecessidadeDocumental ----------------
export function classificarNecessidade(
  status: string,
  obrigatoria: boolean,
  isGenealogia: boolean,
  necessidadeId: number
): BlockingIssue | null {
  // Genealogia só EXIGE que a necessidade tenha sido gerada (existir) — não atende.
  if (isGenealogia) return null
  if (NECESSIDADE_OK.has(status)) return null
  if (!obrigatoria) {
    return { code: "NECESSIDADE_OPCIONAL_PENDENTE", category: "NECESSIDADE_DOCUMENTAL", severity: "WARNING", entityType: "NecessidadeDocumental", entityId: necessidadeId, message: `Necessidade opcional ainda não atendida (${status})` }
  }
  if (status === "NAO_LOCALIZADA") {
    return {
      code: "DOCUMENTO_NAO_LOCALIZADO", category: "NECESSIDADE_DOCUMENTAL", severity: "BLOCKING",
      entityType: "NecessidadeDocumental", entityId: necessidadeId,
      message: "Documento obrigatório não localizado",
      resolutionHint: "Reavaliar / retorno controlado ao domínio genealógico (sem mover a fase)",
      resolvableByPermission: "workflow.reabrirFase",
    }
  }
  return { code: "NECESSIDADE_OBRIGATORIA_PENDENTE", category: "NECESSIDADE_DOCUMENTAL", severity: "BLOCKING", entityType: "NecessidadeDocumental", entityId: necessidadeId, message: `Necessidade obrigatória não atendida (${status})` }
}

// ---------------- Passo ----------------
export function classificarPasso(status: string, obrigatorio: boolean, stepKey: string, stepInstanceId: number): BlockingIssue | null {
  if (PASSO_OK.has(status)) return null
  if (!obrigatorio) {
    return { code: "PASSO_OPCIONAL_ABERTO", category: "PASSO", severity: "WARNING", entityType: "step_instance", entityId: stepInstanceId, message: `Passo opcional ${stepKey} aberto (${status})` }
  }
  if (status === "AGUARDANDO_APROVACAO") {
    return { code: "PASSO_AGUARDANDO_APROVACAO", category: "APROVACAO", severity: "BLOCKING", entityType: "step_instance", entityId: stepInstanceId, message: `Passo ${stepKey} aguardando aprovação`, resolvableByPermission: "workflow.aprovarPasso" }
  }
  if (status === "BLOQUEADO") return { code: "PASSO_BLOQUEADO", category: "PASSO", severity: "BLOCKING", entityType: "step_instance", entityId: stepInstanceId, message: `Passo ${stepKey} bloqueado` }
  if (status === "FALHOU") return { code: "PASSO_FALHOU", category: "PASSO", severity: "BLOCKING", entityType: "step_instance", entityId: stepInstanceId, message: `Passo ${stepKey} falhou` }
  if (status === "PENDENTE") return { code: "PASSO_PENDENTE_DEPENDENCIA", category: "PASSO", severity: "BLOCKING", entityType: "step_instance", entityId: stepInstanceId, message: `Passo ${stepKey} pendente por dependência` }
  return { code: "PASSO_OBRIGATORIO_ABERTO", category: "PASSO", severity: "BLOCKING", entityType: "step_instance", entityId: stepInstanceId, message: `Passo obrigatório ${stepKey} não concluído (${status})` }
}

// ---------------- Tarefa ----------------
export function classificarTarefa(
  status: string,
  obrigatoria: boolean,
  temResponsavel: boolean,
  exigeResponsavel: boolean,
  tarefaId: number
): BlockingIssue[] {
  const issues: BlockingIssue[] = []
  if (TAREFA_CONCLUIDA.has(status) || TAREFA_INATIVA.has(status)) return issues
  if (status === "CANCELADA") return issues // resolução avaliada pelo Passo obrigatório

  // aberta (NAO_INICIADA/EM_ANDAMENTO/AGUARDANDO_*/BLOQUEADA)
  if (obrigatoria) {
    issues.push({ code: "TAREFA_OBRIGATORIA_ABERTA", category: "TAREFA", severity: "BLOCKING", entityType: "tarefa", entityId: tarefaId, message: `Tarefa obrigatória aberta (${status})` })
  } else {
    issues.push({ code: "TAREFA_OPCIONAL_ABERTA", category: "TAREFA", severity: "WARNING", entityType: "tarefa", entityId: tarefaId, message: `Tarefa opcional aberta (${status})` })
  }
  if (!temResponsavel) {
    issues.push({ code: "TAREFA_SEM_RESPONSAVEL", category: "TAREFA", severity: exigeResponsavel ? "BLOCKING" : "WARNING", entityType: "tarefa", entityId: tarefaId, message: "Tarefa sem responsável individual" })
  }
  return issues
}

// ---------------- Tarefa Transversal ----------------
export function classificarTransversal(aplicavelAFase: boolean, obrigatoria: boolean, aberta: boolean, tarefaId: number): BlockingIssue | null {
  if (!aplicavelAFase || !obrigatoria || !aberta) return null
  return { code: "TRANSVERSAL_OBRIGATORIA_ABERTA", category: "TAREFA_TRANSVERSAL", severity: "BLOCKING", entityType: "tarefa", entityId: tarefaId, message: "Tarefa transversal obrigatória aplicável à fase ainda aberta" }
}

// ---------------- Política ----------------
export function avaliarPolitica(issues: BlockingIssue[], _policy: Policy = "ALL_REQUIRED_COMPLETED"): boolean {
  // ALL_REQUIRED_COMPLETED: pode avançar se NÃO houver nenhum BLOCKING.
  return issues.every((i) => i.severity !== "BLOCKING")
}

export function separar(issues: BlockingIssue[]): { blocking: BlockingIssue[]; warnings: BlockingIssue[] } {
  return {
    blocking: issues.filter((i) => i.severity === "BLOCKING"),
    warnings: issues.filter((i) => i.severity === "WARNING"),
  }
}
