// lib/operacional/torre-semana.ts
// ============================================================================
// "ESTA SEMANA" DA TORRE — a ÚNICA definição (módulo-folha: sem dependência de nenhuma outra tela da Torre).
//   · início = segunda-feira 00:00 de SÃO PAULO (não o fuso do servidor);
//   · ABRE  = tarefas criadas desde a segunda que ainda são trabalho (cancelada/supersedida NUNCA contam como "aberta") de processo na Torre;
//   · FECHA = concluídas com sucesso desde a segunda, de processo na Torre.
// Funil, tendência ("vs semana passada"), foto diária e Saúde da fase leem DAQUI. Achado 04/10/2026: o funil dizia "abre 43" com
// "Tarefas abertas 32" (11 canceladas contadas) e a semana do funil começava 3 h antes da da Saúde da fase.
// ============================================================================
import type { Prisma } from '@prisma/client'
import { ONDE_TAREFA_DE_PROCESSO_NA_TORRE } from '@/src/services/processo-pre-contrato'
import { inicioDaSemanaOperacional } from './tempo-operacional'

const STATUS_CONCLUIDOS_SUCESSO = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'] as const

/** A segunda-feira 00:00 (de SÃO PAULO) da semana de `d`. */
export const inicioDaSemana = (d: Date): Date => inicioDaSemanaOperacional(d)

export const ONDE_TAREFA_ABERTA_NA_SEMANA = (inicio: Date): Prisma.TarefaWhereInput => ({
  createdAt: { gte: inicio }, statusTarefa: { notIn: ['CANCELADA', 'SUPERSEDIDA'] }, AND: [ONDE_TAREFA_DE_PROCESSO_NA_TORRE],
})
export const ONDE_TAREFA_FECHADA_NA_SEMANA = (inicio: Date): Prisma.TarefaWhereInput => ({
  statusTarefa: { in: [...STATUS_CONCLUIDOS_SUCESSO] }, dataConclusao: { gte: inicio }, AND: [ONDE_TAREFA_DE_PROCESSO_NA_TORRE],
})
