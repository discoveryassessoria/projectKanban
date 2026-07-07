// src/services/processEngine/taskEngine.ts
//
// ETAPA 3 — TASK ENGINE (fonte única de CRIAÇÃO de tarefa).
//
// Uma peça só que cria uma Tarefa COMPLETA e consistente a partir de uma
// "ficha" (spec): título, responsável, prioridade, prazo/SLA, dependência
// (via tarefaPai + ordem), follow-up (cobrança) e log de auditoria.
//
// ⚠ Isto NÃO cuida de idempotência. Quem chama pelo motor envolve esta
//    função no guard do MotorArtefato (automaticKey @unique) — é lá que a
//    proteção "não cria 2x" já existe e continua valendo. A criação manual
//    (rota /api/tarefas) pode usar esta peça sem o guard.
//
// ⚠ INVARIANTE (apostila): criar/concluir uma TAREFA não conclui um PASSO
//    do workflow. São coisas separadas. Esta peça só cria a tarefa.

import { prisma } from "@/lib/prisma"
import { PrioridadeTarefa } from "@prisma/client"
import type { Pais } from "@prisma/client"
import { logTarefa } from "@/lib/auditoria"

export interface TarefaSpec {
  titulo: string
  descricao?: string | null
  processoId?: number | null
  /** Opcional, só p/ o log de auditoria. Se ausente e houver processoId, busca. */
  processoNome?: string
  /** Usuário responsável JÁ resolvido (id). null = tarefa sem dono. */
  responsavelId?: number | null
  prioridade?: PrioridadeTarefa
  /** Prazo já pronto (Date). Tem prioridade sobre slaDays. */
  dataPrazo?: Date | null
  /** Alternativa ao dataPrazo: calcula prazo = hoje + slaDays. */
  slaDays?: number | null
  statusId?: number | null
  pais?: Pais | null
  /** Dependência = encaixa como subtarefa desta tarefa pai (usa a régua de
   *  ordem existente: só a próxima não-iniciada fica acionável). */
  tarefaPaiId?: number | null
  /** Se ausente, calcula a próxima ordem na sequência (igual à rota). */
  ordem?: number | null
  observacoes?: string | null
  /** Follow-up / cobrança automática (dias). Grava em Tarefa.prazoCobranca. */
  followUp?: { prazoCobranca?: number | null } | null
}

/**
 * Cria UMA tarefa bem-formada a partir da spec e devolve o registro criado.
 * Best-effort no log (uma falha de auditoria não derruba a criação).
 */
export async function criarTarefaDeSpec(spec: TarefaSpec) {
  // -- prioridade (default MÉDIA, igual à rota)
  const prioridade =
    spec.prioridade && Object.values(PrioridadeTarefa).includes(spec.prioridade)
      ? spec.prioridade
      : PrioridadeTarefa.MEDIA

  // -- prazo: data explícita OU calculada do SLA
  let dataPrazo: Date | null = spec.dataPrazo ?? null
  if (!dataPrazo && spec.slaDays && spec.slaDays > 0) {
    dataPrazo = new Date(Date.now() + spec.slaDays * 86400000)
  }

  // -- ordem: se não veio, próxima na sequência (mesma regra da rota)
  //    subtarefa → conta entre as irmãs; raiz → conta no processo
  let ordem = spec.ordem
  if (ordem === undefined || ordem === null) {
    const ultima = await prisma.tarefa.findFirst({
      where: spec.tarefaPaiId
        ? { tarefaPaiId: spec.tarefaPaiId }
        : { tarefaPaiId: null, processoId: spec.processoId ?? undefined },
      orderBy: { ordem: "desc" },
      select: { ordem: true },
    })
    ordem = (ultima?.ordem ?? -1) + 1
  }

  // -- cria a tarefa
  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: spec.titulo,
      descricao: spec.descricao ?? null,
      processoId: spec.processoId ?? null,
      responsavelId: spec.responsavelId ?? null,
      prioridade,
      dataPrazo,
      statusId: spec.statusId ?? null,
      pais: spec.pais ?? null,
      tarefaPaiId: spec.tarefaPaiId ?? null,
      ordem,
      observacoes: spec.observacoes ?? null,
      ...(spec.followUp?.prazoCobranca != null
        ? { prazoCobranca: spec.followUp.prazoCobranca }
        : {}),
    },
  })

  // -- auditoria (igual à rota) — não derruba a criação se falhar
  try {
    let processoNome = spec.processoNome
    if (!processoNome && spec.processoId) {
      const p = await prisma.processo.findUnique({
        where: { id: spec.processoId },
        select: { nome: true },
      })
      processoNome = p?.nome
    }
    await logTarefa.criar(tarefa.titulo, tarefa.id, processoNome)
  } catch (e) {
    console.error("[taskEngine] falha ao gravar log de auditoria (tarefa criada):", e)
  }

  return tarefa
}