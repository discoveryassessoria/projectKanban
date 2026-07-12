// src/services/phase-workflow-helpers.ts
// CP-4B — helpers PUROS (sem prisma/sem alias @/): chaves idempotentes,
// mapeamento de tipo, snapshots, ordenação determinística e detecção de ciclo.

export type PassoTipoStr =
  | "HUMANO"
  | "AUTOMATICO"
  | "ESPERA"
  | "VALIDACAO"
  | "DECISAO"
  | "APROVACAO"
  | "MANUAL_SEM_TAREFA"

const TIPOS_VALIDOS: PassoTipoStr[] = [
  "HUMANO", "AUTOMATICO", "ESPERA", "VALIDACAO", "DECISAO", "APROVACAO", "MANUAL_SEM_TAREFA",
]

export interface WorkflowValidationIssue {
  code: string
  message: string
  entityType?: string
  entityId?: number | string
  stepKey?: string
  metadata?: Record<string, unknown>
}

export interface WorkflowValidationResult {
  valid: boolean
  errors: WorkflowValidationIssue[]
  warnings: WorkflowValidationIssue[]
}

// Definições recebidas (subset do que importa; sem acoplar ao Prisma).
export interface DefWorkflow {
  id: number
  wfUid: string
  name: string
  phaseKey: string
  tipoProcessoId: number | null
  versao: number
  active: boolean
  arquivado: boolean
}
export interface DefStep {
  id: number
  key: string
  label: string
  description: string | null
  ordem: number
  createsTask: boolean
  required: boolean
  owner: string | null
  priority: string
  slaDays: number
  completionRule: string | null
  checklist: unknown
  versao: number
  tipo?: string | null // a definição atual NÃO tem; reservado p/ futuro
  dependeDeStepKeys?: string[] | null // reservado; hoje ausente na definição
}

// ---------- Chaves de idempotência (determinísticas) ----------
export function montarChaveWorkflow(i: {
  processoId: number
  faseMacroId?: number | null
  faseMacroKey: string
  faseMacroVersion?: number | null
  workflowDefinitionId: number
  workflowVersion: number
  ciclo: number
}): string {
  return [
    `proc${i.processoId}`,
    `fmid${i.faseMacroId ?? "-"}`,
    `fmkey${i.faseMacroKey}`,
    `fmv${i.faseMacroVersion ?? "-"}`,
    `wfdef${i.workflowDefinitionId}`,
    `wfv${i.workflowVersion}`,
    `c${i.ciclo}`,
  ].join("|")
}

export function montarChavePasso(i: {
  workflowInstanceId: number
  stepDefinitionId: number
  stepKey: string
  stepDefinitionVersion: number
  ciclo: number
}): string {
  return [
    `wfi${i.workflowInstanceId}`,
    `stepdef${i.stepDefinitionId}`,
    `stepkey${i.stepKey}`,
    `stepv${i.stepDefinitionVersion}`,
    `c${i.ciclo}`,
  ].join("|")
}

export function montarChaveEvento(i: {
  correlationId: string
  tipo: string
  entityType: string
  entityId: number | string
  operationKey: string
}): string {
  return [`corr${i.correlationId}`, `t${i.tipo}`, `et${i.entityType}`, `eid${i.entityId}`, `op${i.operationKey}`].join("|")
}

// ---------- Tipo do Passo (decisão 11) ----------
export function mapearTipoPasso(def: { tipo?: string | null; createsTask: boolean }): {
  tipo: PassoTipoStr
  warnings: WorkflowValidationIssue[]
  error?: WorkflowValidationIssue
} {
  const warnings: WorkflowValidationIssue[] = []
  if (def.tipo != null && def.tipo !== "") {
    if (!TIPOS_VALIDOS.includes(def.tipo as PassoTipoStr)) {
      return {
        tipo: "HUMANO",
        warnings,
        error: { code: "CONFIGURACAO_TIPO_INVALIDA", message: `Tipo de passo inválido: ${def.tipo}` },
      }
    }
    return { tipo: def.tipo as PassoTipoStr, warnings }
  }
  // sem tipo explícito → inferir HUMANO/AUTOMATICO com warning
  const tipo: PassoTipoStr = def.createsTask ? "HUMANO" : "AUTOMATICO"
  warnings.push({ code: "PASSO_TIPO_INFERIDO", message: `Tipo inferido de createsTask=${def.createsTask} => ${tipo}` })
  return { tipo, warnings }
}

// ---------- Estado inicial do Passo (decisão 8/10) ----------
export function estadoInicialPasso(temDependenciaBloqueante: boolean): "DISPONIVEL" | "PENDENTE" {
  return temDependenciaBloqueante ? "PENDENTE" : "DISPONIVEL"
}

// ---------- Ordenação determinística (seção 5) ----------
export function ordenarStepsDeterministico<T extends { ordem: number; key: string }>(steps: T[]): T[] {
  return [...steps].sort((a, b) => (a.ordem - b.ordem) || a.key.localeCompare(b.key))
}

// warning quando há ordem duplicada
export function detectarOrdemDuplicada(steps: { ordem: number; key: string }[]): WorkflowValidationIssue[] {
  const porOrdem = new Map<number, number>()
  for (const s of steps) porOrdem.set(s.ordem, (porOrdem.get(s.ordem) ?? 0) + 1)
  const issues: WorkflowValidationIssue[] = []
  for (const [ordem, n] of porOrdem) {
    if (n > 1) issues.push({ code: "ORDEM_DUPLICADA", message: `${n} passos com ordem=${ordem} (desempate por stepKey)` })
  }
  return issues
}

// ---------- Detecção de ciclo simples (seção 7) ----------
export function detectarCicloDependencia(steps: { key: string; dependeDeStepKeys?: string[] | null }[]): string[] | null {
  const adj = new Map<string, string[]>()
  for (const s of steps) adj.set(s.key, (s.dependeDeStepKeys ?? []).slice())
  const estado = new Map<string, 0 | 1 | 2>() // 0=branco,1=cinza,2=preto
  const pilha: string[] = []

  function dfs(n: string): string[] | null {
    estado.set(n, 1)
    pilha.push(n)
    for (const dep of adj.get(n) ?? []) {
      if (!adj.has(dep)) continue // dependência inexistente é tratada à parte
      const e = estado.get(dep) ?? 0
      if (e === 1) return [...pilha, dep] // ciclo
      if (e === 0) {
        const r = dfs(dep)
        if (r) return r
      }
    }
    pilha.pop()
    estado.set(n, 2)
    return null
  }

  for (const s of steps) {
    if ((estado.get(s.key) ?? 0) === 0) {
      const r = dfs(s.key)
      if (r) return r
    }
  }
  return null
}

// dependências que referenciam stepKeys inexistentes
export function dependenciasInvalidas(steps: { key: string; dependeDeStepKeys?: string[] | null }[]): WorkflowValidationIssue[] {
  const keys = new Set(steps.map((s) => s.key))
  const issues: WorkflowValidationIssue[] = []
  for (const s of steps) {
    for (const dep of s.dependeDeStepKeys ?? []) {
      if (!keys.has(dep)) {
        issues.push({ code: "DEPENDENCIA_INVALIDA", message: `Passo ${s.key} depende de stepKey inexistente: ${dep}`, stepKey: s.key })
      }
    }
  }
  return issues
}

// ---------- Snapshots (imutáveis, versionados) ----------
export function construirSnapshotWorkflow(i: {
  workflowDefinitionId: number
  workflowVersion: number
  name: string
  description?: string | null
  faseMacroId: number | null
  faseMacroKey: string
  faseMacroVersion: number | null
  modoKey?: string | null
  tipoProcessoId: number | null
  instantiatedAt: string
}): Record<string, unknown> {
  return {
    snapshotSchemaVersion: 1,
    workflowDefinitionId: i.workflowDefinitionId,
    workflowVersion: i.workflowVersion,
    name: i.name,
    descricao: i.description ?? null,
    faseMacroId: i.faseMacroId,
    faseMacroKey: i.faseMacroKey,
    faseMacroVersion: i.faseMacroVersion,
    modeKey: i.modoKey ?? null,
    tipoProcessoId: i.tipoProcessoId,
    instantiatedAt: i.instantiatedAt,
  }
}

export function construirSnapshotPasso(def: DefStep, resolvido: {
  tipo: PassoTipoStr
  dependeDeStepKeys: string[]
  instantiatedAt: string
}): Record<string, unknown> {
  return {
    snapshotSchemaVersion: 1,
    stepDefinitionId: def.id,
    stepDefinitionVersion: def.versao,
    stepKey: def.key,
    titulo: def.label,
    descricao: def.description ?? null,
    ordem: def.ordem,
    tipo: resolvido.tipo,
    obrigatorio: def.required,
    geraTarefa: def.createsTask,
    condicao: null, // definição atual não possui condição por passo (CP-4E)
    condicaoVersao: null,
    dependencias: resolvido.dependeDeStepKeys,
    papelResponsavel: def.owner ?? null,
    equipeResponsavel: null,
    prioridade: def.priority,
    sla: def.slaDays,
    exigeEvidencia: null,
    exigeAprovacao: null,
    permiteDispensa: null,
    permiteReabertura: null,
    completionRule: def.completionRule ?? null,
    checklist: def.checklist ?? null,
    metadata: null,
    instantiatedAt: resolvido.instantiatedAt,
  }
}
