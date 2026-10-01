"use client"
// src/components/torre/TorreKpis.tsx — o TOPO da Torre (01/10/2026): a frase fixa + duas faixas, SITUAÇÃO e AGENDA.
// O NÚMERO de cada cartão é `numeroDoKpi` (torre-kpis.ts): o tamanho da lista que o clique filtra na aba Tarefas (mesmo predicado).
// "Processos ativos" (e o selo "N em risco") vêm da aba Processos. A tendência (▲/▼ vs semana passada) só existe quando há
// foto de 7 dias E a definição do cartão é a mesma da foto; sem isso o cartão não mostra nada (nenhum texto de ausência).
// Torre nova (M4): Tarefas abertas · Com a equipe · Aguardando terceiros também têm foto (colunas novas, só de hoje em diante).
import { KPI_POR_CHAVE, CAMPO_DA_FOTO, tendenciaDe, numeroDoKpi, CARTOES_DA_SITUACAO, CARTOES_DA_AGENDA, emRiscoCritico, type ChaveKpi } from "@/lib/operacional/torre-kpis"
import { fraseDoDia, distribuicaoPorFase, type LinhaParaTopo } from "@/lib/operacional/torre-topo"
import type { ProcessoDaTorre } from "./tipos-processos"

export interface FotoDoDia {
  data: string; vencidas: number; vencemEm7Dias: number; semDono: number; aguardandoTerceiro: number
  cobrancasPendentes: number; escaladas: number; emRisco: number; backlogAbertas: number; backlogFechadasNaSemana: number
  /** Torre nova (M4): `null` = foto anterior à M4 (sem o número → sem tendência, nunca estimativa). */
  processosAtivos?: number | null; tarefasAbertas?: number | null; comEquipe?: number | null; comCartorio?: number | null
}
export interface Tendencias { backlog: { abertas: number; fechadas: number }; referencia: FotoDoDia | null; fotosNaSerie: number }

export function TorreKpis({ linhas, processos, agora, tend, ativo, filtrandoPais, onEscolher, onProcessos, onRisco }: {
  linhas: LinhaParaTopo[]; processos: ProcessoDaTorre[] | null; agora: Date; tend: Tendencias | null; ativo: ChaveKpi | null
  filtrandoPais: boolean; onEscolher: (k: ChaveKpi) => void; onProcessos: () => void; onRisco: () => void
}) {
  const tendencia = (k: ChaveKpi, n: number) => {
    const campo = CAMPO_DA_FOTO[k]
    if (filtrandoPais || !campo || !tend?.referencia) return null
    return tendenciaDe(n, tend.referencia[campo])   // `null` na foto antiga (anterior à M4) → sem tendência
  }
  const cartao = (k: ChaveKpi) => {
    const def = KPI_POR_CHAVE[k]
    const n = numeroDoKpi(k, linhas, agora)
    const t = tendencia(k, n)
    return (
      <button key={k} type="button" className={`tor-kpi ${ativo === k ? "on" : ""}`} aria-pressed={ativo === k} title={def.regra} onClick={() => onEscolher(k)}>
        <b className={`tor-kpi-n ${def.cor}`}>{n}</b>
        <span className="tor-kpi-l">{def.rotulo}</span>
        {t && <i className={`tor-kpi-t ${t.direcao}`}>{t.rotulo}</i>}
      </button>
    )
  }
  const nRisco = processos ? processos.filter(emRiscoCritico).length : null
  const rotuloRisco = KPI_POR_CHAVE.risco
  return (
    <div className="tor-topo">
      <p className="tor-frase" data-testid="torre-frase">{fraseDoDia(linhas, agora)}</p>
      <div className="tor-faixa-titulo">Situação</div>
      <div className="tor-kpis tor-kpis-sit" role="group" aria-label="Situação">
        <div className="tor-kpi tor-kpi-proc">
          <button type="button" className="tor-kpi-inner" title="Processos que ainda não foram concluídos (a lista da aba Processos)." onClick={onProcessos}>
            <b className="tor-kpi-n blu">{processos ? processos.length : "…"}</b>
            <span className="tor-kpi-l">Processos ativos</span>
            {processos && processos.length > 0 && <i className="tor-kpi-t">{distribuicaoPorFase(processos).split(" · ").slice(1).join(" · ")}</i>}
          </button>
          {nRisco != null && nRisco > 0 && (
            <button type="button" className="tor-p red tor-selo" title={rotuloRisco.regra} onClick={onRisco}>{nRisco} em risco</button>
          )}
        </div>
        {CARTOES_DA_SITUACAO.map(cartao)}
      </div>
      <div className="tor-faixa-titulo">Agenda</div>
      <div className="tor-kpis tor-kpis-agenda" role="group" aria-label="Agenda">{CARTOES_DA_AGENDA.map(cartao)}</div>
    </div>
  )
}
