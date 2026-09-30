"use client"
// src/components/torre/Torre.tsx — o CASCO da Torre de Controle (Bloco J).
// Cabeçalho (nacionalidade, busca, briefing, revisar o dia) · topo (frase + faixas Situação e Agenda) · 6 abas com contadores.
// Regras, Integridade e Auditoria NÃO são da Torre (ela serve só à gestão de processo): moram em Gerenciamento › Saúde do sistema.
// Uma fonte por dado: as linhas de tarefa vêm de UMA leitura (`/api/torre/tarefas`, a projeção da Operação) e alimentam os KPIs,
// a aba Tarefas, os contadores e a aba Terceiros — o número do cartão é sempre o tamanho da lista que ele filtra.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { KPIS, KPI_POR_CHAVE, emRiscoCritico, linhasDoKpi, processosEmRisco, type ChaveKpi } from "@/lib/operacional/torre-kpis"
import { destinoDaAbaAntigaDaTorre } from "@/lib/operacional/navegacao"
import { aplicarBusca } from "@/src/components/operacao/operacao-v3-derivacoes"
import { api, erroDe, TorreProvider, type PermissoesTorre, type AlvoDoRelatorio } from "./torre-base"
import type { LinhaTorre } from "./tipos"
import type { ColunaDoRadar, ProcessoDaTorre } from "./tipos-processos"
import type { ItemPrecisa } from "./tipos-precisa"
import { TorreCabecalho, type PaisDaTorre } from "./TorreCabecalho"
import { TorreKpis, type Tendencias } from "./TorreKpis"
import { TorrePrecisaDeVoce } from "./TorrePrecisaDeVoce"
import { TorreBriefing } from "./TorreBriefing"
import { TorreRevisao } from "./TorreRevisao"
import { TorreRadar } from "./TorreRadar"
import { TorreProcessos } from "./TorreProcessos"
import { TorreTarefas, CHAVES_DE_VISAO } from "./TorreTarefas"
import { TorreTerceiros } from "./TorreTerceiros"
import { TorreEquipe } from "./TorreEquipe"
import { FocoFamilia } from "./FocoFamilia"
import { RelatorioControle } from "./RelatorioControle"
import "./torre.css"

export type Aba = "precisa" | "radar" | "tarefas" | "equipe" | "processos" | "terceiros"
/** As SEIS abas da Torre, na ordem. */
export const ABAS: Array<[Aba, string]> = [
  ["precisa", "Precisa de você"], ["radar", "Radar"], ["tarefas", "Tarefas"], ["equipe", "Equipe"], ["processos", "Processos"], ["terceiros", "Terceiros"],
]
const ABAS_VALIDAS = ABAS.map(([k]) => k)
const KPIS_QUE_FILTRAM = KPIS.filter((k) => k.filtra).map((k) => k.chave)

const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
const semAcento = (x: string | null | undefined) => String(x ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

const numeroDaUrl = (v: string | null): number | null => {
  const n = Number(v)
  return v != null && Number.isInteger(n) && n > 0 ? n : null
}
/** O CONTRATO DE URL da Torre: `?aba=` · `?kpi=` · `?visao=` (aba Tarefas) · `?processo=` (Foco da família) · `?tarefa=` (drawer da tarefa). */
function lerUrl(params: URLSearchParams) {
  const abaUrl = params.get("aba") as Aba | null
  const visaoUrl = params.get("visao")
  const visao = visaoUrl && CHAVES_DE_VISAO.includes(visaoUrl) ? visaoUrl : null
  const processo = numeroDaUrl(params.get("processo"))
  const tarefa = numeroDaUrl(params.get("tarefa"))
  const abaValida = abaUrl && ABAS_VALIDAS.includes(abaUrl) ? abaUrl : null
  // `?tarefa=` sempre vai para Tarefas; `?visao=`/`?processo=` sem `?aba=` também; com `?aba=` a aba é respeitada.
  const aba: Aba | null = tarefa != null ? "tarefas" : abaValida ?? (visao || processo != null ? "tarefas" : null)
  return { aba, visao, processo, tarefa }
}

export function Torre() {
  const params = useSearchParams()
  const router = useRouter()
  const kpiDaUrl = params.get("kpi") as ChaveKpi | null
  const urlInicial = lerUrl(params)

  const [aba, setAba] = useState<Aba>(urlInicial.aba ?? "precisa")
  const [visaoPedida, setVisaoPedida] = useState<string | null>(urlInicial.visao)
  const [tarefaPedida, setTarefaPedida] = useState<number | null>(urlInicial.tarefa)
  const [processoDaUrl, setProcessoDaUrl] = useState<number | null>(urlInicial.processo)
  const [kpi, setKpi] = useState<ChaveKpi | null>(kpiDaUrl && KPIS_QUE_FILTRAM.includes(kpiDaUrl) ? kpiDaUrl : null)
  const [pais, setPais] = useState("")
  const [busca, setBusca] = useState("")
  const [versao, setVersao] = useState(0)
  // O instante que o topo e a aba Tarefas usam para contar a AGENDA (dia operacional) — o mesmo nos dois, renovado a cada recarga.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const agora = useMemo(() => new Date(), [versao])
  const [filtroProc, setFiltroProc] = useState<"risco" | null>(null)
  const recarregar = useCallback(() => setVersao((n) => n + 1), [])
  const briefingChecado = useRef(false)

  const [linhas, setLinhas] = useState<LinhaTorre[] | null>(null)
  const [permissoes, setPermissoes] = useState<PermissoesTorre | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [precisa, setPrecisa] = useState<{ itens: ItemPrecisa[]; briefing: string } | null>(null)
  const [erroPrecisa, setErroPrecisa] = useState<string | null>(null)
  const [tend, setTend] = useState<Tendencias | null>(null)
  const [paises, setPaises] = useState<PaisDaTorre[]>([])
  const [procs, setProcs] = useState<{ colunas: ColunaDoRadar[]; processos: ProcessoDaTorre[] } | null>(null)
  const [erroProcs, setErroProcs] = useState<string | null>(null)
  const [nEquipe, setNEquipe] = useState<number | null>(null)

  const [foco, setFoco] = useState<number | null>(urlInicial.processo)
  const [relatorio, setRelatorio] = useState<AlvoDoRelatorio | null>(null)
  const [briefingAberto, setBriefingAberto] = useState(false)
  const [revisao, setRevisao] = useState<ItemPrecisa[] | null>(null)

  // Endereço antigo de aba que saiu da Torre (`?aba=regras|integridade|auditoria`): leva ao Gerenciamento equivalente.
  const destinoAntigo = destinoDaAbaAntigaDaTorre(params.get("aba"))
  useEffect(() => { if (destinoAntigo) router.replace(destinoAntigo) }, [destinoAntigo, router])

  // A URL pode mudar depois de montada (link do sino, do Foco…): o que ela pede entra no estado (ajuste durante a renderização, sem efeito).
  const paramsChave = params.toString()
  const [paramsAplicados, setParamsAplicados] = useState(paramsChave)
  if (paramsAplicados !== paramsChave) {
    setParamsAplicados(paramsChave)
    const u = lerUrl(params)
    if (u.aba) setAba(u.aba)
    setVisaoPedida(u.visao); setTarefaPedida(u.tarefa); setProcessoDaUrl(u.processo)
    if (u.processo != null) setFoco(u.processo)
  }

  // 1) As tarefas (a projeção da Operação) e as decisões do dia — o que a tela precisa para abrir.
  useEffect(() => {
    let vivo = true
    void api<{ linhas: LinhaTorre[]; permissoes: PermissoesTorre }>("/api/torre/tarefas").then((r) => {
      if (!vivo) return
      if (r.ok) { setLinhas(r.data.linhas); setPermissoes(r.data.permissoes); setErro(null) }
      else setErro(erroDe(r.data, "Não foi possível carregar a Torre."))
    })
    void api<{ itens: ItemPrecisa[]; briefing: string }>("/api/torre/precisa-de-voce").then((r) => {
      if (!vivo) return
      if (r.ok) {
        setPrecisa({ itens: r.data.itens, briefing: r.data.briefing }); setErroPrecisa(null)
        // O briefing abre ao entrar — uma vez por dia (fuso de São Paulo) por navegador; depois, pelo botão.
        if (!briefingChecado.current) {
          briefingChecado.current = true
          try {
            const hoje = hojeSP()
            if (window.sessionStorage.getItem("torre-briefing-visto") !== hoje) { window.sessionStorage.setItem("torre-briefing-visto", hoje); setBriefingAberto(true) }
          } catch { setBriefingAberto(true) }
        }
      }
      else setErroPrecisa(erroDe(r.data, "Não foi possível carregar as decisões do dia."))
    })
    return () => { vivo = false }
  }, [versao])

  // 2) O resto, depois que as tarefas chegaram (o pool de conexões é pequeno: não dispare tudo junto).
  const pronto = permissoes != null
  useEffect(() => {
    if (!pronto) return
    let vivo = true
    void api<Tendencias>("/api/torre/tendencias").then((r) => { if (vivo && r.ok) setTend(r.data) })
    void api<{ colunas: ColunaDoRadar[]; processos: ProcessoDaTorre[] }>("/api/torre/processos").then((r) => {
      if (!vivo) return
      if (r.ok) { setProcs(r.data); setErroProcs(null) } else setErroProcs(erroDe(r.data, "Não foi possível carregar os processos."))
    })
    if (permissoes?.equipe) {
      void api<{ pessoas: unknown[] }>("/api/torre/equipe").then((r) => { if (vivo && r.ok) setNEquipe(r.data.pessoas.length) })
    }
    return () => { vivo = false }
  }, [pronto, versao, permissoes?.equipe])
  useEffect(() => {
    if (!pronto) return
    let vivo = true
    void api<{ paises: PaisDaTorre[] }>("/api/torre/paises").then((r) => { if (vivo && r.ok) setPaises(r.data.paises) })
    return () => { vivo = false }
  }, [pronto])

  // País filtra TUDO: linhas (KPIs, Tarefas, Terceiros, contadores) e processos (Radar, Processos).
  const paisRotulo = paises.find((p) => p.chave === pais)?.rotulo ?? null
  const linhasPais = useMemo(() => (linhas == null || !pais || !paisRotulo ? linhas ?? [] : linhas.filter((l) => l.pais === paisRotulo)), [linhas, pais, paisRotulo])
  const processosFiltrados = useMemo(() => {
    const b = semAcento(busca.trim())
    return (procs?.processos ?? []).filter((p) => (!pais || !paisRotulo || p.pais === paisRotulo) && (!b || semAcento(`${p.familiaNome} ${p.codigo ?? ""}`).includes(b)))
  }, [procs, pais, paisRotulo, busca])

  const processosPais = useMemo(() => (procs?.processos ?? []).filter((p) => !pais || !paisRotulo || p.pais === paisRotulo), [procs, pais, paisRotulo])
  const processosDaAba = useMemo(() => (filtroProc === "risco" ? processosFiltrados.filter(emRiscoCritico) : processosFiltrados), [processosFiltrados, filtroProc])
  const base = kpi ? linhasDoKpi(kpi, linhasPais, agora) : linhasPais
  const nTarefas = aplicarBusca(base, busca).length
  const filtrandoBacklogPais = !!pais // o backlog da semana é do total, não por nacionalidade
  const nCobrar = linhasPais.filter((l) => l.cobravelVencida).length
  const rotuloKpi = kpi ? KPI_POR_CHAVE[kpi].rotulo : undefined

  const escolherKpi = (k: ChaveKpi) => {
    if (k === "abertas") { setKpi(null); setAba("tarefas"); return } // "Tarefas abertas" = a lista inteira da aba Tarefas
    setKpi((atual) => (atual === k ? null : k)); setAba("tarefas")
  }
  const irParaAba = (a: "equipe") => setAba(a)

  const n = (k: Aba): { txt: string; cls: string } | null => {
    if (k === "precisa") return precisa ? { txt: String(precisa.itens.length), cls: "red" } : null
    if (k === "tarefas") return linhas ? { txt: String(nTarefas), cls: "" } : null
    if (k === "equipe") return nEquipe != null ? { txt: String(nEquipe), cls: "" } : null
    if (k === "processos") return procs ? { txt: String(processosDaAba.length), cls: "" } : null
    if (k === "terceiros") return linhas ? { txt: `${nCobrar} a cobrar`, cls: nCobrar ? "warn" : "" } : null
    return null
  }

  return (
    <TorreProvider
      permissoes={permissoes} recarregar={recarregar}
      abrirFoco={setFoco} abrirRelatorio={setRelatorio}
    >
      <div className="tor">
        <TorreCabecalho
          paises={paises} pais={pais} onPais={setPais} busca={busca} onBusca={setBusca}
          nPrecisa={precisa ? precisa.itens.length : null}
          onBriefing={() => setBriefingAberto(true)}
          onRevisar={() => precisa && setRevisao([...precisa.itens])}
        />
        {linhas && (
          <TorreKpis
            linhas={linhasPais} processos={procs ? processosPais : null} agora={agora} tend={tend} ativo={kpi} filtrandoPais={!!pais} onEscolher={escolherKpi}
            onProcessos={() => { setFiltroProc(null); setAba("processos") }} onRisco={() => { setFiltroProc("risco"); setAba("processos") }}
          />
        )}

        <div className="tor-tabs-linha">
          <div className="tor-tabs" role="tablist">
            {ABAS.map(([k, l]) => {
              const c = n(k)
              return (
                <button key={k} role="tab" aria-selected={aba === k} className="tor-tab" onClick={() => setAba(k)}>
                  {l}{c ? <span className={`n ${c.cls}`}>{c.txt}</span> : null}
                </button>
              )
            })}
          </div>
          {kpi && (
            <span className="tor-p red tor-filtro">
              Filtro: {rotuloKpi}{kpi === "risco" ? ` (${processosEmRisco(linhasPais).size} processo(s) · ${base.length} tarefa(s))` : ""}
              <button className="tor-x" aria-label="Limpar o filtro do indicador" onClick={() => setKpi(null)}>✕</button>
            </span>
          )}
          {filtroProc && (
            <span className="tor-p red tor-filtro">
              Filtro: Processos em risco ({processosDaAba.length})
              <button className="tor-x" aria-label="Limpar o filtro de processos" onClick={() => setFiltroProc(null)}>✕</button>
            </span>
          )}
        </div>

        {aba === "precisa" && <TorrePrecisaDeVoce itens={precisa?.itens ?? null} carregando={!precisa && !erroPrecisa} erro={erroPrecisa} irParaAba={irParaAba} />}
        {aba === "radar" && <TorreRadar colunas={procs?.colunas ?? []} processos={processosFiltrados} carregando={!procs && !erroProcs} erro={erroProcs} />}
        {aba === "tarefas" && (
          <TorreTarefas
            linhas={linhasPais} carregando={linhas == null && !erro} erro={!!erro} kpi={kpi} busca={busca} paisChave={pais} paisRotulo={paisRotulo}
            visaoPedida={visaoPedida} tarefaPedida={tarefaPedida} onTarefaAtendida={() => setTarefaPedida(null)}
            processos={procs?.processos} processoFoco={foco ?? processoDaUrl} versao={versao} agora={agora}
            onAplicarSpec={(s) => { setKpi(s.kpi); setPais(s.pais); setBusca(s.busca) }}
          />
        )}
        {aba === "equipe" && <TorreEquipe versao={versao} />}
        {aba === "processos" && <TorreProcessos processos={processosDaAba} carregando={!procs && !erroProcs} erro={erroProcs} backlog={filtrandoBacklogPais ? null : tend?.backlog ?? null} />}
        {aba === "terceiros" && <TorreTerceiros linhas={linhasPais} versao={versao} />}
        {erro && aba !== "tarefas" && <div className="small mt-2">{erro}</div>}

        {briefingAberto && precisa && (
          <TorreBriefing
            texto={precisa.briefing} n={precisa.itens.length} onFechar={() => setBriefingAberto(false)}
            onRevisar={() => { setBriefingAberto(false); setRevisao([...precisa.itens]) }}
          />
        )}
        {revisao && <TorreRevisao itens={revisao} irParaAba={(a) => { setRevisao(null); irParaAba(a) }} onSair={() => setRevisao(null)} />}
        {foco != null && <FocoFamilia processoId={foco} onFechar={() => setFoco(null)} />}
        {relatorio && <RelatorioControle processoId={relatorio.processoId} processoRotulo={relatorio.codigo ?? relatorio.familiaNome} familiaId={relatorio.familiaId} familiaNome={relatorio.familiaNome} onFechar={() => setRelatorio(null)} />}
      </div>
    </TorreProvider>
  )
}
