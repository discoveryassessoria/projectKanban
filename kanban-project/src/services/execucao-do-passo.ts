// src/services/execucao-do-passo.ts
// ============================================================================
// AS TENTATIVAS DE EXECUÇÃO DE UM PASSO — abrir, encerrar, substituir, ler.
//
// ─── O QUE FALTAVA ─────────────────────────────────────────────────────────
// O modelo já representava a execução da FASE: `PhaseWorkflowInstance` tem `ciclo` e
// `previousInstanceId`, e voltar a uma fase abre uma visita nova, com passos novos.
// Dentro de UMA visita, porém, o passo era uma linha só: reabrir fazia
// `completedAt = NULL` sobre ela. A execução que aconteceu deixava de ter
// acontecido, e a pergunta "concluída em qual execução?" não tinha onde ser
// respondida — só existia `status = CONCLUIDO`, um estado sem dono.
//
// ─── O QUE ESTE MÓDULO ESTABELECE ──────────────────────────────────────────
// A instância do passo continua sendo a OBRIGAÇÃO ("executar `receber_certidao`
// para esta certidão, nesta visita da fase"). Cada TENTATIVA de cumpri-la é uma
// linha em `StepExecution`, e tentativas são append-only.
//
// Reabrir deixa de ser desconclusão: a tentativa vigente é SUBSTITUÍDA (ganha
// `supersededAt`, mantendo `completedAt`, executor, resultado e dados) e uma
// tentativa NOVA nasce. O passado continua sendo passado.
//
// ─── QUAL É A ATUAL ────────────────────────────────────────────────────────
// A vigente é a única com `supersededAt` nulo — e quem garante que é uma só é um
// índice parcial no banco, não uma convenção de código. Não se descobre a atual
// ordenando por data: descobre-se porque é a que não foi substituída.
//
// ─── O QUE ELE NÃO FAZ ─────────────────────────────────────────────────────
// Não decide status de passo (isso é da máquina de passos), não propaga nada para
// dependentes (Gate 3), não toca em tarefa, fase ou documento.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma, StepInstanceStatus } from "@prisma/client"

type DB = Prisma.TransactionClient | typeof prisma

/**
 * POR QUE UMA TENTATIVA NASCEU.
 *
 * É capacidade técnica, não catálogo editável: cada motivo corresponde a um caminho
 * do domínio que já existe. Quando o cadastro de ações chegar (Gate 5), a ação
 * configurada passará a declarar qual destes motivos usa — o vocabulário aqui é o
 * contrato, e o rótulo que o operador lê deixa de morar no código.
 */
export const MOTIVOS_DE_TENTATIVA = {
  /** A primeira tentativa, criada junto com a obrigação. */
  ABERTURA: "ABERTURA",
  /** Alguém reabriu o passo deliberadamente. */
  REABERTURA_MANUAL: "REABERTURA_MANUAL",
  /** O documento anterior não serviu e outro foi pedido. */
  NOVA_VIA: "NOVA_VIA",
  /** O documento foi invalidado depois de aceito. */
  DOCUMENTO_INVALIDADO: "DOCUMENTO_INVALIDADO",
  /** Correção de execução malfeita, sem culpa do documento. */
  CORRECAO: "CORRECAO",
  /** Repetição por falha técnica. */
  RETRY: "RETRY",
  /** Backfill: tentativa deduzida de dado anterior a este modelo. */
  BACKFILL: "BACKFILL",
} as const
export type MotivoDeTentativa = (typeof MOTIVOS_DE_TENTATIVA)[keyof typeof MOTIVOS_DE_TENTATIVA]

export interface Tentativa {
  id: number
  stepInstanceId: number
  sequencia: number
  status: StepInstanceStatus
  motivo: string
  startedAt: Date | null
  completedAt: Date | null
  executadoPorId: number | null
  resultado: string | null
  payload: unknown
  supersededAt: Date | null
  supersededPorId: number | null
  criadoEm: Date
}

/** A tentativa ATUAL do passo: a única não substituída. `null` se ainda não há. */
export async function tentativaVigente(stepInstanceId: number, db: DB = prisma): Promise<Tentativa | null> {
  return db.stepExecution.findFirst({
    where: { stepInstanceId, supersededAt: null },
  }) as Promise<Tentativa | null>
}

/** Todas as tentativas, da mais antiga para a mais nova. Histórico completo. */
export async function tentativasDoPasso(stepInstanceId: number, db: DB = prisma): Promise<Tentativa[]> {
  return db.stepExecution.findMany({
    where: { stepInstanceId }, orderBy: { sequencia: "asc" },
  }) as Promise<Tentativa[]>
}

/**
 * ABRE UMA TENTATIVA — a primeira do passo, ou a que substitui a atual.
 *
 * Se já existe tentativa vigente, ela é SUBSTITUÍDA: ganha `supersededAt` e o
 * ponteiro para a sucessora. Nada nela é apagado — `completedAt`, executor,
 * resultado e dados continuam exatamente como estavam. É essa preservação que
 * separa "reexecutar" de "desconcluir".
 *
 * IDEMPOTENTE por `chaveIdempotencia`: o retry de um comando não vira tentativa
 * nova. Sem chave, a chave é derivada do passo, da sequência e do motivo — o que
 * torna duas aberturas simultâneas do mesmo motivo uma só.
 *
 * ATÔMICO: quando recebe um `tx`, tudo acontece na transação de quem chamou.
 */
export async function abrirTentativa(
  args: {
    stepInstanceId: number
    motivo: MotivoDeTentativa
    status: StepInstanceStatus
    startedAt?: Date | null
    /** Quando a tentativa já nasce cumprida (backfill, herança), o momento disso. */
    completedAt?: Date | null
    executadoPorId?: number | null
    payload?: Prisma.InputJsonValue | null
    correlationId?: string | null
    chaveIdempotencia?: string
  },
  db: DB = prisma,
): Promise<{ tentativa: Tentativa; substituiu: number | null; criada: boolean }> {
  const vigente = await tentativaVigente(args.stepInstanceId, db)
  const sequencia = (vigente?.sequencia ?? 0) + 1
  const chave =
    args.chaveIdempotencia ?? `stepexec|si${args.stepInstanceId}|seq${sequencia}|${args.motivo}`

  // O MESMO COMANDO REENVIADO devolve a tentativa que ele já criou. A chave é única
  // no banco; a leitura antes do insert evita o erro, e o `skipDuplicates` cobre a
  // corrida entre a leitura e a escrita.
  const jaExiste = (await db.stepExecution.findUnique({ where: { chaveIdempotencia: chave } })) as Tentativa | null
  if (jaExiste) return { tentativa: jaExiste, substituiu: null, criada: false }

  const agora = new Date()
  // TENTATIVA CONCLUÍDA TEM DATA — inclusive a que nasce assim.
  //
  // Uma tentativa nova normalmente nasce aberta, mas nada impede um chamador de abrir
  // uma já no estado em que o passo está, e o passo pode estar cumprido. Nascer
  // "CONCLUIDO" com `completedAt` nulo produziria exatamente o que o Gate 2 existe
  // para impedir: um estado de conclusão sem o momento dela. O fuzz encontrou isso em
  // 19 comandos; aqui a incoerência deixa de ser representável.
  const nasceCumprida = args.status === "CONCLUIDO" || args.status === "EXECUTADO"
  const criadas = await db.stepExecution.createMany({
    data: [{
      stepInstanceId: args.stepInstanceId,
      sequencia,
      status: args.status,
      completedAt: nasceCumprida ? (args.completedAt ?? agora) : (args.completedAt ?? null),
      motivo: args.motivo,
      startedAt: args.startedAt ?? null,
      executadoPorId: args.executadoPorId ?? null,
      payload: args.payload ?? undefined,
      correlationId: args.correlationId ?? null,
      chaveIdempotencia: chave,
    }],
    skipDuplicates: true,
  })
  const nova = (await db.stepExecution.findUnique({ where: { chaveIdempotencia: chave } })) as Tentativa
  if (criadas.count === 0) return { tentativa: nova, substituiu: null, criada: false }

  // A SUBSTITUIÇÃO VEM DEPOIS DA CRIAÇÃO, de propósito: o índice parcial exige que
  // exista no máximo uma não-substituída, então a antiga só pode sair de cena quando
  // a nova já existe para tomar o lugar. Se a criação falhar, nada foi substituído.
  if (vigente) {
    await db.stepExecution.update({
      where: { id: vigente.id },
      data: { supersededAt: agora, supersededPorId: nova.id },
    })
  }
  return { tentativa: nova, substituiu: vigente?.id ?? null, criada: true }
}

/**
 * REGISTRA NA TENTATIVA VIGENTE o que a máquina de passos acabou de decidir.
 *
 * Só mexe na tentativa ATUAL — uma tentativa substituída é fato consumado e nada
 * aqui a alcança. `completedAt` é gravado uma vez e não é reescrito por transições
 * posteriores da mesma tentativa.
 */
export async function registrarNaTentativa(
  stepInstanceId: number,
  dados: {
    status: StepInstanceStatus
    startedAt?: Date | null
    completedAt?: Date | null
    executadoPorId?: number | null
    resultado?: string | null
    payload?: Prisma.InputJsonValue | null
  },
  db: DB = prisma,
): Promise<Tentativa | null> {
  const vigente = await tentativaVigente(stepInstanceId, db)
  if (!vigente) return null
  // CUMPRIDA TEM MOMENTO. Passar a tentativa para CONCLUIDO sem data deixaria um
  // estado de conclusão sem a conclusão — o mesmo buraco que o Gate 2 fechou do outro
  // lado. Quando quem chama não informa (a ação cadastrada não sabe o relógio do
  // motor), o instante é agora; quando já havia data, ela é preservada.
  const cumprindo = dados.status === "CONCLUIDO" || dados.status === "EXECUTADO"
  const dataDeConclusao =
    dados.completedAt ?? vigente.completedAt ?? (cumprindo ? new Date() : null)
  const atualizada = await db.stepExecution.update({
    where: { id: vigente.id },
    data: {
      status: dados.status,
      ...(cumprindo && vigente.completedAt == null ? { completedAt: dataDeConclusao } : {}),
      ...(dados.startedAt !== undefined && vigente.startedAt == null ? { startedAt: dados.startedAt } : {}),
      ...(dados.completedAt !== undefined && vigente.completedAt == null ? { completedAt: dados.completedAt } : {}),
      ...(dados.executadoPorId !== undefined ? { executadoPorId: dados.executadoPorId } : {}),
      ...(dados.resultado !== undefined ? { resultado: dados.resultado } : {}),
      ...(dados.payload !== undefined && dados.payload !== null ? { payload: dados.payload } : {}),
    },
  })
  return atualizada as Tentativa
}

/**
 * GARANTE QUE O PASSO TEM TENTATIVA VIGENTE.
 *
 * Usado quando um passo nasce e quando um passo anterior a este modelo é tocado pela
 * primeira vez. Não cria segunda tentativa se já houver uma.
 */
export async function garantirTentativa(
  stepInstanceId: number,
  args: { motivo: MotivoDeTentativa; status: StepInstanceStatus; startedAt?: Date | null; completedAt?: Date | null; payload?: Prisma.InputJsonValue | null },
  db: DB = prisma,
): Promise<Tentativa> {
  const vigente = await tentativaVigente(stepInstanceId, db)
  if (vigente) return vigente
  const chave = `stepexec|si${stepInstanceId}|seq1|${args.motivo}`
  // Um passo já CONCLUÍDO cuja linha não guardou `completedAt` — dado antigo, de
  // antes de a data ser cobrada — não pode produzir uma tentativa concluída sem
  // momento. `criadoEm` é a melhor verdade disponível e é dita como tal.
  const jaCumprido = args.status === "CONCLUIDO" || args.status === "EXECUTADO"
  const fim = args.completedAt ?? (jaCumprido ? new Date() : null)
  await db.stepExecution.createMany({
    data: [{
      stepInstanceId, sequencia: 1, status: args.status, motivo: args.motivo,
      startedAt: args.startedAt ?? null, completedAt: fim,
      payload: args.payload ?? undefined, chaveIdempotencia: chave,
    }],
    skipDuplicates: true,
  })
  return (await db.stepExecution.findUnique({ where: { chaveIdempotencia: chave } })) as Tentativa
}
