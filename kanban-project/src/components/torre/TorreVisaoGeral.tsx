"use client"
// src/components/torre/TorreVisaoGeral.tsx — aba VISÃO GERAL (Torre nova, Etapa A, 01/10/2026).
//
// NESTA ETAPA ela só RENDERIZA o que já existia no topo da Torre: a frase do dia + as faixas SITUAÇÃO e AGENDA
// (`TorreKpis`). O dono da Visão geral a completa (funil por fase, semana, "Precisa de você" como seção, glossário…) —
// por isso as props abaixo já trazem TUDO o que ele vai precisar do casco (linhas e processos JÁ filtrados pelo país do
// cabeçalho, as decisões do dia, a tendência, e os ganchos de navegação), e o contrato do casco não muda.
import type { ChaveKpi } from "@/lib/operacional/torre-kpis"
import type { Aba } from "@/lib/operacional/torre-abas"
import type { LinhaTorre } from "./tipos"
import type { ProcessoDaTorre } from "./tipos-processos"
import type { ItemPrecisa } from "./tipos-precisa"
import { TorreKpis, type Tendencias } from "./TorreKpis"

export interface PropsDaVisaoGeral {
  /** As linhas de tarefa da Torre, JÁ filtradas pelo país do cabeçalho (a mesma lista da aba Tarefas). */
  linhas: LinhaTorre[]
  /** Os processos ativos, JÁ filtrados pelo país; `null` = ainda carregando. */
  processos: ProcessoDaTorre[] | null
  /** As decisões do dia ("Precisa de você"), JÁ filtradas pelo país; `null` = ainda carregando. */
  itensPrecisa: ItemPrecisa[] | null
  /** O instante único da AGENDA (dia operacional) — o mesmo da aba Tarefas. */
  agora: Date
  /** A tendência "vs semana passada" (foto de 7 dias) e o backlog da semana. */
  tend: Tendencias | null
  /** O país do cabeçalho está filtrando? (a tendência é do total e some quando filtra) */
  filtrandoPais: boolean
  /** O cartão ativo (filtro do indicador). */
  kpiAtivo: ChaveKpi | null
  onEscolherKpi: (k: ChaveKpi) => void
  onProcessos: () => void
  onRisco: () => void
  /** Navega para outra aba da Torre (ex.: "ver todas as decisões" → `precisa`). */
  irParaAba: (aba: Aba) => void
}

export function TorreVisaoGeral({ linhas, processos, agora, tend, kpiAtivo, filtrandoPais, onEscolherKpi, onProcessos, onRisco }: PropsDaVisaoGeral) {
  return (
    <TorreKpis
      linhas={linhas} processos={processos} agora={agora} tend={tend} ativo={kpiAtivo} filtrandoPais={filtrandoPais}
      onEscolher={onEscolherKpi} onProcessos={onProcessos} onRisco={onRisco}
    />
  )
}
