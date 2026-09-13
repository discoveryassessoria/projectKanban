// lib/operacional/sla-pausa.ts
// ============================================================================
// O RELÓGIO DO PRAZO — pausa e retomada, num lugar só.
//
// Extraído de `tarefa-ciclo.ts` para ser importável tanto por ela quanto por
// `task-step-sync.ts` sem criar dependência circular entre os dois (o primeiro
// já importa o segundo, para `reabrirPassoTx`). As DUAS portas de
// bloqueio/espera que o sistema tem hoje — a de `tarefa-ciclo.ts` (tarefa sem
// passo vinculado a workflow V2, usada por `/api/tarefas/{id}/comando`) e a de
// `task-step-sync.ts` (a máquina canônica de passo, usada por
// `PAUSE_FOR_EXTERNAL_WAIT`/`RESUME` do `CATALOGO_DE_EFEITOS`) — devem pausar o
// MESMO relógio da MESMA forma. Duas implementações de "pausar" seria a mesma
// classe de dívida já registrada no projeto para "criar tarefa" (doc 25, Parte
// 9): convergem no dado, divergem no comportamento.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { versaoDaInstancia } from '@/src/services/versao-publicada'

export type LeitorSla = Prisma.TransactionClient | typeof prisma

/**
 * A POLÍTICA DE PAUSA vem do workflow publicado, nunca do código.
 *
 * Sem workflow (tarefa manual), o padrão é NÃO pausar: prazo que para sozinho
 * é prazo que ninguém cobra.
 *
 * `db` recebe a MESMA conexão de quem chama — dentro de uma `$transaction`, é
 * a `tx`, nunca o `prisma` global (invariante transação×conexão). Sem
 * parâmetro, cai no `prisma` global — só é seguro fora de uma transação.
 */
export async function politicaDeSla(workflowInstanceId: number | null, db: LeitorSla = prisma): Promise<{ pausaEspera: boolean; pausaBloqueio: boolean }> {
  if (workflowInstanceId == null) return { pausaEspera: false, pausaBloqueio: false }

  // A POLÍTICA É A DA VERSÃO QUE A EXECUÇÃO REGISTROU, não a de hoje.
  //
  // Esta leitura decide se o relógio de uma tarefa EM ANDAMENTO pausa. Enquanto ela
  // consultava a definição VIVA, marcar "pausar na espera externa" no cadastro
  // mudava o prazo de tarefas que tinham começado sob a regra anterior — a
  // configuração nova reinterpretando execução antiga, em silêncio.
  const daVersao = await versaoDaInstancia(workflowInstanceId, db)
  if (daVersao) {
    return { pausaEspera: daVersao.pausarSlaEmEsperaExterna, pausaBloqueio: daVersao.pausarSlaEmBloqueio }
  }

  // SEM VERSÃO CONGELADA — instância anterior ao versionamento. Ler a definição viva
  // aqui é o comportamento antigo, mantido de propósito: o alternativo seria mudar o
  // SLA dessas tarefas para "nunca pausa", o que também seria reinterpretar o
  // passado, só que na direção contrária. O backfill da V1 esvazia este caminho.
  const inst = await db.phaseWorkflowInstance.findUnique({
    where: { id: workflowInstanceId },
    select: { workflowDefinitionId: true },
  })
  if (!inst?.workflowDefinitionId) return { pausaEspera: false, pausaBloqueio: false }
  const def = await db.phaseInternalWorkflow.findUnique({
    where: { id: inst.workflowDefinitionId },
    select: { pausarSlaEmEsperaExterna: true, pausarSlaEmBloqueio: true },
  })
  return { pausaEspera: !!def?.pausarSlaEmEsperaExterna, pausaBloqueio: !!def?.pausarSlaEmBloqueio }
}

/**
 * PAUSA o relógio do prazo.
 *
 * O prazo NÃO é reescrito enquanto a pausa dura — ele é empurrado quando ela
 * termina, pelo tempo exato que passou. Mexer no `dataPrazo` no início da pausa
 * significaria adivinhar quanto o cartório vai demorar. Idempotente: se já
 * está pausada (`slaPausadoEm` não-nulo), não faz nada — repetir a pausa não
 * pode reiniciar a contagem acumulada.
 */
export async function pausarSla(tx: Prisma.TransactionClient, tarefaId: number, agora: Date) {
  await tx.tarefa.updateMany({ where: { id: tarefaId, slaPausadoEm: null }, data: { slaPausadoEm: agora } })
}

/**
 * RETOMA o relógio do prazo, empurrando `dataPrazo` pelo tempo pausado.
 *
 * Idempotente: se não está pausada, não faz nada e devolve 0 — chamar retomada
 * sobre uma tarefa que nunca pausou (ex.: política de pausa desligada) é
 * seguro por desenho.
 */
export async function retomarSla(tx: Prisma.TransactionClient, tarefaId: number, agora: Date): Promise<number> {
  const t = await tx.tarefa.findUnique({ where: { id: tarefaId }, select: { slaPausadoEm: true, dataPrazo: true, slaPausaAcumuladaMin: true } })
  if (!t?.slaPausadoEm) return 0
  const minutos = Math.max(0, Math.round((agora.getTime() - t.slaPausadoEm.getTime()) / 60000))
  const novoPrazo = t.dataPrazo ? new Date(t.dataPrazo.getTime() + minutos * 60000) : null
  await tx.tarefa.update({
    where: { id: tarefaId },
    data: { slaPausadoEm: null, slaPausaAcumuladaMin: t.slaPausaAcumuladaMin + minutos, ...(novoPrazo ? { dataPrazo: novoPrazo } : {}) },
  })
  return minutos
}
