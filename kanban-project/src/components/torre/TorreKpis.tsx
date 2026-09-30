"use client"
// src/components/torre/TorreKpis.tsx — os 8 KPIs clicáveis (Bloco J3).
// O NÚMERO de cada cartão é a contagem da lista que o clique filtra (`linhasDoKpi`, o MESMO predicado que a aba Tarefas
// aplica); a TENDÊNCIA vem da foto diária real (E10). Sem foto de referência → "sem histórico". Nada é estimado.
import { KPIS, linhasDoKpi, processosEmRisco, tendenciaDe, CAMPO_DA_FOTO, type ChaveKpi } from "@/lib/operacional/torre-kpis"
import type { LinhaTorre } from "./tipos"

export interface FotoDoDia {
  data: string; vencidas: number; vencemEm7Dias: number; semDono: number; aguardandoTerceiro: number
  cobrancasPendentes: number; escaladas: number; emRisco: number; backlogAbertas: number; backlogFechadasNaSemana: number
}
export interface Tendencias { backlog: { abertas: number; fechadas: number }; referencia: FotoDoDia | null; fotosNaSerie: number }

/** O número que o cartão mostra — exportado para o casco e para o teste usarem a MESMA conta. */
export function numeroDoKpi(chave: ChaveKpi, linhas: LinhaTorre[]): number | null {
  if (chave === "back") return null
  if (chave === "risco") return processosEmRisco(linhas).size
  return linhasDoKpi(chave, linhas).length
}

export function TorreKpis({ linhas, tend, ativo, filtrandoPais, onEscolher }: {
  linhas: LinhaTorre[]; tend: Tendencias | null; ativo: ChaveKpi | null; filtrandoPais: boolean; onEscolher: (k: ChaveKpi) => void
}) {
  return (
    <div className="tor-kpis" role="group" aria-label="Indicadores">
      {KPIS.map((k) => {
        const n = numeroDoKpi(k.chave, linhas)
        let valor: string
        let trend: { txt: string; cls: string }
        if (k.chave === "back") {
          valor = tend ? `${tend.backlog.abertas} / ${tend.backlog.fechadas}` : "…"
          const t = tend?.referencia ? tendenciaDe(tend.backlog.abertas, tend.referencia.backlogAbertas) : null
          trend = filtrandoPais ? { txt: "tendência só no total", cls: "sem" } : t ? { txt: t.rotulo, cls: t.direcao } : { txt: "sem histórico", cls: "sem" }
        } else {
          valor = String(n)
          const ref = tend?.referencia ? tend.referencia[CAMPO_DA_FOTO[k.chave]] : null
          const t = tend ? tendenciaDe(n as number, ref) : null
          trend = filtrandoPais ? { txt: "tendência só no total", cls: "sem" } : !tend ? { txt: "…", cls: "sem" } : t ? { txt: t.rotulo, cls: t.direcao } : { txt: "sem histórico", cls: "sem" }
        }
        return (
          <button key={k.chave} type="button" className={`tor-kpi ${ativo === k.chave ? "on" : ""}`} aria-pressed={ativo === k.chave} onClick={() => onEscolher(k.chave)}
            title={k.filtra ? "Filtra a aba Tarefas" : "Abre a aba Terceiros, onde está o backlog"}>
            <b className={`tor-kpi-n ${k.cor}`}>{valor}</b>
            <span className="tor-kpi-l">{k.rotulo}</span>
            <i className={`tor-kpi-t ${trend.cls}`}>{trend.txt}</i>
          </button>
        )
      })}
    </div>
  )
}
