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
import { reconciliarFinanceiroDaFase, processarRequerenteAdicionado } from "@/src/lib/motor/executor"
import type { EventoRequerentePayload } from "@/src/lib/motor/executor"
import { reconciliarEconomicoDoProcesso } from "@/src/lib/motor/matriz-economica"
import { espelharCustosDoProcesso } from "@/lib/financeiro/dual-write"
import { reconciliarOperacoesAntecipadas } from "@/src/services/operacao-antecipada"
// MRG — reconciliação contínua do motor registral (evento registral.reconciliar.processo).
import { reconciliarDocumentalDoProcesso } from "@/src/services/registral/reconciliacao-documental"
import { recalcularLinhagem, registrarRecalculo } from "@/src/services/registral/consultas"
// Projeção financeira documental — registro localizado vira custo previsto.
import { projetarCustosDocumentaisDoPasso } from "@/src/services/financeiro/projecao-documental"

const MAX_TENTATIVAS = 5
// Reserva "presa" há mais que isto (worker morreu no meio) volta a ser reivindicável.
const CLAIM_STALE_MS = 5 * 60 * 1000
// Tipos conhecidos SEM consumidor de efeito: arquivados (marcados ENVIADO) — não acumulam.
//
// `phase-workflow.instanced` entrou aqui depois de um incidente real: ele era
// EMITIDO mas não constava da lista de tipos drenados, então ficava PENDENTE para
// sempre. A fila cresceu por 12 dias sem que nada estivesse "com erro" — só
// represado. O efeito das tarefas já é garantido por `phase.entered`; este evento
// é informativo, então arquivar é o comportamento correto.
// TIPOS QUE SÃO NOTIFICAÇÃO, NÃO COMANDO.
//
// Eles nascem porque toda transição publica no outbox — o que é útil como ponto de
// integração e como rastro. O que não podem é ACUMULAR: em produção havia 110
// `tarefa.generated` e dezenas de `step.*` parados desde agosto, porque não estavam
// na lista de drenagem e ninguém os arquivava. Fila que só cresce é fila quebrada,
// mesmo quando ninguém depende do que está nela.
//
// Estar aqui significa: "é processado e arquivado, sem efeito colateral". No dia em
// que um deles ganhar consumidor, sai desta lista e ganha um `else if` lá embaixo.
const TIPOS_SEM_EFEITO = new Set([
  "phase.completed",
  "phase-workflow.instanced",
  "tarefa.generated",
  "tarefa.concluido_recebido",
  "financeiro.obrigacao.criada",
  "step.em_andamento",
  "step.disponivel",
  "step.bloqueado",
  "step.reaberto",
  "step.cancelado",
  "step.dispensado",
  "step.supersedido",
  "step.aguardando",
  "step.executado",
  "step.aguardando_aprovacao",
  "step.pendente",
])

/**
 * TODOS os tipos que o dispatcher drena. Um tipo emitido e ausente daqui nunca é
 * consumido — a fila cresce em silêncio. A verificação de saúde FILA-003 vigia
 * exatamente isso, comparando o que está PENDENTE com esta lista.
 */
export const TIPOS_DRENADOS = [
  "phase.entered",
  "phase.completed",
  "phase-workflow.instanced",
  // NOTIFICAÇÕES — drenadas para ARQUIVAR. Ver `TIPOS_SEM_EFEITO` acima: elas não
  // têm consumidor hoje, e é exatamente por isso que precisam ser drenadas.
  ...[
    "tarefa.generated", "tarefa.concluido_recebido", "financeiro.obrigacao.criada",
    "step.em_andamento", "step.disponivel", "step.bloqueado", "step.reaberto",
    "step.cancelado", "step.dispensado", "step.supersedido", "step.aguardando",
    "step.executado", "step.aguardando_aprovacao", "step.pendente",
  ],
  "requerente.adicionado",
  // MRG — reconciliação contínua: nova certidão / necessidade transicionada /
  // árvore alterada disparam revalidação fora do caminho crítico do upload.
  "registral.reconciliar.processo",
  // PROJEÇÃO FINANCEIRA DOCUMENTAL — a conclusão de um passo é o gatilho de
  // domínio já emitido transacionalmente por task-step-sync. O evento existia e
  // NINGUÉM o drenava: os `step.concluido` ficavam PENDENTE para sempre e o custo
  // do documento nunca era projetado. O filtro de "qual passo importa" é do
  // consumidor (identidade estrutural do passo), não da fila.
  "step.concluido",
] as const

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

    // GRANULARIDADE POR DOCUMENTO/SERVIÇO: reconcilia o motor econômico da Matriz
    // (cria por documento elegível + remove órfãos). Isolado/best-effort.
    try { await reconciliarEconomicoDoProcesso(payload.processId) }
    catch (e) { console.error("[outbox] reconcile econômico (matriz) falhou:", e) }

    // REAPROVEITAMENTO de trabalho antecipado: ao entrar numa fase, reconcilia (idempotente) as
    // Operações Antecipadas cujo destino é esta fase — reusa o trabalho oficial já feito, sem
    // duplicar (via adaptador do catálogo). Isolado/best-effort.
    try { await reconciliarOperacoesAntecipadas(payload.processId, payload.newPhaseKey) }
    catch (e) { console.error("[outbox] reconciliação de operação antecipada falhou:", e) }

    // F3 — CONSOLIDAÇÃO V3: espelha no motor V3 os Custos gerados pela fase (dual-write
    // idempotente, post-commit, best-effort). O V3 passa a ser a fonte lida pelas telas,
    // sem alterar a geração legada nem sua transação. Isolado: falha aqui não afeta a fase.
    try { await espelharCustosDoProcesso(payload.processId) }
    catch (e) { console.error("[outbox] espelho de custos no V3 falhou:", e) }
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
  const tipos = opts?.tipos ?? [...TIPOS_DRENADOS]

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
      } else if (evt.tipo === "requerente.adicionado") {
        // EFEITO: automações financeiras por requerente (trigger person_added). Idempotente
        // (MotorArtefato per-requerente). Uma falha transitória PROPAGA → evento volta a
        // PENDENTE e reprocessa. Pendência de preço/config NÃO é falha (fica registrada).
        const p = (evt.payload ?? {}) as Partial<EventoRequerentePayload>
        if (p.processoId && p.pessoaId) {
          await processarRequerenteAdicionado({ ...p, processoId: p.processoId, pessoaId: p.pessoaId })
        }
      } else if (evt.tipo === "registral.reconciliar.processo") {
        // EFEITO: reconciliar a Pasta Documental do processo com o que o motor
        // registral apurou e recalcular a linhagem. Idempotente e convergente:
        // reprocessar o mesmo evento não duplica proposta nem reabre necessidade
        // atendida. Uma falha transitória PROPAGA → o evento volta a PENDENTE.
        const p = (evt.payload ?? {}) as { processoId?: number; motivo?: string; usuarioId?: number | null }
        if (p.processoId) {
          const docs = await reconciliarDocumentalDoProcesso({
            processoId: p.processoId,
            usuarioId: p.usuarioId ?? null,
          })
          const linhagem = await recalcularLinhagem(p.processoId)
          if (linhagem) {
            await registrarRecalculo(
              p.processoId,
              p.usuarioId ?? null,
              `${linhagem.elegibilidade.resultado} · ${linhagem.inconsistencias.length} inconsistência(s) · ${docs.necessidadesAtendidas} necessidade(s) atendida(s) · motivo=${p.motivo ?? "-"}`,
            )
          }
        }
      } else if (evt.tipo === "step.concluido") {
        // EFEITO: projetar os custos documentais previstos do documento cujo
        // registro acabou de ser localizado. O serviço decide sozinho se ESTE
        // passo autoriza projeção (identidade estrutural do passo + régua oficial
        // de "localizado"); passo que não é registral sai como no-op silencioso —
        // e o evento é arquivado como ENVIADO, sem represar a fila.
        // Falha transitória PROPAGA → evento volta a PENDENTE e reprocessa
        // (idempotente pela chave única da obrigação).
        const p = (evt.payload ?? {}) as { stepId?: number }
        if (p.stepId) {
          await projetarCustosDocumentaisDoPasso(p.stepId, { correlationId: evt.correlationId })
        }
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
