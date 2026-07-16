// src/services/outbox-dispatcher.ts
// Consumidor da DomainOutbox — dispatcher idempotente dos eventos canônicos.
//
// Papel: drenar eventos PENDENTE e processar seus EFEITOS de forma idempotente,
// marcando ENVIADO no sucesso e ERRO (com tentativas) na falha. Reprocessável.
// NÃO é um segundo motor: reutiliza os serviços canônicos (garantirTarefaDePasso).
//
// Hoje o efeito conectado é phase.entered → garantir as Tarefas dos passos da
// instância da fase (mesma geração idempotente usada no nascimento/avanço). Como
// o nascimento/avanço já geram inline na mesma transação, aqui é convergência
// idempotente (no-op quando já geradas) + gancho estável p/ efeitos futuros.

import { prisma } from "@/lib/prisma"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"

const MAX_TENTATIVAS = 5

export interface OutboxProcessResumo {
  lidos: number
  processados: number
  falhos: number
  ignorados: number
  detalhes: { id: number; tipo: string; status: "ENVIADO" | "ERRO" | "IGNORADO"; erro?: string }[]
}

interface PhaseEnteredPayload {
  processId?: number
  newPhaseInstanceId?: number
  newPhaseKey?: string
}

/** Efeito idempotente de phase.entered: garantir as tarefas dos passos da fase. */
async function aplicarPhaseEntered(payload: PhaseEnteredPayload, correlationId: string | null): Promise<number> {
  const instanceId = payload.newPhaseInstanceId
  if (!instanceId) return 0
  const steps = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: instanceId }, select: { id: true },
  })
  let criadas = 0
  for (const step of steps) {
    const g = await garantirTarefaDePasso({
      stepInstanceId: step.id, correlationId: correlationId ?? undefined, origem: "outbox_dispatcher",
    })
    if (g.success && g.created) criadas++
  }
  return criadas
}

/**
 * Drena a outbox. `tipos` limita quais tipos processar (default: phase.entered).
 * `limite` = máximo de eventos por execução. `forcar` reprocessa mesmo acima do
 * teto de tentativas (reprocessamento administrativo).
 */
export async function processarOutbox(opts?: {
  limite?: number
  tipos?: string[]
  forcar?: boolean
}): Promise<OutboxProcessResumo> {
  const limite = opts?.limite ?? 50
  const tipos = opts?.tipos ?? ["phase.entered"]

  const pendentes = await prisma.domainOutbox.findMany({
    where: {
      status: "PENDENTE",
      tipo: { in: tipos },
      ...(opts?.forcar ? {} : { tentativas: { lt: MAX_TENTATIVAS } }),
    },
    orderBy: { criadoEm: "asc" },
    take: limite,
  })

  const resumo: OutboxProcessResumo = { lidos: pendentes.length, processados: 0, falhos: 0, ignorados: 0, detalhes: [] }

  for (const evt of pendentes) {
    try {
      if (evt.tipo === "phase.entered") {
        await aplicarPhaseEntered((evt.payload ?? {}) as PhaseEnteredPayload, evt.correlationId)
      } else {
        // tipo conhecido mas sem efeito conectado ainda: apenas marca como enviado.
      }
      await prisma.domainOutbox.update({
        where: { id: evt.id },
        data: { status: "ENVIADO", processadoEm: new Date(), erro: null },
      })
      resumo.processados++
      resumo.detalhes.push({ id: evt.id, tipo: evt.tipo, status: "ENVIADO" })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await prisma.domainOutbox.update({
        where: { id: evt.id },
        data: { status: "PENDENTE", tentativas: { increment: 1 }, erro: msg.slice(0, 1000) },
      }).catch(() => {})
      resumo.falhos++
      resumo.detalhes.push({ id: evt.id, tipo: evt.tipo, status: "ERRO", erro: msg })
    }
  }
  return resumo
}
