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
import { supersederPassosDaInstanciaTx } from "@/src/services/task-step-sync"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import { calcularPendencias } from "@/src/lib/motor/blocking-engine"
import type { BlockingIssue } from "@/src/lib/motor/blocking-helpers"
import { instanciarWorkflowDaFase, type OrigemInstanciaStr } from "@/src/services/phase-workflow"
import { processarOutbox } from "@/src/services/outbox-dispatcher"
import { materializarExecucaoDaFase, type FonteMaterializacao } from "@/src/services/materializar-fase"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import {
  fotografarObrigacoes,
  compararObrigacoes,
  type ResultadoInvariantes,
} from "@/src/lib/motor/invariantes-obrigacoes"
import {
  type AdvanceOperacao,
  type AdvanceFailureCode,
  type AdvanceResultadoStr,
  resultadoDaOperacao,
  exigeJustificativa,
  montarChaveAdvance,
  montarChaveAdvanceBloqueio,
  proximaFaseAplicavel,
  faseAlvoEhAnterior,
  montarEventoEntered,
  montarEventoCompleted,
  type FaseOrdenada,
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

/** Movimentação MANUAL (Administrador Master) para qualquer fase do macro. */
export interface MoveInput extends AdvanceCtx {
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
  /** Passos instanciados na nova fase — as tarefas deles são geradas após o commit. */
  stepInstanceIds?: number[]
  /**
   * Estado da materialização da fase de destino. `null` só quando a operação
   * convergiu por idempotência (nada foi materializado nesta chamada).
   */
  materializacao?: {
    estado: string
    mensagemAdministrativa: string | null
    motivos: Array<{ code: string; message: string }>
    passos: number
    tarefasCriadas: number
  } | null
  /** Prova de que nenhuma obrigação de outra fase foi tocada. */
  obrigacoesPreservadas?: ResultadoInvariantes["resumo"] | null
  /** O que a transição fez com as tarefas da fase que saiu. */
  tarefasReconciliadas?: { encerradasSemCausa: number; aguardandoDecisao: number }
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
  fases: { phaseKey: string; ordem: number; conditional?: boolean }[]
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
    include: { fases: { orderBy: { ordem: "asc" }, select: { phaseKey: true, ordem: true, conditional: true } } },
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

/**
 * O ROTULO DE ORIGEM NUNCA PODE DERRUBAR UMA TRANSIÇÃO.
 *
 * `PhaseAdvanceLog.origem` é `VarChar(20)`. Quem chama o motor passa um rótulo para
 * a auditoria — "kanban-drag", "cron-reconciliacao", "comando:cancelar" — e um rótulo
 * comprido a mais fazia o INSERT do log estourar e a transação INTEIRA cair: o
 * processo deixava de avançar por causa do nome de quem pediu. Auditoria descreve o
 * fato; ela não pode impedi-lo. Aqui o rótulo é cortado no tamanho da coluna.
 */
function rotuloDeOrigem(v: string | undefined | null): string {
  return String(v ?? "advance").slice(0, 20)
}

interface Plano {
  operacao: AdvanceOperacao
  processoId: number
  faseAtual: string
  lockVersion: number
  faseDestino: string
  novaFaseAtualKey: string
  cicloAlvo: number
  origemInstancia: OrigemInstanciaStr
  /** Fonte declarada para o materializador oficial — a MESMA para todas as origens. */
  fonteMaterializacao: FonteMaterializacao
  /**
   * REFAZER O TRABALHO, em vez de reencontrá-lo.
   *
   * Entrar de novo numa fase preserva o que a visita anterior concluiu: voltar não
   * desfaz trabalho. REABRIR é a operação que existe justamente para pedir o
   * trabalho DE NOVO — e é a única que nasce do zero. Por isso a distinção é
   * explícita aqui, e não deduzida da origem da instância: `returnPhase` e
   * `reopenPhase` compartilham a origem REABERTURA e querem coisas opostas.
   */
  reexecutarDoZero?: boolean
  encerramento: "CONCLUIR" | "SUPERSEDER" | "NENHUM"
  eventoFaseTipo: "FASE_AVANCADA" | "FASE_AVANCADA_FORCADO" | "FASE_REABERTA" | "FASE_RETORNADA" | "FASE_MOVIDA"
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
    let invariantes: ResultadoInvariantes | null = null
    const out = await prisma.$transaction(async (tx) => {
      // 0) FOTOGRAFIA DAS OBRIGAÇÕES — antes de qualquer escrita.
      //    Mudar a fase do processo não pode concluir, cancelar, invalidar nem apagar
      //    obrigação de fase nenhuma. A conferência é feita ANTES do commit (passo 8):
      //    se alguma obrigação alheia mudou, a transição inteira volta atrás.
      const obrigacoesAntes = await fotografarObrigacoes(tx, p.processoId)

      // 1) encerrar/superseder a instância atual da fase de origem (histórico preservado)
      let previousInstanceId: number | null = null
      // SUPERSEDIDA, não apenas encerrada: quando a fase é CONCLUÍDA, os passos dela já
      // estão no desfecho deles e nada pode mudar de estado. A permissão do invariante
      // vale só para a supersessão, e por isso é uma variável separada.
      let instanciaSupersedidaId: number | null = null
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
          // A INSTÂNCIA MORREU; OS FILHOS DELA NÃO PODEM SEGUIR VIVOS.
          //
          // Superseder a instância e deixar os passos onde estavam produzia trabalho
          // fantasma: medido em produção, quatro passos DISPONIVEL/EM_ANDAMENTO dentro
          // de instâncias já supersedidas, três deles com tarefa na fila de alguém.
          //
          // Vai pela mesma máquina de estados de sempre — o que já está concluído
          // continua concluído, porque superseder um desfecho apagaria o que aconteceu.
          // E na MESMA transação: instância morta com filho vivo não pode existir nem
          // por um instante.
          if (!concluir) {
            instanciaSupersedidaId = atual.id
            await supersederPassosDaInstanciaTx(tx, atual.id, {
              correlationId: p.correlationId,
              causationId: chave,
              ciclo: p.cicloAlvo ?? 1,
              processoId: p.processoId,
              workflowInstanceId: atual.id,
            })
          }

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
          solicitadoPorId: p.solicitadoPorId, reexecutarDoZero: p.reexecutarDoZero === true,
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

      // 4) As Tarefas dos passos NÃO são geradas aqui dentro.
      // Uma fase operada por entidade instancia um passo por alvo: com N alvos, gerar
      // as tarefas na mesma transação do avanço multiplica escritas sem teto e estoura
      // o tempo da transação (P2028) — a fase não avançava justamente quando tinha
      // muito trabalho. A geração é idempotente e chaveada por passo, então roda logo
      // após o commit; se falhar, a reconciliação da fase a completa.
      const tarefasCriadas = 0

      // 4c) INVARIANTE DE DOMÍNIO — obrigações alheias intactas.
      //
      // A transição só pode ter: criado a instância de destino (e os passos dela) e
      // mudado o STATUS DO CICLO de origem. Nenhuma obrigação — passo ou tarefa — de
      // qualquer fase pode ter mudado de status, ganhado data de conclusão ou sumido.
      // Um ciclo SUPERSEDIDO continua contendo tarefas pendentes obrigatórias; a
      // supersessão diz que aquele ciclo deixou de ser a referência operacional, não
      // que o trabalho dele deixou de ser devido.
      const obrigacoesDepois = await fotografarObrigacoes(tx, p.processoId)
      invariantes = compararObrigacoes(obrigacoesAntes, obrigacoesDepois, {
        // A instância que acabou de ser supersedida pode ter levado os filhos vivos
        // junto — é a única mudança de estado que uma movimentação pode causar. Fase
        // CONCLUÍDA não entra aqui: `instanciaSupersedidaId` fica null.
        instanciaSupersedidaId,
        instanciaDestinoId: inst.workflowInstance.id,
        passosDoDestino: new Set(inst.stepInstances.map((s) => s.id)),
      })
      if (!invariantes.ok) {
        const err = new Error("INVARIANTE_OBRIGACOES") as Error & { __invariante?: ResultadoInvariantes }
        err.__invariante = invariantes
        throw err
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
          // `regrasAvaliadas` ganha o bloco `invariantes`: a auditoria passa a dizer,
          // com números, que nenhuma obrigação alheia mudou — e quantas pendências
          // cada fase tinha antes e depois.
          regrasAvaliadas: {
            regras: p.regrasAvaliadas,
            invariantes: {
              obrigacoesPreservadas: true,
              ...(invariantes as ResultadoInvariantes | null)?.resumo,
            },
          } as unknown as Prisma.InputJsonValue,
          pendencias: p.pendencias, warnings: p.warnings,
          resultado: resultadoEnum, origem: rotuloDeOrigem(p.origemLog), solicitadoPorId: p.solicitadoPorId ?? null,
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
        origem: rotuloDeOrigem(p.origemLog),
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
        stepInstanceIds: inst.stepInstances.map((si) => si.id),
      }
      return ok
    }, {
      // A transação do avanço cria a instância da próxima fase + passos + eventos +
      // logs + outbox. As tarefas saíram daqui (ver 4b) justamente porque escalam com
      // o número de alvos da fase. O default de 5000ms não cobre a latência do pool.
      timeout: 20000,
      maxWait: 15000,
    })
    // 4b) MATERIALIZAÇÃO DA FASE DE DESTINO — serviço OFICIAL ÚNICO.
    //
    // Antes, cada origem gerava as tarefas do seu jeito aqui dentro. É por isso que
    // avanço automático e movimentação manual podiam terminar em estados diferentes.
    // Agora toda origem chama `materializarExecucaoDaFase`, que converge o que faltar
    // (passos e tarefas), é idempotente e devolve o MOTIVO quando não materializa nada.
    // Roda fora da transação porque escala com o número de alvos da fase (ver 4).
    if (out.success && out.changed && out.workflowInstanceId != null) {
      try {
        const mat = await materializarExecucaoDaFase({
          processoId: p.processoId,
          phaseInstanceId: out.workflowInstanceId,
          fonte: p.fonteMaterializacao,
          solicitadoPorId: p.solicitadoPorId,
          correlationId: p.correlationId,
          causationId: chave,
        })
        out.tarefasCriadas += mat.tarefasCriadas
        out.materializacao = {
          estado: mat.estado,
          mensagemAdministrativa: mat.mensagemAdministrativa,
          motivos: mat.motivos.map((m) => ({ code: m.code, message: m.message })),
          passos: mat.passosTotais,
          tarefasCriadas: mat.tarefasCriadas,
        }
      } catch (e) {
        console.error(`[avanço de fase] materialização da fase de destino falhou (proc ${p.processoId}); reconciliação completará:`, e)
        out.materializacao = {
          estado: "ERRO",
          mensagemAdministrativa: "A fase mudou, mas a materialização da fase de destino falhou. Use o reparo da fase para completá-la.",
          motivos: [{ code: "MATERIALIZACAO_POS_COMMIT_FALHOU", message: e instanceof Error ? e.message : String(e) }],
          passos: out.stepInstanceIds?.length ?? 0,
          tarefasCriadas: 0,
        }
      }
    }
    // 4c) RECONCILIAÇÃO DA FASE DE ORIGEM — o outro lado da mesma transição.
    //
    // Mudar de fase SUPERSEDE a instância da fase anterior (passo 1). O que faltava
    // era o efeito disso sobre as TAREFAS que projetavam aquela instância: elas
    // continuavam na fila de alguém, com um passo de um workflow que o próprio motor
    // acabara de declarar superado.
    //
    // Foi assim que o processo 523 do Ademir ficou com DUAS linhas do mesmo trabalho:
    // a viva, da Emissão Documental, e a residual, da Genealogia supersedida. Não era
    // duplicidade de identidade — era a fila sem saber que uma delas tinha acabado.
    //
    // O reconciliador já sabia o que fazer, e faz com cuidado: tarefa nunca iniciada é
    // cancelada; tarefa em que ALGUÉM JÁ TRABALHOU não é cancelada por máquina — fica
    // marcada como "causa removida" e espera decisão de quem pode tomá-la. Aqui só se
    // liga a causa ao efeito.
    //
    // Best-effort e fora da transação, como a materialização: uma falha aqui não desfaz
    // o avanço, e a reconciliação periódica completa depois.
    if (out.success && out.changed) {
      try {
        const rec = await reconciliarTarefas({ processoId: p.processoId })
        out.tarefasReconciliadas = {
          encerradasSemCausa: rec.tarefasEncerradasSemCausa,
          aguardandoDecisao: rec.tarefasAguardandoDecisao,
        }
      } catch (e) {
        console.error(`[avanço de fase] reconciliação da fase de origem falhou (proc ${p.processoId}); a periódica completa:`, e)
      }
    }

    if (out.success) out.obrigacoesPreservadas = (invariantes as ResultadoInvariantes | null)?.resumo ?? null

    // Drena o phase.entered recém-emitido: os EFEITOS ADICIONAIS da nova fase (automações
    // FINANCEIRAS → lançamentos) rodam ao AVANÇAR, não só na criação do processo. Best-effort:
    // uma falha aqui não desfaz o avanço (o evento fica PENDENTE e é reprocessável).
    if (out.success && out.changed) {
      try { await processarOutbox({ tipos: ["phase.entered"], limite: 20 }) }
      catch (e) { console.error("[advance] drenar outbox phase.entered falhou (avanço ok):", e) }
    }
    return out
  } catch (e) {
    const err = e as { __conflito?: boolean; __instFail?: string; code?: string; __invariante?: ResultadoInvariantes }
    // INVARIANTE quebrado: a transição mexeu em obrigação que não era dela. A
    // transação já sofreu rollback (nada foi commitado); aqui só se explica o motivo.
    // Este caminho é uma trava de segurança: se ele disparar, há um efeito colateral
    // no domínio que precisa ser removido — não um erro de operação do usuário.
    if (err.__invariante) {
      const v = err.__invariante.violacoes.slice(0, 5)
      console.error(
        `[mudança de fase] INVARIANTE DE OBRIGAÇÕES violado (proc ${p.processoId}, ${p.correlationId}) — rollback integral:`,
        JSON.stringify(err.__invariante.violacoes),
      )
      return {
        success: false, resultado: "REJEITADO", code: "INVARIANTE_OBRIGACOES",
        message:
          "A mudança de fase foi desfeita: ela alteraria obrigações de outras fases " +
          `(${err.__invariante.violacoes.length} ocorrência(s), ex.: ${v.map((x) => `${x.chave} ${x.de ?? "—"}→${x.para ?? "removida"}`).join("; ")}). ` +
          "Mover o processo altera apenas a fase operacional de referência.",
        correlationId: p.correlationId,
      }
    }
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

/**
 * Próxima fase respeitando o DESVIO CONDICIONAL. Fases marcadas como CONDICIONAIS no macro
 * (FaseMacro.conditional — fonte canônica, ex.: "retificacao" e "emissao_documental_
 * retificada") só entram no caminho quando sua condição se aplica. Hoje a única condição é
 * a decisão da Análise: requerRetificacao === true entra nas fases condicionais; caso
 * contrário (false/indefinido) elas são PULADAS, indo direto p/ a próxima aplicável.
 */
async function proximaFaseComCondicional(processoId: number, fases: FaseOrdenada[], faseAtual: string): Promise<string | null> {
  const temCondicional = fases.some((f) => f.conditional)
  if (!temCondicional) return proximaFaseAplicavel(fases, faseAtual, () => true)

  const analise = await prisma.analiseDocumental.findUnique({
    where: { processoId },
    select: { requerRetificacao: true },
  }).catch(() => null)
  const requerRetificacao = analise?.requerRetificacao === true
  const condicionais = new Set(fases.filter((f) => f.conditional).map((f) => f.phaseKey))
  const ehAplicavel = (phaseKey: string): boolean =>
    condicionais.has(phaseKey) ? requerRetificacao : true
  return proximaFaseAplicavel(fases, faseAtual, ehAplicavel)
}

/** Avanço NORMAL: só avança com zero pendências BLOCKING. Transação atômica. */
export async function advance(processoId: number, ctx: AdvanceCtx = {}): Promise<AdvanceResult> {
  const ctxOuErr = await carregarContexto(processoId)
  if ("success" in ctxOuErr) return ctxOuErr
  const c = ctxOuErr
  const correlationId = ctx.correlationId ?? randomUUID()

  const proxima = await proximaFaseComCondicional(processoId, c.fases, c.processo.faseAtual)
  if (!proxima) {
    return { success: false, resultado: "REJEITADO", code: "SEM_PROXIMA_FASE", message: "Não há próxima fase (última fase do macro)", faseAtual: c.processo.faseAtual, correlationId }
  }

  // GATE canônico: decide pelo `canAdvance` da FUNÇÃO-BASE ÚNICA (computeGate), a MESMA
  // consumida pela OperationalProjection. Sem cálculo paralelo — calcularPendencias é só
  // o adaptador que carrega o snapshot e delega ao gate compartilhado; `blocking` é usado
  // apenas para a auditoria da tentativa.
  const snap = await snapshotPendencias(processoId, c.processo.faseAtual, correlationId)
  if (!snap.pend.canAdvance) {
    // AUDITORIA DA TENTATIVA BLOQUEADA — uma por correlação, sem mutação de estado.
    //
    // `createMany` com `skipDuplicates` em vez de `create`: a reconciliação
    // convergente pergunta de novo, de hora em hora, com a MESMA correlação por
    // posição — e a segunda pergunta não é um erro a engolir, é a mesma tentativa.
    // Com `create` cada repetição levantava violação de unicidade e enchia o log de
    // erro do runtime com uma falha que não existe.
    const dadosBloqueio: { data: Prisma.PhaseAdvanceLogCreateManyInput } = {
      data: {
        processoId, faseAtual: c.processo.faseAtual, fasePretendida: proxima,
        policy: "ALL_REQUIRED_COMPLETED", regrasAvaliadas: snap.regrasAvaliadas,
        pendencias: snap.pendencias, warnings: snap.warnings, resultado: "BLOQUEADO",
        origem: rotuloDeOrigem(ctx.origem), solicitadoPorId: ctx.solicitadoPorId ?? null,
        forcado: false, correlationId, causationId: ctx.causationId ?? null,
        chaveIdempotencia: montarChaveAdvanceBloqueio({ processoId, operacao: "AVANCAR", faseAtual: c.processo.faseAtual, correlationId }),
      },
    }
    await prisma.phaseAdvanceLog.createMany({ data: [dadosBloqueio.data], skipDuplicates: true }).catch(() => null)
    const log = await prisma.phaseAdvanceLog
      .findUnique({ where: { chaveIdempotencia: dadosBloqueio.data.chaveIdempotencia }, select: { id: true } })
      .catch(() => null)
    return {
      success: false, resultado: "BLOQUEADO", code: "BLOQUEADO",
      message: "Avanço bloqueado por pendências obrigatórias",
      blockingIssues: snap.pend.blocking, warnings: snap.pend.warnings,
      faseAtual: c.processo.faseAtual, correlationId, logId: log?.id ?? null,
    }
  }

  // CICLO ALVO da fase destino = próximo ciclo REAL (não 1 fixo). Após um returnPhase que
  // criou um novo ciclo, a fase destino pode já ter uma instância ciclo-1 CONCLUÍDA; usar
  // ciclo 1 reusaria a instância morta (fase vira no-op que passa sozinha). proximoCiclo
  // devolve 1 na 1ª passagem e o próximo ciclo após reabertura/retorno — igual a reopen/return.
  const cicloAlvo = await proximoCiclo(processoId, proxima)
  return executarPlano({
    operacao: "AVANCAR", processoId, faseAtual: c.processo.faseAtual, lockVersion: c.processo.lockVersion,
    faseDestino: proxima, novaFaseAtualKey: proxima, cicloAlvo, origemInstancia: "MOTOR",
    fonteMaterializacao: "AVANCO_AUTOMATICO",
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

  const proxima = await proximaFaseComCondicional(processoId, c.fases, c.processo.faseAtual)
  if (!proxima) {
    return { success: false, resultado: "REJEITADO", code: "SEM_PROXIMA_FASE", message: "Não há próxima fase (última fase do macro)", faseAtual: c.processo.faseAtual, correlationId }
  }

  // pendências são apenas SNAPSHOT para auditoria (ignoradas no forçado)
  const snap = await snapshotPendencias(processoId, c.processo.faseAtual, correlationId)

  // ciclo alvo = próximo ciclo REAL da fase destino (ver advance) — evita reusar instância
  // CONCLUÍDA de ciclo anterior após retorno de fase.
  const cicloAlvo = await proximoCiclo(processoId, proxima)
  return executarPlano({
    operacao: "FORCAR", processoId, faseAtual: c.processo.faseAtual, lockVersion: c.processo.lockVersion,
    faseDestino: proxima, novaFaseAtualKey: proxima, cicloAlvo, origemInstancia: "MOTOR",
    fonteMaterializacao: "AVANCO_FORCADO",
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
    origemInstancia: "REABERTURA", fonteMaterializacao: "REABERTURA",
    // A ÚNICA operação que refaz: reabrir é pedir o trabalho de novo.
    reexecutarDoZero: true,
    encerramento: "SUPERSEDER", eventoFaseTipo: "FASE_REABERTA",
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
    origemInstancia: "REABERTURA", fonteMaterializacao: "RETORNO_CONTROLADO",
    encerramento: "SUPERSEDER", eventoFaseTipo: "FASE_RETORNADA",
    correlationId, causationId: input.causationId ?? null, solicitadoPorId: input.solicitadoPorId,
    forcado: false, justificativa: input.justificativa, motivoCodigo: input.motivoCodigo,
    origemLog: input.origem ?? "return", regrasAvaliadas: snap.regrasAvaliadas,
    pendencias: snap.pendencias, warnings: snap.warnings,
  })
}


// --------------------------------------------------------------------------
// MOVIMENTAÇÃO MANUAL — Administrador Master
// --------------------------------------------------------------------------

/**
 * Reposiciona a fase atual do processo para QUALQUER fase do macro workflow —
 * anterior, posterior ou intermediária — SEM executar as validações do fluxo
 * automático.
 *
 * O QUE ELA FAZ: só reposiciona. A instância da fase de origem é SUPERSEDIDA (nunca
 * concluída: nada foi concluído), e a fase de destino ganha um NOVO CICLO. Tudo o que
 * existe continua existindo — passos, tarefas, eventos, instâncias e logs das demais
 * fases não são tocados, e o histórico da fase de origem fica preservado no ciclo
 * dela. Nada é apagado, recalculado ou reescrito.
 *
 * O QUE ELA NÃO FAZ: não consulta o gate, não avalia pendências para DECIDIR. As
 * pendências da fase de origem ainda são fotografadas para o log — o registro precisa
 * dizer em que estado o processo estava quando foi movido, mesmo que esse estado não
 * tenha impedido nada.
 *
 * AUTORIZAÇÃO é da rota, por permissão EXCLUSIVA (`processos.moverFaseManual`), nunca
 * por `tipo = 'admin'`. Funcionário não move processo.
 */
export async function movePhaseManual(processoId: number, input: MoveInput): Promise<AdvanceResult> {
  const ctxOuErr = await carregarContexto(processoId)
  if ("success" in ctxOuErr) return ctxOuErr
  const c = ctxOuErr
  const correlationId = input.correlationId ?? randomUUID()

  const faseAlvo = (input.faseAlvo ?? "").trim()
  if (!faseAlvo) {
    return { success: false, resultado: "REJEITADO", code: "FASE_ALVO_INVALIDA", message: "Informe a fase-alvo da movimentação", correlationId }
  }
  // A fase-alvo tem de existir NO MACRO DESTE PROCESSO. Aceitar uma chave qualquer
  // deixaria o processo numa fase que o workflow dele não conhece.
  if (!c.fases.some((f) => f.phaseKey === faseAlvo)) {
    return { success: false, resultado: "REJEITADO", code: "FASE_ALVO_INVALIDA", message: "Fase-alvo inexistente no macro do processo", correlationId }
  }
  if (faseAlvo === c.processo.faseAtual) {
    return {
      success: false, resultado: "REJEITADO", code: "FASE_ALVO_INVALIDA",
      message: "O processo já está nesta fase. Para reiniciar o ciclo da fase atual, use a reabertura.",
      faseAtual: c.processo.faseAtual, correlationId,
    }
  }
  if (!input.justificativa || !input.justificativa.trim()) {
    return { success: false, resultado: "REJEITADO", code: "JUSTIFICATIVA_OBRIGATORIA", message: "Movimentação manual exige justificativa", correlationId }
  }
  if (!input.motivoCodigo || !input.motivoCodigo.trim()) {
    return { success: false, resultado: "REJEITADO", code: "MOTIVO_OBRIGATORIO", message: "Movimentação manual exige código de motivo", correlationId }
  }

  const cicloAlvo = await proximoCiclo(processoId, faseAlvo)
  // As pendências entram no log como FOTOGRAFIA do estado, não como decisão: a
  // movimentação manual não é gateada por elas. Sem isso, o registro não diria de
  // onde o processo saiu.
  const snap = await snapshotPendencias(processoId, c.processo.faseAtual, correlationId)

  return executarPlano({
    operacao: "MOVER", processoId, faseAtual: c.processo.faseAtual, lockVersion: c.processo.lockVersion,
    faseDestino: faseAlvo, novaFaseAtualKey: faseAlvo, cicloAlvo,
    // SUPERSEDER, nunca CONCLUIR: mover não conclui a fase de origem. Marcá-la como
    // concluída faria o histórico afirmar um trabalho que não aconteceu.
    origemInstancia: "MANUAL", fonteMaterializacao: "MOVIMENTACAO_MANUAL",
    encerramento: "SUPERSEDER", eventoFaseTipo: "FASE_MOVIDA",
    correlationId, causationId: input.causationId ?? null, solicitadoPorId: input.solicitadoPorId,
    // `forcado` continua sendo especificamente "o gate barrou e foi sobreposto".
    // Aqui o gate nem foi consultado — o fato é outro, e quem o nomeia é `resultado`.
    forcado: false, justificativa: input.justificativa, motivoCodigo: input.motivoCodigo,
    origemLog: input.origem ?? "mover-manual", regrasAvaliadas: snap.regrasAvaliadas,
    pendencias: snap.pendencias, warnings: snap.warnings,
  })
}
