// src/services/documento-operacao.ts
// FASE 3 (CP-5) — OPERAÇÃO POR-DOCUMENTO no runtime V2 ÚNICO.
// Fonte canônica: PhaseWorkflowStepInstance com documentoId setado (discriminador
// já existente). Sem model/coluna nova. Este é o ponto central: os consumidores
// (Central Operacional, completion-engine, rotas de operação, avanço de fase)
// leem/escrevem AQUI — não falam com o legado direto. Reusa o completion-engine
// (não recalcula regra — regras 9/10).

import { prisma } from "@/lib/prisma"
import type { StepInstanceStatus } from "@prisma/client"
import {
  resolveStepCompletionState,
  politicaPadraoParaStep,
} from "@/src/services/processEngine/stepCompletionResolver"
import { evaluateWorkflowProgress, type AggregateResult } from "@/src/services/completion-engine/policies"
import { getStepsForFase, phaseKeyToFaseCode, resolveStepKeyCompat } from "@/src/lib/process-stage/fases-catalog"
import { mapLegacyStepStatus } from "@/src/lib/process-stage/legacy-status-map"

// Passos que NÃO contam como operação ativa do documento.
const INATIVOS: StepInstanceStatus[] = ["SUPERSEDIDO", "CANCELADO"]

// TODO(FASE-3 restante — fora do escopo do item atual):
//  - workflow POST "Iniciar operação": criar passos V2 por-documento (dual-write de criação).
//  - recalcular-fase: derivar avanço da fase a partir da operação V2 por-documento.
//  - central-operacional: owner da etapa ativa pela fonte V2 (responsavelId é ref solta a Usuario).
//  - cutover final: remover leitura/escrita legada após validação em produção.

export interface PassoOperacaoV2 {
  id: number
  stepKey: string
  status: StepInstanceStatus
  faseMacroKey: string
  ordem: number
  responsavelId: number | null
  prazo: Date | null
  startedAt: Date | null
  completedAt: Date | null
  motivo: string | null
  operacao: Record<string, unknown> | null // metadata.operacao (domínio)
}

/** Passos operacionais V2 de UM documento (ativos), ordenados. */
export async function passosOperacaoV2(documentoId: number): Promise<PassoOperacaoV2[]> {
  const rows = await prisma.phaseWorkflowStepInstance.findMany({
    where: { documentoId, status: { notIn: INATIVOS } },
    orderBy: { ordem: "asc" },
    select: {
      id: true, stepKey: true, status: true, faseMacroKey: true, ordem: true,
      responsavelId: true, prazo: true, startedAt: true, completedAt: true, motivo: true, metadata: true,
    },
  })
  return rows.map((r) => {
    const meta = (r.metadata ?? null) as { operacao?: Record<string, unknown> } | null
    return {
      id: r.id, stepKey: r.stepKey, status: r.status, faseMacroKey: r.faseMacroKey, ordem: r.ordem,
      responsavelId: r.responsavelId, prazo: r.prazo, startedAt: r.startedAt, completedAt: r.completedAt,
      motivo: r.motivo, operacao: meta?.operacao ?? null,
    }
  })
}

/** Documento já tem operação por-documento no V2? (discrimina V2 × fallback legado.) */
export async function temOperacaoV2(documentoId: number): Promise<boolean> {
  const n = await prisma.phaseWorkflowStepInstance.count({ where: { documentoId } })
  return n > 0
}

/**
 * Progresso/conclusão da operação de UM documento pela fonte V2. Reusa o mesmo
 * núcleo do completion-engine (resolveStepCompletionState + evaluateWorkflowProgress);
 * o peso vem do catálogo de fases (fonte única). Retorna null se não há operação V2
 * para o documento (o chamador cai no fallback legado durante a compatibilidade).
 */
export async function progressoOperacaoV2(documentoId: number): Promise<AggregateResult | null> {
  const passos = await passosOperacaoV2(documentoId)
  if (passos.length === 0) return null
  const now = new Date()
  const faseCode = phaseKeyToFaseCode(passos[0].faseMacroKey)
  const catalogo = faseCode ? getStepsForFase(faseCode) : []
  const pesoDe = (k: string) => catalogo.find((c) => c.stepKey === k)?.weight ?? 1

  const inputs = await Promise.all(
    passos.map(async (p) => {
      // Estado gravado como concluído/dispensado conta como 100% (respeita o banco).
      if (p.status === "CONCLUIDO" || p.status === "DISPENSADO") {
        return {
          weight: pesoDe(p.stepKey),
          result: {
            completed: true, progress: 100, reason: "Passo concluído.",
            policy: "MANUAL_CONFIRMATION" as const, blockers: [], evidence: [], evaluatedAt: now,
          },
        }
      }
      const r = await resolveStepCompletionState(p.stepKey, documentoId, politicaPadraoParaStep(p.stepKey))
      return { weight: pesoDe(p.stepKey), result: r.result }
    }),
  )
  return evaluateWorkflowProgress(inputs, now)
}

/**
 * ESCRITA de compatibilidade: espelha no passo V2 por-documento a mudança de
 * status feita no passo legado (dual-write até o cutover). Best-effort — retorna
 * false se não houver passo V2 correspondente (documento ainda não migrado).
 * Resolve alias legado→publicado pela fonte única do catálogo. Não toca o legado.
 */
export async function sincronizarStatusPassoV2(
  documentoId: number,
  legacyStepKey: string,
  legacyStatus: string | null | undefined,
): Promise<boolean> {
  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: { documentoId, status: { notIn: INATIVOS } },
    select: { id: true, stepKey: true, faseMacroKey: true },
  })
  const alvo = passos.find(
    (p) => p.stepKey === legacyStepKey || resolveStepKeyCompat(p.faseMacroKey, legacyStepKey) === p.stepKey,
  )
  if (!alvo) return false
  const novo = mapLegacyStepStatus(legacyStatus)
  await prisma.phaseWorkflowStepInstance.update({
    where: { id: alvo.id },
    data: {
      status: novo,
      ...(novo === "CONCLUIDO" ? { completedAt: new Date() } : {}),
      ...(novo === "EM_ANDAMENTO" ? { startedAt: new Date() } : {}),
    },
  })
  return true
}
