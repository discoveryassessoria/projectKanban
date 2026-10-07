"use client"
// src/components/torre/Torre.tsx — o CASCO da Torre de Controle (Bloco J; reorganizado na Torre nova, Etapa A, 01/10/2026).
// Cabeçalho (nacionalidade, busca, Briefing do dia MANUAL, Revisar o dia) · 7 abas, na ordem do protótipo, com contadores:
// Visão geral · Precisa de você · Radar · Processos · Tarefas · Equipe · Terceiros. O Processo (detalhe) é uma PÁGINA
// (`/torre/processo/[id]`).
// O topo (frase + faixas Situação e Agenda) agora mora na Visão geral (`TorreVisaoGeral`), não acima das abas.
// Regras, Integridade e Auditoria NÃO são da Torre (ela serve só à gestão de processo): moram em Gerenciamento › Saúde do sistema.
// Uma fonte por dado: as linhas de tarefa vêm de UMA leitura (`/api/torre/tarefas`, a projeção da Operação) e alimentam os KPIs,
// a aba Tarefas, os contadores e a aba Terceiros — o número do cartão é sempre o tamanho da lista que ele filtra.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { KPIS, KPI_POR_CHAVE, emRiscoCritico, linhasDoKpi, numeroDoKpi, processosEmRisco, type ChaveKpi } from "@/lib/operacional/torre-kpis"
import { briefingDoDia } from "@/lib/operacional/precisa-de-voce-decisoes"
import { ALARMES_DE_HOJE } from "@/lib/operacional/torre-hoje"
import { classeDoFunil } from "@/lib/operacional/torre-funil-puro"
import type { OntemPorPais } from "@/lib/operacional/precisa-de-voce"
import { ABAS_DA_TORRE, ABA_INICIAL, ABA_ANTIGA_PARA_NOVA, abaDaUrl, destinoDeAbaQueSaiu, ehAbaDaTorre, type Aba } from "@/lib/operacional/torre-abas"
import { seloVisivel, separarFaseDaUrl, preservarFaseDeTarefas, filtrosNaQueryDaAba } from "@/lib/operacional/torre-casca"
import { itensDoPais, mapaDePaisPorProcesso, contagemDeProcessosPorPais } from "@/lib/operacional/torre-pais"
import { destinoDaAbaAntigaDaTorre } from "@/lib/operacional/navegacao"
import { aplicarFiltros, filtrosDaQuery, filtrosIguais, type FiltrosTorre } from "@/lib/operacional/torre-filtros"
import { AGRUPAR_TORRE, DENTRO_TORRE } from "@/lib/operacional/torre-visoes"
import { aplicarBusca } from "@/src/components/operacao/operacao-v3-derivacoes"
import { api, erroDe, TorreProvider, type PermissoesTorre, type AlvoDoRelatorio } from "./torre-base"
import type { LinhaTorre } from "./tipos"
import type { ColunaDoRadar, ProcessoDaTorre } from "./tipos-processos"
import type { ItemPrecisa } from "./tipos-precisa"
import { TorreCabecalho, type PaisDaTorre } from "./TorreCabecalho"
import type { Tendencias } from "./TorreKpis"
import { TorreHoje } from "./TorreHoje"
import { TorreFamilias } from "./TorreFamilias"
import { pedirFaseDeProcessos } from "./torre-fase-memoria"
import { TorreTarefas, CHAVES_DE_VISAO } from "./TorreTarefas"
import { TorreTerceiros } from "./TorreTerceiros"
import { TorreEquipe } from "./TorreEquipe"
import { ProcessoRelatorioDaTorre } from "./ProcessoRelatorio"
import "./torre.css"

export type { Aba }
/**
 * As SETE abas da Torre, na ordem do protótipo — Visão geral · Precisa de você · Radar · Processos · Tarefas · Equipe · Terceiros.
 * Os ids (`visao`, `precisa`, `radar`, `processos`, `tarefas`, `equipe`, `terceiros`) são ESTÁVEIS: são o `?aba=` da URL e os
 * links antigos continuam funcionando. A lista mora em `lib/operacional/torre-abas.ts` (pura), para a tela e o teste lerem a mesma.
 */
export const ABAS: Array<[Aba, string]> = ABAS_DA_TORRE
const KPIS_QUE_FILTRAM = KPIS.filter((k) => k.filtra).map((k) => k.chave)

const semAcento = (x: string | null | undefined) => String(x ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

const numeroDaUrl = (v: string | null): number | null => {
  const n = Number(v)
  return v != null && Number.isInteger(n) && n > 0 ? n : null
}
/**
 * O CONTRATO DE URL da Torre: `?aba=` · `?kpi=` · `?visao=` (aba Tarefas) · `?processo=` (só com `?tarefa=`: marca as novas; sozinho redireciona à página do processo) · `?tarefa=` (drawer da tarefa)
 * · `?pais=` (nacionalidade) · `?q=` (busca) · `?agrupar=` · `?dentro=` · e os filtros da barra (`resp`, `prazo`, `prazo_de`, `prazo_ate`,
 * `quando`, `quando_de`, `quando_ate`, `familia`, `status`, `certidao`, `fase`, `passo`, `orgao`, `prio`, `risco`, `linha_reta`, `acomp`,
 * `cobranca`, `ordem` — lib/operacional/torre-filtros.ts). O ESTADO INICIAL vem da URL e a URL acompanha o estado: o endereço é compartilhável.
 */
function lerUrl(params: URLSearchParams) {
  const abaUrl = params.get("aba")
  const visaoUrl = params.get("visao")
  const visao = visaoUrl && CHAVES_DE_VISAO.includes(visaoUrl) ? visaoUrl : null
  const processo = numeroDaUrl(params.get("processo"))
  const tarefa = numeroDaUrl(params.get("tarefa"))
  // `?aba=` NOVO ou ANTIGO (visao/precisa → hoje · processos → familias · radar → familias com a matriz). `minha` saiu da Torre (vai para /operacao).
  const antiga = abaUrl ? ABA_ANTIGA_PARA_NOVA[abaUrl] : undefined
  const abaValida = ehAbaDaTorre(abaUrl) ? abaUrl : antiga && "aba" in antiga ? antiga.aba : null
  const vista = params.get("vista") === "matriz" || (antiga && "vista" in antiga && antiga.vista === "matriz") ? "matriz" : "lista"
  const kpiUrl = params.get("kpi") as ChaveKpi | null
  const agrupar = params.get("agrupar"); const dentro = params.get("dentro")
  // `?tarefa=` sempre vai para Tarefas; `?visao=`/`?processo=` sem `?aba=` também; com `?aba=` a aba é respeitada.
  const aba: Aba | null = tarefa != null ? "tarefas" : abaValida ?? (visao || processo != null ? "tarefas" : null)
  // `?fase=` tem dois donos: filtro de TAREFAS (aba Tarefas) ou seleção de fase (aba Processos) — `torre-casca.ts`.
  const { filtros, faseProcessos } = separarFaseDaUrl(aba ?? ABA_INICIAL, filtrosDaQuery(params))
  return {
    aba, vista: vista as "lista" | "matriz", visao, processo, tarefa, faseProcessos,
    kpi: kpiUrl && KPIS_QUE_FILTRAM.includes(kpiUrl) ? kpiUrl : null,
    pais: params.get("pais") ?? "",
    busca: params.get("q") ?? "",
    agrupar: agrupar && (AGRUPAR_TORRE as readonly string[]).includes(agrupar) && agrupar !== "fam" ? agrupar : null,
    dentro: dentro && (DENTRO_TORRE as readonly string[]).includes(dentro) && dentro !== "none" ? dentro : null,
    filtros,
  }
}
/** Comparação de querystrings sem depender da ordem das chaves. */
const canonicaDaQuery = (q: URLSearchParams): string => [...q.entries()].map(([k, v]) => `${k}=${v}`).sort().join("&")

/** Rola a página (a janela e qualquer contêiner rolável que envolva a Torre) para o topo. */
function rolarAoTopo() {
  if (typeof window === "undefined") return
  window.scrollTo({ top: 0 })
  for (let el = document.querySelector(".tor")?.parentElement ?? null; el; el = el.parentElement) {
    if (el.scrollTop > 0) el.scrollTop = 0
  }
}

export function Torre() {
  const params = useSearchParams()
  const router = useRouter()
  const urlInicial = lerUrl(params)

  const [aba, setAba] = useState<Aba>(urlInicial.aba ?? ABA_INICIAL)
  // FAMÍLIAS tem duas vistas do MESMO conjunto: lista e matriz (o antigo Radar). `?vista=matriz`.
  const [vista, setVista] = useState<"lista" | "matriz">(urlInicial.vista)
  // A fase que o link pediu para a aba PROCESSOS (`?aba=processos&fase=…`). A seleção em si mora na memória de Processos; `n` muda a cada
  // pedido novo para a aba remontar e aplicá-lo (mesmo já estando em Processos).
  const [pedidoFase, setPedidoFase] = useState<{ n: number }>(() => { if (urlInicial.faseProcessos) pedirFaseDeProcessos(urlInicial.faseProcessos); return { n: 0 } })
  // O que a aba Tarefas escolheu (visão fixa, agrupamento) e a URL guarda; ela também o recebe de volta quando a URL muda de fora.
  const [estadoTarefas, setEstadoTarefas] = useState<{ visao: string | null; agrupar: string | null; dentro: string | null }>({ visao: urlInicial.visao, agrupar: urlInicial.agrupar, dentro: urlInicial.dentro })
  const visaoPedida = estadoTarefas.visao
  const [tarefaPedida, setTarefaPedida] = useState<number | null>(urlInicial.tarefa)
  const [processoDaUrl, setProcessoDaUrl] = useState<number | null>(urlInicial.processo)
  const [kpi, setKpi] = useState<ChaveKpi | null>(urlInicial.kpi)
  const [pais, setPais] = useState(urlInicial.pais)
  const [busca, setBusca] = useState(urlInicial.busca)
  const [filtros, setFiltros] = useState<FiltrosTorre>(urlInicial.filtros)
  // As querystrings que ESTA tela escreveu (as últimas): quando a URL muda por causa delas, o estado não é relido (evita perder o que
  // se digita entre a escrita e a releitura). Só a URL que veio de fora (link, sino, Foco) é aplicada ao estado.
  const [escritas, setEscritas] = useState<string[]>([])
  const [versao, setVersao] = useState(0)
  // O instante que o topo e a aba Tarefas usam para contar a AGENDA (dia operacional) — o mesmo nos dois, renovado a cada recarga.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const agora = useMemo(() => new Date(), [versao])
  const [filtroProc, setFiltroProc] = useState<"risco" | null>(null)
  const recarregar = useCallback(() => setVersao((n) => n + 1), [])

  const [linhas, setLinhas] = useState<LinhaTorre[] | null>(null)
  const [permissoes, setPermissoes] = useState<PermissoesTorre | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [precisa, setPrecisa] = useState<{ itens: ItemPrecisa[]; nome: string | null; ontem: OntemPorPais } | null>(null)
  const [erroPrecisa, setErroPrecisa] = useState<string | null>(null)
  const [tend, setTend] = useState<Tendencias | null>(null)
  const [paises, setPaises] = useState<PaisDaTorre[]>([])
  const [procs, setProcs] = useState<{ colunas: ColunaDoRadar[]; processos: ProcessoDaTorre[] } | null>(null)
  const [erroProcs, setErroProcs] = useState<string | null>(null)
  const [nEquipe, setNEquipe] = useState<number | null>(null)

  const [relatorio, setRelatorio] = useState<AlvoDoRelatorio | null>(null)

  // Endereço antigo de aba que saiu da Torre (`?aba=regras|integridade|auditoria`): leva ao Gerenciamento equivalente.
  const destinoAntigo = destinoDaAbaAntigaDaTorre(params.get("aba")) ?? destinoDeAbaQueSaiu(params.get("aba"))
  useEffect(() => { if (destinoAntigo) router.replace(destinoAntigo) }, [destinoAntigo, router])

  // Endereço antigo da janela "Foco da família" (`/torre?processo=N`, `?aba=tarefas&processo=N`): leva à PÁGINA do processo. Com `?tarefa=` o pedido é
  // o drawer da tarefa e fica como está (o `processo` só marca as "novas" da família).
  const processoPedido = lerUrl(params)
  const paraPaginaDoProcesso = processoPedido.processo != null && processoPedido.tarefa == null ? processoPedido.processo : null
  useEffect(() => { if (paraPaginaDoProcesso != null) router.replace(`/torre/processo/${paraPaginaDoProcesso}`) }, [paraPaginaDoProcesso, router])

  // A URL pode mudar depois de montada (link do sino, do Foco…): o que ela pede entra no estado (ajuste durante a renderização, sem efeito).
  const paramsChave = params.toString()
  const [paramsAplicados, setParamsAplicados] = useState(paramsChave)
  if (paramsAplicados !== paramsChave) {
    setParamsAplicados(paramsChave)
    if (!escritas.includes(paramsChave)) {
      const u = lerUrl(params)
      if (u.aba) setAba(u.aba)
      setVista(u.vista)
      if (u.faseProcessos) { pedirFaseDeProcessos(u.faseProcessos); setPedidoFase((p) => ({ n: p.n + 1 })) }
      setEstadoTarefas((e) => (e.visao === u.visao && e.agrupar === u.agrupar && e.dentro === u.dentro ? e : { visao: u.visao, agrupar: u.agrupar, dentro: u.dentro }))
      setTarefaPedida(u.tarefa); setProcessoDaUrl(u.processo)
      setKpi(u.kpi); setPais(u.pais); setBusca(u.busca)
      setFiltros((f) => { const novos = preservarFaseDeTarefas(u.aba ?? aba, u.filtros, f); return filtrosIguais(f, novos) ? f : novos })
    }
  }

  // O ESTADO → A URL (replaceState: não refaz a rota nem empilha histórico). Debounce curto para não gravar a cada tecla da busca.
  const onEstadoUrl = useCallback((e: { visao: string | null; agrupar: string | null; dentro: string | null }) => {
    setEstadoTarefas((a) => (a.visao === e.visao && a.agrupar === e.agrupar && a.dentro === e.dentro ? a : e))
  }, [])
  useEffect(() => {
    if (destinoAntigo || typeof window === "undefined") return
    const t = window.setTimeout(() => {
      const atual = new URLSearchParams(window.location.search)
      const q = new URLSearchParams(atual.toString())
      for (const k of ["aba", "kpi", "visao", "pais", "q", "agrupar", "dentro"]) q.delete(k)
      if (aba !== ABA_INICIAL) q.set("aba", aba)
      q.delete("op"); q.delete("vista")
      if (aba === "familias" && vista === "matriz") q.set("vista", "matriz")
      if (kpi) q.set("kpi", kpi)
      if (pais) q.set("pais", pais)
      if (busca.trim()) q.set("q", busca.trim())
      if (aba === "tarefas") {
        if (estadoTarefas.visao) q.set("visao", estadoTarefas.visao)
        if (estadoTarefas.agrupar) q.set("agrupar", estadoTarefas.agrupar)
        if (estadoTarefas.dentro) q.set("dentro", estadoTarefas.dentro)
      }
      const novo = filtrosNaQueryDaAba(q, aba, filtros)
      if (canonicaDaQuery(novo) === canonicaDaQuery(atual)) return
      setEscritas((e) => [...e.slice(-11), novo.toString()])
      window.history.replaceState(window.history.state, "", novo.toString() ? `${window.location.pathname}?${novo.toString()}` : window.location.pathname)
    }, 250)
    return () => window.clearTimeout(t)
  }, [aba, vista, kpi, pais, busca, filtros, estadoTarefas, destinoAntigo])

  // 1) As tarefas (a projeção da Operação) e as decisões do dia — o que a tela precisa para abrir.
  useEffect(() => {
    let vivo = true
    void api<{ linhas: LinhaTorre[]; permissoes: PermissoesTorre }>("/api/torre/tarefas").then((r) => {
      if (!vivo) return
      if (r.ok) { setLinhas(r.data.linhas); setPermissoes(r.data.permissoes); setErro(null) }
      else setErro(erroDe(r.data, "Não foi possível carregar a Torre."))
    })
    void api<{ itens: ItemPrecisa[]; nome: string | null; ontem: OntemPorPais }>("/api/torre/precisa-de-voce").then((r) => {
      if (!vivo) return
      // O BRIEFING DO DIA É SÓ MANUAL (botão "Briefing do dia" do cabeçalho): nada abre sozinho ao entrar na Torre.
      if (r.ok) { setPrecisa({ itens: r.data.itens, nome: r.data.nome, ontem: r.data.ontem }); setErroPrecisa(null) }
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
  // UM critério de "estou filtrando por país" para TUDO (listas, KPIs, funil, backlog, tendência): só vale com o rótulo RESOLVIDO.
  // `?pais=` desconhecido, ou antes de /api/torre/paises responder, = "Todos" em todas as superfícies (nunca metade filtrada).
  const filtrandoPais = !!(pais && paisRotulo)
  const linhasPais = useMemo(() => (linhas == null || !pais || !paisRotulo ? linhas ?? [] : linhas.filter((l) => l.pais === paisRotulo)), [linhas, pais, paisRotulo])
  const processosFiltrados = useMemo(() => {
    const b = semAcento(busca.trim())
    return (procs?.processos ?? []).filter((p) => (!pais || !paisRotulo || p.pais === paisRotulo) && (!b || semAcento(`${p.familiaNome} ${p.codigo ?? ""}`).includes(b)))
  }, [procs, pais, paisRotulo, busca])

  const processosPais = useMemo(() => (procs?.processos ?? []).filter((p) => !pais || !paisRotulo || p.pais === paisRotulo), [procs, pais, paisRotulo])
  // OS PAÍSES COM A CONTAGEM DE PROCESSOS ATIVOS (botões do cabeçalho: "Itália 280"). `null` até a lista de processos chegar.
  const paisesComContagem = useMemo<PaisDaTorre[]>(() => {
    const por = contagemDeProcessosPorPais(procs?.processos ?? [])
    return paises.map((p) => ({ ...p, n: procs ? por.get(p.rotulo) ?? 0 : null }))
  }, [paises, procs])
  const nTodosOsProcessos = procs ? procs.processos.length : null
  // O PAÍS FILTRA TAMBÉM AS DECISÕES DO DIA (`itensDoPais`): cada item vale pelo país do seu processo (lido da lista de processos e das
  // linhas de tarefa). Item sem processo (ex.: "Carga" de uma pessoa) não é de país nenhum e some quando um país é escolhido.
  const paisDoProcesso = useMemo(() => mapaDePaisPorProcesso(procs?.processos ?? [], linhas ?? []), [procs, linhas])
  const itensPrecisaPais = useMemo<ItemPrecisa[] | null>(() => {
    if (!precisa) return null
    if (!pais || !paisRotulo) return precisa.itens
    if (!procs && !linhas) return null
    return itensDoPais(precisa.itens, paisRotulo, paisDoProcesso)
  }, [precisa, pais, paisRotulo, procs, linhas, paisDoProcesso])

  const processosDaAba = useMemo(() => (filtroProc === "risco" ? processosFiltrados.filter(emRiscoCritico) : processosFiltrados), [processosFiltrados, filtroProc])
  const base = kpi ? linhasDoKpi(kpi, linhasPais, agora) : linhasPais
  // O número da aba = a lista que os filtros da barra deixam passar (a MESMA `aplicarFiltros` da tabela).
  const nTarefas = aplicarFiltros(aplicarBusca(base, busca) as LinhaTorre[], filtros, { usuarioId: permissoes?.usuarioId ?? null, agora }).mostrando
  const filtrandoBacklogPais = filtrandoPais
  // Terceiros: "N aguardando" = a visão "Aguardando terceiros" da aba Tarefas (todo pedido com a bola com terceiro) — a MESMA lista (L3).
  const nTerceiros = numeroDoKpi("aguard", linhasPais, agora)
  // O TEXTO DO BRIEFING sai dos MESMOS conjuntos que os cartões mostram (país escolhido, "no ritmo" = a classe do funil, "vencem hoje" =
  // o cartão da Agenda). Ele não vem mais pronto do servidor: era global e com outra régua de "no ritmo".
  const textoDoBriefing = useMemo(() => {
    if (!precisa) return ""
    const escopo = filtrandoPais ? paisRotulo : null
    const somar = (m: Record<string, number>) => (escopo != null ? m[escopo] ?? 0 : Object.values(m).reduce((a, b) => a + b, 0))
    const itens = itensPrecisaPais ?? precisa.itens
    return briefingDoDia(itens, agora, {
      nome: precisa.nome,
      ...(procs ? { ativos: processosPais.length, noRitmo: processosPais.filter((p) => classeDoFunil(p.risco) === "ritmo").length } : {}),
      fechadasOntem: somar(precisa.ontem.fechadas), protocoladosOntem: somar(precisa.ontem.protocolados),
      vencemHoje: numeroDoKpi("hoje", linhasPais, agora),
    })
  }, [precisa, itensPrecisaPais, procs, processosPais, linhasPais, filtrandoPais, paisRotulo, agora])
  const rotuloKpi = kpi ? KPI_POR_CHAVE[kpi].rotulo : undefined

  const escolherKpi = (k: ChaveKpi) => {
    if (k === "abertas") { setKpi(null); setAba("tarefas"); return } // "Tarefas abertas" = a lista inteira da aba Tarefas
    setKpi((atual) => (atual === k ? null : k)); setAba("tarefas")
  }
  // O clique num número de HOJE abre a aba Tarefas já filtrada pelo MESMO predicado que deu o número (KPI ou visão) — L3.
  const abrirAlarme = (chave: string) => {
    const a = ALARMES_DE_HOJE.find((x) => x.chave === chave)
    if (!a) return
    if (a.abre.tipo === "kpi") { setKpi(a.abre.kpi); setEstadoTarefas((e) => ({ ...e, visao: null })) }
    else { setKpi(null); setEstadoTarefas((e) => ({ ...e, visao: a.abre.tipo === "visao" ? a.abre.visao : null })) }
    setAba("tarefas")
  }
  const irParaAba = (a: "equipe") => setAba(a)

  // T011: trocar de aba (clique, link interno, "ver equipe"…) rola a página para o topo. Não roda na montagem.
  const abaAnterior = useRef<Aba>(aba)
  useEffect(() => {
    if (abaAnterior.current === aba) return
    abaAnterior.current = aba
    rolarAoTopo()
  }, [aba])
  const clicarNaAba = (k: Aba) => setAba(k)

  // Os selos das abas: cada um é o TAMANHO da lista que a aba mostra (L3).
  const n = (k: Aba): { txt: string; cls: string } | null => {
    if (!seloVisivel(k, aba)) return null // o selo só aparece onde o protótipo o desenha (torre-casca.ts)
    if (k === "tarefas") return linhas ? { txt: String(nTarefas), cls: "" } : null
    if (k === "equipe") return nEquipe != null ? { txt: String(nEquipe), cls: "" } : null
    if (k === "familias") return procs ? { txt: String(processosDaAba.length), cls: "" } : null
    if (k === "terceiros") return linhas ? { txt: String(nTerceiros), cls: nTerceiros ? "warn" : "" } : null
    return null
  }

  return (
    <TorreProvider
      permissoes={permissoes} recarregar={recarregar} fixo
      abrirRelatorio={setRelatorio}
    >
      <div className="tor">
        <TorreCabecalho
          paises={paisesComContagem} pais={pais} onPais={setPais} nTodos={nTodosOsProcessos} busca={busca} onBusca={setBusca}
        />

        <div className="tor-tabs-linha">
          <div className="tor-tabs" role="tablist">
            {ABAS.map(([k, l]) => {
              const c = n(k)
              return (
                <button key={k} role="tab" aria-selected={aba === k} className="tor-tab" onClick={() => clicarNaAba(k)}>
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

        {aba === "hoje" && (
          linhas ? (
            <TorreHoje linhas={linhasPais} itens={itensPrecisaPais} erroItens={erroPrecisa} agora={agora} frase={textoDoBriefing} onAlarme={abrirAlarme} />
          ) : <div className="tor-card pad small">{erro ?? "Carregando a Torre…"}</div>
        )}
        {aba === "tarefas" && (
          <TorreTarefas
            linhas={linhasPais} carregando={linhas == null && !erro} erro={!!erro} kpi={kpi} busca={busca} paisChave={pais} paisRotulo={paisRotulo}
            visaoPedida={visaoPedida} tarefaPedida={tarefaPedida} onTarefaAtendida={() => setTarefaPedida(null)}
            processos={procs?.processos} processoFoco={processoDaUrl} versao={versao} agora={agora}
            onAplicarSpec={(s) => { setKpi(s.kpi); setPais(s.pais); setBusca(s.busca) }}
            filtros={filtros} onFiltros={setFiltros} onLimparPais={() => setPais("")} onLimparBusca={() => setBusca("")}
            agruparPedido={estadoTarefas.agrupar} dentroPedido={estadoTarefas.dentro} onEstadoUrl={onEstadoUrl}
          />
        )}
        {aba === "equipe" && <TorreEquipe versao={versao} pais={pais} />}
        {aba === "familias" && (
          <TorreFamilias
            key={pedidoFase.n} vista={vista} onVista={setVista}
            processos={processosDaAba} processosTodos={processosFiltrados} colunas={procs?.colunas ?? []}
            carregando={!procs && !erroProcs} erro={erroProcs} backlog={filtrandoBacklogPais ? null : tend?.backlog ?? null}
          />
        )}
        {aba === "terceiros" && <TorreTerceiros linhas={linhasPais} versao={versao} />}
        {erro && aba !== "tarefas" && <div className="small mt-2">{erro}</div>}

        {relatorio && <ProcessoRelatorioDaTorre processoId={relatorio.processoId} processoRotulo={relatorio.codigo ?? relatorio.familiaNome} familiaId={relatorio.familiaId} familiaNome={relatorio.familiaNome} onFechar={() => setRelatorio(null)} />}
      </div>
    </TorreProvider>
  )
}
