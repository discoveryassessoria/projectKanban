// src/services/passo-tarefa-projecao.ts
//
// PASSO É O ESTADO OFICIAL. A TAREFA É PROJEÇÃO DELE.
//
// A instância do passo (PhaseWorkflowStepInstance) é a fonte de verdade do estado
// operacional. A Tarefa existe para que o trabalho apareça nas filas, nos painéis e
// nas cobranças — ela ESPELHA o passo, nunca discorda dele.
//
// Este módulo é onde esse espelhamento vive, e é o único lugar onde o mapeamento
// passo → tarefa está escrito. Toda transição de passo, venha de onde vier, projeta
// a tarefa pela MESMA tabela e dentro da MESMA transação:
//
//   • task-step-sync (fluxo canônico Tarefa↔Passo);
//   • operação por documento/necessidade (Central e drawer);
//   • delegação e demais operações que mexem no passo.
//
// O que ele NÃO faz: não decide se a transição do PASSO é válida (isso é do serviço
// que conduz a transição), não avança fase, não conclui necessidade, não cria tarefa
// (quem cria é `garantirTarefaDePasso`).
//
// Antes disto, `atualizarPassoV2` escrevia o status do passo direto e não tocava na
// Tarefa: em produção o passo "Localizar registro da certidão" ficou CONCLUIDO com a
// tarefa NAO_INICIADA. Estado operacional contraditório para a MESMA execução.

import { Prisma, type StatusTarefa, type StepInstanceStatus } from "@prisma/client"

type TX = Prisma.TransactionClient

/**
 * MAPEAMENTO OFICIAL passo → tarefa. Fonte única.
 *
 * `null` significa "a tarefa não tem estado correspondente e NÃO deve ser tocada" —
 * não é o mesmo que "deixe como está por engano". Hoje só EXECUTADO e
 * AGUARDANDO_APROVACAO caem aí: o trabalho foi feito, mas a conclusão formal depende
 * da aprovação, e a tarefa só fecha quando o passo fecha.
 */
export const STATUS_TAREFA_POR_PASSO: Record<StepInstanceStatus, StatusTarefa | null> = {
  PENDENTE: "NAO_INICIADA",
  DISPONIVEL: "NAO_INICIADA",
  EM_ANDAMENTO: "EM_ANDAMENTO",
  AGUARDANDO: "AGUARDANDO_TERCEIRO",
  BLOQUEADO: "BLOQUEADA",
  EXECUTADO: null,
  AGUARDANDO_APROVACAO: null,
  CONCLUIDO: "CONCLUIDO_RECEBIDO",
  FALHOU: "BLOQUEADA",
  CANCELADO: "CANCELADA",
  DISPENSADO: "CANCELADA",
  SUPERSEDIDO: "SUPERSEDIDA",
}

/** Estados de tarefa que contam como conclusão (`concluida = true`). */
const TAREFA_CONCLUIDA = new Set<StatusTarefa>(["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"])

/** Passo encerrado: não há mais trabalho a fazer nele. */
const PASSO_ENCERRADO = new Set<StepInstanceStatus>(["CONCLUIDO", "CANCELADO", "DISPENSADO", "SUPERSEDIDO"])
/** Tarefa encerrada: idem, do lado da tarefa. */
const TAREFA_ENCERRADA = new Set<StatusTarefa>(["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"])

/**
 * O par (passo, tarefa) é COERENTE?
 *
 * Coerência proíbe CONTRADIÇÃO, não diferença. Passo DISPONIVEL com tarefa
 * EM_ANDAMENTO não é contradição — é alguém que começou a trabalhar antes de o
 * sistema saber. Exigir igualdade aqui rebaixaria o trabalho em curso a cada
 * projeção, e travaria o desbloqueio (o passo volta a DISPONIVEL, a tarefa volta a
 * EM_ANDAMENTO).
 *
 * As contradições REAIS, e são estas que derrubam a transação:
 *   • passo encerrado com tarefa aberta (o caso de produção: CONCLUIDO × NAO_INICIADA);
 *   • tarefa encerrada com passo ainda aberto;
 *   • encerramento de naturezas opostas (concluído de um lado, cancelado do outro).
 *
 * EXECUTADO e AGUARDANDO_APROVACAO ficam FORA da verificação de propósito: ali a
 * tarefa já foi concluída pelo executor e o passo aguarda o aprovador. Os dois
 * estados são diferentes porque o fluxo é esse, não porque divergiram.
 */
export function paresCoerentes(
  statusPasso: StepInstanceStatus | string,
  statusTarefa: StatusTarefa | string,
): boolean {
  const passo = statusPasso as StepInstanceStatus
  const tarefa = statusTarefa as StatusTarefa
  const esperado = STATUS_TAREFA_POR_PASSO[passo]
  if (esperado === null || esperado === undefined) return true

  const passoEncerrado = PASSO_ENCERRADO.has(passo)
  const tarefaEncerrada = TAREFA_ENCERRADA.has(tarefa)

  // Um lado encerrado e o outro aberto é contradição — nos dois sentidos.
  if (passoEncerrado !== tarefaEncerrada) return false
  if (!passoEncerrado) return true

  // Ambos encerrados: a NATUREZA do encerramento tem de bater. Concluir e cancelar
  // dizem coisas opostas sobre o mesmo trabalho.
  const passoConcluiu = passo === "CONCLUIDO"
  const tarefaConcluiu = TAREFA_CONCLUIDA.has(tarefa)
  return passoConcluiu === tarefaConcluiu
}

export interface ProjecaoResultado {
  /** A tarefa mudou de estado nesta projeção. */
  changed: boolean
  tarefaId: number | null
  de: string | null
  para: string | null
}

export interface ProjetarInput {
  stepInstanceId: number
  /** Status ALVO do passo (já decidido por quem conduz a transição). */
  statusPasso: StepInstanceStatus
  /** Quem executou — vira `executedById` quando a projeção conclui a tarefa. */
  usuarioId?: number | null
  agora?: Date
}

/**
 * Projeta o estado do passo na Tarefa vinculada, DENTRO da transação de quem chama.
 *
 * Idempotente: se a tarefa já está no estado projetado, não escreve. Sem tarefa
 * vinculada, não faz nada — passo sem tarefa é legítimo (`geraTarefa = false`).
 */
export async function projetarTarefaDoPasso(tx: TX, input: ProjetarInput): Promise<ProjecaoResultado> {
  const alvo = STATUS_TAREFA_POR_PASSO[input.statusPasso]
  if (alvo == null) return { changed: false, tarefaId: null, de: null, para: null }

  const tarefa = await tx.tarefa.findFirst({
    where: { workflowStepInstanceId: input.stepInstanceId },
    select: { id: true, statusTarefa: true, concluida: true, dataInicio: true, dataConclusao: true, responsavelId: true },
    orderBy: { id: "asc" },
  })
  if (!tarefa) return { changed: false, tarefaId: null, de: null, para: null }
  if (paresCoerentes(input.statusPasso, tarefa.statusTarefa)) {
    return { changed: false, tarefaId: tarefa.id, de: tarefa.statusTarefa, para: tarefa.statusTarefa }
  }

  const agora = input.agora ?? new Date()
  const concluiu = TAREFA_CONCLUIDA.has(alvo)
  const data: Prisma.TarefaUpdateInput = {
    statusTarefa: alvo,
    // As datas acompanham o estado do PASSO — não podem ficar só de um lado.
    concluida: concluiu,
    dataConclusao: concluiu ? (tarefa.dataConclusao ?? agora) : null,
    ...(alvo === "EM_ANDAMENTO" || concluiu ? { dataInicio: tarefa.dataInicio ?? agora } : {}),
    ...(concluiu ? { executedById: input.usuarioId ?? tarefa.responsavelId ?? null } : {}),
  }

  await tx.tarefa.update({ where: { id: tarefa.id }, data })
  return { changed: true, tarefaId: tarefa.id, de: tarefa.statusTarefa, para: alvo }
}

// --------------------------------------------------------------------------
// INVARIANTE TRANSACIONAL
// --------------------------------------------------------------------------

export interface DivergenciaPassoTarefa {
  stepInstanceId: number
  tarefaId: number
  statusPasso: string
  statusTarefa: string
  esperado: string | null
}

export class DivergenciaPassoTarefaError extends Error {
  readonly divergencias: DivergenciaPassoTarefa[]
  constructor(divergencias: DivergenciaPassoTarefa[]) {
    super(
      `Passo e tarefa em estados contraditórios (${divergencias.length}): ` +
      divergencias.map((d) => `passo ${d.stepInstanceId}=${d.statusPasso} × tarefa ${d.tarefaId}=${d.statusTarefa} (esperado ${d.esperado})`).join("; "),
    )
    this.name = "DivergenciaPassoTarefaError"
    this.divergencias = divergencias
  }
}

/** Lista as divergências entre os passos indicados e as tarefas deles. */
export async function conferirCoerenciaPassoTarefa(tx: TX, stepInstanceIds: number[]): Promise<DivergenciaPassoTarefa[]> {
  if (stepInstanceIds.length === 0) return []
  const passos = await tx.phaseWorkflowStepInstance.findMany({
    where: { id: { in: stepInstanceIds } },
    select: { id: true, status: true, tarefas: { select: { id: true, statusTarefa: true }, orderBy: { id: "asc" } } },
  })
  const divergencias: DivergenciaPassoTarefa[] = []
  for (const p of passos) {
    for (const t of p.tarefas) {
      if (paresCoerentes(p.status, t.statusTarefa)) continue
      divergencias.push({
        stepInstanceId: p.id, tarefaId: t.id,
        statusPasso: String(p.status), statusTarefa: String(t.statusTarefa),
        esperado: STATUS_TAREFA_POR_PASSO[p.status] ?? null,
      })
    }
  }
  return divergencias
}

/**
 * TRAVA antes do commit: se algum par ficou contraditório, lança e a transação
 * inteira volta atrás. Um estado meio-atualizado é pior do que a operação recusada —
 * ele fica no banco parecendo verdade.
 */
export async function assegurarCoerenciaPassoTarefa(tx: TX, stepInstanceIds: number[]): Promise<void> {
  const divergencias = await conferirCoerenciaPassoTarefa(tx, stepInstanceIds)
  if (divergencias.length > 0) throw new DivergenciaPassoTarefaError(divergencias)
}
