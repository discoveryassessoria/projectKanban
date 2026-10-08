"use client"
// src/components/torre/TorreKpis.tsx — o TOPO da Visão geral (Torre nova, frente B1, 01/10/2026): a faixa "Hoje" + as faixas SITUAÇÃO e AGENDA.
// O NÚMERO de cada cartão é `numeroDoKpi` (torre-kpis.ts): o tamanho da lista que o clique filtra na aba Tarefas (mesmo predicado, mesmas
// linhas). O clique é um LINK para a URL que a Torre já entende (`?aba=tarefas&kpi=…`, mantendo país e busca): a aba Tarefas abre só
// com aquele filtro, sem sobras de filtros anteriores — por isso o número do cartão = o "Mostrando N" da lista.
// "Processos ativos" (e o selo "N em risco") vêm da aba Processos. A tendência (vs semana passada) só existe quando há foto de 7 dias
// E a definição do cartão é a mesma da foto; sem isso o cartão não mostra nada (nenhum texto de ausência).
import { contarTotais } from "@/lib/operacional/torre-contagens"
import { paraContagem } from "@/lib/operacional/torre-fase"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { KPI_POR_CHAVE, CAMPO_DA_FOTO, tendenciaDe, numeroDoKpi, CARTOES_DA_SITUACAO, CARTOES_DA_AGENDA, type ChaveKpi } from "@/lib/operacional/torre-kpis"
import {
  fraseDoDia, distribuicaoPorPais, detalheDosTerceiros, familiasSemResponsavel, subtituloSemResponsavel, corDaTendencia, milhar, rotuloDecisoes,
  type LinhaParaTopo,
} from "@/lib/operacional/torre-topo"
import type { LinhaDoFunil } from "@/lib/operacional/torre-funil-puro"
import type { ProcessoDaTorre } from "./tipos-processos"

export interface FotoDoDia {
  data: string; vencidas: number; vencemEm7Dias: number; semDono: number; aguardandoTerceiro: number
  cobrancasPendentes: number; escaladas: number; emRisco: number; backlogAbertas: number; backlogFechadasNaSemana: number
  /** Torre nova (M4): `null` = foto anterior à M4 (sem o número → sem tendência, nunca estimativa). */
  processosAtivos?: number | null; tarefasAbertas?: number | null; comEquipe?: number | null; comCartorio?: number | null
}
export interface Tendencias { backlog: { abertas: number; fechadas: number }; referencia: FotoDoDia | null; fotosNaSerie: number }

/** O endereço de um cartão: a aba Tarefas já filtrada (`kpi`), mantendo o país e a busca da URL. "Tarefas abertas" = a lista inteira. */
export function hrefDoKpi(chave: ChaveKpi, manter: { pais?: string | null; q?: string | null } = {}): string {
  const q = new URLSearchParams()
  q.set("aba", "tarefas")
  if (KPI_POR_CHAVE[chave].filtra) q.set("kpi", chave)
  if (manter.pais) q.set("pais", manter.pais)
  if (manter.q) q.set("q", manter.q)
  return `/torre?${q.toString()}`
}

const COR_DA_TENDENCIA = { boa: "tvg-tend boa", ruim: "tvg-tend ruim", neutra: "tvg-tend" } as const

export function TorreKpis({ linhas, processos, itensPrecisa, agora, tend, filtrandoPais, gargalo, onProcessos, onRisco, onRevisar }: {
  linhas: LinhaParaTopo[]; processos: ProcessoDaTorre[] | null; itensPrecisa: Array<{ tipo: string }> | null; agora: Date; tend: Tendencias | null
  filtrandoPais: boolean; gargalo: LinhaDoFunil | null
  onProcessos: () => void; onRisco: () => void; onRevisar: () => void
}) {
  const url = useSearchParams()
  const manter = { pais: url.get("pais"), q: url.get("q") }

  const tendencia = (k: ChaveKpi | "processos", n: number) => {
    const campo = k === "processos" ? "processosAtivos" : CAMPO_DA_FOTO[k]
    if (filtrandoPais || !campo || !tend?.referencia) return null
    const anterior = tend.referencia[campo as keyof FotoDoDia] as number | null | undefined
    return tendenciaDe(n, anterior)   // `null` na foto antiga (anterior à M4) → sem tendência
  }
  const nDe = (k: ChaveKpi) => numeroDoKpi(k, linhas, agora)
  const textoDaTendencia = (k: ChaveKpi | "processos", n: number) => {
    const t = tendencia(k, n)
    if (!t) return null
    // O protótipo mostra o cartão "Processos ativos" sem seta ("+12 vs semana passada"); os demais com ▲/▼.
    const rotulo = k === "processos" && t.delta !== 0 ? `${t.delta > 0 ? "+" : "−"}${Math.abs(t.delta)} vs semana passada` : t.rotulo
    return <i className={COR_DA_TENDENCIA[corDaTendencia(k, t.direcao)]}>{rotulo}</i>
  }

  // UMA CONTAGEM (torre-contagens.ts): a mesma de Processos, do funil e do Radar.
  const contagem = processos ? contarTotais(processos.map(paraContagem)) : null
  const nRisco = contagem ? contagem.graves : null
  const nProcessos = contagem ? contagem.total : null
  const noRitmo = contagem ? contagem.noRitmo : null
  const decisoes = itensPrecisa ?? []

  const subtitulo: Record<string, string> = {
    abertas: "certidões e passos em andamento",
    equipe: "aguardando a equipe: solicitar, conferir, traduzir",
    cartorio: detalheDosTerceiros(linhas),
    ninguem: subtituloSemResponsavel(familiasSemResponsavel(linhas)),
  }
  const cartao = (k: ChaveKpi) => {
    const def = KPI_POR_CHAVE[k]
    const n = nDe(k)
    return (
      <Link key={k} href={hrefDoKpi(k, manter)} prefetch={false} className="tvg-card" title={def.regra} data-kpi={k}>
        <span className="tvg-card-t">{def.rotulo}</span>
        <span className="tvg-card-n"><b className={def.cor}>{milhar(n)}</b>{textoDaTendencia(k, n)}</span>
        {subtitulo[k] ? <span className="tvg-card-s">{subtitulo[k]}</span> : null}
      </Link>
    )
  }
  const agenda = (k: ChaveKpi) => {
    const def = KPI_POR_CHAVE[k]
    return (
      <Link key={k} href={hrefDoKpi(k, manter)} prefetch={false} className="tvg-ag" title={def.regra} data-kpi={k}>
        <b className={def.cor}>{milhar(nDe(k))}</b><span>{def.rotulo}</span>
      </Link>
    )
  }

  return (
    <div className="tvg-topo">
      <div className="tvg-hoje" data-testid="torre-frase">
        <div className="tvg-hoje-t">
          {nProcessos == null || noRitmo == null
            ? "Carregando os processos…"
            : fraseDoDia({ processos: nProcessos, noRitmo, decisoes, gargalo }).map((x, i) => (x.b ? <b key={i}>{x.t}</b> : <span key={i}>{x.t}</span>))}
        </div>
        <button type="button" className="tvg-hoje-b" disabled={decisoes.length === 0} onClick={onRevisar}>▶ Revisar o dia · {rotuloDecisoes(decisoes.length)}</button>
      </div>

      <div className="tvg-rotulo">Situação · onde está o trabalho agora</div>
      <div className="tvg-grid5" role="group" aria-label="Situação">
        <div className="tvg-card tvg-card-proc" data-kpi="processos">
          <button type="button" className="tvg-card-inner" title="Processos que ainda não foram concluídos (a lista da aba Processos)." onClick={onProcessos}>
            <span className="tvg-card-t">Processos ativos</span>
            <span className="tvg-card-n"><b className="blu">{nProcessos == null ? "…" : milhar(nProcessos)}</b>{nProcessos != null ? textoDaTendencia("processos", nProcessos) : null}</span>
            <span className="tvg-card-s">{processos ? distribuicaoPorPais(processos) : ""}</span>
          </button>
          {nRisco != null && nRisco > 0 && (
            <button type="button" className="tvg-selo-risco" title={KPI_POR_CHAVE.risco.regra} onClick={onRisco}>{nRisco} em risco · parado ou crítico</button>
          )}
        </div>
        {CARTOES_DA_SITUACAO.map(cartao)}
      </div>

      <div className="tvg-rotulo">Agenda · prazos de todas as certidões</div>
      <div className="tvg-grid6" role="group" aria-label="Agenda">{CARTOES_DA_AGENDA.map(agenda)}</div>
    </div>
  )
}
