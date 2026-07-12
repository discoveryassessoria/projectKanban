// src/services/task-step-sync.ts
// CP-4D — TaskStepSyncService: sincronização canônica Tarefa ↔ Passo, SEM LOOP.
//
// Prevenção de loop: funções internas SEPARADAS (aplicarTarefa/aplicarPasso) que
// NÃO se re-chamam; CAS por (status + lockVersion); no-op quando já no alvo;
// chaves idempotentes; eventos @unique; tudo em uma transação. Origem só audita.
// Só atua sob runtime v2 (kill switch + Processo.workflowRuntime="v2"). Nunca
// avança fase, nunca gera financeiro, nunca escreve no Workflow/WorkflowStep legado.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { Prisma, type Tarefa, type PhaseWorkflowStepInstance, type WorkflowEventoTipo } from "@prisma/client"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import * as H from "@/src/services/task-step-sync-helpers"

const TAREFA_CONCLUIDA_STATUS = "CONCLUIDO_RECEBIDO"

export interface SyncContexto {
  origem: H.Origem
  usuarioId?: number
  correlationId?: string
  causationId?: string
  motivoCodigo?: string
  justificativa?: string
  politica?: H.PoliticaCancelamento
  aprovadorId?: number
}

export type SyncResultado =
  | {
      success: true
      changed: boolean
      tarefa?: Tarefa | null
      stepInstance?: PhaseWorkflowStepInstance | null
      estadoAnterior: { tarefa?: string; passo?: string }
      estadoAtual: { tarefa?: string; passo?: string }
      eventos: string[]
      warnings: H.SyncIssue[]
      correlationId: string
    }
  | { success: false; code: H.FailureCodeD; errors: H.SyncIssue[]; correlationId: string }

type TX = Prisma.TransactionClient
interface ApplyOpts {
  correlationId: string
  causationId: string
  ciclo: number
  processoId: number
  workflowInstanceId?: number | null
  extra?: Record<string, unknown>
  dados?: Prisma.InputJsonValue
}

// ---------------- APLICADOR: PASSO (CAS) ----------------
async function aplicarPasso(tx: TX, stepId: number, alvo: string, tipoEvento: WorkflowEventoTipo, o: ApplyOpts) {
  const step = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: stepId } })
  if (!step) return { changed: false, anterior: "", atual: "", code: "STEP_NAO_ENCONTRADO" as H.FailureCodeD }
  if (step.status === alvo) return { changed: false, anterior: step.status, atual: step.status }
  if (!H.podeAplicarPasso(step.status, alvo)) return { changed: false, anterior: step.status, atual: step.status, code: "TRANSICAO_INVALIDA" as H.FailureCodeD }

  const now = new Date()
  const data: Prisma.PhaseWorkflowStepInstanceUpdateManyMutationInput = {
    status: alvo as Prisma.PhaseWorkflowStepInstanceUpdateManyMutationInput["status"],
    lockVersion: { increment: 1 },
    ...(o.extra as object),
  }
  if (alvo === "EM_ANDAMENTO") data.startedAt = step.startedAt ?? now
  if (alvo === "EXECUTADO" || alvo === "CONCLUIDO") data.completedAt = now
  if (alvo === "BLOQUEADO") data.blockedAt = now
  if (alvo === "DISPENSADO") data.dispensedAt = now
  if (alvo === "CANCELADO") data.cancelledAt = now
  if (alvo === "SUPERSEDIDO") data.supersededAt = now

  const res = await tx.phaseWorkflowStepInstance.updateMany({
    where: { id: stepId, status: step.status as Prisma.PhaseWorkflowStepInstanceWhereInput["status"], lockVersion: step.lockVersion },
    data,
  })
  if (res.count === 0) return { changed: false, anterior: step.status, atual: step.status, code: "CONFLITO" as H.FailureCodeD }

  const chaveEvt = H.chaveEvento(tipoEvento, "step_instance", stepId, alvo, o.ciclo)
  await tx.workflowEvento.create({
    data: {
      tipo: tipoEvento, entityType: "step_instance", entityId: stepId,
      processoId: o.processoId, workflowInstanceId: o.workflowInstanceId ?? undefined, stepInstanceId: stepId,
      correlationId: o.correlationId, causationId: o.causationId, chaveIdempotencia: chaveEvt, dados: o.dados,
    },
  })
  await tx.domainOutbox.create({
    data: {
      tipo: `step.${alvo.toLowerCase()}`, aggregateType: "PhaseWorkflowStepInstance", aggregateId: stepId,
      correlationId: o.correlationId, causationId: o.causationId, chaveIdempotencia: `outbox|${chaveEvt}`,
      payload: { stepId, alvo, ciclo: o.ciclo },
    },
  })
  return { changed: true, anterior: step.status, atual: alvo }
}

// ---------------- APLICADOR: TAREFA (CAS) ----------------
async function aplicarTarefa(tx: TX, tarefaId: number, alvo: string, tipoEvento: WorkflowEventoTipo, o: ApplyOpts) {
  const t = await tx.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return { changed: false, anterior: "", atual: "", code: "TAREFA_NAO_ENCONTRADA" as H.FailureCodeD }
  if (t.statusTarefa === alvo) return { changed: false, anterior: t.statusTarefa, atual: t.statusTarefa }
  if (!H.podeAplicarTarefa(t.statusTarefa, alvo)) return { changed: false, anterior: t.statusTarefa, atual: t.statusTarefa, code: "TRANSICAO_INVALIDA" as H.FailureCodeD }

  const now = new Date()
  const data: Prisma.TarefaUpdateManyMutationInput = {
    statusTarefa: alvo as Prisma.TarefaUpdateManyMutationInput["statusTarefa"],
    lockVersion: { increment: 1 },
    ...(o.extra as object),
  }
  if (alvo === "EM_ANDAMENTO") data.dataInicio = t.dataInicio ?? now
  if (alvo === TAREFA_CONCLUIDA_STATUS) { data.concluida = true; data.dataConclusao = now }

  const res = await tx.tarefa.updateMany({
    where: { id: tarefaId, statusTarefa: t.statusTarefa as Prisma.TarefaWhereInput["statusTarefa"], lockVersion: t.lockVersion },
    data,
  })
  if (res.count === 0) return { changed: false, anterior: t.statusTarefa, atual: t.statusTarefa, code: "CONFLITO" as H.FailureCodeD }

  const chaveEvt = H.chaveEvento(tipoEvento, "tarefa", tarefaId, alvo, o.ciclo)
  await tx.workflowEvento.create({
    data: {
      tipo: tipoEvento, entityType: "tarefa", entityId: tarefaId,
      processoId: o.processoId, workflowInstanceId: o.workflowInstanceId ?? undefined, tarefaId,
      correlationId: o.correlationId, causationId: o.causationId, chaveIdempotencia: chaveEvt, dados: o.dados,
    },
  })
  await tx.domainOutbox.create({
    data: {
      tipo: `tarefa.${alvo.toLowerCase()}`, aggregateType: "Tarefa", aggregateId: tarefaId,
      correlationId: o.correlationId, causationId: o.causationId, chaveIdempotencia: `outbox|${chaveEvt}`,
      payload: { tarefaId, alvo, ciclo: o.ciclo },
    },
  })
  return { changed: true, anterior: t.statusTarefa, atual: alvo }
}

// ---------------- gate de runtime v2 ----------------
async function gateV2(processoId: number): Promise<{ ok: true } | { ok: false; code: H.FailureCodeD }> {
  const proc = await prisma.processo.findUnique({ where: { id: processoId }, select: { workflowRuntime: true } })
  const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  const v2Global = cfg?.runtimeV2Habilitado ?? false
  if (!v2Global) return { ok: false, code: "RUNTIME_V2_DESABILITADO" }
  if (resolveWorkflowRuntime(proc?.workflowRuntime, v2Global) !== "v2") return { ok: false, code: "PROCESSO_LEGACY" }
  return { ok: true }
}

// helpers de contexto
function corr(ctx: SyncContexto): string { return ctx.correlationId ?? randomUUID() }
function ok(changed: boolean, correlationId: string, ea: { tarefa?: string; passo?: string }, ec: { tarefa?: string; passo?: string }, eventos: string[], warnings: H.SyncIssue[] = []): SyncResultado {
  return { success: true, changed, estadoAnterior: ea, estadoAtual: ec, eventos, warnings, correlationId }
}
function ko(code: H.FailureCodeD, correlationId: string, msg: string = code): SyncResultado {
  return { success: false, code, errors: [{ code, message: msg }], correlationId }
}

// carrega step + processo/workflow para as ops de Passo
async function carregarStep(stepId: number) {
  return prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepId },
    include: { tarefas: { where: { chaveIdempotencia: { not: null } }, take: 1 }, workflowInstance: { select: { status: true } } },
  })
}

// ============================================================
// TAREFA → PASSO
// ============================================================
export async function iniciarTarefa(tarefaId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return ko("TAREFA_NAO_ENCONTRADA", correlationId)
  const gate = await gateV2(t.processoId!)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = t.ciclo ?? 1
  const causationId = ctx.causationId ?? H.chaveComando("task-start", "tarefa", tarefaId, "EM_ANDAMENTO", ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: t.processoId!, workflowInstanceId: t.workflowInstanceId }
  try {
    return await prisma.$transaction(async (tx) => {
      const rt = await aplicarTarefa(tx, tarefaId, "EM_ANDAMENTO", "TAREFA_INICIADA", base)
      if (rt.code) return ko(rt.code, correlationId)
      let rp: { changed: boolean; anterior?: string; atual?: string } = { changed: false }
      if (t.workflowStepInstanceId) rp = await aplicarPasso(tx, t.workflowStepInstanceId, "EM_ANDAMENTO", "PASSO_INICIADO", base)
      return ok(rt.changed || rp.changed, correlationId, { tarefa: rt.anterior, passo: rp.anterior }, { tarefa: rt.atual, passo: rp.atual }, ["TAREFA_INICIADA", ...(rp.changed ? ["PASSO_INICIADO"] : [])])
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export async function concluirTarefa(tarefaId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return ko("TAREFA_NAO_ENCONTRADA", correlationId)
  const gate = await gateV2(t.processoId!)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = t.ciclo ?? 1
  const causationId = ctx.causationId ?? H.chaveComando("task-complete", "tarefa", tarefaId, TAREFA_CONCLUIDA_STATUS, ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: t.processoId!, workflowInstanceId: t.workflowInstanceId }

  let exigeAprovacao = false
  if (t.workflowStepInstanceId) {
    const step = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: t.workflowStepInstanceId }, select: { snapshot: true } })
    exigeAprovacao = (step?.snapshot as { exigeAprovacao?: boolean } | null)?.exigeAprovacao === true
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const rt = await aplicarTarefa(tx, tarefaId, TAREFA_CONCLUIDA_STATUS, "TAREFA_CONCLUIDA", { ...base, extra: { executedById: ctx.usuarioId ?? t.responsavelId } })
      if (rt.code) return ko(rt.code, correlationId)
      const eventos = ["TAREFA_CONCLUIDA"]
      let passoAnterior: string | undefined, passoAtual: string | undefined
      if (t.workflowStepInstanceId) {
        if (exigeAprovacao) {
          const rx = await aplicarPasso(tx, t.workflowStepInstanceId, "EXECUTADO", "PASSO_EXECUTADO", base)
          passoAnterior = rx.anterior
          const ra = await aplicarPasso(tx, t.workflowStepInstanceId, "AGUARDANDO_APROVACAO", "PASSO_AGUARDANDO_APROVACAO", base)
          passoAtual = ra.atual
          if (rx.changed) eventos.push("PASSO_EXECUTADO")
          if (ra.changed) eventos.push("PASSO_AGUARDANDO_APROVACAO")
        } else {
          const rc = await aplicarPasso(tx, t.workflowStepInstanceId, "CONCLUIDO", "PASSO_CONCLUIDO", base)
          passoAnterior = rc.anterior; passoAtual = rc.atual
          if (rc.changed) eventos.push("PASSO_CONCLUIDO")
        }
      }
      return ok(rt.changed, correlationId, { tarefa: rt.anterior, passo: passoAnterior }, { tarefa: rt.atual, passo: passoAtual }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export async function bloquearTarefa(tarefaId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return ko("TAREFA_NAO_ENCONTRADA", correlationId)
  if (!ctx.motivoCodigo) return ko("MOTIVO_OBRIGATORIO", correlationId)
  const gate = await gateV2(t.processoId!)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = t.ciclo ?? 1
  const causationId = ctx.causationId ?? H.chaveComando("task-block", "tarefa", tarefaId, "BLOQUEADA", ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: t.processoId!, workflowInstanceId: t.workflowInstanceId }
  try {
    return await prisma.$transaction(async (tx) => {
      const rt = await aplicarTarefa(tx, tarefaId, "BLOQUEADA", "TAREFA_BLOQUEADA", { ...base, extra: { blockedPreviousStatus: t.statusTarefa, motivoCodigo: ctx.motivoCodigo, justificativa: ctx.justificativa } })
      if (rt.code) return ko(rt.code, correlationId)
      const eventos = ["TAREFA_BLOQUEADA"]
      let passoAnt: string | undefined, passoAt: string | undefined
      if (t.workflowStepInstanceId) {
        const step = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: t.workflowStepInstanceId }, select: { status: true } })
        const rp = await aplicarPasso(tx, t.workflowStepInstanceId, "BLOQUEADO", "PASSO_BLOQUEADO", { ...base, extra: { statusAnteriorBloqueio: step?.status } })
        passoAnt = rp.anterior; passoAt = rp.atual
        if (rp.changed) eventos.push("PASSO_BLOQUEADO")
      }
      return ok(rt.changed, correlationId, { tarefa: rt.anterior, passo: passoAnt }, { tarefa: rt.atual, passo: passoAt }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export async function desbloquearTarefa(tarefaId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return ko("TAREFA_NAO_ENCONTRADA", correlationId)
  const gate = await gateV2(t.processoId!)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = t.ciclo ?? 1
  const alvoT = H.restaurarStatusTarefa(t.blockedPreviousStatus)
  const causationId = ctx.causationId ?? H.chaveComando("task-unblock", "tarefa", tarefaId, alvoT, ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: t.processoId!, workflowInstanceId: t.workflowInstanceId }
  try {
    return await prisma.$transaction(async (tx) => {
      const rt = await aplicarTarefa(tx, tarefaId, alvoT, "TAREFA_DESBLOQUEADA", { ...base, extra: { blockedPreviousStatus: null } })
      if (rt.code) return ko(rt.code, correlationId)
      const eventos = ["TAREFA_DESBLOQUEADA"]
      let passoAnt: string | undefined, passoAt: string | undefined
      if (t.workflowStepInstanceId) {
        const step = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: t.workflowStepInstanceId }, select: { statusAnteriorBloqueio: true } })
        const alvoP = H.restaurarStatusPasso(step?.statusAnteriorBloqueio)
        const rp = await aplicarPasso(tx, t.workflowStepInstanceId, alvoP, "PASSO_DESBLOQUEADO", { ...base, extra: { statusAnteriorBloqueio: null } })
        passoAnt = rp.anterior; passoAt = rp.atual
        if (rp.changed) eventos.push("PASSO_DESBLOQUEADO")
      }
      return ok(rt.changed, correlationId, { tarefa: rt.anterior, passo: passoAnt }, { tarefa: rt.atual, passo: passoAt }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export async function cancelarTarefa(tarefaId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return ko("TAREFA_NAO_ENCONTRADA", correlationId)
  if (!ctx.motivoCodigo || !ctx.justificativa) return ko("MOTIVO_OBRIGATORIO", correlationId)
  if (!ctx.politica) return ko("POLITICA_INVALIDA", correlationId)
  const gate = await gateV2(t.processoId!)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = t.ciclo ?? 1
  const destino = H.destinoCancelamentoTarefa(ctx.politica)
  const causationId = ctx.causationId ?? H.chaveComando("task-cancel", "tarefa", tarefaId, destino.tarefaAlvo, ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: t.processoId!, workflowInstanceId: t.workflowInstanceId }
  const evtT: WorkflowEventoTipo = destino.tarefaAlvo === "SUPERSEDIDA" ? "TAREFA_SUPERSEDIDA" : "TAREFA_CANCELADA"
  try {
    return await prisma.$transaction(async (tx) => {
      const rt = await aplicarTarefa(tx, tarefaId, destino.tarefaAlvo, evtT, { ...base, extra: { motivoCodigo: ctx.motivoCodigo, justificativa: ctx.justificativa } })
      if (rt.code) return ko(rt.code, correlationId)
      const eventos = [evtT as string]
      let passoAnt: string | undefined, passoAt: string | undefined
      if (t.workflowStepInstanceId && destino.passoAlvo) {
        const evtP: WorkflowEventoTipo = destino.passoAlvo === "SUPERSEDIDO" ? "PASSO_SUPERSEDIDO" : destino.passoAlvo === "CANCELADO" ? "PASSO_CANCELADO" : destino.passoAlvo === "BLOQUEADO" ? "PASSO_BLOQUEADO" : "PASSO_DESBLOQUEADO"
        const rp = await aplicarPasso(tx, t.workflowStepInstanceId, destino.passoAlvo, evtP, base)
        passoAnt = rp.anterior; passoAt = rp.atual
        if (rp.changed) eventos.push(evtP)
      }
      return ok(rt.changed, correlationId, { tarefa: rt.anterior, passo: passoAnt }, { tarefa: rt.atual, passo: passoAt }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

// ============================================================
// PASSO → TAREFA
// ============================================================
async function opPassoSimples(stepInstanceId: number, ctx: SyncContexto, alvoPasso: string, evtPasso: WorkflowEventoTipo, opKey: string, sincronizarTarefa?: { alvo: string; evt: WorkflowEventoTipo; extra?: Record<string, unknown> }): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const step = await carregarStep(stepInstanceId)
  if (!step) return ko("STEP_NAO_ENCONTRADO", correlationId)
  const gate = await gateV2(step.processoId)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = step.ciclo
  const causationId = ctx.causationId ?? H.chaveComando(opKey, "step_instance", stepInstanceId, alvoPasso, ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: step.processoId, workflowInstanceId: step.workflowInstanceId }
  const tarefa = step.tarefas[0]
  try {
    return await prisma.$transaction(async (tx) => {
      const rp = await aplicarPasso(tx, stepInstanceId, alvoPasso, evtPasso, base)
      if (rp.code) return ko(rp.code, correlationId)
      const eventos = [evtPasso as string]
      let tAnt: string | undefined, tAt: string | undefined
      if (tarefa && sincronizarTarefa) {
        const rt = await aplicarTarefa(tx, tarefa.id, sincronizarTarefa.alvo, sincronizarTarefa.evt, { ...base, extra: sincronizarTarefa.extra })
        tAnt = rt.anterior; tAt = rt.atual
        if (rt.changed) eventos.push(sincronizarTarefa.evt as string)
      }
      return ok(rp.changed, correlationId, { passo: rp.anterior, tarefa: tAnt }, { passo: rp.atual, tarefa: tAt }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export function iniciarPasso(stepInstanceId: number, ctx: SyncContexto) {
  return opPassoSimples(stepInstanceId, ctx, "EM_ANDAMENTO", "PASSO_INICIADO", "step-start", { alvo: "EM_ANDAMENTO", evt: "TAREFA_INICIADA" })
}

export async function concluirPasso(stepInstanceId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const step = await carregarStep(stepInstanceId)
  if (!step) return ko("STEP_NAO_ENCONTRADO", correlationId)
  const gate = await gateV2(step.processoId)
  if (!gate.ok) return ko(gate.code, correlationId)
  const exigeAprovacao = (step.snapshot as { exigeAprovacao?: boolean } | null)?.exigeAprovacao === true
  const ciclo = step.ciclo
  const base: ApplyOpts = { correlationId, causationId: ctx.causationId ?? H.chaveComando("step-complete", "step_instance", stepInstanceId, "CONCLUIDO", ciclo), ciclo, processoId: step.processoId, workflowInstanceId: step.workflowInstanceId }
  const tarefa = step.tarefas[0]
  try {
    return await prisma.$transaction(async (tx) => {
      const eventos: string[] = []
      let pAnt: string | undefined, pAt: string | undefined
      if (exigeAprovacao) {
        const rx = await aplicarPasso(tx, stepInstanceId, "EXECUTADO", "PASSO_EXECUTADO", base); pAnt = rx.anterior
        const ra = await aplicarPasso(tx, stepInstanceId, "AGUARDANDO_APROVACAO", "PASSO_AGUARDANDO_APROVACAO", base); pAt = ra.atual
        if (rx.changed) eventos.push("PASSO_EXECUTADO"); if (ra.changed) eventos.push("PASSO_AGUARDANDO_APROVACAO")
      } else {
        const rc = await aplicarPasso(tx, stepInstanceId, "CONCLUIDO", "PASSO_CONCLUIDO", base); pAnt = rc.anterior; pAt = rc.atual
        if (rc.code) return ko(rc.code, correlationId)
        if (rc.changed) eventos.push("PASSO_CONCLUIDO")
      }
      // sincroniza Tarefa aberta (no-op se já concluída) — sem re-chamar concluirPasso
      let tAnt: string | undefined, tAt: string | undefined
      if (tarefa) {
        const rt = await aplicarTarefa(tx, tarefa.id, TAREFA_CONCLUIDA_STATUS, "TAREFA_CONCLUIDA", { ...base, extra: { executedById: ctx.usuarioId ?? tarefa.responsavelId } })
        tAnt = rt.anterior; tAt = rt.atual
        if (rt.changed) eventos.push("TAREFA_CONCLUIDA")
      }
      return ok(true, correlationId, { passo: pAnt, tarefa: tAnt }, { passo: pAt, tarefa: tAt }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export async function aprovarPasso(stepInstanceId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const step = await carregarStep(stepInstanceId)
  if (!step) return ko("STEP_NAO_ENCONTRADO", correlationId)
  const gate = await gateV2(step.processoId)
  if (!gate.ok) return ko(gate.code, correlationId)
  if (step.status !== "AGUARDANDO_APROVACAO") return ko("NAO_AGUARDANDO_APROVACAO", correlationId)
  const segregacao = (step.snapshot as { segregacaoDeFuncoes?: boolean } | null)?.segregacaoDeFuncoes === true
  const executor = step.tarefas[0]?.executedById ?? step.responsavelId ?? null
  if (segregacao && ctx.aprovadorId != null && executor != null && ctx.aprovadorId === executor) {
    return ko("SEGREGACAO_VIOLADA", correlationId, "Aprovador não pode ser o executor")
  }
  const ciclo = step.ciclo
  const base: ApplyOpts = { correlationId, causationId: ctx.causationId ?? H.chaveComando("step-approve", "step_instance", stepInstanceId, "CONCLUIDO", ciclo), ciclo, processoId: step.processoId, workflowInstanceId: step.workflowInstanceId }
  try {
    return await prisma.$transaction(async (tx) => {
      const eventos: string[] = []
      const ra = await aplicarPasso(tx, stepInstanceId, "CONCLUIDO", "PASSO_APROVADO", { ...base, extra: { aprovadorId: ctx.aprovadorId, approvedAt: new Date() } })
      if (ra.code) return ko(ra.code, correlationId)
      if (ra.changed) eventos.push("PASSO_APROVADO", "PASSO_CONCLUIDO")
      return ok(ra.changed, correlationId, { passo: ra.anterior }, { passo: ra.atual }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export function dispensarPasso(stepInstanceId: number, ctx: SyncContexto) {
  if (!ctx.motivoCodigo || !ctx.justificativa) return Promise.resolve(ko("MOTIVO_OBRIGATORIO", corr(ctx)))
  return opPassoSimples(stepInstanceId, ctx, "DISPENSADO", "PASSO_DISPENSADO", "step-dispense",
    { alvo: "CANCELADA", evt: "TAREFA_CANCELADA", extra: { motivoCodigo: ctx.motivoCodigo, justificativa: ctx.justificativa } })
}

export function cancelarPasso(stepInstanceId: number, ctx: SyncContexto) {
  if (!ctx.motivoCodigo) return Promise.resolve(ko("MOTIVO_OBRIGATORIO", corr(ctx)))
  return opPassoSimples(stepInstanceId, ctx, "CANCELADO", "PASSO_CANCELADO", "step-cancel",
    { alvo: "CANCELADA", evt: "TAREFA_CANCELADA", extra: { motivoCodigo: ctx.motivoCodigo, justificativa: ctx.justificativa } })
}

export function supersederPasso(stepInstanceId: number, ctx: SyncContexto) {
  return opPassoSimples(stepInstanceId, ctx, "SUPERSEDIDO", "PASSO_SUPERSEDIDO", "step-supersede",
    { alvo: "SUPERSEDIDA", evt: "TAREFA_SUPERSEDIDA" })
}

// concorrência: P2002 (evento) ou conflito → releitura convergente
function convergirOuThrow(e: unknown, correlationId: string): SyncResultado {
  if ((e as { code?: string })?.code === "P2002") {
    return { success: true, changed: false, estadoAnterior: {}, estadoAtual: {}, eventos: [], warnings: [{ code: "IDEMPOTENTE", message: "Operação já aplicada (evento único)" }], correlationId }
  }
  throw e
}
