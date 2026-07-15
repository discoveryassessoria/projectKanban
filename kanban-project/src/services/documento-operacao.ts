// src/services/documento-operacao.ts
// FASE 3 (CP-5) — OPERAÇÃO POR-DOCUMENTO no runtime V2 ÚNICO.
// Fonte canônica: PhaseWorkflowStepInstance com documentoId setado (discriminador
// já existente). Sem model/coluna nova. Este é o ponto central: os consumidores
// (Central Operacional, completion-engine, rotas de operação, avanço de fase)
// leem/escrevem AQUI — não falam com o legado direto. Reusa o completion-engine
// (não recalcula regra — regras 9/10).

import { prisma } from "@/lib/prisma"
import type { StepInstanceStatus, FaseCode, Prisma } from "@prisma/client"
import {
  resolveStepCompletionState,
  politicaPadraoParaStep,
} from "@/src/services/processEngine/stepCompletionResolver"
import { evaluateWorkflowProgress, type AggregateResult } from "@/src/services/completion-engine/policies"
import {
  getStepsForFase, getFase, isFaseReady, phaseKeyToFaseCode, faseCodeToPhaseKey, resolveStepKeyCompat,
} from "@/src/lib/process-stage/fases-catalog"
import { mapLegacyStepStatus, stepInstanceStatusToLegacy } from "@/src/lib/process-stage/legacy-status-map"
import { montarChavePasso } from "@/src/services/phase-workflow-helpers"

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

// ── ADAPTADOR V2 → shape legado (preserva o contrato do frontend, fonte é V2) ──
export interface WorkflowV2Shape {
  id: string
  documentoId: number
  faseCode: string | null
  status: string
  progress: number
  steps: Array<Record<string, unknown>>
}

/** Monta o objeto "workflow" no formato antigo esperado pela UI, a partir do V2. */
export async function montarWorkflowV2(documentoId: number): Promise<WorkflowV2Shape | null> {
  const passos = await passosOperacaoV2(documentoId)
  if (passos.length === 0) return null
  const faseMacroKey = passos[0].faseMacroKey
  const faseCode = phaseKeyToFaseCode(faseMacroKey)
  const catalogo = faseCode ? getFase(faseCode as FaseCode).steps : []
  const catOf = (k: string) => catalogo.find((c) => c.stepKey === k)
  const ids = [...new Set(passos.map((p) => p.responsavelId).filter((x): x is number => x != null))]
  const usuarios = ids.length
    ? await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, email: true } })
    : []
  const uMap = new Map(usuarios.map((u) => [u.id, u]))

  let totalW = 0, doneW = 0
  const steps = passos.map((p) => {
    const c = catOf(p.stepKey)
    const w = c?.weight ?? 1
    totalW += w
    if (p.status === "CONCLUIDO" || p.status === "DISPENSADO") doneW += w
    const op = (p.operacao ?? {}) as Record<string, unknown>
    return {
      ...op,
      id: p.id, ordem: p.ordem, stepKey: p.stepKey,
      title: c?.title ?? p.stepKey, description: c?.description ?? null,
      status: stepInstanceStatusToLegacy(p.status), weight: w, ownerKey: c?.ownerKey ?? null,
      assigneeId: p.responsavelId, assignee: p.responsavelId ? uMap.get(p.responsavelId) ?? null : null,
      startedAt: p.startedAt, dueAt: p.prazo, completedAt: p.completedAt,
      notes: (op.notes as string) ?? null, motivoBloqueio: p.motivo,
    } as Record<string, unknown>
  })
  const progress = totalW > 0 ? Math.round((doneW / totalW) * 100) : 0
  const concluido = passos.every((p) => ["CONCLUIDO", "DISPENSADO"].includes(p.status))
  return { id: `v2-${documentoId}-${faseMacroKey}`, documentoId, faseCode, status: concluido ? "concluido" : "em_andamento", progress, steps }
}

type IniciarOpts = { responsavelId?: number | null; dataPrazoInicial?: Date | null; observacaoInicial?: string | null }
type OpResult = { ok: true; workflow: WorkflowV2Shape | null } | { ok: false; error: string; status: number }

/** "Iniciar operação" no V2: cria os passos por-documento sob a instância da fase. */
export async function iniciarOperacaoDocumentoV2(documentoId: number, opts: IniciarOpts = {}): Promise<OpResult> {
  if (await temOperacaoV2(documentoId)) return { ok: false, error: "Operação já existe para este documento", status: 409 }
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: { pessoa: { select: { arvore: { select: { processos: { select: { id: true, faseAtualKey: true, status: { select: { faseCode: true } } } } } } } } },
  })
  const processos = doc?.pessoa?.arvore?.processos ?? []
  if (processos.length === 0) return { ok: false, error: "Documento não está ligado a nenhum processo", status: 422 }
  const processo = processos[0]
  const faseCode = (phaseKeyToFaseCode(processo.faseAtualKey) ?? processo.status?.faseCode ?? null) as FaseCode | null
  if (!faseCode) return { ok: false, error: "Processo sem fase definida", status: 422 }
  if (!isFaseReady(faseCode)) return { ok: false, error: `A fase "${faseCode}" não tem etapas no catálogo`, status: 422 }
  const faseMacroKey = faseCodeToPhaseKey(faseCode) as string
  const inst = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId: processo.id, faseMacroKey, status: { notIn: ["CANCELADO", "SUPERSEDIDO"] } },
    orderBy: { ciclo: "desc" },
    select: { id: true, ciclo: true, workflowDefinitionId: true },
  })
  if (!inst) return { ok: false, error: "Instância V2 da fase não encontrada (processo não migrado)", status: 422 }
  const catSteps = getFase(faseCode).steps
  const now = new Date()
  const firstDue = opts.dataPrazoInicial ?? new Date(now.getTime() + catSteps[0].slaDays * 86400000)
  const defId = inst.workflowDefinitionId ?? 0
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < catSteps.length; i++) {
      const s = catSteps[i]
      const isActive = i === 0
      const chave = montarChavePasso({ workflowInstanceId: inst.id, stepDefinitionId: defId, stepKey: s.stepKey, stepDefinitionVersion: 1, ciclo: inst.ciclo, documentoId })
      const meta = isActive && opts.observacaoInicial ? ({ operacao: { notes: opts.observacaoInicial } } as Prisma.InputJsonValue) : undefined
      await tx.phaseWorkflowStepInstance.upsert({
        where: { chaveIdempotencia: chave },
        create: {
          workflowInstanceId: inst.id, stepDefinitionId: defId, stepDefinitionVersion: 1, stepKey: s.stepKey,
          snapshot: { origem: "INICIAR_OPERACAO" } as Prisma.InputJsonValue, snapshotSchemaVersion: 1,
          processoId: processo.id, faseMacroKey, ordem: s.ordem, status: isActive ? "EM_ANDAMENTO" : "BLOQUEADO",
          ciclo: inst.ciclo, chaveIdempotencia: chave, documentoId,
          responsavelId: isActive ? opts.responsavelId ?? null : null, prazo: isActive ? firstDue : null,
          startedAt: isActive ? now : null, ...(meta ? { metadata: meta } : {}),
        },
        update: {},
      })
    }
    await tx.documento.update({
      where: { id: documentoId },
      data: {
        status: faseCode === "GENEALOGIA" ? "EM_BUSCA" : "SOLICITAR", dataInicioOperacao: now, ultimaMovimentacao: now,
        responsavelId: opts.responsavelId ?? undefined, dataPrazoOperacao: firstDue, motivoBloqueio: null,
      },
    })
  })
  return { ok: true, workflow: await montarWorkflowV2(documentoId) }
}

// Campos de DOMÍNIO aceitos no PATCH do passo (vão para metadata.operacao).
const CAMPOS_OPERACAO = [
  "trackingCode", "externalProtocol", "requestChannel", "reviewResult", "validationResult",
  "externalEntityName", "costPaid", "paymentMethod", "documentMedium", "physicalLocation",
  "reviewChecklist", "stepObservation", "legalOpinion", "notes", "completedById",
] as const

/** PATCH de um passo no V2 (status/responsável/campos de domínio) + lock-step entre irmãos. */
export async function atualizarPassoV2(
  documentoId: number,
  stepInstanceId: number,
  patch: Record<string, unknown>,
): Promise<OpResult> {
  const p = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId },
    select: { id: true, documentoId: true, processoId: true, faseMacroKey: true, ordem: true, status: true, ciclo: true, metadata: true, stepKey: true },
  })
  if (!p || p.documentoId !== documentoId) return { ok: false, error: "Passo não encontrado", status: 404 }
  const now = new Date()
  const catStep = (() => {
    const fc = phaseKeyToFaseCode(p.faseMacroKey)
    return fc ? getFase(fc as FaseCode).steps.find((c) => c.stepKey === p.stepKey) : undefined
  })()
  const slaDays = catStep?.slaDays ?? 1

  const novo: StepInstanceStatus = typeof patch.status === "string" ? mapLegacyStepStatus(patch.status) : p.status
  const eraConcluida = p.status === "CONCLUIDO"
  const liberarProximo = novo === "CONCLUIDO" && !eraConcluida
  const vaiReabrir = eraConcluida && novo !== "CONCLUIDO"

  // metadata.operacao: preserva o existente e sobrepõe os campos de domínio do patch
  const metaExist = ((p.metadata ?? {}) as { operacao?: Record<string, unknown> }).operacao ?? {}
  const opPatch: Record<string, unknown> = { ...metaExist }
  for (const k of CAMPOS_OPERACAO) if (patch[k] !== undefined) opPatch[k] = patch[k]

  const data: Prisma.PhaseWorkflowStepInstanceUpdateInput = {
    status: novo,
    metadata: { operacao: opPatch } as Prisma.InputJsonValue,
    ...(patch.assigneeId !== undefined ? { responsavelId: (patch.assigneeId as number | null) } : {}),
    ...(patch.dueAt !== undefined ? { prazo: patch.dueAt ? new Date(patch.dueAt as string) : null } : {}),
    ...(patch.motivoBloqueio !== undefined ? { motivo: patch.motivoBloqueio as string | null } : {}),
    ...(novo === "EM_ANDAMENTO" ? { startedAt: now } : {}),
    ...(liberarProximo ? { completedAt: now } : {}),
    ...(vaiReabrir ? { completedAt: null } : {}),
  }
  await prisma.phaseWorkflowStepInstance.update({ where: { id: p.id }, data })

  const LOCK = "Aguardando outros documentos do processo"
  if (liberarProximo) {
    const proximo = await prisma.phaseWorkflowStepInstance.findFirst({
      where: { documentoId, faseMacroKey: p.faseMacroKey, ordem: { gt: p.ordem }, status: { in: ["BLOQUEADO", "PENDENTE"] } },
      orderBy: { ordem: "asc" },
      select: { id: true, ordem: true },
    })
    if (proximo) {
      // irmãos: outros docs do mesmo processo com passo V2 na mesma ordem
      const irmaos = await prisma.phaseWorkflowStepInstance.findMany({
        where: { processoId: p.processoId, faseMacroKey: p.faseMacroKey, ordem: p.ordem, documentoId: { not: documentoId, notIn: [] }, status: { notIn: INATIVOS } },
        select: { documentoId: true, status: true },
      })
      const todosConcluiram = irmaos.every((s) => s.status === "CONCLUIDO" || s.status === "DISPENSADO")
      if (todosConcluiram) {
        const due = new Date(now.getTime() + slaDays * 86400000)
        await prisma.phaseWorkflowStepInstance.update({ where: { id: proximo.id }, data: { status: "EM_ANDAMENTO", startedAt: now, prazo: due } })
        await prisma.phaseWorkflowStepInstance.updateMany({
          where: { processoId: p.processoId, faseMacroKey: p.faseMacroKey, ordem: proximo.ordem, documentoId: { in: irmaos.map((s) => s.documentoId!).filter(Boolean) }, status: { in: ["BLOQUEADO", "PENDENTE"] } },
          data: { status: "EM_ANDAMENTO", startedAt: now, prazo: due },
        })
      } else {
        await prisma.phaseWorkflowStepInstance.update({ where: { id: proximo.id }, data: { status: "BLOQUEADO", motivo: `${LOCK} concluírem a etapa ${p.ordem}` } })
      }
    }
  }
  if (vaiReabrir) {
    await prisma.phaseWorkflowStepInstance.updateMany({
      where: { documentoId, faseMacroKey: p.faseMacroKey, ordem: { gt: p.ordem }, status: { in: ["EM_ANDAMENTO", "AGUARDANDO"] } },
      data: { status: "BLOQUEADO", startedAt: null, prazo: null, motivo: null },
    })
  }
  await prisma.documento.update({ where: { id: documentoId }, data: { ultimaMovimentacao: now } })
  return { ok: true, workflow: await montarWorkflowV2(documentoId) }
}

/** Controles da operação (pausar/retomar/cancelar/invalidar) no V2 + status do documento. */
export async function controlarOperacaoV2(documentoId: number, action: string, observacao?: string): Promise<OpResult> {
  const passos = await passosOperacaoV2(documentoId)
  if (passos.length === 0) return { ok: false, error: "Operação não encontrada", status: 404 }
  const now = new Date()
  const obs = (observacao ?? "").trim()
  if (action === "cancelar" || action === "invalidar") {
    await prisma.phaseWorkflowStepInstance.updateMany({
      where: { documentoId, status: { notIn: ["CONCLUIDO", "SUPERSEDIDO", "CANCELADO"] } },
      data: { status: "CANCELADO", cancelledAt: now },
    })
    await prisma.documento.update({
      where: { id: documentoId },
      data: action === "invalidar"
        ? { status: "INVALIDO", ultimaMovimentacao: now, motivoBloqueio: obs ? `Documento invalidado: ${obs}` : "Documento invalidado" }
        : { status: "PENDENTE", ultimaMovimentacao: now, dataInicioOperacao: null, dataPrazoOperacao: null, motivoBloqueio: obs ? `Operação cancelada: ${obs}` : "Operação cancelada" },
    })
  } else if (action === "pausar") {
    await prisma.phaseWorkflowStepInstance.updateMany({ where: { documentoId, status: "EM_ANDAMENTO" }, data: { status: "BLOQUEADO", motivo: obs ? `Operação pausada: ${obs}` : "Operação pausada" } })
    await prisma.documento.update({ where: { id: documentoId }, data: { ultimaMovimentacao: now, motivoBloqueio: obs ? `Operação pausada: ${obs}` : "Operação pausada" } })
  } else if (action === "retomar") {
    const primeiro = passos.find((s) => s.status === "BLOQUEADO")
    if (primeiro) await prisma.phaseWorkflowStepInstance.update({ where: { id: primeiro.id }, data: { status: "EM_ANDAMENTO", motivo: null } })
    await prisma.documento.update({ where: { id: documentoId }, data: { ultimaMovimentacao: now, motivoBloqueio: null } })
  } else {
    return { ok: false, error: "action inválido", status: 400 }
  }
  return { ok: true, workflow: await montarWorkflowV2(documentoId) }
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
