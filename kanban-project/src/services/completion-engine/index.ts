// src/services/completion-engine/index.ts
//
// SERVIÇOS CENTRAIS do Motor de Conclusão (Etapa 2). Ponto ÚNICO de entrada.
// Cada função REUSA o cálculo já existente (não cria segundo cálculo) e expõe
// o veredito no formato canônico do núcleo puro. O front/rotas só consomem
// daqui — não recalculam regra (regras 9/10).

import { prisma } from "@/lib/prisma"
import type { FaseCode } from "@prisma/client"
import { resolveStepCompletionState } from "@/src/services/processEngine/stepCompletionResolver"
import {
  computePhaseProgress,
  stageFromFaseCode,
} from "@/src/lib/process-stage/compute-phase-progress"
import type { DocForStage } from "@/src/lib/process-stage/derive-stage"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import { progressoOperacaoV2 } from "@/src/services/documento-operacao"
import {
  evaluateWorkflowProgress,
  canCompletePhase as canCompletePhasePure,
  type AggregateResult,
  type Blocker,
} from "./policies"

// Reexporta o núcleo puro para quem quiser consumir a decisão diretamente.
export {
  evaluateStepCompletion,
  evaluateWorkflowProgress,
  evaluatePhaseProgress,
  normalizePolicy,
  COMPLETION_POLICIES,
} from "./policies"
export type {
  StepCompletionResult,
  Blocker,
  Evidence,
  CompletionPolicy,
  ResolvedPolicy,
  AggregateResult,
} from "./policies"
export { resolveStepCompletionState } from "@/src/services/processEngine/stepCompletionResolver"

// ── resolveWorkflowProgress: progresso/conclusão do workflow de UM documento ─
export async function resolveWorkflowProgress(documentoId: number): Promise<AggregateResult> {
  const now = new Date()
  // CUTOVER V2: fonte ÚNICA = operação por-documento no V2 (PhaseWorkflowStepInstance
  // com documentoId). Sem operação V2 → progresso zero (nada a concluir).
  const v2 = await progressoOperacaoV2(documentoId)
  return v2 ?? { completed: false, progress: 0, blockers: [], mandatoryBlockers: [], evaluatedAt: now }
}

// ── resolvePhaseProgress: progresso da FASE atual do processo ─────────────────
export interface PhaseResolution extends AggregateResult {
  faseCode: string | null
  done: number
  total: number
}

async function carregarFaseEDocs(processoId: number): Promise<{
  faseCode: string | null
  docs: DocForStage[]
}> {
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: {
      faseAtualKey: true,
      status: { select: { faseCode: true } },
      arvore: {
        select: {
          pessoas: {
            where: { linhaReta: true },
            select: {
              documentos: {
                select: {
                  status: true,
                  // CUTOVER V2: progresso da fase deriva do status (mestre) do documento;
                  // não lê mais Workflow legado.
                },
              },
            },
          },
        },
      },
    },
  })
  const faseCode =
    phaseKeyToFaseCode(processo?.faseAtualKey) ??
    processo?.status?.faseCode ??
    null
  const docs: DocForStage[] = (processo?.arvore?.pessoas ?? []).flatMap((p) =>
    p.documentos.map((d) => ({ status: d.status, required: true, workflows: [] } as unknown as DocForStage)),
  )
  return { faseCode, docs }
}

export async function resolvePhaseProgress(processoId: number): Promise<PhaseResolution> {
  const now = new Date()
  const { faseCode, docs } = await carregarFaseEDocs(processoId)
  const stage = stageFromFaseCode(faseCode)
  const pp = computePhaseProgress(docs, stage, faseCode)
  const blockers = await resolvePhaseBlockers(processoId, pp.done, pp.total)
  const mandatoryBlockers = blockers.filter((b) => b.mandatory)
  return {
    faseCode,
    done: pp.done,
    total: pp.total,
    progress: pp.percent,
    completed: pp.total > 0 && pp.done === pp.total && mandatoryBlockers.length === 0,
    blockers,
    mandatoryBlockers,
    evaluatedAt: now,
  }
}

// ── resolvePhaseBlockers: pendências obrigatórias da fase ─────────────────────
export async function resolvePhaseBlockers(
  processoId: number,
  done?: number,
  total?: number,
): Promise<Blocker[]> {
  if (done === undefined || total === undefined) {
    const { faseCode, docs } = await carregarFaseEDocs(processoId)
    const pp = computePhaseProgress(docs, stageFromFaseCode(faseCode), faseCode)
    done = pp.done
    total = pp.total
  }
  const faltam = total - done
  if (faltam <= 0) return []
  return [
    {
      code: "REQUIRED_DOCUMENTS_PENDING",
      mandatory: true,
      message: `${faltam} de ${total} documento(s) obrigatório(s) ainda pendente(s) nesta fase.`,
    },
  ]
}

// ── canCompletePhase: pode concluir/avançar a fase? ───────────────────────────
export async function canCompletePhase(processoId: number): Promise<{ can: boolean; reason: string; blockers: Blocker[] }> {
  const phase = await resolvePhaseProgress(processoId)
  const d = canCompletePhasePure(phase)
  return { can: d.can, reason: d.reason, blockers: phase.blockers }
}

// ── tryAdvanceCurrentPhase: GUARD canônico de avanço ──────────────────────────
// Read-only: decide se PODE avançar (regra 9 — blocker obrigatório nega). A
// escrita da fase segue no fluxo existente (recalcular-fase/PhaseAdvanceService);
// este guard é o que esses caminhos devem consultar. Não muta nada aqui.
export async function tryAdvanceCurrentPhase(
  processoId: number,
): Promise<{ advanced: false; canAdvance: boolean; reason: string; blockers: Blocker[] }> {
  const c = await canCompletePhase(processoId)
  return { advanced: false, canAdvance: c.can, reason: c.reason, blockers: c.blockers }
}

// evita "unused" do import de tipo em builds estritos
export type { FaseCode }
