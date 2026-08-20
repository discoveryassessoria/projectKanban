// src/services/versao-publicada.ts
// ============================================================================
// A VERSÃO PUBLICADA DE UM WORKFLOW INTERNO — congelar e ler.
//
// ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────────
// `PhaseWorkflowInstance` sempre gravou `workflowDefinitionId` + `workflowVersion`:
// o vínculo com a versão já existia. O que não existia era o CONTEÚDO dela.
// `PhaseInternalWorkflow.versao` nunca era incrementada, e a edição apagava e
// recriava os passos — de modo que uma execução iniciada semana passada passava a
// ser lida pela configuração de hoje, sem que nada no dado registrasse a troca.
//
// Não é um risco teórico: `politicaDeSla` decidia se o relógio de uma tarefa EM
// ANDAMENTO pausa lendo a definição VIVA. Marcar "pausar na espera externa" hoje
// mudava o prazo de tarefas que começaram sob a regra anterior.
//
// ─── O QUE ESTE MÓDULO FAZ ──────────────────────────────────────────────────
// CONGELAR: copia o conteúdo da definição para `PhaseInternalWorkflowVersao` no
// momento em que a versão passa a valer. A identidade é o par que a instância já
// guarda — `(workflowId, versao)` —, e é por isso que nenhuma coluna nova nasceu na
// instância: o ponteiro existia; faltava o alvo.
//
// LER: devolve o que a versão dizia, não o que a definição diz agora.
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
// Não atualiza versão congelada — nada no runtime escreve numa linha destas depois
// de criada. Não migra processo de versão. Não decide qual versão vale: quem decide
// é a instância, que já registrou a sua no dia em que materializou.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

type DB = Prisma.TransactionClient | typeof prisma

/** Origem de uma versão congelada. Descreve POR QUE ela nasceu. */
export type OrigemVersao = "CRIACAO" | "PUBLICACAO" | "BACKFILL"

/** Um passo como ele estava quando a versão foi congelada. */
export interface PassoCongelado {
  key: string
  label: string
  description: string | null
  ordem: number
  createsTask: boolean
  required: boolean
  owner: string | null
  priority: string
  slaDays: number
  cardinalidade: string | null
  completionRule: string | null
  checklist: unknown
  versao: number
}

export interface VersaoPublicada {
  workflowId: number
  versao: number
  phaseKey: string
  tipoProcessoId: number | null
  name: string
  execucao: string
  escopoExecucao: string | null
  familiaDocumentalId: number | null
  exigeDocumento: boolean
  exigePessoa: boolean
  pausarSlaEmEsperaExterna: boolean
  pausarSlaEmBloqueio: boolean
  passos: PassoCongelado[]
  congeladoEm: Date
  origem: string
}

/**
 * CONGELA a versão vigente de um workflow, se ela ainda não estiver congelada.
 *
 * Idempotente por construção: a chave `(workflowId, versao)` é única e o congelamento
 * usa `skipDuplicates`. Chamar duas vezes não cria duas linhas nem reescreve a
 * primeira — e não poderia: uma versão congelada é um fato passado.
 *
 * Devolve `true` quando esta chamada foi a que congelou.
 */
export async function congelarVersaoVigente(
  workflowId: number,
  origem: OrigemVersao,
  db: DB = prisma,
  congeladoPorId?: number | null,
): Promise<boolean> {
  const wf = await db.phaseInternalWorkflow.findUnique({
    where: { id: workflowId },
    include: { passos: { orderBy: { ordem: "asc" } } },
  })
  if (!wf) return false

  const jaCongelada = await db.phaseInternalWorkflowVersao.findUnique({
    where: { workflowId_versao: { workflowId, versao: wf.versao } },
    select: { id: true },
  })
  if (jaCongelada) return false

  const passos: PassoCongelado[] = wf.passos.map((p) => ({
    key: p.key, label: p.label, description: p.description, ordem: p.ordem,
    createsTask: p.createsTask, required: p.required, owner: p.owner,
    priority: p.priority, slaDays: p.slaDays, cardinalidade: p.cardinalidade,
    completionRule: p.completionRule, checklist: p.checklist ?? null, versao: p.versao,
  }))

  const r = await db.phaseInternalWorkflowVersao.createMany({
    data: [{
      workflowId, versao: wf.versao, phaseKey: wf.phaseKey, tipoProcessoId: wf.tipoProcessoId,
      name: wf.name, execucao: wf.execucao, escopoExecucao: wf.escopoExecucao,
      familiaDocumentalId: wf.familiaDocumentalId, exigeDocumento: wf.exigeDocumento,
      exigePessoa: wf.exigePessoa, pausarSlaEmEsperaExterna: wf.pausarSlaEmEsperaExterna,
      pausarSlaEmBloqueio: wf.pausarSlaEmBloqueio,
      passos: passos as unknown as Prisma.InputJsonValue,
      congeladoPorId: congeladoPorId ?? null, origem,
    }],
    skipDuplicates: true,
  })
  return r.count > 0
}

/**
 * PUBLICA UMA NOVA VERSÃO: congela a vigente e incrementa o número.
 *
 * A ordem importa e é o coração do gate. Congelar ANTES de alterar é o que preserva
 * o que a versão anterior dizia; incrementar DEPOIS é o que faz as instâncias novas
 * nascerem apontando para outra coisa. Quem já estava em execução continua com o
 * número que registrou — e agora esse número tem conteúdo.
 *
 * Devolve o número da versão NOVA. O chamador aplica a edição na mesma transação,
 * entre o congelamento e o incremento não há janela: tudo é uma transação só.
 */
export async function publicarNovaVersao(
  workflowId: number,
  db: DB = prisma,
  congeladoPorId?: number | null,
): Promise<{ anterior: number; nova: number }> {
  await congelarVersaoVigente(workflowId, "PUBLICACAO", db, congeladoPorId)
  const wf = await db.phaseInternalWorkflow.update({
    where: { id: workflowId },
    data: { versao: { increment: 1 } },
    select: { versao: true },
  })
  return { anterior: wf.versao - 1, nova: wf.versao }
}

/**
 * O QUE A VERSÃO DIZIA. `null` quando aquela versão nunca foi congelada — caso que
 * o chamador precisa tratar explicitamente em vez de cair na definição viva, que é
 * exatamente o erro que este módulo existe para impedir.
 */
export async function lerVersaoPublicada(
  workflowId: number,
  versao: number,
  db: DB = prisma,
): Promise<VersaoPublicada | null> {
  const v = await db.phaseInternalWorkflowVersao.findUnique({
    where: { workflowId_versao: { workflowId, versao } },
  })
  if (!v) return null
  return {
    workflowId: v.workflowId, versao: v.versao, phaseKey: v.phaseKey,
    tipoProcessoId: v.tipoProcessoId, name: v.name, execucao: v.execucao,
    escopoExecucao: v.escopoExecucao, familiaDocumentalId: v.familiaDocumentalId,
    exigeDocumento: v.exigeDocumento, exigePessoa: v.exigePessoa,
    pausarSlaEmEsperaExterna: v.pausarSlaEmEsperaExterna,
    pausarSlaEmBloqueio: v.pausarSlaEmBloqueio,
    passos: (v.passos as unknown as PassoCongelado[]) ?? [],
    congeladoEm: v.congeladoEm, origem: v.origem,
  }
}

/**
 * A VERSÃO DE UMA INSTÂNCIA EM EXECUÇÃO — o atalho que os consumidores usam.
 *
 * Resolve pelo par que a instância já guarda. Devolve `null` se a instância não
 * registrou versão (dado anterior ao versionamento) ou se a versão não foi
 * congelada: nos dois casos, quem chama decide o que fazer, e a decisão fica visível
 * no código do chamador em vez de virar um fallback silencioso aqui.
 */
export async function versaoDaInstancia(
  workflowInstanceId: number,
  db: DB = prisma,
): Promise<VersaoPublicada | null> {
  const inst = await db.phaseWorkflowInstance.findUnique({
    where: { id: workflowInstanceId },
    select: { workflowDefinitionId: true, workflowVersion: true },
  })
  if (!inst?.workflowDefinitionId || inst.workflowVersion == null) return null
  return lerVersaoPublicada(inst.workflowDefinitionId, inst.workflowVersion, db)
}
