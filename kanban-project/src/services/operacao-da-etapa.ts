// src/services/operacao-da-etapa.ts
// ============================================================================
// A OPERAÇÃO DE UMA ETAPA — o que se preencheu, e em qual execução.
//
// ─── O CONTRATO, RESOLVIDO ──────────────────────────────────────────────────
// "Operation" nunca foi uma máquina de estados neste sistema — e ainda bem, porque
// duas máquinas para o mesmo passo seria o defeito, não a solução. Ela sempre foi
// PAYLOAD OPERACIONAL: canal usado, protocolo, código de rastreio, checklist,
// contatos com o cartório, quem concluiu.
//
// O problema era ONDE esse payload morava: em `PhaseWorkflowStepInstance.metadata.operacao`,
// um blob na linha do PASSO. A linha do passo é a OBRIGAÇÃO, e obrigação é uma só;
// as tentativas de cumpri-la são muitas. Guardar ali o que foi preenchido significava
// que reexecutar sobrescrevia o preenchimento anterior — o mesmo defeito do
// `completedAt`, numa camada acima.
//
//   OBRIGAÇÃO  = PhaseWorkflowStepInstance   ("executar isto, para esta certidão")
//   TENTATIVA  = StepExecution               ("a vez em que se tentou")
//   OPERAÇÃO   = StepExecution.payload       ("o que se preencheu naquela vez")
//
// A operação é da TENTATIVA. Sempre foi, conceitualmente; agora é no dado.
//
// ─── COMO A TROCA FOI FEITA ─────────────────────────────────────────────────
// Leitura DUPLA primeiro (tentativa, e o blob antigo quando a tentativa ainda não
// tem nada), backfill depois, escrita só na tentativa por último. Em nenhum instante
// houve uma janela em que o andamento de uma etapa não pudesse ser lido.
//
// `metadata.operacao` continua sendo ESCRITO enquanto houver leitor legado fora
// deste módulo — mas ele deixou de ser a fonte: quem responde é a tentativa. A
// verificação de saúde OPE-001 acusa divergência entre os dois.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { tentativaVigente, tentativasDoPasso, garantirTentativa, MOTIVOS_DE_TENTATIVA } from "@/src/services/execucao-do-passo"

type DB = Prisma.TransactionClient | typeof prisma

/** O payload operacional — chaves livres, porque o que cada etapa coleta é do cadastro. */
export type PayloadOperacional = Record<string, unknown>

/** Campos que a TENTATIVA governa e que não fazem parte do payload livre. */
const RESERVADAS = new Set(["acao", "efeito", "versaoDaConfiguracao", "decididoEm", "detalhes"])

function limpar(p: unknown): PayloadOperacional {
  if (!p || typeof p !== "object" || Array.isArray(p)) return {}
  return Object.fromEntries(Object.entries(p as PayloadOperacional).filter(([k]) => !RESERVADAS.has(k)))
}

/**
 * A OPERAÇÃO DA EXECUÇÃO ATUAL desta etapa.
 *
 * Lê da tentativa vigente. Cai no blob antigo apenas quando a tentativa ainda não
 * carrega nada — dado anterior ao backfill. Não é um caminho paralelo permanente:
 * é o que impede uma etapa antiga de aparecer vazia enquanto a migração acontece.
 */
export async function lerOperacao(
  stepInstanceId: number,
  db: DB = prisma,
): Promise<{ payload: PayloadOperacional; daTentativa: boolean; tentativaId: number | null; sequencia: number | null }> {
  const vigente = await tentativaVigente(stepInstanceId, db)
  const doPayload = limpar(vigente?.payload)
  if (Object.keys(doPayload).length > 0) {
    return { payload: doPayload, daTentativa: true, tentativaId: vigente!.id, sequencia: vigente!.sequencia }
  }
  const passo = await db.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId }, select: { metadata: true },
  })
  const antigo = ((passo?.metadata ?? {}) as { operacao?: PayloadOperacional }).operacao ?? {}
  return { payload: limpar(antigo), daTentativa: false, tentativaId: vigente?.id ?? null, sequencia: vigente?.sequencia ?? null }
}

/**
 * GRAVA NA EXECUÇÃO ATUAL. Mescla com o que já estava lá — a operação é preenchida
 * aos poucos, e um PATCH parcial não pode apagar o que outro campo já registrou.
 *
 * Cria a tentativa se ela não existir: uma etapa tocada sem tentativa é justamente o
 * que a verificação EXE-002 acusa, e aqui não faz sentido produzir uma.
 */
export async function gravarOperacao(
  stepInstanceId: number,
  patch: PayloadOperacional,
  db: DB = prisma,
): Promise<PayloadOperacional> {
  const passo = await db.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId }, select: { status: true, startedAt: true, completedAt: true },
  })
  if (!passo) return {}
  await garantirTentativa(stepInstanceId, {
    motivo: MOTIVOS_DE_TENTATIVA.BACKFILL, status: passo.status,
    startedAt: passo.startedAt, completedAt: passo.completedAt,
  }, db)
  const vigente = (await tentativaVigente(stepInstanceId, db))!
  const anterior = (vigente.payload ?? {}) as PayloadOperacional
  const merge: PayloadOperacional = { ...anterior }
  for (const [k, v] of Object.entries(patch)) if (!RESERVADAS.has(k)) merge[k] = v
  await db.stepExecution.update({
    where: { id: vigente.id },
    data: { payload: merge as Prisma.InputJsonValue },
  })
  return limpar(merge)
}

/**
 * A OPERAÇÃO DE CADA EXECUÇÃO — atual e anteriores, distinguíveis.
 *
 * É a resposta que o blob nunca pôde dar: "o que foi preenchido na primeira vez que
 * esta etapa foi executada?".
 */
export async function historicoDaOperacao(
  stepInstanceId: number,
  db: DB = prisma,
): Promise<Array<{ sequencia: number; motivo: string; atual: boolean; concluidaEm: Date | null; payload: PayloadOperacional }>> {
  return (await tentativasDoPasso(stepInstanceId, db)).map((t) => ({
    sequencia: t.sequencia,
    motivo: t.motivo,
    atual: t.supersededAt == null,
    concluidaEm: t.completedAt,
    payload: limpar(t.payload),
  }))
}
