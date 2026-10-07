"use client"
// src/components/torre/TorreFamilias.tsx — FAMÍLIAS · "Como está cada família?" (consolidação da Torre, 06/10/2026).
// O MESMO conjunto de processos em DUAS VISTAS, escolhidas por um alternador (L1: o antigo Radar deixou de ser aba e virou a vista "Matriz"):
//   Lista  — por fase: Saúde da fase, passos das certidões, filtros (inclusive "Bola" nossa × terceiros, que era o filtro do Radar), tabela.
//   Matriz — cada família em cada fase (bola, dias na fase, risco), com a mesma lista de processos.
import { PERGUNTA_DA_ABA } from "@/lib/operacional/torre-abas"
import type { ColunaDoRadar, ProcessoDaTorre } from "./tipos-processos"
import { TorreProcessos } from "./TorreProcessos"
import { TorreRadar } from "./TorreRadar"

export function TorreFamilias({ vista, onVista, processos, processosTodos, colunas, carregando, erro, backlog }: {
  vista: "lista" | "matriz"; onVista: (v: "lista" | "matriz") => void
  processos: ProcessoDaTorre[]; processosTodos: ProcessoDaTorre[]; colunas: ColunaDoRadar[]
  carregando: boolean; erro: string | null; backlog: { abertas: number; fechadas: number } | null
}) {
  return (
    <div data-aba="familias">
      <div className="tor-aba-pergunta" data-testid="pergunta-da-aba" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span>{PERGUNTA_DA_ABA.familias}</span>
        <span role="group" aria-label="Vista" className="tor-pg-chips">
          <button type="button" className="tor-pg-chip" aria-pressed={vista === "lista"} onClick={() => onVista("lista")}>Lista</button>
          <button type="button" className="tor-pg-chip" aria-pressed={vista === "matriz"} onClick={() => onVista("matriz")}>Matriz (família × fases)</button>
        </span>
      </div>
      {vista === "matriz"
        ? <TorreRadar colunas={colunas} processos={processosTodos} carregando={carregando} erro={erro} />
        : <TorreProcessos processos={processos} carregando={carregando} erro={erro} backlog={backlog} />}
    </div>
  )
}
