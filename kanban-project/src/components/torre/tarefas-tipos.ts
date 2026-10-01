// src/components/torre/tarefas-tipos.ts — tipos da aba Tarefas no cliente (só tipos; nada do servidor entra no bundle).
import type { LinhaTorre } from "./tipos"

/** Quem cancelou, quando e por quê (`GET /api/torre/tarefas/canceladas`). */
export interface EncerramentoDaTarefa { quando: string | null; quandoRotulo: string | null; porNome: string | null; motivo: string | null }

/** A linha da tela: a da Torre, mais — só nas canceladas — o fato do cancelamento. Cancelada é EXIBIÇÃO: não conta, não seleciona, não entra em lote. */
export type LinhaDaTela = LinhaTorre & { encerramento?: EncerramentoDaTarefa | null }

/** Uma concluída da visão Feito (`GET /api/torre/tarefas/feito`): a linha + quem concluiu (`null` = sem registro → "—"). */
export type LinhaDoFeito = LinhaTorre & { concluidaPorNome?: string | null }

export const ehCancelada = (l: { statusTarefa: string }): boolean => l.statusTarefa === "CANCELADA"

/** O que a gaveta lê além da linha (`GET /api/torre/tarefas/{id}/gaveta`). */
export interface DadosDaGaveta {
  taskId: number
  etapas: Array<{ ordem: number; titulo: string; status: string; atual: boolean; concluidaEm: string | null }>
  historico: Array<{ em: string; quando: string; texto: string; autor: string | null }>
}

/** A ação (modal) que a linha ou a gaveta pede. */
export type AcaoComModal = "cobrar" | "cobrarCliente" | "adiar" | "desbloquear" | "repactuar" | "bloquear" | "reabrir" | "ligacao" | "canal"
