// Tipos da Torre no cliente — espelho de `LinhaDaTorre` (src/services/torre-tarefas.ts) em JSON.
import type { LinhaOperacaoV3 } from "@/src/components/operacao/operacao-v3-tipos"

export interface LinhaTorre extends LinhaOperacaoV3 {
  orgaoId: number | null
  faseAtualKey: string | null
  podeIniciar: boolean
  motivoNaoIniciar: string | null
  cobravelVencida: boolean
}
export type Pill = "red" | "amb" | "grn" | "blu" | "gry"

/** DE QUEM É A BOLA — só campos reais da linha. */
export function bolaDe(l: LinhaTorre): { txt: string; cls: Pill } {
  if (l.esperandoDe === "terceiro") return { txt: l.terceiroNome ?? "Cartório", cls: "amb" }
  if (l.esperandoDe === "cliente") return { txt: "Cliente", cls: "amb" }
  if (l.statusTarefa === "BLOQUEADA") return { txt: "Bloqueada", cls: "red" }
  if (l.responsavelNome) return { txt: l.responsavelNome, cls: "blu" }
  return { txt: "Ninguém", cls: "red" }
}

/** RISCO — derivado dos indicadores que a Operação já calcula (nada recalculado). */
export function riscoDe(l: LinhaTorre): { txt: string; cls: Pill } {
  if (l.atrasada || l.escalada) return { txt: "Crítico", cls: "red" }
  if (l.emRisco || l.acompanhamentoVencido || l.statusTarefa === "BLOQUEADA") return { txt: "Atenção", cls: "amb" }
  return { txt: "No ritmo", cls: "grn" }
}
