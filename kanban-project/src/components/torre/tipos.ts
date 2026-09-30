// Tipos da Torre no cliente — espelho de `LinhaDaTorre` (src/services/torre-tarefas.ts) em JSON.
import type { LinhaOperacaoV3 } from "@/src/components/operacao/operacao-v3-tipos"
import { nivelDeRisco } from "@/lib/operacional/torre-filtros"

export interface LinhaTorre extends LinhaOperacaoV3 {
  orgaoId: number | null
  faseAtualKey: string | null
  podeIniciar: boolean
  motivoNaoIniciar: string | null
  cobravelVencida: boolean
  /** O processo desta linha está em risco CRÍTICO (mesmo score do Radar) — base do cartão "Processos em risco". */
  processoEmRisco?: boolean
}
export type Pill = "red" | "amb" | "grn" | "blu" | "gry"

/** DE QUEM É A BOLA — só campos reais da linha. */
export function bolaDe(l: LinhaOperacaoV3): { txt: string; cls: Pill } {
  if (l.esperandoDe === "terceiro") return { txt: l.terceiroNome ?? "Cartório", cls: "amb" }
  if (l.esperandoDe === "cliente") return { txt: "Cliente", cls: "amb" }
  if (l.statusTarefa === "BLOQUEADA") return { txt: "Bloqueada", cls: "red" }
  if (l.responsavelNome) return { txt: l.responsavelNome, cls: "blu" }
  return { txt: "Ninguém", cls: "red" }
}

/** RISCO — derivado dos indicadores que a Operação já calcula (nada recalculado). */
export function riscoDe(l: LinhaOperacaoV3): { txt: string; cls: Pill } {
  // O NÍVEL vem de UMA função (`nivelDeRisco`): a coluna Risco e o filtro Risco da barra nunca discordam.
  const n = nivelDeRisco(l)
  return n === "critico" ? { txt: "Crítico", cls: "red" } : n === "atencao" ? { txt: "Atenção", cls: "amb" } : { txt: "No ritmo", cls: "grn" }
}

/** A tarefa tem acompanhamento a adiar — a MESMA condição da aba Acompanhamento da Operação (`acompanhamentoPasso` com prazo). */
export const temAcompanhamento = (l: Pick<LinhaOperacaoV3, "acompanhamentoPasso">): boolean =>
  !!l.acompanhamentoPasso && !l.acompanhamentoPasso.semPrazo
