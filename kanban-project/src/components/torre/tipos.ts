// Tipos da Torre no cliente — espelho de `LinhaDaTorre` (src/services/torre-tarefas.ts) em JSON.
import type { LinhaOperacaoV3 } from "@/src/components/operacao/operacao-v3-tipos"
import { nivelDeRisco } from "@/lib/operacional/torre-filtros"
import type { CamposDaBola } from "@/lib/operacional/torre-bola"

/**
 * A linha da Torre no cliente. Campos ADITIVOS da Torre nova (Etapa A, 01/10/2026) — nomes EXATOS para as telas:
 *   `iniciouEm`            ISO de quando a tarefa foi iniciada (só de registro real; `null` = "—"/"não iniciou");
 *   `bolaCom`              Nossa · Cartório · Cliente · Tradutor · Juízo · Consulado (função única `torre-bola.ts`);
 *   `bolaDesde`            ISO do início da espera atual (`null` = sem registro, "—");
 *   `categoriaTerceiro`    o rótulo de terceiro do órgão da tarefa (`null` = a tarefa não tem órgão);
 *   `pedidaEm`             ISO do pedido (SolicitacaoDocumento.dataEnvio) — `null` = sem registro;
 *   `cobrarEm`             ISO de quando cobrar (acompanhamento registrado, ou o padrão de 7 dias) — `null` = nada a cobrar;
 *   `cobrarEmPadrao`       `true` = `cobrarEm` é o padrão de 7 dias, não uma data registrada.
 */
export interface LinhaTorre extends LinhaOperacaoV3, CamposDaBola {
  iniciouEm: string | null
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
  return { txt: "Sem responsável", cls: "red" }
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
