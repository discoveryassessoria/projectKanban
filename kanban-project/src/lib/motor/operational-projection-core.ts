// src/lib/motor/operational-projection-core.ts
//
// NÚCLEO PURO (sem I/O) do RESOLVER CANÔNICO da projeção operacional. É a ÚNICA
// fonte de progresso, bloqueio, próxima ação e possibilidade de avanço de uma fase.
// Não toca no banco: recebe um snapshot já carregado (ProjectionInput) e devolve a
// OperationalProjection. As duas camadas de I/O — resolveOperationalProjection (1) e
// resolveOperationalProjectionBatch (N) — apenas carregam o snapshot e chamam este
// núcleo, garantindo contrato e lógica IDÊNTICOS. O BlockingEngine também consome a
// mesma função-base (computeGate), sem cálculo paralelo nem recálculo de progresso.
//
// SCOPE-AWARE: o progresso e o bloqueio são calculados EXCLUSIVAMENTE sobre as
// entidades do ESCOPO DECLARADO da fase (PROCESSO/NECESSIDADE/DOCUMENTO — ver
// fases-catalog.ts). Passos genéricos órfãos (documentoId=null E necessidadeId=null)
// de fases operadas por-entidade são ignorados para progresso e gate (via
// resolvePassosBloqueantesDaFase), mas nunca apagados.

import type { FaseCode } from "@prisma/client"
import type { WorkflowScope } from "@/src/lib/process-stage/fases-catalog"
import { getStepsForFase, getProcessSteps } from "@/src/lib/process-stage/fases-catalog"
import {
  type BlockingIssue,
  classificarNecessidade,
  classificarPasso,
  classificarTarefa,
} from "@/src/lib/motor/blocking-helpers"
import {
  faseOperadaPorEntidade,
  resolvePassosBloqueantesDaFase,
} from "@/src/lib/motor/resolve-passos-bloqueantes"

// ============================================================
// CONTRATO PÚBLICO (definitivo)
// ============================================================

export type { WorkflowScope }

export interface OperationalProjection {
  processId: string

  activePhase: {
    id: string
    name: string
    scope: WorkflowScope
  } | null

  progress: {
    percentage: number
    completedWeight: number
    totalWeight: number
  }

  status: {
    blocked: boolean
    canAdvance: boolean
    operationalState: OperationalState
  }

  nextAction: {
    key: string
    label: string
  } | null

  metrics: {
    required: number
    completed: number
    blocked: number
  }
}

export type OperationalState =
  | "SEM_FASE"
  | "NAO_INICIADA"
  | "EM_ANDAMENTO"
  | "BLOQUEADA"
  | "PRONTA_PARA_AVANCAR"
  | "CONCLUIDA"

// ============================================================
// SNAPSHOT DE ENTRADA (carregado pelas camadas de I/O)
// ============================================================

export interface GateStepData {
  id: number
  stepKey: string
  ordem: number
  status: string
  obrigatorio: boolean
  tipo: string
  geraTarefa: boolean
  documentoId: number | null
  necessidadeId: number | null
  bloqueadoManual: boolean
  motivo: string | null
  snapshot: { exigeEvidencia?: boolean; exigeResponsavel?: boolean; dependencias?: string[] } | null
  dependeDeStepKeys: string[] | null
  tarefas: Array<{ id: number; statusTarefa: string; responsavelId: number | null }>
}

export interface NecessidadeData {
  id: number
  status: string
  obrigatoria: boolean
  ehCertidao: boolean
}

export interface DocumentoData {
  id: number
  status: string
  linhaReta: boolean
}

export interface ProjectionInput {
  processId: number
  faseCode: FaseCode | null
  faseMacroKey: string | null
  phaseName: string | null
  /** Escopo DECLARADO da fase (fases-catalog). null quando a fase é desconhecida. */
  scope: WorkflowScope | null
  processoExists: boolean
  hasActiveInstance: boolean
  /** Passos da instância ATIVA (todos, incluindo genéricos). */
  steps: GateStepData[]
  /** Necessidades do processo (com flag de natureza CERTIDÃO). */
  necessidades: NecessidadeData[]
  /** Documentos da LINHA RETA (denominador do escopo DOCUMENTO). */
  documentos: DocumentoData[]
  hasArvore: boolean
  requerentesCount: number
}

// ============================================================
// HELPERS PUROS
// ============================================================

// Estados terminais do passo que contam como CONCLUÍDO para progresso (idênticos ao
// PASSO_OK do gate: um passo dispensado/supersedido não bloqueia e conta como feito).
const PASSO_OK = new Set(["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO"])
const passoConcluido = (s: { status: string }) => PASSO_OK.has(s.status)

interface Snapshot { exigeEvidencia?: boolean; exigeResponsavel?: boolean; dependencias?: string[] }

/** Escopo EFETIVO: o declarado; fallback data-driven quando a fase é desconhecida. */
export function escopoEfetivo(input: Pick<ProjectionInput, "scope" | "steps">): WorkflowScope {
  if (input.scope) return input.scope
  if (!faseOperadaPorEntidade(input.steps)) return "PROCESSO"
  return input.steps.some((s) => s.documentoId != null) ? "DOCUMENTO" : "NECESSIDADE"
}

/** Título legível de um stepKey a partir do catálogo (por-documento ou por-processo). */
function tituloDoStep(faseCode: FaseCode | null, stepKey: string): string {
  if (!faseCode) return stepKey
  const doc = getStepsForFase(faseCode).find((s) => s.stepKey === stepKey)
  if (doc) return doc.title
  const proc = getProcessSteps(faseCode).find((s) => s.stepKey === stepKey)
  return proc?.title ?? stepKey
}

/** Próxima ação = 1º passo pendente (menor ordem) entre os candidatos informados. */
function proximaAcaoDe(
  faseCode: FaseCode | null,
  candidatos: GateStepData[],
): { key: string; label: string } | null {
  const pendentes = candidatos.filter((s) => !passoConcluido(s)).sort((a, b) => a.ordem - b.ordem)
  const prox = pendentes[0]
  if (!prox) return null
  return { key: prox.stepKey, label: tituloDoStep(faseCode, prox.stepKey) }
}

// ============================================================
// GATE (bloqueio) — FUNÇÃO-BASE ÚNICA
// ============================================================
//
// Espelha exatamente a lógica do PhaseBlockingService (calcularPendencias), mas PURA
// e orientada pelo ESCOPO DECLARADO — sem exceção por nome de fase e sem lista
// hardcoded de stepKey. É consumida pelo resolver E pelo BlockingEngine.

export function computeGate(input: ProjectionInput): BlockingIssue[] {
  const issues: BlockingIssue[] = []
  if (!input.processoExists) {
    issues.push({ code: "PROCESSO_NAO_ENCONTRADO", category: "INCIDENTE", severity: "BLOCKING", message: "Processo inexistente" })
    return issues
  }

  const scope = escopoEfetivo(input)
  const gateSteps = resolvePassosBloqueantesDaFase(input.steps)
  const faseEntityScoped = faseOperadaPorEntidade(input.steps)
  const necStatusById = new Map(input.necessidades.map((n) => [n.id, n.status]))

  // --- Escopo NECESSIDADE: estrutura mínima (necessidades geradas + árvore + requerente).
  //     A LOCALIZAÇÃO em si é gatada pelos PASSOS por-necessidade (abaixo), nunca pelo
  //     status cru da necessidade (existência, não atendimento).
  if (scope === "NECESSIDADE") {
    const necsLegit = input.necessidades.filter((n) => n.ehCertidao)
    if (necsLegit.length === 0) {
      issues.push({ code: "NECESSIDADE_NAO_GERADA", category: "NECESSIDADE_DOCUMENTAL", severity: "BLOCKING", entityType: "Processo", entityId: input.processId, message: "Nenhuma NecessidadeDocumental de CERTIDÃO foi gerada", resolutionHint: "Materializar as certidões obrigatórias aplicáveis antes de avançar" })
    }
    if (!input.hasArvore) {
      issues.push({ code: "GENEALOGIA_SEM_ARVORE", category: "INCIDENTE", severity: "BLOCKING", entityType: "Processo", entityId: input.processId, message: "Fase de necessidade sem árvore vinculada" })
    }
    if (input.requerentesCount === 0) {
      issues.push({ code: "GENEALOGIA_SEM_REQUERENTE", category: "REGRA", severity: "BLOCKING", entityType: "Processo", entityId: input.processId, message: "Nenhum requerente definido" })
    }
  }

  // --- Escopo DOCUMENTO ainda NÃO materializado (sem passo por-entidade): gata pela
  //     EXISTÊNCIA do requisito (certidão obrigatória esperada), NÃO pelo status da
  //     NecessidadeDocumental. O status ATENDIDA significa "localizada na Genealogia / esperada
  //     nesta fase", não "documento emitido" — usar o status aqui deixaria a fase avançar
  //     vazia. Assim que houver passo por-documento, o gate passa a ser o documento.
  if (scope === "DOCUMENTO" && !faseEntityScoped) {
    const esperadas = input.necessidades.filter((n) => n.ehCertidao && n.obrigatoria && n.status !== "DISPENSADA")
    if (esperadas.length > 0) {
      issues.push({ code: "FASE_DOCUMENTAL_NAO_INICIADA", category: "NECESSIDADE_DOCUMENTAL", severity: "BLOCKING", entityType: "Processo", entityId: input.processId, message: "Fase documental sem documento operacional materializado", resolutionHint: "Abrir a operação dos documentos obrigatórios da fase" })
    }
  }

  // --- Passos do gate (por-entidade quando a fase é operada por entidade; genéricos
  //     legítimos quando escopo PROCESSO). Genéricos órfãos já foram filtrados.
  if (input.hasActiveInstance) {
    const stepKeys = new Set(input.steps.map((s) => s.stepKey))
    for (const step of gateSteps) {
      const snap = (step.snapshot as Snapshot | null) ?? {}

      // Entidade DISPENSADA não bloqueia (requisito deixou de ser exigido).
      if (step.necessidadeId != null && necStatusById.get(step.necessidadeId) === "DISPENSADA") continue

      const pIssue = classificarPasso(step.status, step.obrigatorio, step.stepKey, step.id)
      if (pIssue) issues.push(pIssue)

      if (step.bloqueadoManual) {
        issues.push({ code: "BLOQUEIO_MANUAL_ATIVO", category: "BLOQUEIO_MANUAL", severity: "BLOCKING", entityType: "step_instance", entityId: step.id, message: `Bloqueio manual ativo no passo ${step.stepKey}`, metadata: { motivo: step.motivo ?? null } })
      }

      if (snap.exigeEvidencia === true && step.documentoId == null && !PASSO_OK.has(step.status)) {
        issues.push({ code: "EVIDENCIA_OBRIGATORIA_AUSENTE", category: "EVIDENCIA", severity: "BLOCKING", entityType: "step_instance", entityId: step.id, message: `Passo ${step.stepKey} exige evidência ausente` })
      }

      const deps = (step.dependeDeStepKeys as string[] | null) ?? snap.dependencias ?? []
      for (const dep of deps) {
        if (!stepKeys.has(dep)) {
          issues.push({ code: "DEPENDENCIA_QUEBRADA", category: "INCIDENTE", severity: "BLOCKING", entityType: "step_instance", entityId: step.id, message: `Passo ${step.stepKey} depende de stepKey inexistente: ${dep}` })
        }
      }

      if (step.obrigatorio && step.geraTarefa && step.tipo === "HUMANO" && step.status === "DISPONIVEL" && step.tarefas.length === 0) {
        issues.push({ code: "PASSO_SEM_TAREFA_ESPERADA", category: "INCIDENTE", severity: "WARNING", entityType: "step_instance", entityId: step.id, message: `Passo ${step.stepKey} deveria ter Tarefa e não tem` })
      }

      for (const t of step.tarefas) {
        const exigeResp = snap.exigeResponsavel === true
        issues.push(...classificarTarefa(t.statusTarefa, step.obrigatorio, t.responsavelId != null, exigeResp, t.id))
      }
    }
  }

  return issues
}

// ============================================================
// PROGRESSO — SCOPE-AWARE
// ============================================================

interface ProgressResult {
  scope: WorkflowScope
  completedWeight: number
  totalWeight: number
  percentage: number
  required: number
  completed: number
  nextAction: { key: string; label: string } | null
}

function computeProgress(input: ProjectionInput, blocked: boolean): ProgressResult {
  const scope = escopoEfetivo(input)
  const gateSteps = resolvePassosBloqueantesDaFase(input.steps)

  let completedWeight = 0
  let totalWeight = 0
  let required = 0
  let completed = 0
  let nextAction: { key: string; label: string } | null = null

  if (scope === "DOCUMENTO") {
    const docSteps = gateSteps.filter((s) => s.documentoId != null)
    const stepsByDoc = new Map<number, GateStepData[]>()
    for (const s of docSteps) {
      const arr = stepsByDoc.get(s.documentoId as number) ?? []
      arr.push(s)
      stepsByDoc.set(s.documentoId as number, arr)
    }
    const docConcluiu = (docId: number): boolean => {
      const ss = stepsByDoc.get(docId) ?? []
      if (ss.length === 0) return false
      const ultima = ss.reduce((a, b) => (b.ordem > a.ordem ? b : a))
      return passoConcluido(ultima)
    }
    // Denominador = documentos obrigatórios da LINHA RETA (mesma régua da fonte oficial),
    // excluindo CANCELADO. Doc sem passo materializado conta no total como não-concluído.
    const eligibleDocs = input.documentos.filter((d) => d.linhaReta && d.status !== "CANCELADO")
    for (const d of eligibleDocs) {
      totalWeight += 1
      required += 1
      if (docConcluiu(d.id)) { completedWeight += 1; completed += 1 }
    }
    nextAction = proximaAcaoDe(input.faseCode, docSteps)
  } else if (scope === "NECESSIDADE") {
    const stepByNec = new Map<number, GateStepData>()
    for (const s of gateSteps.filter((x) => x.necessidadeId != null)) {
      if (!stepByNec.has(s.necessidadeId as number)) stepByNec.set(s.necessidadeId as number, s)
    }
    const localizada = (n: NecessidadeData): boolean => {
      const s = stepByNec.get(n.id)
      return (!!s && passoConcluido(s)) || n.status === "ATENDIDA"
    }
    // Legítimas = certidões não dispensadas; progresso sobre as OBRIGATÓRIAS.
    const obrig = input.necessidades.filter((n) => n.ehCertidao && n.status !== "DISPENSADA" && n.obrigatoria)
    for (const n of obrig) {
      totalWeight += 1
      required += 1
      if (localizada(n)) { completedWeight += 1; completed += 1 }
    }
    nextAction = proximaAcaoDe(input.faseCode, [...stepByNec.values()])
  } else {
    // PROCESSO: passos genéricos OBRIGATÓRIOS legítimos (a esteira do processo).
    const obrigSteps = gateSteps.filter((s) => s.obrigatorio)
    for (const s of obrigSteps) {
      totalWeight += 1
      required += 1
      if (passoConcluido(s)) { completedWeight += 1; completed += 1 }
    }
    nextAction = proximaAcaoDe(input.faseCode, gateSteps)
  }

  let percentage: number
  if (totalWeight <= 0) percentage = blocked ? 0 : 100
  else percentage = Math.round((completedWeight / totalWeight) * 100)
  // Nunca 100% com bloqueio obrigatório aberto (regra do motor de conclusão).
  if (blocked) percentage = Math.min(percentage, 99)

  return { scope, completedWeight, totalWeight, percentage, required, completed, nextAction }
}

// ============================================================
// PROJEÇÃO — monta o contrato final a partir do snapshot
// ============================================================

export function buildOperationalProjection(input: ProjectionInput): OperationalProjection {
  const gateIssues = computeGate(input)
  const blockingIssues = gateIssues.filter((i) => i.severity === "BLOCKING")
  const blocked = blockingIssues.length > 0
  // ALL_REQUIRED_COMPLETED: pode avançar se não houver nenhum BLOCKING.
  const canAdvance = !blocked

  const prog = computeProgress(input, blocked)

  const hasPhase = input.processoExists && !!input.faseMacroKey
  const activePhase = hasPhase
    ? {
        id: input.faseMacroKey as string,
        name: input.phaseName ?? (input.faseMacroKey as string),
        scope: prog.scope,
      }
    : null

  let operationalState: OperationalState
  if (!activePhase) operationalState = "SEM_FASE"
  else if (blocked) operationalState = "BLOQUEADA"
  else if (prog.percentage >= 100 && canAdvance) operationalState = "PRONTA_PARA_AVANCAR"
  else if (prog.percentage >= 100) operationalState = "CONCLUIDA"
  else if (prog.completed > 0 || prog.percentage > 0) operationalState = "EM_ANDAMENTO"
  else operationalState = "NAO_INICIADA"

  // Próxima ação: passo pendente; se não há pendente e pode avançar, ação de avanço.
  const nextAction =
    prog.nextAction ??
    (activePhase && canAdvance ? { key: "advance_phase", label: "Avançar fase" } : null)

  return {
    processId: String(input.processId),
    activePhase,
    progress: {
      percentage: prog.percentage,
      completedWeight: prog.completedWeight,
      totalWeight: prog.totalWeight,
    },
    status: { blocked, canAdvance, operationalState },
    nextAction,
    metrics: { required: prog.required, completed: prog.completed, blocked: blockingIssues.length },
  }
}
