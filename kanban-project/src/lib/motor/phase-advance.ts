// src/lib/motor/phase-advance.ts
// CP-4F — PhaseAdvanceService: ÚNICO serviço canônico autorizado a mudar
// Processo.faseAtualKey no runtime v2 (REGRA SUPREMA). Nenhuma rota/componente
// deve escrever faseAtualKey diretamente sob v2.
//
// Operações: advance (normal), forceAdvance (forçado), reopenPhase (reabertura,
// novo ciclo) e returnPhase (retorno controlado a fase anterior, novo ciclo).
//
// Garantias:
//  - transação única e atômica (rollback integral em qualquer falha antes do commit);
//  - concorrência por CAS (faseAtualKey + lockVersion) — clique duplo não avança 2x;
//  - idempotência por chave determinística @unique (P2002 → convergência);
//  - auditoria completa em PhaseAdvanceLog + WorkflowEvento (append-only) + DomainOutbox;
//  - recálculo de pendências pelo BlockingEngine antes de avançar (avanço normal);
//  - avanço forçado exige justificativa + código de motivo (não basta admin genérico);
//  - NÃO executa efeito financeiro, NÃO faz dual-write, NÃO ativa runtime,
//    NÃO remove legado. Fora do v2 recusa explicitamente (a rota trata o legado).

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import { calcularPendencias } from "@/src/lib/motor/blocking-engine"
import type { BlockingIssue } from "@/src/lib/motor/blocking-helpers"
import { instanciarWorkflowDaFase, type OrigemInstanciaStr } from "@/src/services/phase-workflow"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import {
  type AdvanceOperacao,
  type AdvanceFailureCode,
  type AdvanceResultadoStr,
  resultadoDaOperacao,
  exigeJustificativa,
  montarChaveAdvance,
  montarChaveAdvanceBloqueio,
  proximaFasePorOrdem,
  faseAlvoEhAnterior,
  montarEventoEntered,
  montarEventoCompleted,
} from "@/src/lib/motor/phase-advance-helpers"

// --------------------------------------------------------------------------
// Tipos públicos
// --------------------------------------------------------------------------

export interface AdvanceCtx {
  correlationId?: string
  causationId?: string
  solicitadoPorId?: number
  origem?: string
}

export interface ForceInput extends AdvanceCtx {
  justificativa: string
  motivoCodigo: string
}

export interface ReopenInput extends AdvanceCtx {
  justificativa: string
  motivoCodigo: string
}

export interface ReturnInput extends AdvanceCtx {
  faseAlvo: string
  justificativa: string
  motivoCodigo: string
}

export interface AdvanceOk {
  success: true
  resultado: Exclude<AdvanceResultadoStr, "BLOQUEADO" | "CONFLITO">
  changed: boolean
  processoId: number
  faseAnterior: string
  faseAtual: string
  faseDestino: string
  ciclo: number
  workflowInstanceId: number | null
  tarefasCriadas: number
  correlationId: string
  logId: number | null
}

export interface AdvanceErr {
  success: false
  resultado: "BLOQUEADO" | "CONFLITO" | "REJEITADO"
  code: AdvanceFailureCode
  message: string
  blockingIssues?: BlockingIssue[]
  warnings?: BlockingIssue[]
  faseAtual?: string
  correlationId: string
  logId?: number | null
}

export type AdvanceResult = AdvanceOk | AdvanceErr

// --------------------------------------------------------------------------
// Contexto interno
// --------------------------------------------------------------------------

interface Contexto {
  processo: { id: number; faseAtual: string; lockVersion: number; tipoProcessoMotorId: number | null }
  fases: { phaseKey: string; ordem: number }[]
  runtime: "legacy" | "v2"
  v2Global: boolean
}

async function carregarContexto(processoId: number): Promise<Contexto | AdvanceErr> {
  const correlationId = randomUUID()
  const rejeitar = (code: AdvanceFailureCode, message: string): AdvanceErr => ({
    success: false, resultado: "REJEITADO", code, message, correlationId,
  })

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, faseAtualKey: true, lockVersion: true, tipoProcessoMotorId: true, workflowRuntime: true },
  })
  if (!processo) return rejeitar("PROCESSO_NAO_ENCONTRADO", "Processo inexistente")

  const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  const v2Global = cfg?.runtimeV2Habilitado ?? false
  const runtime = resolveWorkflowRuntime(processo.workflowRuntime, v2Global)
  if (!v2Global) return rejeitar("RUNTIME_V2_DESABILITADO", "Kill switch global do runtime v2 desabilitado")
  if (runtime !== "v2") return rejeitar("PROCESSO_LEGACY", "Processo em runtime legacy — avanço v2 não aplicável")
  if (processo.tipoProcessoMotorId == null) return rejeitar("SEM_TIPO_MOTOR", "Processo sem tipo do motor")

  const wf = await prisma.macroWorkflow.findUnique({
    where: { tipoProcessoId: processo.tipoProcessoMotorId },
    include: { fases: { orderBy: { ordem: "asc" }, select: { phaseKey: true, ordem: true } } },
  })
  if (!wf) return rejeitar("SEM_TIPO_MOTOR", "Tipo do motor sem Workflow Macro")

  return {
    processo: {
      id: processo.id, faseAtual: processo.faseAtualKey ?? "",
      lockVersion: processo.lockVersion, tipoProcessoMotorId: processo.tipoProcessoMotorId,
    },
    fases: wf.fases, runtime, v2Global,
  }
}

async function proximoCiclo(processoId: number, faseMacroKey: string): Promise<number> {
  const ultima = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey },
    orderBy: { ciclo: "desc" }, select: { ciclo: true },
  })
  return (ultima?.ciclo ?? 0) + 1
}

// --------------------------------------------------------------------------
// Plano de mutação (compartilhado por todas as operações)
// --------------------------------------------------------------------------

interface Plano {
  operacao: AdvanceOperacao
  processoId: number
  faseAtual: string
  lockVersion: number
  faseDestino: string
  novaFaseAtualKey: string
  cicloAlvo: number
  origemInstancia: OrigemInstanciaStr
  encerramento: "CONCLUIR" | "SUPERSEDER" | "NENHUM"
  eventoFaseTipo: "FASE_AVANCADA" | "FASE_AVANCADA_FORCADO" | "FASE_REABERTA" | "FASE_RETORNADA"
  correlationId: string
  causationId: string | null
  solicitadoPorId?: number
  justificativa?: string
  motivoCodigo?: string
  forcado: boolean
  origemLog: string
  regrasAvaliadas: Prisma.InputJsonValue
  pendencias: Prisma.InputJsonValue
  warnings: Prisma.InputJsonValue
}

async function executarPlano(p: Plano): Promise<AdvanceResult> {
  const resultadoEnum = resultadoDaOperacao(p.operacao)
  const chave = montarChaveAdvance({
    processoId: p.processoId, operacao: p.operacao,
    faseAtual: p.faseAtual, fasePretendida: p.novaFaseAtualKey,
    lockVersion: p.lockVersion, cicloAlvo: p.cicloAlvo,
  })

  try {
    const out = await prisma.$transaction(async (tx) => {
      // 1) encerrar/superseder a instância atual da fase de origem (histórico preservado)
      let previousInstanceId: number | null = null
      if (p.encerramento !== "NENHUM") {
        const atual = await tx.phaseWorkflowInstance.findFirst({
          where: { processoId: p.processoId, faseMacroKey: p.faseAtual, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
          orderBy: { ciclo: "desc" }, select: { id: true },
        })
        if (atual) {
          previousInstanceId = atual.id
          const concluir = p.encerramento === "CONCLUIR"
          await tx.phaseWorkflowInstance.update({
            where: { id: atual.id },
            data: concluir
              ? { status: "CONCLUIDO", completedAt: new Date() }
              : { status: "SUPERSEDIDO", supersededAt: new Date() },
          })
          await tx.workflowEvento.create({
            data: {
              tipo: concluir ? "WORKFLOW_CONCLUIDO" : "WORKFLOW_SUPERSEDIDO",
              entityType: "workflow_instance", entityId: atual.id,
              processoId: p.processoId, workflowInstanceId: atual.id,
              correlationId: p.correlationId, causationId: chave,
              chaveIdempotencia: `evt|saida|${chave}|wfi${atual.id}`,
              dados: { faseMacroKey: p.faseAtual, motivo: p.operacao },
            },
          })
        }
      }

      // 2) CAS na fase do Processo — ÚNICO ponto de escrita de faseAtualKey no v2.
      const cas = await tx.processo.updateMany({
        where: { id: p.processoId, faseAtualKey: p.faseAtual, lockVersion: p.lockVersion },
        data: { faseAtualKey: p.novaFaseAtualKey, lockVersion: { increment: 1 } },
      })
      if (cas.count === 0) {
        const err = new Error("CAS_CONFLITO") as Error & { __conflito?: boolean }
        err.__conflito = true
        throw err
      }

      // 3) instanciar o Workflow Interno da fase de destino (passos versionados)
      const inst = await instanciarWorkflowDaFase(
        {
          processoId: p.processoId, faseMacroKey: p.faseDestino, ciclo: p.cicloAlvo,
          origem: p.origemInstancia, correlationId: p.correlationId, causationId: chave,
          solicitadoPorId: p.solicitadoPorId,
        },
        tx,
      )
      if (!inst.success) {
        const err = new Error("INSTANCIACAO_FALHOU") as Error & { __instFail?: string }
        err.__instFail = inst.code
        throw err
      }

      // 3b) vincular previousInstanceId (reabertura/retorno mantêm o ciclo anterior)
      if (previousInstanceId != null) {
        await tx.phaseWorkflowInstance.update({
          where: { id: inst.workflowInstance.id }, data: { previousInstanceId },
        })
      }

      // 4) gerar Tarefas humanas dos passos elegíveis (idempotente; o serviço se auto-filtra)
      let tarefasCriadas = 0
      for (const step of inst.stepInstances) {
        const g = await garantirTarefaDePasso(
          { stepInstanceId: step.id, correlationId: p.correlationId, causationId: chave, origem: "workflow" },
          tx,
        )
        if (g.success && g.created) tarefasCriadas++
      }

      // 5) evento de fase (append-only)
      await tx.workflowEvento.create({
        data: {
          tipo: p.eventoFaseTipo, entityType: "fase", entityId: p.processoId,
          processoId: p.processoId, workflowInstanceId: inst.workflowInstance.id,
          correlationId: p.correlationId, causationId: chave,
          chaveIdempotencia: `evt|fase|${chave}`,
          dados: {
            de: p.faseAtual, para: p.novaFaseAtualKey, faseDestino: p.faseDestino,
            ciclo: p.cicloAlvo, forcado: p.forcado, operacao: p.operacao,
          },
        },
      })

      // 6) auditoria completa da mudança de fase
      const log = await tx.phaseAdvanceLog.create({
        data: {
          processoId: p.processoId, faseAtual: p.faseAtual, fasePretendida: p.novaFaseAtualKey,
          faseAnteriorId: previousInstanceId, fasePretendidaId: inst.workflowInstance.id,
          macroWorkflowId: inst.workflowInstance.macroWorkflowId ?? null,
          macroVersion: inst.workflowInstance.macroVersion ?? null,
          internalWorkflowVersion: inst.workflowInstance.workflowVersion ?? null,
          policy: "ALL_REQUIRED_COMPLETED",
          regrasAvaliadas: p.regrasAvaliadas, pendencias: p.pendencias, warnings: p.warnings,
          resultado: resultadoEnum, origem: p.origemLog, solicitadoPorId: p.solicitadoPorId ?? null,
          justificativa: p.justificativa ?? null, motivoCodigo: p.motivoCodigo ?? null,
          forcado: p.forcado, correlationId: p.correlationId, causationId: p.causationId,
          chaveIdempotencia: chave,
        },
      })

      // 7) EVENTOS CANÔNICOS no outbox transacional (contrato estável p/ efeitos
      //    futuros — inclusive o financeiro — reagirem à ENTRADA em fase).
      //    - phase.completed: só quando a fase de origem foi de fato CONCLUÍDA
      //      (avanço normal/forçado); reabertura/retorno SUPERSEDEM, não concluem.
      //    - phase.entered: SEMPRE. Ambos idempotentes por chaveIdempotencia @unique
      //      (mesma transição reprocessada não duplica o evento).
      const occurredAt = new Date().toISOString()
      const eventoBase = {
        processoId: p.processoId,
        faseAnteriorKey: p.faseAtual,
        faseAnteriorInstanceId: previousInstanceId,
        faseNovaKey: p.faseDestino,
        faseNovaInstanceId: inst.workflowInstance.id,
        ciclo: p.cicloAlvo,
        operacao: p.operacao,
        origem: p.origemLog,
        solicitadoPorId: p.solicitadoPorId ?? null,
        macroVersion: inst.workflowInstance.macroVersion ?? null,
        chaveTransicao: chave,
        correlationId: p.correlationId,
        occurredAt,
      }

      if (p.encerramento === "CONCLUIR") {
        const evtCompleted = montarEventoCompleted(eventoBase)
        await tx.domainOutbox.create({
          data: {
            tipo: evtCompleted.tipo, aggregateType: "Processo", aggregateId: p.processoId,
            correlationId: p.correlationId, causationId: chave,
            chaveIdempotencia: evtCompleted.chaveIdempotencia,
            payload: evtCompleted.payload as Prisma.InputJsonValue,
          },
        })
      }

      const evtEntered = montarEventoEntered(eventoBase)
      await tx.domainOutbox.create({
        data: {
          tipo: evtEntered.tipo, aggregateType: "Processo", aggregateId: p.processoId,
          correlationId: p.correlationId, causationId: chave,
          chaveIdempotencia: evtEntered.chaveIdempotencia,
          payload: evtEntered.payload as Prisma.InputJsonValue,
        },
      })

      const ok: AdvanceOk = {
        success: true, resultado: resultadoEnum, changed: true, processoId: p.processoId,
        faseAnterior: p.faseAtual, faseAtual: p.novaFaseAtualKey, faseDestino: p.faseDestino,
        ciclo: p.cicloAlvo, workflowInstanceId: inst.workflowInstance.id,
        tarefasCriadas, correlationId: p.correlationId, logId: log.id,
      }
      return ok
    }, {
      // A transação do avanço cria a instância da próxima fase + passos + tarefas +
      // eventos + logs + outbox (muitas escritas sequenciais). O default de 5000ms
      // estourava (P2028) na transição genealogia→emissao_documental sob latência de
      // pool. Só amplia a janela; nenhuma mudança de lógica.
      timeout: 20000,
      maxWait: 15000,
    })
    return out
  } catch (e) {
    const err = e as { __conflito?: boolean; __instFail?: string; code?: string }
    // Concorrência: CAS falhou ou colisão da chave @unique (clique duplo real).
    if (err.__conflito || err.code === "P2002") {
      const atual = await prisma.processo.findUnique({
        where: { id: p.processoId }, select: { faseAtualKey: true },
      })
      const logExistente = await prisma.phaseAdvanceLog.findUnique({
        where: { chaveIdempotencia: chave }, select: { id: true },
      })
      // Se já está exatamente na fase pretendida, a operação convergiu (idempotente).
      if ((atual?.faseAtualKey ?? "") === p.novaFaseAtualKey && p.novaFaseAtualKey !== p.faseAtual) {
        return {
          success: true, resultado: "IDEMPOTENTE", changed: false, processoId: p.processoId,
          faseAnterior: p.faseAtual, faseAtual: p.novaFaseAtualKey, faseDestino: p.faseDestino,
          ciclo: p.cicloAlvo, workflowInstanceId: null, tarefasCriadas: 0,
          correlationId: p.correlationId, logId: logExistente?.id ?? null,
        }
      }
      return {
        success: false, resultado: "CONFLITO", code: "CONFLITO",
        message: "Conflito de concorrência na mudança de fase (estado mudou sob a operação)",
        faseAtual: atual?.faseAtualKey ?? p.faseAtual, correlationId: p.correlationId,
        logId: logExistente?.id ?? null,
      }
    }
    if (err.__instFail) {
      return {
        success: false, resultado: "REJEITADO", code: "INSTANCIACAO_FALHOU",
        message: `Falha ao instanciar a fase de destino: ${err.__instFail}`,
        correlationId: p.correlationId,
      }
    }
    throw e
  }
}

// --------------------------------------------------------------------------
// Snapshot de pendências (leitura) para auditoria
// --------------------------------------------------------------------------

async function snapshotPendencias(processoId: number, faseAtual: string, correlationId: string) {
  const pend = await calcularPendencias(processoId, faseAtual, { correlationId })
  const regrasAvaliadas = [
    { policy: pend.policy, faseAtual, totalIssues: pend.issues.length, blocking: pend.blocking.length, warnings: pend.warnings.length },
  ]
  return {
    pend,
    regrasAvaliadas: regrasAvaliadas as unknown as Prisma.InputJsonValue,
    pendencias: pend.blocking as unknown as Prisma.InputJsonValue,
    warnings: pend.warnings as unknown as Prisma.InputJsonValue,
  }
}

// --------------------------------------------------------------------------
// Operações públicas
// --------------------------------------------------------------------------

/** Avanço NORMAL: só avança com zero pendências BLOCKING. Transação atômica. */
export async function advance(processoId: number, ctx: AdvanceCtx = {}): Promise<AdvanceResult> {
  const ctxOuErr = await carregarContexto(processoId)
  if ("success" in ctxOuErr) return ctxOuErr
  const c = ctxOuErr
  const correlationId = ctx.correlationId ?? randomUUID()

  const proxima = proximaFasePorOrdem(c.fases, c.processo.faseAtual)
  if (!proxima) {
    return { success: false, resultado: "REJEITADO", code: "SEM_PROXIMA_FASE", message: "Não há próxima fase (última fase do macro)", faseAtual: c.processo.faseAtual, correlationId }
  }

  const snap = await snapshotPendencias(processoId, c.processo.faseAtual, correlationId)
  if (snap.pend.blocking.length > 0) {
    // Auditoria da tentativa BLOQUEADA (uma por correlação) — sem mutação.
    const log = await prisma.phaseAdvanceLog.create({
      data: {
        processoId, faseAtual: c.processo.faseAtual, fasePretendida: proxima,
        policy: "ALL_REQUIRED_COMPLETED", regrasAvaliadas: snap.regrasAvaliadas,
        pendencias: snap.pendencias, warnings: snap.warnings, resultado: "BLOQUEADO",
        origem: ctx.origem ?? "advance", solicitadoPorId: ctx.solicitadoPorId ?? null,
        forcado: false, correlationId, causationId: ctx.causationId ?? null,
        chaveIdempotencia: montarChaveAdvanceBloqueio({ processoId, operacao: "AVANCAR", faseAtual: c.processo.faseAtual, correlationId }),
      },
    }).catch(() => null)
    return {
      success: false, resultado: "BLOQUEADO", code: "BLOQUEADO",
      message: "Avanço bloqueado por pendências obrigatórias",
      blockingIssues: snap.pend.blocking, warnings: snap.pend.warnings,
      faseAtual: c.processo.faseAtual, correlationId, logId: log?.id ?? null,
    }
  }

  return executarPlano({
    operacao: "AVANCAR", processoId, faseAtual: c.processo.faseAtual, lockVersion: c.processo.lockVersion,
    faseDestino: proxima, novaFaseAtualKey: proxima, cicloAlvo: 1, origemInstancia: "MOTOR",
    encerramento: "CONCLUIR", eventoFaseTipo: "FASE_AVANCADA", correlationId,
    causationId: ctx.causationId ?? null, solicitadoPorId: ctx.solicitadoPorId, forcado: false,
    origemLog: ctx.origem ?? "advance", regrasAvaliadas: snap.regrasAvaliadas,
    pendencias: snap.pendencias, warnings: snap.warnings,
  })
}

/** Avanço FORÇADO: ignora BLOCKING mas EXIGE justificativa + código de motivo. */
export async function forceAdvance(processoId: number, input: ForceInput): Promise<AdvanceResult> {
  const ctxOuErr = await carregarContexto(processoId)
  if ("success" in ctxOuErr) return ctxOuErr
  const c = ctxOuErr
  const correlationId = input.correlationId ?? randomUUID()

  if (!input.justificativa || !input.justificativa.trim()) {
    return { success: false, resultado: "REJEITADO", code: "JUSTIFICATIVA_OBRIGATORIA", message: "Avanço forçado exige justificativa", correlationId }
  }
  if (!input.motivoCodigo || !input.motivoCodigo.trim()) {
    return { success: false, resultado: "REJEITADO", code: "MOTIVO_OBRIGATORIO", message: "Avanço forçado exige código de motivo", correlationId }
  }

  const proxima = proximaFasePorOrdem(c.fases, c.processo.faseAtual)
  if (!proxima) {
    return { success: false, resultado: "REJEITADO", code: "SEM_PROXIMA_FASE", message: "Não há próxima fase (última fase do macro)", faseAtual: c.processo.faseAtual, correlationId }
  }

  // pendências são apenas SNAPSHOT para auditoria (ignoradas no forçado)
  const snap = await snapshotPendencias(processoId, c.processo.faseAtual, correlationId)

  return executarPlano({
    operacao: "FORCAR", processoId, faseAtual: c.processo.faseAtual, lockVersion: c.processo.lockVersion,
    faseDestino: proxima, novaFaseAtualKey: proxima, cicloAlvo: 1, origemInstancia: "MOTOR",
    encerramento: "CONCLUIR", eventoFaseTipo: "FASE_AVANCADA_FORCADO", correlationId,
    causationId: input.causationId ?? null, solicitadoPorId: input.solicitadoPorId, forcado: true,
    justificativa: input.justificativa, motivoCodigo: input.motivoCodigo,
    origemLog: input.origem ?? "force", regrasAvaliadas: snap.regrasAvaliadas,
    pendencias: snap.pendencias, warnings: snap.warnings,
  })
}

/** Reabertura da fase ATUAL: novo ciclo, supersede o ciclo anterior (histórico). */
export async function reopenPhase(processoId: number, input: ReopenInput): Promise<AdvanceResult> {
  const ctxOuErr = await carregarContexto(processoId)
  if ("success" in ctxOuErr) return ctxOuErr
  const c = ctxOuErr
  const correlationId = input.correlationId ?? randomUUID()

  if (!input.justificativa || !input.justificativa.trim()) {
    return { success: false, resultado: "REJEITADO", code: "JUSTIFICATIVA_OBRIGATORIA", message: "Reabertura exige justificativa", correlationId }
  }
  if (!input.motivoCodigo || !input.motivoCodigo.trim()) {
    return { success: false, resultado: "REJEITADO", code: "MOTIVO_OBRIGATORIO", message: "Reabertura exige código de motivo", correlationId }
  }

  const cicloAlvo = await proximoCiclo(processoId, c.processo.faseAtual)
  const snap = await snapshotPendencias(processoId, c.processo.faseAtual, correlationId)

  return executarPlano({
    operacao: "REABRIR", processoId, faseAtual: c.processo.faseAtual, lockVersion: c.processo.lockVersion,
    faseDestino: c.processo.faseAtual, novaFaseAtualKey: c.processo.faseAtual, cicloAlvo,
    origemInstancia: "REABERTURA", encerramento: "SUPERSEDER", eventoFaseTipo: "FASE_REABERTA",
    correlationId, causationId: input.causationId ?? null, solicitadoPorId: input.solicitadoPorId,
    forcado: false, justificativa: input.justificativa, motivoCodigo: input.motivoCodigo,
    origemLog: input.origem ?? "reopen", regrasAvaliadas: snap.regrasAvaliadas,
    pendencias: snap.pendencias, warnings: snap.warnings,
  })
}

/** Retorno CONTROLADO a uma fase anterior (ex.: volta à Genealogia): novo ciclo. */
export async function returnPhase(processoId: number, input: ReturnInput): Promise<AdvanceResult> {
  const ctxOuErr = await carregarContexto(processoId)
  if ("success" in ctxOuErr) return ctxOuErr
  const c = ctxOuErr
  const correlationId = input.correlationId ?? randomUUID()

  if (!input.faseAlvo || !input.faseAlvo.trim()) {
    return { success: false, resultado: "REJEITADO", code: "FASE_ALVO_INVALIDA", message: "Informe a fase-alvo do retorno", correlationId }
  }
  if (!input.justificativa || !input.justificativa.trim()) {
    return { success: false, resultado: "REJEITADO", code: "JUSTIFICATIVA_OBRIGATORIA", message: "Retorno controlado exige justificativa", correlationId }
  }
  if (!input.motivoCodigo || !input.motivoCodigo.trim()) {
    return { success: false, resultado: "REJEITADO", code: "MOTIVO_OBRIGATORIO", message: "Retorno controlado exige código de motivo", correlationId }
  }
  const existe = c.fases.some((f) => f.phaseKey === input.faseAlvo)
  if (!existe) {
    return { success: false, resultado: "REJEITADO", code: "FASE_ALVO_INVALIDA", message: "Fase-alvo inexistente no macro do processo", correlationId }
  }
  if (!faseAlvoEhAnterior(c.fases, c.processo.faseAtual, input.faseAlvo)) {
    return { success: false, resultado: "REJEITADO", code: "FASE_ALVO_NAO_ANTERIOR", message: "Retorno só é permitido para uma fase anterior à atual", correlationId }
  }

  const cicloAlvo = await proximoCiclo(processoId, input.faseAlvo)
  const snap = await snapshotPendencias(processoId, c.processo.faseAtual, correlationId)

  return executarPlano({
    operacao: "RETORNAR", processoId, faseAtual: c.processo.faseAtual, lockVersion: c.processo.lockVersion,
    faseDestino: input.faseAlvo, novaFaseAtualKey: input.faseAlvo, cicloAlvo,
    origemInstancia: "REABERTURA", encerramento: "SUPERSEDER", eventoFaseTipo: "FASE_RETORNADA",
    correlationId, causationId: input.causationId ?? null, solicitadoPorId: input.solicitadoPorId,
    forcado: false, justificativa: input.justificativa, motivoCodigo: input.motivoCodigo,
    origemLog: input.origem ?? "return", regrasAvaliadas: snap.regrasAvaliadas,
    pendencias: snap.pendencias, warnings: snap.warnings,
  })
}
