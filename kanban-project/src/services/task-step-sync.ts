// src/services/task-step-sync.ts
// CP-4D — TaskStepSyncService: sincronização canônica Tarefa ↔ Passo, SEM LOOP.
//
// Prevenção de loop: funções internas SEPARADAS (aplicarTarefa/aplicarPasso) que
// NÃO se re-chamam; CAS por (status + lockVersion); no-op quando já no alvo;
// chaves idempotentes; eventos @unique; tudo em uma transação. Origem só audita.
// Só atua sob runtime v2 (kill switch + Processo.workflowRuntime="v2"). Nunca
// avança fase, nunca gera financeiro, nunca escreve no Workflow/WorkflowStep legado.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { Prisma, type Tarefa, type PhaseWorkflowStepInstance, type WorkflowEventoTipo } from "@prisma/client"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import * as H from "@/src/services/task-step-sync-helpers"
import { projetarTarefaDoPasso, assegurarCoerenciaPassoTarefa } from "@/src/services/passo-tarefa-projecao"
import { processarOutbox } from "@/src/services/outbox-dispatcher"
import { escopoDaUnidade, estadoDerivado, sincronizarTarefaComWorkflow } from "@/lib/operacional/tarefa-canonica"

const TAREFA_CONCLUIDA_STATUS = "CONCLUIDO_RECEBIDO"
const TAREFA_CONCLUIDA_SET = new Set<string>(["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"])

/**
 * O QUE AS ETAPAS DIZEM SOBRE A TAREFA — uma conta só, importada.
 *
 * A regra ("a tarefa acabou quando todas as etapas obrigatórias acabaram") não
 * é reescrita aqui: ela vive em `tarefa-canonica` e é a mesma que a Central, o
 * reconciliador e as filas usam.
 */
async function statusDerivadoDaTarefa(tx: TX, tarefaId: number): Promise<string | null> {
  const t = await tx.tarefa.findUnique({
    where: { id: tarefaId },
    select: {
      workflowInstanceId: true, dataInicio: true,
      // A UNIDADE. Sem ela a conta lia os passos da FASE inteira: numa Emissão
      // com quatro certidões, a tarefa de uma só concluía quando as outras três
      // concluíssem, e ficava BLOQUEADA porque a certidão de outra pessoa travou.
      necessidadeId: true, documentoId: true, workflowStepInstanceId: true,
    },
  })
  if (!t?.workflowInstanceId) return null
  const steps = await tx.phaseWorkflowStepInstance.findMany({
    where: escopoDaUnidade({
      workflowInstanceId: t.workflowInstanceId,
      necessidadeId: t.necessidadeId,
      documentoId: t.documentoId,
      workflowStepInstanceId: t.workflowStepInstanceId,
    }),
    select: { id: true, status: true, obrigatorio: true, ordem: true, stepKey: true },
    orderBy: { ordem: "asc" },
  })
  return estadoDerivado(steps, { iniciada: t.dataInicio != null }).status
}

export interface SyncContexto {
  origem: H.Origem
  usuarioId?: number
  correlationId?: string
  causationId?: string
  motivoCodigo?: string
  justificativa?: string
  politica?: H.PoliticaCancelamento
  aprovadorId?: number
}

export type SyncResultado =
  | {
      success: true
      changed: boolean
      tarefa?: Tarefa | null
      stepInstance?: PhaseWorkflowStepInstance | null
      estadoAnterior: { tarefa?: string; passo?: string }
      estadoAtual: { tarefa?: string; passo?: string }
      eventos: string[]
      warnings: H.SyncIssue[]
      correlationId: string
    }
  | { success: false; code: H.FailureCodeD; errors: H.SyncIssue[]; correlationId: string }

type TX = Prisma.TransactionClient
interface ApplyOpts {
  correlationId: string
  causationId: string
  ciclo: number
  processoId: number
  workflowInstanceId?: number | null
  extra?: Record<string, unknown>
  dados?: Prisma.InputJsonValue
}

// ---------------- APLICADOR: PASSO (CAS) ----------------
async function aplicarPasso(tx: TX, stepId: number, alvo: string, tipoEvento: WorkflowEventoTipo, o: ApplyOpts) {
  const step = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: stepId } })
  if (!step) return { changed: false, anterior: "", atual: "", code: "STEP_NAO_ENCONTRADO" as H.FailureCodeD }
  if (step.status === alvo) return { changed: false, anterior: step.status, atual: step.status }
  if (!H.podeAplicarPasso(step.status, alvo)) return { changed: false, anterior: step.status, atual: step.status, code: "TRANSICAO_INVALIDA" as H.FailureCodeD }

  const now = new Date()
  const data: Prisma.PhaseWorkflowStepInstanceUpdateManyMutationInput = {
    status: alvo as Prisma.PhaseWorkflowStepInstanceUpdateManyMutationInput["status"],
    lockVersion: { increment: 1 },
    ...(o.extra as object),
  }
  if (alvo === "EM_ANDAMENTO") data.startedAt = step.startedAt ?? now
  if (alvo === "EXECUTADO" || alvo === "CONCLUIDO") data.completedAt = now
  if (alvo === "BLOQUEADO") data.blockedAt = now
  if (alvo === "DISPENSADO") data.dispensedAt = now
  if (alvo === "CANCELADO") data.cancelledAt = now
  if (alvo === "SUPERSEDIDO") data.supersededAt = now

  const res = await tx.phaseWorkflowStepInstance.updateMany({
    where: { id: stepId, status: step.status as Prisma.PhaseWorkflowStepInstanceWhereInput["status"], lockVersion: step.lockVersion },
    data,
  })
  if (res.count === 0) return { changed: false, anterior: step.status, atual: step.status, code: "CONFLITO" as H.FailureCodeD }

  const chaveEvt = H.chaveEvento(tipoEvento, "step_instance", stepId, alvo, o.ciclo, step.lockVersion)
  await tx.workflowEvento.create({
    data: {
      tipo: tipoEvento, entityType: "step_instance", entityId: stepId,
      processoId: o.processoId, workflowInstanceId: o.workflowInstanceId ?? undefined, stepInstanceId: stepId,
      correlationId: o.correlationId, causationId: o.causationId, chaveIdempotencia: chaveEvt, dados: o.dados,
    },
  })
  await tx.domainOutbox.create({
    data: {
      tipo: `step.${alvo.toLowerCase()}`, aggregateType: "PhaseWorkflowStepInstance", aggregateId: stepId,
      correlationId: o.correlationId, causationId: o.causationId, chaveIdempotencia: `outbox|${chaveEvt}`,
      payload: { stepId, alvo, ciclo: o.ciclo },
    },
  })
  return { changed: true, anterior: step.status, atual: alvo }
}

// ════════════════════════════════════════════════════════════════════════════
// FRONTEIRA EXPLÍCITA — A ÚNICA MÁQUINA DE ESTADOS DE PASSO É ESTE MÓDULO.
//
// A camada de TAREFA (lib/operacional/*) é dona da unidade de trabalho: prazo,
// responsável, equipe, dependências, SLA, notificações. Ela NÃO é dona do
// passo. Quando uma porta de tarefa precisa mover um passo, ela entra por aqui.
//
// Por que isto existe: durante a reengenharia operacional nasceram duas
// famílias de transição — esta, que valida pela precedência, emite
// WorkflowEvento e publica no outbox; e a da camada de tarefa, que escrevia
// `phaseWorkflowStepInstance.updateMany` direto. As duas concluíam passo com
// regras diferentes. Concluir pela tela emitia evento; concluir pela porta de
// tarefa, não. Um mesmo fato com duas derivações — a segunda sempre fica para
// trás.
//
// `transicionarPassoTx` é a mesma função que as portas deste módulo usam
// (`aplicarPasso`), exposta para quem já está dentro de uma transação e precisa
// compor a transição do passo com a escrita da própria tarefa no MESMO commit.
// ════════════════════════════════════════════════════════════════════════════

/**
 * O EVENTO QUE CADA ALVO PRODUZ — tabela única.
 *
 * Sem isto, cada chamador escolheria o tipo do evento na hora, e o mesmo alvo
 * apareceria no histórico com dois nomes conforme a porta usada.
 *
 * Os alvos ausentes (AGUARDANDO, FALHOU) não têm evento próprio no enum: quem
 * os aplica passa `tipoEvento` explicitamente e assume a escolha.
 */
export const EVENTO_PASSO_POR_ALVO: Partial<Record<string, WorkflowEventoTipo>> = {
  PENDENTE: "PASSO_INSTANCIADO",
  DISPONIVEL: "PASSO_DISPONIBILIZADO",
  EM_ANDAMENTO: "PASSO_INICIADO",
  BLOQUEADO: "PASSO_BLOQUEADO",
  EXECUTADO: "PASSO_EXECUTADO",
  AGUARDANDO_APROVACAO: "PASSO_AGUARDANDO_APROVACAO",
  CONCLUIDO: "PASSO_CONCLUIDO",
  DISPENSADO: "PASSO_DISPENSADO",
  CANCELADO: "PASSO_CANCELADO",
  SUPERSEDIDO: "PASSO_SUPERSEDIDO",
}

export interface TransicaoPassoOpts {
  correlationId: string
  /** Operação de origem — vira a chave determinística do comando. */
  operacao: string
  ciclo: number
  processoId: number
  workflowInstanceId?: number | null
  /** Campos adicionais na MESMA escrita (ex.: `motivo` da conclusão). */
  extra?: Record<string, unknown>
  tipoEvento?: WorkflowEventoTipo
}

export type TransicaoPassoResultado = {
  changed: boolean
  anterior: string
  atual: string
  code?: H.FailureCodeD
}

/**
 * MOVE UM PASSO DENTRO DA TRANSAÇÃO DE QUEM CHAMA.
 *
 * Faz exatamente o que as portas deste módulo fazem — valida a transição pela
 * precedência, grava com CAS por (status + lockVersion), emite `WorkflowEvento`
 * e publica no `DomainOutbox`. Não decide nada sobre a Tarefa: essa decisão é
 * da camada de tarefa, e é justamente a fronteira que este desenho separa.
 */
export async function transicionarPassoTx(
  tx: TX,
  stepId: number,
  alvo: string,
  o: TransicaoPassoOpts,
): Promise<TransicaoPassoResultado> {
  const tipoEvento = o.tipoEvento ?? EVENTO_PASSO_POR_ALVO[alvo]
  if (!tipoEvento) {
    throw new Error(`transicionarPassoTx: alvo "${alvo}" não tem evento canônico — passe tipoEvento explicitamente.`)
  }
  const atual = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: stepId }, select: { lockVersion: true } })
  return aplicarPasso(tx, stepId, alvo, tipoEvento, {
    correlationId: o.correlationId,
    causationId: H.chaveComando(o.operacao, "step_instance", stepId, alvo, o.ciclo, atual?.lockVersion),
    ciclo: o.ciclo,
    processoId: o.processoId,
    workflowInstanceId: o.workflowInstanceId,
    extra: o.extra,
  })
}

/**
 * ATIVA A PRÓXIMA ETAPA EXECUTÁVEL — uma regra só, para as duas portas.
 *
 * Concluir um passo sem liberar o seguinte deixa o trabalho parado com tudo
 * pronto e ninguém sabendo o que fazer. Era o que acontecia ao concluir pela
 * porta de PASSO: `concluirPasso` fechava a etapa e o roteiro travava, porque a
 * ativação estava escrita só do lado da porta de TAREFA.
 *
 * "A próxima" é a de MENOR ordem ainda PENDENTE depois da concluída — e essa
 * definição não pode morar em dois lugares, senão as duas portas discordam
 * sobre qual etapa vem agora.
 */
export async function ativarProximoPassoTx(
  tx: TX,
  args: {
    workflowInstanceId: number
    ordemConcluida: number
    /**
     * A UNIDADE do passo concluído — a obrigação a que ele pertence.
     *
     * Sem ela, "a próxima etapa" era a primeira PENDENTE da INSTÂNCIA com ordem
     * maior. A instância é da FASE: numa Emissão com quatro certidões há quatro
     * passos de ordem 2 pendentes, e concluir "Solicitar certidão" do Ademir
     * abria "Aguardar retorno" da Tereza. O empate era resolvido pelo acaso do
     * `orderBy`, e o trabalho do Ademir ficava parado com todas as etapas
     * pendentes enquanto a tarefa dele apontava para o documento de outra pessoa.
     *
     * Quem conclui SEMPRE conhece a unidade: ela vem do próprio passo.
     */
    necessidadeId?: number | null
    documentoId?: number | null
  },
  o: Omit<TransicaoPassoOpts, "ciclo" | "processoId" | "workflowInstanceId">,
): Promise<number | null> {
  const proxima = await tx.phaseWorkflowStepInstance.findFirst({
    where: {
      ...escopoDaUnidade({
        workflowInstanceId: args.workflowInstanceId,
        necessidadeId: args.necessidadeId,
        documentoId: args.documentoId,
      }),
      status: "PENDENTE",
      ordem: { gt: args.ordemConcluida },
    },
    select: { id: true, ciclo: true, processoId: true },
    orderBy: { ordem: "asc" },
  })
  if (!proxima) return null
  const r = await transicionarPassoTx(tx, proxima.id, "DISPONIVEL", {
    ...o,
    ciclo: proxima.ciclo,
    processoId: proxima.processoId,
    workflowInstanceId: args.workflowInstanceId,
  })
  return r.changed ? proxima.id : null
}

/**
 * MOVE A TAREFA PELO MESMO APLICADOR QUE AS PORTAS DESTE MÓDULO USAM.
 *
 * Exposto pelo mesmo motivo que `transicionarPassoTx`: a camada de tarefa
 * precisa compor a mudança de estado com as escritas que são só dela (ponteiro
 * da etapa corrente, prazo, justificativa) dentro do MESMO commit — e, ao
 * fazer isso, tem de produzir o mesmo `WorkflowEvento` e a mesma publicação no
 * outbox que a Central produz. Sem isto, a mesma conclusão aparecia no
 * histórico quando vinha da Central e sumia quando vinha da fila de tarefas.
 */
export async function aplicarTarefaTx(
  tx: TX,
  tarefaId: number,
  alvo: string,
  tipoEvento: WorkflowEventoTipo,
  o: TransicaoPassoOpts & { extra?: Record<string, unknown> },
) {
  const t = await tx.tarefa.findUnique({ where: { id: tarefaId }, select: { lockVersion: true } })
  return aplicarTarefa(tx, tarefaId, alvo, tipoEvento, {
    correlationId: o.correlationId,
    causationId: H.chaveComando(o.operacao, "tarefa", tarefaId, alvo, o.ciclo, t?.lockVersion),
    ciclo: o.ciclo,
    processoId: o.processoId,
    workflowInstanceId: o.workflowInstanceId,
    extra: o.extra,
  })
}

/**
 * REABRE UM PASSO — a única descida permitida na máquina de estados.
 *
 * A precedência existe para impedir que um estado antigo sobrescreva um novo
 * por acidente. Reabertura não é acidente: é decisão humana registrada, com
 * motivo, para refazer trabalho. Por isso ela passa por uma porta própria, e
 * não afrouxando `podeAplicarPasso` — afrouxar ali abriria a descida para todo
 * o resto do sistema.
 */
/** Para onde um passo pode VOLTAR. Fora daqui não é reabertura — é outra coisa. */
const DESTINOS_DE_RETRABALHO = new Set<string>(["PENDENTE", "DISPONIVEL", "EM_ANDAMENTO"])

export async function reabrirPassoTx(
  tx: TX,
  stepId: number,
  alvo: "DISPONIVEL" | "PENDENTE" | "EM_ANDAMENTO",
  o: TransicaoPassoOpts,
): Promise<TransicaoPassoResultado> {
  // O DESTINO É VALIDADO AQUI, não no tipo de quem chama.
  //
  // Esta é a única porta que desce na máquina de estados, então ela precisa
  // policiar para ONDE se desce. Confiar na assinatura TypeScript deixou passar
  // CONCLUIDO → BLOQUEADO num `as`: o passo "voltava" para um estado que não é
  // retrabalho, sem passar por precedência nenhuma. Um passo concluído se
  // reabre; bloquear vem depois, pela porta normal.
  if (!DESTINOS_DE_RETRABALHO.has(alvo)) {
    return { changed: false, anterior: "", atual: "", code: "TRANSICAO_INVALIDA" as H.FailureCodeD }
  }
  const step = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: stepId } })
  if (!step) return { changed: false, anterior: "", atual: "", code: "STEP_NAO_ENCONTRADO" as H.FailureCodeD }
  if (step.status === alvo) return { changed: false, anterior: step.status, atual: step.status }

  const res = await tx.phaseWorkflowStepInstance.updateMany({
    where: { id: stepId, status: step.status as Prisma.PhaseWorkflowStepInstanceWhereInput["status"], lockVersion: step.lockVersion },
    data: {
      status: alvo as Prisma.PhaseWorkflowStepInstanceUpdateManyMutationInput["status"],
      lockVersion: { increment: 1 },
      completedAt: null,
      ...(o.extra as object),
    },
  })
  if (res.count === 0) return { changed: false, anterior: step.status, atual: step.status, code: "CONFLITO" as H.FailureCodeD }

  const causationId = H.chaveComando(o.operacao, "step_instance", stepId, alvo, o.ciclo, step.lockVersion)
  const chaveEvt = H.chaveEvento("PASSO_REABERTO", "step_instance", stepId, alvo, o.ciclo, step.lockVersion)
  await tx.workflowEvento.create({
    data: {
      tipo: "PASSO_REABERTO", entityType: "step_instance", entityId: stepId,
      processoId: o.processoId, workflowInstanceId: o.workflowInstanceId ?? undefined, stepInstanceId: stepId,
      correlationId: o.correlationId, causationId, chaveIdempotencia: chaveEvt,
      dados: { de: step.status, para: alvo },
    },
  })
  await tx.domainOutbox.create({
    data: {
      tipo: "step.reaberto", aggregateType: "PhaseWorkflowStepInstance", aggregateId: stepId,
      correlationId: o.correlationId, causationId, chaveIdempotencia: `outbox|${chaveEvt}`,
      payload: { stepId, alvo, de: step.status, ciclo: o.ciclo },
    },
  })
  return { changed: true, anterior: step.status, atual: alvo }
}

// ---------------- APLICADOR: TAREFA (CAS) ----------------
async function aplicarTarefa(tx: TX, tarefaId: number, alvo: string, tipoEvento: WorkflowEventoTipo, o: ApplyOpts) {
  const t = await tx.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return { changed: false, anterior: "", atual: "", code: "TAREFA_NAO_ENCONTRADA" as H.FailureCodeD }
  if (t.statusTarefa === alvo) return { changed: false, anterior: t.statusTarefa, atual: t.statusTarefa }
  if (!H.podeAplicarTarefa(t.statusTarefa, alvo)) return { changed: false, anterior: t.statusTarefa, atual: t.statusTarefa, code: "TRANSICAO_INVALIDA" as H.FailureCodeD }

  const now = new Date()
  const data: Prisma.TarefaUpdateManyMutationInput = {
    statusTarefa: alvo as Prisma.TarefaUpdateManyMutationInput["statusTarefa"],
    lockVersion: { increment: 1 },
    ...(o.extra as object),
  }
  if (alvo === "EM_ANDAMENTO") data.dataInicio = t.dataInicio ?? now
  if (alvo === TAREFA_CONCLUIDA_STATUS) { data.concluida = true; data.dataConclusao = now }

  const res = await tx.tarefa.updateMany({
    where: { id: tarefaId, statusTarefa: t.statusTarefa as Prisma.TarefaWhereInput["statusTarefa"], lockVersion: t.lockVersion },
    data,
  })
  if (res.count === 0) return { changed: false, anterior: t.statusTarefa, atual: t.statusTarefa, code: "CONFLITO" as H.FailureCodeD }

  const chaveEvt = H.chaveEvento(tipoEvento, "tarefa", tarefaId, alvo, o.ciclo, t.lockVersion)
  await tx.workflowEvento.create({
    data: {
      tipo: tipoEvento, entityType: "tarefa", entityId: tarefaId,
      processoId: o.processoId, workflowInstanceId: o.workflowInstanceId ?? undefined, tarefaId,
      correlationId: o.correlationId, causationId: o.causationId, chaveIdempotencia: chaveEvt, dados: o.dados,
    },
  })
  await tx.domainOutbox.create({
    data: {
      tipo: `tarefa.${alvo.toLowerCase()}`, aggregateType: "Tarefa", aggregateId: tarefaId,
      correlationId: o.correlationId, causationId: o.causationId, chaveIdempotencia: `outbox|${chaveEvt}`,
      payload: { tarefaId, alvo, ciclo: o.ciclo },
    },
  })
  return { changed: true, anterior: t.statusTarefa, atual: alvo }
}

// ---------------- gate de runtime v2 ----------------
async function gateV2(processoId: number): Promise<{ ok: true } | { ok: false; code: H.FailureCodeD }> {
  const proc = await prisma.processo.findUnique({ where: { id: processoId }, select: { workflowRuntime: true } })
  const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  const v2Global = cfg?.runtimeV2Habilitado ?? false
  if (!v2Global) return { ok: false, code: "RUNTIME_V2_DESABILITADO" }
  if (resolveWorkflowRuntime(proc?.workflowRuntime, v2Global) !== "v2") return { ok: false, code: "PROCESSO_LEGACY" }
  return { ok: true }
}

// helpers de contexto
function corr(ctx: SyncContexto): string { return ctx.correlationId ?? randomUUID() }
function ok(changed: boolean, correlationId: string, ea: { tarefa?: string; passo?: string }, ec: { tarefa?: string; passo?: string }, eventos: string[], warnings: H.SyncIssue[] = []): SyncResultado {
  return { success: true, changed, estadoAnterior: ea, estadoAtual: ec, eventos, warnings, correlationId }
}
function ko(code: H.FailureCodeD, correlationId: string, msg: string = code): SyncResultado {
  return { success: false, code, errors: [{ code, message: msg }], correlationId }
}

// carrega step + processo/workflow para as ops de Passo
async function carregarStep(stepId: number) {
  return prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepId },
    include: { tarefas: { where: { chaveIdempotencia: { not: null } }, take: 1 }, workflowInstance: { select: { status: true } } },
  })
}

// ============================================================
// TAREFA → PASSO
// ============================================================
export async function iniciarTarefa(tarefaId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return ko("TAREFA_NAO_ENCONTRADA", correlationId)
  const gate = await gateV2(t.processoId!)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = t.ciclo ?? 1
  const causationId = ctx.causationId ?? H.chaveComando("task-start", "tarefa", tarefaId, "EM_ANDAMENTO", ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: t.processoId!, workflowInstanceId: t.workflowInstanceId }
  try {
    return await prisma.$transaction(async (tx) => {
      const rt = await aplicarTarefa(tx, tarefaId, "EM_ANDAMENTO", "TAREFA_INICIADA", base)
      if (rt.code) return ko(rt.code, correlationId)
      let rp: { changed: boolean; anterior?: string; atual?: string } = { changed: false }
      if (t.workflowStepInstanceId) rp = await aplicarPasso(tx, t.workflowStepInstanceId, "EM_ANDAMENTO", "PASSO_INICIADO", base)
      if (t.workflowStepInstanceId) await assegurarCoerenciaPassoTarefa(tx, [t.workflowStepInstanceId])
      return ok(rt.changed || rp.changed, correlationId, { tarefa: rt.anterior, passo: rp.anterior }, { tarefa: rt.atual, passo: rp.atual }, ["TAREFA_INICIADA", ...(rp.changed ? ["PASSO_INICIADO"] : [])])
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export async function concluirTarefa(tarefaId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return ko("TAREFA_NAO_ENCONTRADA", correlationId)
  const gate = await gateV2(t.processoId!)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = t.ciclo ?? 1
  const causationId = ctx.causationId ?? H.chaveComando("task-complete", "tarefa", tarefaId, TAREFA_CONCLUIDA_STATUS, ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: t.processoId!, workflowInstanceId: t.workflowInstanceId }

  let exigeAprovacao = false
  if (t.workflowStepInstanceId) {
    const step = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: t.workflowStepInstanceId }, select: { snapshot: true } })
    exigeAprovacao = (step?.snapshot as { exigeAprovacao?: boolean } | null)?.exigeAprovacao === true
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const rt = await aplicarTarefa(tx, tarefaId, TAREFA_CONCLUIDA_STATUS, "TAREFA_CONCLUIDA", { ...base, extra: { executedById: ctx.usuarioId ?? t.responsavelId } })
      if (rt.code) return ko(rt.code, correlationId)
      const eventos = ["TAREFA_CONCLUIDA"]
      let passoAnterior: string | undefined, passoAtual: string | undefined
      if (t.workflowStepInstanceId) {
        if (exigeAprovacao) {
          const rx = await aplicarPasso(tx, t.workflowStepInstanceId, "EXECUTADO", "PASSO_EXECUTADO", base)
          passoAnterior = rx.anterior
          const ra = await aplicarPasso(tx, t.workflowStepInstanceId, "AGUARDANDO_APROVACAO", "PASSO_AGUARDANDO_APROVACAO", base)
          passoAtual = ra.atual
          if (rx.changed) eventos.push("PASSO_EXECUTADO")
          if (ra.changed) eventos.push("PASSO_AGUARDANDO_APROVACAO")
        } else {
          const rc = await aplicarPasso(tx, t.workflowStepInstanceId, "CONCLUIDO", "PASSO_CONCLUIDO", base)
          passoAnterior = rc.anterior; passoAtual = rc.atual
          if (rc.changed) eventos.push("PASSO_CONCLUIDO")
        }
      }
      if (t.workflowStepInstanceId) await assegurarCoerenciaPassoTarefa(tx, [t.workflowStepInstanceId])
      return ok(rt.changed, correlationId, { tarefa: rt.anterior, passo: passoAnterior }, { tarefa: rt.atual, passo: passoAtual }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export async function bloquearTarefa(tarefaId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return ko("TAREFA_NAO_ENCONTRADA", correlationId)
  if (!ctx.motivoCodigo) return ko("MOTIVO_OBRIGATORIO", correlationId)
  const gate = await gateV2(t.processoId!)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = t.ciclo ?? 1
  const causationId = ctx.causationId ?? H.chaveComando("task-block", "tarefa", tarefaId, "BLOQUEADA", ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: t.processoId!, workflowInstanceId: t.workflowInstanceId }
  try {
    return await prisma.$transaction(async (tx) => {
      const rt = await aplicarTarefa(tx, tarefaId, "BLOQUEADA", "TAREFA_BLOQUEADA", { ...base, extra: { blockedPreviousStatus: t.statusTarefa, motivoCodigo: ctx.motivoCodigo, justificativa: ctx.justificativa } })
      if (rt.code) return ko(rt.code, correlationId)
      const eventos = ["TAREFA_BLOQUEADA"]
      let passoAnt: string | undefined, passoAt: string | undefined
      if (t.workflowStepInstanceId) {
        const step = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: t.workflowStepInstanceId }, select: { status: true } })
        const rp = await aplicarPasso(tx, t.workflowStepInstanceId, "BLOQUEADO", "PASSO_BLOQUEADO", { ...base, extra: { statusAnteriorBloqueio: step?.status } })
        passoAnt = rp.anterior; passoAt = rp.atual
        if (rp.changed) eventos.push("PASSO_BLOQUEADO")
      }
      return ok(rt.changed, correlationId, { tarefa: rt.anterior, passo: passoAnt }, { tarefa: rt.atual, passo: passoAt }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export async function desbloquearTarefa(tarefaId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return ko("TAREFA_NAO_ENCONTRADA", correlationId)
  const gate = await gateV2(t.processoId!)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = t.ciclo ?? 1
  const alvoT = H.restaurarStatusTarefa(t.blockedPreviousStatus)
  const causationId = ctx.causationId ?? H.chaveComando("task-unblock", "tarefa", tarefaId, alvoT, ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: t.processoId!, workflowInstanceId: t.workflowInstanceId }
  try {
    return await prisma.$transaction(async (tx) => {
      const rt = await aplicarTarefa(tx, tarefaId, alvoT, "TAREFA_DESBLOQUEADA", { ...base, extra: { blockedPreviousStatus: null } })
      if (rt.code) return ko(rt.code, correlationId)
      const eventos = ["TAREFA_DESBLOQUEADA"]
      let passoAnt: string | undefined, passoAt: string | undefined
      if (t.workflowStepInstanceId) {
        const step = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: t.workflowStepInstanceId }, select: { statusAnteriorBloqueio: true } })
        const alvoP = H.restaurarStatusPasso(step?.statusAnteriorBloqueio)
        const rp = await aplicarPasso(tx, t.workflowStepInstanceId, alvoP, "PASSO_DESBLOQUEADO", { ...base, extra: { statusAnteriorBloqueio: null } })
        passoAnt = rp.anterior; passoAt = rp.atual
        if (rp.changed) eventos.push("PASSO_DESBLOQUEADO")
      }
      return ok(rt.changed, correlationId, { tarefa: rt.anterior, passo: passoAnt }, { tarefa: rt.atual, passo: passoAt }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export async function cancelarTarefa(tarefaId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t) return ko("TAREFA_NAO_ENCONTRADA", correlationId)
  if (!ctx.motivoCodigo || !ctx.justificativa) return ko("MOTIVO_OBRIGATORIO", correlationId)
  if (!ctx.politica) return ko("POLITICA_INVALIDA", correlationId)
  const gate = await gateV2(t.processoId!)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = t.ciclo ?? 1
  const destino = H.destinoCancelamentoTarefa(ctx.politica)
  const causationId = ctx.causationId ?? H.chaveComando("task-cancel", "tarefa", tarefaId, destino.tarefaAlvo, ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: t.processoId!, workflowInstanceId: t.workflowInstanceId }
  const evtT: WorkflowEventoTipo = destino.tarefaAlvo === "SUPERSEDIDA" ? "TAREFA_SUPERSEDIDA" : "TAREFA_CANCELADA"
  try {
    return await prisma.$transaction(async (tx) => {
      const rt = await aplicarTarefa(tx, tarefaId, destino.tarefaAlvo, evtT, { ...base, extra: { motivoCodigo: ctx.motivoCodigo, justificativa: ctx.justificativa } })
      if (rt.code) return ko(rt.code, correlationId)
      const eventos = [evtT as string]
      let passoAnt: string | undefined, passoAt: string | undefined
      if (t.workflowStepInstanceId && destino.passoAlvo) {
        const evtP: WorkflowEventoTipo = destino.passoAlvo === "SUPERSEDIDO" ? "PASSO_SUPERSEDIDO" : destino.passoAlvo === "CANCELADO" ? "PASSO_CANCELADO" : destino.passoAlvo === "BLOQUEADO" ? "PASSO_BLOQUEADO" : "PASSO_DESBLOQUEADO"
        const rp = await aplicarPasso(tx, t.workflowStepInstanceId, destino.passoAlvo, evtP, base)
        passoAnt = rp.anterior; passoAt = rp.atual
        if (rp.changed) eventos.push(evtP)
      }
      return ok(rt.changed, correlationId, { tarefa: rt.anterior, passo: passoAnt }, { tarefa: rt.atual, passo: passoAt }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

// ============================================================
// PASSO → TAREFA
// ============================================================
async function opPassoSimples(stepInstanceId: number, ctx: SyncContexto, alvoPasso: string, evtPasso: WorkflowEventoTipo, opKey: string, sincronizarTarefa?: { alvo: string; evt: WorkflowEventoTipo; extra?: Record<string, unknown> }): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const step = await carregarStep(stepInstanceId)
  if (!step) return ko("STEP_NAO_ENCONTRADO", correlationId)
  const gate = await gateV2(step.processoId)
  if (!gate.ok) return ko(gate.code, correlationId)
  const ciclo = step.ciclo
  const causationId = ctx.causationId ?? H.chaveComando(opKey, "step_instance", stepInstanceId, alvoPasso, ciclo)
  const base: ApplyOpts = { correlationId, causationId, ciclo, processoId: step.processoId, workflowInstanceId: step.workflowInstanceId }
  const tarefa = step.tarefas[0]
  try {
    return await prisma.$transaction(async (tx) => {
      const rp = await aplicarPasso(tx, stepInstanceId, alvoPasso, evtPasso, base)
      if (rp.code) return ko(rp.code, correlationId)
      const eventos = [evtPasso as string]
      let tAnt: string | undefined, tAt: string | undefined
      if (tarefa && sincronizarTarefa) {
        const rt = await aplicarTarefa(tx, tarefa.id, sincronizarTarefa.alvo, sincronizarTarefa.evt, { ...base, extra: sincronizarTarefa.extra })
        tAnt = rt.anterior; tAt = rt.atual
        if (rt.changed) eventos.push(sincronizarTarefa.evt as string)
      }
      await assegurarCoerenciaPassoTarefa(tx, [stepInstanceId])
      return ok(rp.changed, correlationId, { passo: rp.anterior, tarefa: tAnt }, { passo: rp.atual, tarefa: tAt }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export function iniciarPasso(stepInstanceId: number, ctx: SyncContexto) {
  return opPassoSimples(stepInstanceId, ctx, "EM_ANDAMENTO", "PASSO_INICIADO", "step-start", { alvo: "EM_ANDAMENTO", evt: "TAREFA_INICIADA" })
}

export async function concluirPasso(stepInstanceId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const step = await carregarStep(stepInstanceId)
  if (!step) return ko("STEP_NAO_ENCONTRADO", correlationId)
  const gate = await gateV2(step.processoId)
  if (!gate.ok) return ko(gate.code, correlationId)
  const exigeAprovacao = (step.snapshot as { exigeAprovacao?: boolean } | null)?.exigeAprovacao === true
  const ciclo = step.ciclo
  const base: ApplyOpts = { correlationId, causationId: ctx.causationId ?? H.chaveComando("step-complete", "step_instance", stepInstanceId, "CONCLUIDO", ciclo), ciclo, processoId: step.processoId, workflowInstanceId: step.workflowInstanceId }
  const tarefa = step.tarefas[0]
  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const eventos: string[] = []
      let pAnt: string | undefined, pAt: string | undefined
      if (exigeAprovacao) {
        const rx = await aplicarPasso(tx, stepInstanceId, "EXECUTADO", "PASSO_EXECUTADO", base); pAnt = rx.anterior
        const ra = await aplicarPasso(tx, stepInstanceId, "AGUARDANDO_APROVACAO", "PASSO_AGUARDANDO_APROVACAO", base); pAt = ra.atual
        if (rx.changed) eventos.push("PASSO_EXECUTADO"); if (ra.changed) eventos.push("PASSO_AGUARDANDO_APROVACAO")
      } else {
        const rc = await aplicarPasso(tx, stepInstanceId, "CONCLUIDO", "PASSO_CONCLUIDO", base); pAnt = rc.anterior; pAt = rc.atual
        if (rc.code) return ko(rc.code, correlationId)
        if (rc.changed) eventos.push("PASSO_CONCLUIDO")
        // A PRÓXIMA ETAPA É LIBERADA AQUI TAMBÉM. Concluir pela Central e pela
        // fila de tarefas tem de deixar o roteiro no mesmo lugar: sem isto, a
        // conclusão vinda daqui fechava a etapa e o trabalho parava com todas
        // as seguintes PENDENTES.
        if (rc.changed && step.workflowInstanceId != null) {
          const ativada = await ativarProximoPassoTx(
            tx,
            {
              workflowInstanceId: step.workflowInstanceId,
              ordemConcluida: step.ordem,
              // A PRÓXIMA ETAPA É DESTE DOCUMENTO. O passo concluído sabe de
              // qual obrigação é; a instância, não.
              necessidadeId: step.necessidadeId,
              documentoId: step.documentoId,
            },
            { correlationId, operacao: "step-complete-proximo" },
          )
          if (ativada != null) eventos.push("PASSO_DISPONIBILIZADO")
        }
      }
      // O ESTADO DA TAREFA É DERIVADO, NÃO DECIDIDO AQUI.
      //
      // Antes, concluir um passo concluía a tarefa — o que estava certo quando
      // passo e tarefa eram a mesma coisa. Hoje uma tarefa carrega N passos:
      // concluir "enviar ao cartório" não encerra o pedido de certidão, encerra
      // uma etapa dele. Quem sabe se o trabalho acabou é o conjunto das etapas
      // OBRIGATÓRIAS, e essa conta vive num lugar só (`estadoDerivado`).
      //
      // Para a tarefa de passo único o resultado é idêntico ao anterior: o
      // último passo concluído deriva CONCLUIDO_RECEBIDO e o evento
      // TAREFA_CONCLUIDA continua saindo daqui.
      let tAnt: string | undefined, tAt: string | undefined
      if (tarefa) {
        const derivado = await statusDerivadoDaTarefa(tx, tarefa.id)
        if (derivado != null && TAREFA_CONCLUIDA_SET.has(derivado)) {
          const rt = await aplicarTarefa(tx, tarefa.id, derivado, "TAREFA_CONCLUIDA", { ...base, extra: { executedById: ctx.usuarioId ?? tarefa.responsavelId } })
          tAnt = rt.anterior; tAt = rt.atual
          if (rt.changed) eventos.push("TAREFA_CONCLUIDA")
        } else {
          // Ainda há etapa a fazer: a tarefa continua aberta e o ponteiro anda
          // para a próxima. Sem isto a trava de coerência derrubaria a
          // transação — passo CONCLUIDO apontado por tarefa EM_ANDAMENTO é
          // contradição.
          const r = await sincronizarTarefaComWorkflow(tx, tarefa.id, new Date())
          tAnt = tarefa.statusTarefa; tAt = r.status
          if (r.mudou) eventos.push("TAREFA_SINCRONIZADA")
        }
      }
      // TRAVA antes do commit: o par não pode terminar contraditório. Se o mapeamento
      // desta operação divergir do mapeamento OFICIAL, a transação cai aqui — o
      // desalinhamento aparece na hora, não meses depois num relatório.
      await assegurarCoerenciaPassoTarefa(tx, [stepInstanceId])
      return ok(eventos.length > 0, correlationId, { passo: pAnt, tarefa: tAnt }, { passo: pAt, tarefa: tAt }, eventos)
    })
    // O `step.concluido` já foi emitido DENTRO da transação acima. Drenar aqui só
    // antecipa o efeito (projeção financeira documental) para o mesmo clique, em
    // vez de esperar o próximo ciclo da fila. Best-effort: se falhar, o evento
    // continua PENDENTE e reprocessa — nada se perde.
    await processarOutbox({ tipos: ["step.concluido"], limite: 20 }).catch(() => {})
    return resultado
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export async function aprovarPasso(stepInstanceId: number, ctx: SyncContexto): Promise<SyncResultado> {
  const correlationId = corr(ctx)
  const step = await carregarStep(stepInstanceId)
  if (!step) return ko("STEP_NAO_ENCONTRADO", correlationId)
  const gate = await gateV2(step.processoId)
  if (!gate.ok) return ko(gate.code, correlationId)
  if (step.status !== "AGUARDANDO_APROVACAO") return ko("NAO_AGUARDANDO_APROVACAO", correlationId)
  const segregacao = (step.snapshot as { segregacaoDeFuncoes?: boolean } | null)?.segregacaoDeFuncoes === true
  const executor = step.tarefas[0]?.executedById ?? step.responsavelId ?? null
  if (segregacao && ctx.aprovadorId != null && executor != null && ctx.aprovadorId === executor) {
    return ko("SEGREGACAO_VIOLADA", correlationId, "Aprovador não pode ser o executor")
  }
  const ciclo = step.ciclo
  const base: ApplyOpts = { correlationId, causationId: ctx.causationId ?? H.chaveComando("step-approve", "step_instance", stepInstanceId, "CONCLUIDO", ciclo), ciclo, processoId: step.processoId, workflowInstanceId: step.workflowInstanceId }
  try {
    return await prisma.$transaction(async (tx) => {
      const eventos: string[] = []
      const ra = await aplicarPasso(tx, stepInstanceId, "CONCLUIDO", "PASSO_APROVADO", { ...base, extra: { aprovadorId: ctx.aprovadorId, approvedAt: new Date() } })
      if (ra.code) return ko(ra.code, correlationId)
      if (ra.changed) eventos.push("PASSO_APROVADO", "PASSO_CONCLUIDO")
      // Aprovar CONCLUI o passo: a tarefa (já concluída pelo executor) tem de estar
      // coerente com isso antes do commit.
      await projetarTarefaDoPasso(tx, { stepInstanceId, statusPasso: "CONCLUIDO", usuarioId: ctx.aprovadorId })
      await assegurarCoerenciaPassoTarefa(tx, [stepInstanceId])
      return ok(ra.changed, correlationId, { passo: ra.anterior }, { passo: ra.atual }, eventos)
    })
  } catch (e) { return convergirOuThrow(e, correlationId) }
}

export function dispensarPasso(stepInstanceId: number, ctx: SyncContexto) {
  if (!ctx.motivoCodigo || !ctx.justificativa) return Promise.resolve(ko("MOTIVO_OBRIGATORIO", corr(ctx)))
  return opPassoSimples(stepInstanceId, ctx, "DISPENSADO", "PASSO_DISPENSADO", "step-dispense",
    { alvo: "CANCELADA", evt: "TAREFA_CANCELADA", extra: { motivoCodigo: ctx.motivoCodigo, justificativa: ctx.justificativa } })
}

export function cancelarPasso(stepInstanceId: number, ctx: SyncContexto) {
  if (!ctx.motivoCodigo) return Promise.resolve(ko("MOTIVO_OBRIGATORIO", corr(ctx)))
  return opPassoSimples(stepInstanceId, ctx, "CANCELADO", "PASSO_CANCELADO", "step-cancel",
    { alvo: "CANCELADA", evt: "TAREFA_CANCELADA", extra: { motivoCodigo: ctx.motivoCodigo, justificativa: ctx.justificativa } })
}

export function supersederPasso(stepInstanceId: number, ctx: SyncContexto) {
  return opPassoSimples(stepInstanceId, ctx, "SUPERSEDIDO", "PASSO_SUPERSEDIDO", "step-supersede",
    { alvo: "SUPERSEDIDA", evt: "TAREFA_SUPERSEDIDA" })
}

// concorrência: P2002 (evento) ou conflito → releitura convergente
function convergirOuThrow(e: unknown, correlationId: string): SyncResultado {
  if ((e as { code?: string })?.code === "P2002") {
    return { success: true, changed: false, estadoAnterior: {}, estadoAtual: {}, eventos: [], warnings: [{ code: "IDEMPOTENTE", message: "Operação já aplicada (evento único)" }], correlationId }
  }
  throw e
}
