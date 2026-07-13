// src/services/completion-engine/policies.ts
//
// MOTOR DE CONCLUSÃO — NÚCLEO PURO (Etapa 2 da Apostila Mestra).
//
// FONTE ÚNICA DE VERDADE da DECISÃO de conclusão/progresso/blockers.
// PURO: sem prisma, sem alias "@/", sem I/O. Recebe "fatos" (context) já
// carregados e devolve o veredito. Assim é 100% testável (tsx, sem DB) e
// pode ser consumido por qualquer rota/serviço (regras 9 e 10: o front e as
// rotas só EXIBEM/aplicam o que este motor decide — não recalculam regra).
//
// Os adaptadores que tocam o banco (montar o context) vivem em ./index.ts e
// em processEngine/stepCompletionResolver.ts. Este arquivo nunca faz I/O.

// ── Políticas suportadas (regra: "POLÍTICAS DE CONCLUSÃO MÍNIMAS") ──────────
export const COMPLETION_POLICIES = [
  "MANUAL_CONFIRMATION",
  "TASK_COMPLETED",
  "ALL_LINKED_TASKS_COMPLETED",
  "DOCUMENT_LOCATED",
  "DOCUMENT_RECEIVED",
  "DOCUMENT_VALIDATED",
  "ALL_REQUIRED_DOCUMENTS_LOCATED",
  "ALL_REQUIRED_DOCUMENTS_VALIDATED",
  "CONDITION_EXPRESSION",
  "CUSTOM_RULE",
] as const

export type CompletionPolicy = (typeof COMPLETION_POLICIES)[number]
/** NEEDS_REVIEW = política ausente/desconhecida/inválida (regra 8). */
export type ResolvedPolicy = CompletionPolicy | "NEEDS_REVIEW"

export interface Blocker {
  /** código estável (não-i18n) — ex.: DOCUMENT_NOT_LOCATED, POLICY_NEEDS_REVIEW */
  code: string
  /** blocker obrigatório impede 100% e avanço (regras 5, 6, 9). */
  mandatory: boolean
  message: string
  ref?: string
}

export interface Evidence {
  code: string
  message: string
  ref?: string
}

/** Formato mínimo obrigatório para resolução de passo (spec). */
export interface StepCompletionResult {
  completed: boolean
  progress: number // 0..100
  reason: string
  policy: ResolvedPolicy
  blockers: Blocker[]
  evidence: Evidence[]
  evaluatedAt: Date
}

// ── Fatos de entrada (montados pelo adaptador de banco OU pelo teste) ───────

export interface DocumentFact {
  ref?: string
  /** default true. Documentos não-obrigatórios não bloqueiam (viram WARNING). */
  required?: boolean
  cancelled?: boolean
  located: boolean // ato localizado (dados registrais preenchidos)
  received: boolean // arquivo/certidão anexada
  validated: boolean // validação jurídica REAL (não só arquivo)
}

export interface TaskFact {
  ref?: string
  completed: boolean
  /** default true. Tarefa opcional não bloqueia. */
  mandatory?: boolean
}

export interface StepEvalContext {
  /** política crua vinda do passo (WorkflowStep.completionPolicy) ou do padrão. */
  rawPolicy: string | null | undefined
  now: Date
  /** doc do próprio passo — para DOCUMENT_LOCATED/RECEIVED/VALIDATED. */
  self?: DocumentFact
  /** conjunto obrigatório da fase — para ALL_REQUIRED_DOCUMENTS_*. */
  requiredDocuments?: DocumentFact[]
  /** tarefas ligadas ao passo — para TASK_COMPLETED/ALL_LINKED_TASKS_COMPLETED. */
  linkedTasks?: TaskFact[]
  /** resultado já avaliado da expressão — para CONDITION_EXPRESSION (avaliada fora). */
  conditionResult?: boolean | null
  /** resultado da regra custom — para CUSTOM_RULE (avaliada fora). */
  customRuleResult?: { completed: boolean; progress?: number; reason?: string } | null
}

/** Normaliza a política: ausente/desconhecida → NEEDS_REVIEW (regra 8). */
export function normalizePolicy(raw: string | null | undefined): ResolvedPolicy {
  if (!raw) return "NEEDS_REVIEW"
  return (COMPLETION_POLICIES as readonly string[]).includes(raw)
    ? (raw as CompletionPolicy)
    : "NEEDS_REVIEW"
}

// ── Helpers puros ───────────────────────────────────────────────────────────
const pct = (done: number, total: number) =>
  total > 0 ? Math.round((done / total) * 100) : 0

const activeRequired = (docs: DocumentFact[]) =>
  docs.filter((d) => d.required !== false && !d.cancelled)

function aggregate(
  docs: DocumentFact[],
  pred: (d: DocumentFact) => boolean,
  faltaCode: string,
  faltaMsg: (d: DocumentFact, i: number) => string,
  now: Date,
): StepCompletionResult {
  const req = activeRequired(docs)
  const total = req.length
  const done = req.filter(pred).length
  const faltantes = req.filter((d) => !pred(d))
  const blockers: Blocker[] = faltantes.map((d, i) => ({
    code: faltaCode,
    mandatory: true,
    message: faltaMsg(d, i),
    ref: d.ref,
  }))
  const evidence: Evidence[] = req.filter(pred).map((d) => ({
    code: "REQUIRED_DOCUMENT_OK",
    message: `Documento ${d.ref ?? "?"} atende o critério`,
    ref: d.ref,
  }))
  return {
    completed: total > 0 && done === total,
    progress: pct(done, total),
    reason:
      total === 0
        ? "Sem documentos obrigatórios nesta fase"
        : `${done} de ${total} documento(s) obrigatório(s) atendem o critério`,
    policy: "ALL_REQUIRED_DOCUMENTS_LOCATED", // sobrescrito pelo caller
    blockers,
    evidence,
    evaluatedAt: now,
  }
}

function boolStep(
  ok: boolean,
  okEvidence: Evidence,
  faltaBlocker: Blocker,
  reasonOk: string,
  reasonFalta: string,
  policy: ResolvedPolicy,
  now: Date,
): StepCompletionResult {
  return {
    completed: ok,
    progress: ok ? 100 : 0,
    reason: ok ? reasonOk : reasonFalta,
    policy,
    blockers: ok ? [] : [faltaBlocker],
    evidence: ok ? [okEvidence] : [],
    evaluatedAt: now,
  }
}

/**
 * DECISÃO CENTRAL de conclusão de UM passo. Pura. Nunca assume TASK_COMPLETED
 * por padrão; política desconhecida/ausente → NEEDS_REVIEW e NÃO conclui.
 */
export function evaluateStepCompletion(ctx: StepEvalContext): StepCompletionResult {
  const now = ctx.now
  const policy = normalizePolicy(ctx.rawPolicy)

  switch (policy) {
    case "NEEDS_REVIEW":
      return {
        completed: false,
        progress: 0,
        reason:
          "Política de conclusão ausente, desconhecida ou inválida — passo requer revisão (não concluído automaticamente).",
        policy,
        blockers: [
          {
            code: "POLICY_NEEDS_REVIEW",
            mandatory: true,
            message: `Política "${ctx.rawPolicy ?? "(vazia)"}" não é reconhecida. Configure a regra de conclusão.`,
          },
        ],
        evidence: [],
        evaluatedAt: now,
      }

    case "MANUAL_CONFIRMATION":
      // Sem trava automática — a conclusão é liberada para confirmação manual.
      return {
        completed: true,
        progress: 100,
        reason: "Conclusão manual liberada (sem condição automática).",
        policy,
        blockers: [],
        evidence: [{ code: "MANUAL", message: "Confirmação manual permitida" }],
        evaluatedAt: now,
      }

    case "TASK_COMPLETED": {
      // Só conclui o passo por tarefa quando a tarefa ligada está concluída (regra 1/2).
      const tasks = ctx.linkedTasks ?? []
      const alvo = tasks[0]
      const ok = !!alvo && alvo.completed
      return boolStep(
        ok,
        { code: "TASK_COMPLETED", message: "Tarefa vinculada concluída", ref: alvo?.ref },
        {
          code: alvo ? "TASK_NOT_COMPLETED" : "TASK_MISSING",
          mandatory: true,
          message: alvo
            ? "A tarefa vinculada ainda não foi concluída."
            : "Nenhuma tarefa vinculada encontrada para concluir este passo.",
          ref: alvo?.ref,
        },
        "Tarefa vinculada concluída.",
        alvo ? "Tarefa vinculada pendente." : "Sem tarefa vinculada.",
        policy,
        now,
      )
    }

    case "ALL_LINKED_TASKS_COMPLETED": {
      const tasks = (ctx.linkedTasks ?? []).filter((t) => t.mandatory !== false)
      const total = tasks.length
      const done = tasks.filter((t) => t.completed).length
      const blockers: Blocker[] = tasks
        .filter((t) => !t.completed)
        .map((t) => ({
          code: "TASK_NOT_COMPLETED",
          mandatory: true,
          message: "Tarefa vinculada pendente.",
          ref: t.ref,
        }))
      return {
        completed: total > 0 && done === total,
        progress: pct(done, total),
        reason:
          total === 0 ? "Sem tarefas vinculadas." : `${done} de ${total} tarefa(s) concluída(s).`,
        policy,
        blockers,
        evidence: tasks
          .filter((t) => t.completed)
          .map((t) => ({ code: "TASK_COMPLETED", message: "Tarefa concluída", ref: t.ref })),
        evaluatedAt: now,
      }
    }

    case "DOCUMENT_LOCATED": {
      const ok = !!ctx.self?.located
      return boolStep(
        ok,
        { code: "REGISTRAL_DATA", message: "Ato localizado (dados registrais preenchidos)", ref: ctx.self?.ref },
        {
          code: "DOCUMENT_NOT_LOCATED",
          mandatory: true,
          message:
            'O ato ainda não foi localizado. Preencha os dados registrais (cartório, livro/folha/termo ou nº de registro) antes de concluir.',
          ref: ctx.self?.ref,
        },
        "Ato localizado.",
        "Ato ainda não localizado.",
        policy,
        now,
      )
    }

    case "DOCUMENT_RECEIVED": {
      const ok = !!ctx.self?.received
      return boolStep(
        ok,
        { code: "FILE_ATTACHED", message: "Certidão/arquivo recebido", ref: ctx.self?.ref },
        {
          code: "DOCUMENT_NOT_RECEIVED",
          mandatory: true,
          message: "Anexe o arquivo da certidão recebida antes de concluir.",
          ref: ctx.self?.ref,
        },
        "Documento recebido.",
        "Documento ainda não recebido.",
        policy,
        now,
      )
    }

    case "DOCUMENT_VALIDATED": {
      // Exige sinal REAL de validação (não apenas arquivo anexado).
      const ok = !!ctx.self?.validated
      return boolStep(
        ok,
        { code: "VALIDATION_OK", message: "Documento validado", ref: ctx.self?.ref },
        {
          code: "DOCUMENT_NOT_VALIDATED",
          mandatory: true,
          message: "O documento ainda não passou pela validação jurídica.",
          ref: ctx.self?.ref,
        },
        "Documento validado.",
        "Documento ainda não validado.",
        policy,
        now,
      )
    }

    case "ALL_REQUIRED_DOCUMENTS_LOCATED": {
      const r = aggregate(
        ctx.requiredDocuments ?? [],
        (d) => d.located,
        "DOCUMENT_NOT_LOCATED",
        (d) => `Documento obrigatório ${d.ref ?? "?"} ainda não localizado.`,
        now,
      )
      return { ...r, policy }
    }

    case "ALL_REQUIRED_DOCUMENTS_VALIDATED": {
      const r = aggregate(
        ctx.requiredDocuments ?? [],
        (d) => d.validated,
        "DOCUMENT_NOT_VALIDATED",
        (d) => `Documento obrigatório ${d.ref ?? "?"} ainda não validado.`,
        now,
      )
      return { ...r, policy }
    }

    case "CONDITION_EXPRESSION": {
      if (ctx.conditionResult === null || ctx.conditionResult === undefined) {
        // Não dá pra avaliar → não conclui, marca revisão (nunca assume true).
        return {
          completed: false,
          progress: 0,
          reason: "Expressão de condição não pôde ser avaliada — requer revisão.",
          policy,
          blockers: [
            { code: "CONDITION_UNRESOLVED", mandatory: true, message: "Condição não avaliada." },
          ],
          evidence: [],
          evaluatedAt: now,
        }
      }
      return boolStep(
        ctx.conditionResult,
        { code: "CONDITION_TRUE", message: "Condição satisfeita" },
        { code: "CONDITION_FALSE", mandatory: true, message: "Condição ainda não satisfeita." },
        "Condição satisfeita.",
        "Condição não satisfeita.",
        policy,
        now,
      )
    }

    case "CUSTOM_RULE": {
      const r = ctx.customRuleResult
      if (!r) {
        // Regra custom não resolvida → não conclui (regra 8).
        return {
          completed: false,
          progress: 0,
          reason: "Regra custom não avaliada — requer revisão (não concluído por padrão).",
          policy,
          blockers: [
            { code: "CUSTOM_RULE_UNRESOLVED", mandatory: true, message: "Regra custom não avaliada." },
          ],
          evidence: [],
          evaluatedAt: now,
        }
      }
      return {
        completed: r.completed,
        progress: typeof r.progress === "number" ? r.progress : r.completed ? 100 : 0,
        reason: r.reason ?? (r.completed ? "Regra custom satisfeita." : "Regra custom não satisfeita."),
        policy,
        blockers: r.completed ? [] : [{ code: "CUSTOM_RULE_FALSE", mandatory: true, message: "Regra custom não satisfeita." }],
        evidence: r.completed ? [{ code: "CUSTOM_RULE_TRUE", message: "Regra custom satisfeita" }] : [],
        evaluatedAt: now,
      }
    }

    default: {
      // Inalcançável (todas as políticas tratadas). Fail-closed por segurança.
      const _exhaustive: never = policy
      return {
        completed: false,
        progress: 0,
        reason: "Política não tratada — requer revisão.",
        policy: "NEEDS_REVIEW",
        blockers: [{ code: "POLICY_NEEDS_REVIEW", mandatory: true, message: String(_exhaustive) }],
        evidence: [],
        evaluatedAt: now,
      }
    }
  }
}

// ── Agregação: workflow e fase a partir de resultados de passos ─────────────

export interface StepInput {
  weight?: number
  result: StepCompletionResult
}

export interface AggregateResult {
  completed: boolean
  progress: number
  blockers: Blocker[]
  mandatoryBlockers: Blocker[]
  evaluatedAt: Date
}

/**
 * Progresso/conclusão do WORKFLOW a partir dos passos (média ponderada por
 * weight). NUNCA conclui com blocker obrigatório aberto (regra 6).
 */
export function evaluateWorkflowProgress(steps: StepInput[], now: Date): AggregateResult {
  const totalWeight = steps.reduce((a, s) => a + (s.weight ?? 1), 0)
  const doneWeight = steps.reduce((a, s) => a + (s.weight ?? 1) * (s.result.progress / 100), 0)
  const progress = totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0
  const blockers = steps.flatMap((s) => s.result.blockers)
  const mandatoryBlockers = blockers.filter((b) => b.mandatory)
  const allStepsCompleted = steps.length > 0 && steps.every((s) => s.result.completed)
  return {
    completed: allStepsCompleted && mandatoryBlockers.length === 0,
    progress: mandatoryBlockers.length > 0 ? Math.min(progress, 99) : progress,
    blockers,
    mandatoryBlockers,
    evaluatedAt: now,
  }
}

/**
 * Conclusão da FASE a partir dos workflows + blockers de fase. Passo/ workflow
 * concluído NÃO conclui fase automaticamente (regra 7): quem decide é esta
 * agregação + canCompletePhase.
 */
export function evaluatePhaseProgress(
  workflows: AggregateResult[],
  extraBlockers: Blocker[],
  now: Date,
): AggregateResult {
  const totalW = workflows.length
  const progress =
    totalW > 0 ? Math.round(workflows.reduce((a, w) => a + w.progress, 0) / totalW) : 0
  const blockers = [...workflows.flatMap((w) => w.blockers), ...extraBlockers]
  const mandatoryBlockers = blockers.filter((b) => b.mandatory)
  const allDone = totalW > 0 && workflows.every((w) => w.completed)
  return {
    completed: allDone && mandatoryBlockers.length === 0,
    progress: mandatoryBlockers.length > 0 ? Math.min(progress, 99) : progress,
    blockers,
    mandatoryBlockers,
    evaluatedAt: now,
  }
}

/** Pode concluir/avançar a fase? Só se não houver blocker obrigatório (regra 9). */
export function canCompletePhase(phase: AggregateResult): { can: boolean; reason: string } {
  if (phase.mandatoryBlockers.length > 0) {
    return {
      can: false,
      reason: `Avanço bloqueado: ${phase.mandatoryBlockers.length} pendência(s) obrigatória(s) aberta(s).`,
    }
  }
  if (!phase.completed) {
    return { can: false, reason: "Fase ainda não concluída (progresso < 100%)." }
  }
  return { can: true, reason: "Fase concluída — avanço liberado." }
}
