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
import { reconciliarFinanceiroDaFase } from "@/src/lib/motor/executor"
import { reconciliarOperacoesAntecipadas } from "@/src/services/operacao-antecipada"

const MAX_TENTATIVAS = 5
// Reserva "presa" há mais que isto (worker morreu no meio) volta a ser reivindicável.
const CLAIM_STALE_MS = 5 * 60 * 1000
// Tipos conhecidos SEM consumidor de efeito: arquivados (marcados ENVIADO) — não acumulam.
const TIPOS_SEM_EFEITO = new Set(["phase.completed"])

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

  // EFEITO ADICIONAL — automações FINANCEIRAS da fase (fluxo novo): o preço vem da
  // Tabela de Preços e o lançamento cai no Financeiro do Processo. Idempotente
  // (MotorArtefato). Isolado: uma falha aqui não impede a convergência das tarefas.
  if (payload.processId && payload.newPhaseKey) {
    // NÃO engolir: se algum lançamento falhou (erro transitório), PROPAGAR para o
    // processarOutbox marcar o evento PENDENTE e reprocessar (idempotente via MotorArtefato).
    // Engolir marcaria ENVIADO e perderia a Receita/Custo silenciosamente.
    // RECONCILE (modelo definitivo): cria os lançamentos que faltam E remove os órfãos
    // (regra/config que deixou de aplicar). Converge o Financeiro do Processo ao que o
    // FinanceRuleEngine determina. Idempotente.
    const r = await reconciliarFinanceiroDaFase(payload.processId, payload.newPhaseKey)
    if (r.erros.length) throw new Error(`automações financeiras da fase falharam: ${r.erros.join(" ; ")}`)

    // REAPROVEITAMENTO de trabalho antecipado: ao entrar numa fase, reconcilia (idempotente) as
    // Operações Antecipadas cujo destino é esta fase — reusa o trabalho oficial já feito, sem
    // duplicar (via adaptador do catálogo). Isolado/best-effort.
    try { await reconciliarOperacoesAntecipadas(payload.processId, payload.newPhaseKey) }
    catch (e) { console.error("[outbox] reconciliação de operação antecipada falhou:", e) }
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
  // phase.completed entra por padrão só para ARQUIVAR (marca ENVIADO) — não acumula.
  const tipos = opts?.tipos ?? ["phase.entered", "phase.completed"]

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
  const staleAntes = new Date(Date.now() - CLAIM_STALE_MS)

  for (const evt of pendentes) {
    // CLAIM ATÔMICO: reserva a linha antes de processar. Dois workers concorrentes → só um
    // consegue (count===1); o outro IGNORA. Reivindica também reservas "presas" (worker morto).
    const claim = await prisma.domainOutbox.updateMany({
      where: { id: evt.id, status: "PENDENTE", OR: [{ reservadoEm: null }, { reservadoEm: { lt: staleAntes } }] },
      data: { reservadoEm: new Date() },
    })
    if (claim.count !== 1) { resumo.ignorados++; resumo.detalhes.push({ id: evt.id, tipo: evt.tipo, status: "IGNORADO" }); continue }

    try {
      if (evt.tipo === "phase.entered") {
        await aplicarPhaseEntered((evt.payload ?? {}) as PhaseEnteredPayload, evt.correlationId)
      } else if (!TIPOS_SEM_EFEITO.has(evt.tipo)) {
        // tipo conhecido sem efeito conectado ainda: no-op (será marcado ENVIADO/arquivado).
      }
      await prisma.domainOutbox.update({
        where: { id: evt.id },
        data: { status: "ENVIADO", processadoEm: new Date(), erro: null },
      })
      resumo.processados++
      resumo.detalhes.push({ id: evt.id, tipo: evt.tipo, status: "ENVIADO" })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // libera a reserva (reservadoEm: null) para reprocessamento.
      await prisma.domainOutbox.update({
        where: { id: evt.id },
        data: { status: "PENDENTE", reservadoEm: null, tentativas: { increment: 1 }, erro: msg.slice(0, 1000) },
      }).catch(() => {})
      resumo.falhos++
      resumo.detalhes.push({ id: evt.id, tipo: evt.tipo, status: "ERRO", erro: msg })
    }
  }
  return resumo
}
