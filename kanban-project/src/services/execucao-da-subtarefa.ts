// src/services/execucao-da-subtarefa.ts
// ============================================================================
// AS EXECUÇÕES DE UMA SUBTAREFA — abrir, registrar, substituir, ler.
//
// ─── O QUE FALTAVA ─────────────────────────────────────────────────────────
// Dentro de "Solicitar certidão" acontecem três coisas: pedir, registrar o protocolo,
// esperar o retorno. Nenhuma delas tinha existência: eram trechos de um componente.
// "Quem registrou o protocolo?" só podia ser respondido por dedução — olhando o
// payload da tentativa do passo inteiro e torcendo para o campo estar lá.
//
// ─── O QUE ESTE MÓDULO ESTABELECE ──────────────────────────────────────────
// A subtarefa é a OBRIGAÇÃO ("registrar o protocolo desta certidão, nesta visita").
// Cada tentativa de cumpri-la é uma linha em `SubtaskExecution`, append-only.
//
// Reabrir não desconclui: a execução vigente é SUBSTITUÍDA (ganha `supersededAt`,
// mantendo `completedAt`, executor, resultado e dados) e uma nova nasce. É a mesma
// mecânica da tentativa do passo, um nível abaixo — de propósito: duas mecânicas
// diferentes para o mesmo fato dariam duas respostas para "o que aconteceu antes".
//
// ─── QUAL É A ATUAL ────────────────────────────────────────────────────────
// A vigente é a única com `supersededAt` nulo, garantido por índice parcial no banco.
// Não se descobre ordenando por data: descobre-se porque não foi substituída.
//
// ─── O QUE ELE NÃO FAZ ─────────────────────────────────────────────────────
// Não decide se a subtarefa PODE ser executada (isso é da projeção, que conhece as
// dependências e as condições), não conclui passo, não toca em tarefa nem documento.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

type DB = Prisma.TransactionClient | typeof prisma

/**
 * OS ESTADOS DE UMA EXECUÇÃO DE SUBTAREFA.
 *
 * Vocabulário fechado, conferido por CHECK no banco. `PENDENTE` e `DISPONIVEL` são
 * coisas diferentes: pendente é "ainda não pode", disponível é "pode agora" — e
 * misturá-las é o que faz uma tela mostrar botão que o servidor recusa.
 */
export const ESTADOS_DA_SUBTAREFA = {
  PENDENTE: "PENDENTE",
  DISPONIVEL: "DISPONIVEL",
  EM_ANDAMENTO: "EM_ANDAMENTO",
  AGUARDANDO_EXTERNO: "AGUARDANDO_EXTERNO",
  BLOQUEADO: "BLOQUEADO",
  CONCLUIDO: "CONCLUIDO",
  CANCELADO: "CANCELADO",
  INVALIDADO: "INVALIDADO",
  FALHOU: "FALHOU",
} as const
export type EstadoDaSubtarefa = (typeof ESTADOS_DA_SUBTAREFA)[keyof typeof ESTADOS_DA_SUBTAREFA]

/** Estados em que a obrigação está cumprida — nem toda saída é conclusão. */
export const ESTADOS_CUMPRIDOS_DA_SUBTAREFA: EstadoDaSubtarefa[] = ["CONCLUIDO"]
/** Estados em que ela saiu de cena sem ter sido cumprida. */
export const ESTADOS_ENCERRADOS_SEM_CUMPRIR: EstadoDaSubtarefa[] = ["CANCELADO", "INVALIDADO"]

/** POR QUE esta execução nasceu. Mesmo vocabulário da tentativa do passo. */
export const MOTIVOS_DE_EXECUCAO = {
  ABERTURA: "ABERTURA",
  REABERTURA_MANUAL: "REABERTURA_MANUAL",
  NOVA_OCORRENCIA: "NOVA_OCORRENCIA",
  CORRECAO: "CORRECAO",
  RETRY: "RETRY",
  BACKFILL: "BACKFILL",
} as const
export type MotivoDeExecucao = (typeof MOTIVOS_DE_EXECUCAO)[keyof typeof MOTIVOS_DE_EXECUCAO]

/** CAUSAS ESTRUTURADAS de bloqueio — "bloqueada" sem dizer por quê a UI não explica. */
export const CAUSAS_DE_BLOQUEIO = {
  DEPENDENCIA_PENDENTE: "DEPENDENCIA_PENDENTE",
  CONDICAO_DE_ENTRADA: "CONDICAO_DE_ENTRADA",
  FORNECEDOR_AUSENTE: "FORNECEDOR_AUSENTE",
  CANAL_INDISPONIVEL: "CANAL_INDISPONIVEL",
  PASSO_BLOQUEADO: "PASSO_BLOQUEADO",
} as const
export type CausaDeBloqueio = (typeof CAUSAS_DE_BLOQUEIO)[keyof typeof CAUSAS_DE_BLOQUEIO]

export interface ExecucaoDeSubtarefa {
  id: number
  stepInstanceId: number
  subtaskKey: string
  subtaskDefinitionId: number | null
  workflowVersao: number | null
  sequencia: number
  status: string
  motivo: string
  bloqueioCodigo: string | null
  bloqueioAlvo: string | null
  startedAt: Date | null
  completedAt: Date | null
  executadoPorId: number | null
  responsavelId: number | null
  prazo: Date | null
  resultado: string | null
  payload: unknown
  fornecedorId: number | null
  canalKey: string | null
  protocolo: string | null
  protocoloId: number | null
  enviadoEm: Date | null
  previstoPara: Date | null
  supersededAt: Date | null
  supersededPorId: number | null
  criadoEm: Date
}

/** A execução ATUAL da subtarefa: a única não substituída. `null` se ainda não há. */
export async function execucaoVigente(
  stepInstanceId: number, subtaskKey: string, db: DB = prisma,
): Promise<ExecucaoDeSubtarefa | null> {
  return db.subtaskExecution.findFirst({
    where: { stepInstanceId, subtaskKey, supersededAt: null },
  }) as Promise<ExecucaoDeSubtarefa | null>
}

/** Todas as execuções da subtarefa, da mais antiga para a mais nova. */
export async function execucoesDaSubtarefa(
  stepInstanceId: number, subtaskKey: string, db: DB = prisma,
): Promise<ExecucaoDeSubtarefa[]> {
  return db.subtaskExecution.findMany({
    where: { stepInstanceId, subtaskKey }, orderBy: { sequencia: "asc" },
  }) as Promise<ExecucaoDeSubtarefa[]>
}

/** Todas as execuções vigentes do passo, uma por subtarefa. */
export async function vigentesDoPasso(stepInstanceId: number, db: DB = prisma): Promise<ExecucaoDeSubtarefa[]> {
  return db.subtaskExecution.findMany({
    where: { stepInstanceId, supersededAt: null }, orderBy: { id: "asc" },
  }) as Promise<ExecucaoDeSubtarefa[]>
}

/**
 * ABRE UMA EXECUÇÃO — a primeira da subtarefa, ou a que substitui a atual.
 *
 * IDEMPOTENTE por `chaveIdempotencia`: o retry de um comando não vira execução nova.
 * ATÔMICO: recebendo um `tx`, tudo acontece na transação de quem chamou.
 *
 * A SUBSTITUIÇÃO VEM DEPOIS DA CRIAÇÃO, de propósito: o índice parcial exige no
 * máximo uma não-substituída, então a antiga só sai de cena quando a nova já existe.
 */
export async function abrirExecucao(
  args: {
    stepInstanceId: number
    subtaskKey: string
    subtaskDefinitionId?: number | null
    workflowVersao?: number | null
    motivo: MotivoDeExecucao
    status: EstadoDaSubtarefa
    bloqueioCodigo?: CausaDeBloqueio | null
    bloqueioAlvo?: string | null
    responsavelId?: number | null
    prazo?: Date | null
    payload?: Prisma.InputJsonValue | null
    correlationId?: string | null
    chaveIdempotencia?: string
  },
  db: DB = prisma,
): Promise<{ execucao: ExecucaoDeSubtarefa; substituiu: number | null; criada: boolean }> {
  const vigente = await execucaoVigente(args.stepInstanceId, args.subtaskKey, db)
  const sequencia = (vigente?.sequencia ?? 0) + 1
  const chave = args.chaveIdempotencia ??
    `subexec|si${args.stepInstanceId}|${args.subtaskKey}|seq${sequencia}|${args.motivo}`

  const jaExiste = (await db.subtaskExecution.findUnique({ where: { chaveIdempotencia: chave } })) as ExecucaoDeSubtarefa | null
  if (jaExiste) return { execucao: jaExiste, substituiu: null, criada: false }

  const agora = new Date()
  // ── A SUBSTITUIÇÃO VEM ANTES DA CRIAÇÃO ─────────────────────────────────
  //
  // O índice parcial admite UMA linha não-substituída. Inserir a nova antes de tirar a
  // antiga de cena viola o índice — e, com `ON CONFLICT DO NOTHING`, a violação é
  // SILENCIOSA: nada é inserido, a função devolve "já existia" e a reabertura
  // simplesmente não acontece, sem erro nenhum. Era assim em produção.
  //
  // O ponteiro para a sucessora fica NULO por um instante, e a trava do banco permite
  // exatamente isso: ela exige que a substituída tenha data e que o ponteiro, quando
  // existir, aponte para OUTRA linha. "Saiu de cena, e já se sabe quando" é um estado
  // legítimo; "aponta para si mesma" nunca seria.
  if (vigente) {
    await db.subtaskExecution.update({
      where: { id: vigente.id },
      data: { supersededAt: agora },
    })
  }

  // CUMPRIDA TEM MOMENTO — inclusive a que nasce assim. Nascer CONCLUIDO sem
  // `completedAt` produziria estado de conclusão sem a conclusão; o banco recusa, e
  // aqui a incoerência nem chega a ser tentada.
  const nasceCumprida = args.status === "CONCLUIDO"
  // BLOQUEADO TEM CAUSA. Sem código de bloqueio, a UI só sabe dizer "bloqueada".
  const bloqueioCodigo = args.status === "BLOQUEADO"
    ? (args.bloqueioCodigo ?? CAUSAS_DE_BLOQUEIO.DEPENDENCIA_PENDENTE)
    : (args.bloqueioCodigo ?? null)

  const criadas = await db.subtaskExecution.createMany({
    data: [{
      stepInstanceId: args.stepInstanceId,
      subtaskKey: args.subtaskKey,
      subtaskDefinitionId: args.subtaskDefinitionId ?? null,
      workflowVersao: args.workflowVersao ?? null,
      sequencia,
      status: args.status,
      motivo: args.motivo,
      bloqueioCodigo,
      bloqueioAlvo: args.bloqueioAlvo ?? null,
      completedAt: nasceCumprida ? agora : null,
      responsavelId: args.responsavelId ?? null,
      prazo: args.prazo ?? null,
      payload: args.payload ?? undefined,
      correlationId: args.correlationId ?? null,
      chaveIdempotencia: chave,
    }],
    skipDuplicates: true,
  })
  const nova = (await db.subtaskExecution.findUnique({ where: { chaveIdempotencia: chave } })) as ExecucaoDeSubtarefa
  if (criadas.count === 0) {
    // Retry do mesmo comando: a chave já existia. Desfaz a substituição — o que já
    // estava lá continua sendo o vigente.
    if (vigente) {
      await db.subtaskExecution.update({
        where: { id: vigente.id }, data: { supersededAt: null, supersededPorId: null },
      })
    }
    return { execucao: nova, substituiu: null, criada: false }
  }

  if (vigente) {
    await db.subtaskExecution.update({
      where: { id: vigente.id },
      data: { supersededAt: agora, supersededPorId: nova.id },
    })
  }
  return { execucao: nova, substituiu: vigente?.id ?? null, criada: true }
}

/**
 * REGISTRA NA EXECUÇÃO VIGENTE o que acabou de acontecer.
 *
 * Só mexe na ATUAL — execução substituída é fato consumado e nada aqui a alcança.
 * `completedAt` e `startedAt` são gravados uma vez e não são reescritos.
 */
export async function registrarNaExecucao(
  stepInstanceId: number,
  subtaskKey: string,
  dados: {
    status?: EstadoDaSubtarefa
    bloqueioCodigo?: CausaDeBloqueio | null
    bloqueioAlvo?: string | null
    startedAt?: Date | null
    completedAt?: Date | null
    executadoPorId?: number | null
    responsavelId?: number | null
    prazo?: Date | null
    resultado?: string | null
    payload?: Prisma.InputJsonValue | null
    fornecedorId?: number | null
    canalKey?: string | null
    /**
     * PROJEÇÃO do número, nunca a fonte. Quem responde pelo protocolo é `Protocolo`,
     * alcançado por `protocoloId`; este texto existe para os leitores que ainda não
     * migraram e só deve receber o que o cadastro canônico confirmou.
     */
    protocolo?: string | null
    /** O protocolo canônico desta execução. É por ele que se chega ao número. */
    protocoloId?: number | null
    enviadoEm?: Date | null
    previstoPara?: Date | null
  },
  db: DB = prisma,
): Promise<ExecucaoDeSubtarefa | null> {
  const vigente = await execucaoVigente(stepInstanceId, subtaskKey, db)
  if (!vigente) return null

  const cumprindo = dados.status === "CONCLUIDO"
  const bloqueando = dados.status === "BLOQUEADO"
  const atualizada = await db.subtaskExecution.update({
    where: { id: vigente.id },
    data: {
      ...(dados.status !== undefined ? { status: dados.status } : {}),
      // Sair de BLOQUEADO limpa a causa: causa de bloqueio pendurada numa execução
      // que não está mais bloqueada é histórico falso.
      ...(dados.status !== undefined && !bloqueando ? { bloqueioCodigo: null, bloqueioAlvo: null } : {}),
      ...(bloqueando ? {
        bloqueioCodigo: dados.bloqueioCodigo ?? vigente.bloqueioCodigo ?? CAUSAS_DE_BLOQUEIO.DEPENDENCIA_PENDENTE,
        bloqueioAlvo: dados.bloqueioAlvo ?? vigente.bloqueioAlvo ?? null,
      } : {}),
      ...(cumprindo && vigente.completedAt == null ? { completedAt: dados.completedAt ?? new Date() } : {}),
      ...(dados.startedAt !== undefined && vigente.startedAt == null ? { startedAt: dados.startedAt } : {}),
      ...(dados.executadoPorId !== undefined ? { executadoPorId: dados.executadoPorId } : {}),
      ...(dados.responsavelId !== undefined ? { responsavelId: dados.responsavelId } : {}),
      ...(dados.prazo !== undefined ? { prazo: dados.prazo } : {}),
      ...(dados.resultado !== undefined ? { resultado: dados.resultado } : {}),
      ...(dados.payload !== undefined && dados.payload !== null ? { payload: dados.payload } : {}),
      ...(dados.fornecedorId !== undefined ? { fornecedorId: dados.fornecedorId } : {}),
      ...(dados.canalKey !== undefined ? { canalKey: dados.canalKey } : {}),
      ...(dados.protocolo !== undefined ? { protocolo: dados.protocolo } : {}),
      ...(dados.protocoloId !== undefined ? { protocoloId: dados.protocoloId } : {}),
      ...(dados.enviadoEm !== undefined ? { enviadoEm: dados.enviadoEm } : {}),
      ...(dados.previstoPara !== undefined ? { previstoPara: dados.previstoPara } : {}),
    },
  })
  return atualizada as ExecucaoDeSubtarefa
}

/**
 * GARANTE QUE A SUBTAREFA TEM EXECUÇÃO VIGENTE, sem criar uma segunda.
 *
 * É o que a materialização chama: um passo que ganha subtarefas passa a ter uma linha
 * por subtarefa, no estado que a projeção calculou.
 */
export async function garantirExecucao(
  args: {
    stepInstanceId: number
    subtaskKey: string
    subtaskDefinitionId?: number | null
    workflowVersao?: number | null
    status: EstadoDaSubtarefa
    bloqueioCodigo?: CausaDeBloqueio | null
    bloqueioAlvo?: string | null
    responsavelId?: number | null
    prazo?: Date | null
  },
  db: DB = prisma,
): Promise<ExecucaoDeSubtarefa> {
  const vigente = await execucaoVigente(args.stepInstanceId, args.subtaskKey, db)
  if (vigente) return vigente
  const r = await abrirExecucao({ ...args, motivo: MOTIVOS_DE_EXECUCAO.ABERTURA }, db)
  return r.execucao
}
