// src/lib/motor/resolve-historical-phase-projection.ts
//
// PROJEÇÃO HISTÓRICA de uma fase — LEITURA PURA de dados MATERIALIZADOS.
//
// Contrato (guardrails inegociáveis do plano "Acesso permanente às fases materializadas"):
//   • Nunca cria instâncias, nunca materializa workflow, nunca executa automações,
//     nunca dispara eventos, nunca escreve nada.
//   • Nunca recalcula progresso/bloqueios/próxima ação a partir do estado ATUAL.
//   • Toda informação vem da PhaseWorkflowInstance do ciclo selecionado (+ seus passos,
//     eventos, logs e auditoria daquele ciclo). Reflete o momento da conclusão.
//   • Chaveada por workflowInstanceId (contrato multi-ciclo) — NUNCA só por phaseKey.
//   • Sem snapshot suficiente → devolve o disponível, marcando indisponível; jamais
//     reconstrói do estado vivo.
//
// Reaproveita o mapeamento de passos de operational-workflow.ts (mesma forma de saída),
// mas SEM o filtro de status ATIVO/BLOQUEADO/AGUARDANDO (que nunca traria um CONCLUIDO).

import { prisma } from "@/lib/prisma"
import { iso, type OperationalPasso } from "@/src/services/operational-workflow-helpers"
import { phaseKeyToFaseCode, FASES } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"

export type HistoricalPhaseState = "COMPLETED" | "SUPERSEDED" | "ACTIVE" | "OTHER"

export interface HistoricalWorkflowStep extends OperationalPasso {
  motivo: string | null
  blockedAt: string | null
  completedAt: string | null
  statusAnteriorBloqueio: string | null
}

export interface HistoricalDocumentView {
  stepInstanceId: number
  stepKey: string
  documentoId: number
  tipo: string | null // identidade do documento (não é estado operacional recalculado)
  stepStatus: string // estado do passo que operou o documento nesta fase (materializado)
}

export interface HistoricalNeedView {
  stepInstanceId: number
  stepKey: string
  necessidadeId: number
  itemCatalogoId: number | null
  stepStatus: string
}

export interface HistoricalEventView {
  id: number
  tipo: string
  entityType: string
  entityId: number | null
  stepInstanceId: number | null
  dados: unknown
  criadoEm: string
}

export interface HistoricalDecisionView {
  id: number
  resultado: string
  faseAtual: string
  fasePretendida: string | null
  justificativa: string | null
  motivoCodigo: string | null
  forcado: boolean
  solicitadoPorId: number | null
  criadoEm: string
}

export interface HistoricalBlockView {
  stepInstanceId: number
  stepKey: string
  status: string
  bloqueadoManual: boolean
  motivo: string | null
  blockedAt: string | null
  statusAnteriorBloqueio: string | null
}

export interface HistoricalAuditView {
  id: number
  acao: string
  entidade: string
  entidadeId: number | null
  descricao: string
  usuario: { id: number; nome: string } | null
  criadoEm: string
}

export interface HistoricalPhaseProjection {
  processoId: number
  phase: {
    workflowInstanceId: number
    phaseKey: string
    faseCode: FaseCode | null
    label: string
    state: HistoricalPhaseState
    cycle: number
    startedAt: string | null
    completedAt: string | null
    supersededAt: string | null
  }
  progress: {
    percentage: number
    completedWeight: number // nº de passos concluídos (contagem materializada)
    totalWeight: number // nº total de passos
  }
  workflow: { steps: HistoricalWorkflowStep[] }
  documents: HistoricalDocumentView[]
  needs: HistoricalNeedView[]
  events: HistoricalEventView[]
  decisions: HistoricalDecisionView[]
  blocks: HistoricalBlockView[]
  audit: HistoricalAuditView[]
  /** Campos/seções cujo snapshot histórico não está disponível (compat. retroativa). */
  unavailable: string[]
}

// Estados terminais "feitos" de um passo (contagem de progresso a partir do materializado).
const STEP_DONE = new Set(["CONCLUIDO", "EXECUTADO", "DISPENSADO"])

export interface ResolveHistoricalInput {
  processoId: number
  workflowInstanceId: number
}

export type ResolveHistoricalResult =
  | { ok: true; projection: HistoricalPhaseProjection }
  | { ok: false; code: "NAO_ENCONTRADO" | "NAO_PERTENCE"; message: string }

/**
 * Resolve a projeção histórica de UMA instância de fase (por id), somente leitura.
 * Valida que a instância pertence ao processo informado.
 */
export async function resolveHistoricalPhaseProjection(
  input: ResolveHistoricalInput,
): Promise<ResolveHistoricalResult> {
  const { processoId, workflowInstanceId } = input

  const instancia = await prisma.phaseWorkflowInstance.findUnique({
    where: { id: workflowInstanceId },
    include: { steps: { orderBy: { ordem: "asc" } } },
  })

  if (!instancia) {
    return { ok: false, code: "NAO_ENCONTRADO", message: "Instância de fase não encontrada" }
  }
  if (instancia.processoId !== processoId) {
    return { ok: false, code: "NAO_PERTENCE", message: "Instância não pertence ao processo" }
  }

  const unavailable: string[] = []
  if (instancia.snapshot == null) unavailable.push("instance.snapshot")

  const faseCode = phaseKeyToFaseCode(instancia.faseMacroKey)
  const label = faseCode ? FASES[faseCode].label : instancia.faseMacroKey

  const state: HistoricalPhaseState =
    instancia.status === "CONCLUIDO" ? "COMPLETED"
    : instancia.status === "SUPERSEDIDO" ? "SUPERSEDED"
    : instancia.status === "ATIVO" || instancia.status === "BLOQUEADO" || instancia.status === "AGUARDANDO" ? "ACTIVE"
    : "OTHER"

  // ── Passos materializados (sem recalcular ao vivo) ──────────────────────────
  const steps: HistoricalWorkflowStep[] = instancia.steps.map((s) => ({
    id: s.id,
    stepKey: s.stepKey,
    ordem: s.ordem,
    tipo: String(s.tipo),
    status: String(s.status),
    obrigatorio: s.obrigatorio,
    responsavelId: s.responsavelId,
    prioridade: s.prioridade,
    prazo: iso(s.prazo),
    bloqueadoManual: s.bloqueadoManual,
    necessidadeId: s.necessidadeId,
    documentoId: s.documentoId,
    motivo: s.motivo,
    blockedAt: iso(s.blockedAt),
    completedAt: iso(s.completedAt),
    statusAnteriorBloqueio: s.statusAnteriorBloqueio,
  }))

  const totalWeight = steps.length
  const completedWeight = steps.filter((s) => STEP_DONE.has(s.status)).length
  const percentage = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0

  // ── Bloqueios registrados (dos próprios passos materializados) ──────────────
  const blocks: HistoricalBlockView[] = instancia.steps
    .filter((s) => s.bloqueadoManual || String(s.status) === "BLOQUEADO")
    .map((s) => ({
      stepInstanceId: s.id,
      stepKey: s.stepKey,
      status: String(s.status),
      bloqueadoManual: s.bloqueadoManual,
      motivo: s.motivo,
      blockedAt: iso(s.blockedAt),
      statusAnteriorBloqueio: s.statusAnteriorBloqueio,
    }))

  // ── Identidade de documentos/necessidades referenciados pelos passos ────────
  // (identidade, NÃO estado operacional recalculado — o estado exibido é o do passo).
  const docIds = Array.from(new Set(instancia.steps.map((s) => s.documentoId).filter((x): x is number => x != null)))
  const needIds = Array.from(new Set(instancia.steps.map((s) => s.necessidadeId).filter((x): x is number => x != null)))

  const [docsIdent, needsIdent] = await Promise.all([
    docIds.length
      ? prisma.documento.findMany({ where: { id: { in: docIds } }, select: { id: true, tipo: true } })
      : Promise.resolve([] as Array<{ id: number; tipo: string | null }>),
    needIds.length
      ? prisma.necessidadeDocumental.findMany({ where: { id: { in: needIds } }, select: { id: true, itemCatalogoId: true } })
      : Promise.resolve([] as Array<{ id: number; itemCatalogoId: number | null }>),
  ])
  const docTipoById = new Map(docsIdent.map((d) => [d.id, d.tipo ? String(d.tipo) : null]))
  const needItemById = new Map(needsIdent.map((n) => [n.id, n.itemCatalogoId]))

  const documents: HistoricalDocumentView[] = instancia.steps
    .filter((s) => s.documentoId != null)
    .map((s) => ({
      stepInstanceId: s.id,
      stepKey: s.stepKey,
      documentoId: s.documentoId as number,
      tipo: docTipoById.get(s.documentoId as number) ?? null,
      stepStatus: String(s.status),
    }))

  const needs: HistoricalNeedView[] = instancia.steps
    .filter((s) => s.necessidadeId != null)
    .map((s) => ({
      stepInstanceId: s.id,
      stepKey: s.stepKey,
      necessidadeId: s.necessidadeId as number,
      itemCatalogoId: needItemById.get(s.necessidadeId as number) ?? null,
      stepStatus: String(s.status),
    }))

  // ── Eventos, decisões e auditoria do CICLO (janela desta instância) ─────────
  const stepIds = instancia.steps.map((s) => s.id)
  const janelaFim = instancia.completedAt ?? instancia.supersededAt ?? instancia.cancelledAt ?? new Date()

  const [eventos, decisoes, auditoria] = await Promise.all([
    prisma.workflowEvento.findMany({
      where: {
        processoId,
        OR: [
          { workflowInstanceId },
          stepIds.length ? { stepInstanceId: { in: stepIds } } : { stepInstanceId: -1 },
        ],
      },
      orderBy: { criadoEm: "asc" },
      select: { id: true, tipo: true, entityType: true, entityId: true, stepInstanceId: true, dados: true, criadoEm: true },
    }),
    prisma.phaseAdvanceLog.findMany({
      where: {
        processoId,
        OR: [{ fasePretendidaId: workflowInstanceId }, { faseAnteriorId: workflowInstanceId }],
      },
      orderBy: { criadoEm: "asc" },
      select: {
        id: true, resultado: true, faseAtual: true, fasePretendida: true,
        justificativa: true, motivoCodigo: true, forcado: true, solicitadoPorId: true, criadoEm: true,
      },
    }),
    prisma.logAuditoria.findMany({
      where: {
        entidade: "PROCESSO",
        entidadeId: processoId,
        criadoEm: { gte: instancia.createdAt, lte: janelaFim },
      },
      orderBy: { criadoEm: "desc" },
      take: 100,
      include: { usuario: { select: { id: true, nome: true } } },
    }),
  ])

  const events: HistoricalEventView[] = eventos.map((e) => ({
    id: e.id, tipo: String(e.tipo), entityType: e.entityType, entityId: e.entityId,
    stepInstanceId: e.stepInstanceId, dados: e.dados, criadoEm: e.criadoEm.toISOString(),
  }))

  const decisions: HistoricalDecisionView[] = decisoes.map((d) => ({
    id: d.id, resultado: String(d.resultado), faseAtual: d.faseAtual, fasePretendida: d.fasePretendida,
    justificativa: d.justificativa, motivoCodigo: d.motivoCodigo, forcado: d.forcado,
    solicitadoPorId: d.solicitadoPorId, criadoEm: d.criadoEm.toISOString(),
  }))

  const audit: HistoricalAuditView[] = auditoria.map((a) => ({
    id: a.id,
    acao: a.acao,
    entidade: a.entidade,
    entidadeId: a.entidadeId,
    descricao: a.descricao,
    usuario: a.usuario ? { id: a.usuario.id, nome: a.usuario.nome } : null,
    criadoEm: a.criadoEm.toISOString(),
  }))

  return {
    ok: true,
    projection: {
      processoId,
      phase: {
        workflowInstanceId: instancia.id,
        phaseKey: instancia.faseMacroKey,
        faseCode,
        label,
        state,
        cycle: instancia.ciclo,
        startedAt: iso(instancia.startedAt),
        completedAt: iso(instancia.completedAt),
        supersededAt: iso(instancia.supersededAt),
      },
      progress: { percentage, completedWeight, totalWeight },
      workflow: { steps },
      documents,
      needs,
      events,
      decisions,
      blocks,
      audit,
      unavailable,
    },
  }
}
