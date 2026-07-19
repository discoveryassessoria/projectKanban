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
  /** Necessidade (certidão) que este documento atende — vínculo Documento.necessidadeId.
   *  Usado para gatear a fase DOCUMENTO pelas CERTIDÕES OBRIGATÓRIAS (não por docs de apoio). */
  necessidadeId?: number | null
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

/**
 * Escopo DOCUMENTO (Emissão): as CERTIDÕES OBRIGATÓRIAS são o denominador da fase — a
 * fase só avança quando TODAS estiverem resolvidas. Docs de apoio (RG/CPF etc.) NÃO
 * gateiam. Uma certidão está resolvida quando SEU documento (Documento.necessidadeId) tem
 * a operação da fase concluída (último passo por-documento concluído). Fonte ÚNICA usada
 * por computeGate E computeProgress → gate e progresso nunca divergem (100% ⟺ pode avançar).
 */
function certidoesObrigatoriasDocumento(input: ProjectionInput): {
  certObrig: NecessidadeData[]
  emitida: (n: NecessidadeData) => boolean
} {
  const certObrig = input.necessidades.filter((n) => n.ehCertidao && n.obrigatoria && n.status !== "DISPENSADA")
  const stepsByDoc = new Map<number, GateStepData[]>()
  for (const s of input.steps) {
    if (s.documentoId == null) continue
    const arr = stepsByDoc.get(s.documentoId) ?? []
    arr.push(s)
    stepsByDoc.set(s.documentoId, arr)
  }
  const docConcluiu = (docId: number): boolean => {
    const ss = stepsByDoc.get(docId) ?? []
    if (ss.length === 0) return false
    return passoConcluido(ss.reduce((a, b) => (b.ordem > a.ordem ? b : a)))
  }
  const docsByNec = new Map<number, number[]>()
  for (const d of input.documentos) {
    if (d.necessidadeId == null) continue
    const arr = docsByNec.get(d.necessidadeId) ?? []
    arr.push(d.id)
    docsByNec.set(d.necessidadeId, arr)
  }
  const emitida = (n: NecessidadeData): boolean => (docsByNec.get(n.id) ?? []).some(docConcluiu)
  return { certObrig, emitida }
}

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

  // --- Escopo DOCUMENTO (Emissão): a fase só avança quando TODAS as CERTIDÕES OBRIGATÓRIAS
  //     estiverem resolvidas (documento emitido/operação concluída). Cada certidão obrigatória
  //     ainda pendente emite um BLOCKING — inclusive as que NUNCA tiveram operação aberta (o
  //     bug anterior: com 1 doc aberto, as demais ficavam invisíveis ao gate e a fase avançava
  //     em 1/N). Docs de apoio (RG/CPF) NÃO gateiam. Mesma régua do computeProgress.
  if (scope === "DOCUMENTO") {
    const { certObrig, emitida } = certidoesObrigatoriasDocumento(input)
    for (const n of certObrig) {
      if (!emitida(n)) {
        issues.push({ code: "CERTIDAO_OBRIGATORIA_PENDENTE", category: "NECESSIDADE_DOCUMENTAL", severity: "BLOCKING", entityType: "NecessidadeDocumental", entityId: n.id, message: "Certidão obrigatória ainda não emitida/concluída nesta fase", resolutionHint: "Concluir a operação de TODAS as certidões obrigatórias antes de avançar" })
      }
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
    // Denominador = CERTIDÕES OBRIGATÓRIAS (mesma régua do gate). Cada certidão conta como
    // concluída quando SEU documento tem a operação da fase concluída. Certidão sem operação
    // (nunca aberta) conta no total como NÃO concluída → progresso e gate concordam.
    const { certObrig, emitida } = certidoesObrigatoriasDocumento(input)
    for (const n of certObrig) {
      totalWeight += 1
      required += 1
      if (emitida(n)) { completedWeight += 1; completed += 1 }
    }
    nextAction = proximaAcaoDe(input.faseCode, gateSteps.filter((s) => s.documentoId != null))
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

  // Progresso a partir da MESMA fonte oficial (computeGate): `blocked` já inclui as regras
  // do BlockingEngine (ex.: GENEALOGIA_SEM_REQUERENTE). Regra definitiva:
  //  • bloqueado (o BlockingEngine NÃO permite concluir) → NUNCA 100% (teto 99);
  //  • não bloqueado + todas as obrigatórias feitas → EXATAMENTE 100% (sem reserva de 1%);
  //  • parcial → proporcional, teto 99 (nunca arredonda p/ 100 com item incompleto).
  const raw = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : (blocked ? 0 : 100)
  let percentage: number
  if (blocked) percentage = Math.min(99, raw)
  else if (totalWeight <= 0 || completedWeight >= totalWeight) percentage = 100
  else percentage = Math.min(99, raw)

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

  // ── BLINDAGEM (invariante do sistema) ──────────────────────────────────────
  // 100% ⟺ o BlockingEngine PERMITE avançar. Logo, uma fase BLOQUEADA jamais pode
  // exibir 100% (senão o card mostra "concluído" mas não avança). Trava defensiva
  // de runtime: mesmo que computeProgress regrida, aqui garantimos ≤ 99% se bloqueado.
  // (`progress` e `advance` derivam do MESMO computeGate → nunca divergem.)
  if (blocked && prog.percentage >= 100) prog.percentage = 99
  if (!blocked && prog.completedWeight >= prog.totalWeight && prog.totalWeight > 0) prog.percentage = 100

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
