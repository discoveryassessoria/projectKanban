// src/components/operacao/minha-operacao.tsx
// ============================================================================
// MINHA OPERAÇÃO — a central PESSOAL de atenção operacional.
//
// Mental model (mandato "Minha Operação", 15/09/2026):
//   NOTIFICAÇÕES         = o que aconteceu.
//   MINHA OPERAÇÃO       = o que exige minha atenção agora.
//   PROCESSO → WORKFLOW  = onde o trabalho é EXECUTADO.
//
// Esta tela é só PROJEÇÃO + PRIORIZAÇÃO + CONSULTA + NAVEGAÇÃO. Fonte única:
// `GET /api/operacao/tarefas?visao=minha_fila` (a MESMA `minhaFila()` que já
// alimentava a antiga Minha Fila) — nenhum motor novo, nenhuma Tarefa
// sintética, nenhum passo virando linha própria.
//
// UMA LINHA = UMA TAREFA CANÔNICA. "Aguardar cartório", "Acompanhar hoje",
// "Retorno recebido" NUNCA são Tarefas separadas — são a CONDIÇÃO atual da
// MESMA linha (mesma taskId, mesmo stepInstanceId), lida dos mesmos booleanos
// canônicos que já alimentavam `central-tarefas.tsx` (`emRisco`,
// `atrasoInterno`, `atrasoTerceiro`, `acompanhamentoVencido`,
// `retornoRecebido`, `coluna`) — nunca um novo estado inventado aqui.
//
// Identidade visual: 100% tokens/componentes de `visao-global.tsx`
// (Tarefas e Projetos) — `Etiqueta`/`Estado` do kit compartilhado, shadcn
// (`Input`/`Select`/`Popover`), mesmos tokens de superfície/borda/texto.
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Search, Play, CalendarClock, AlertTriangle, Clock3, Hourglass,
  SlidersHorizontal, X as XIcon, ArrowUpRight, UserPlus,
  ChevronLeft, ChevronRight,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  auth, dataCurta, Estado, Etiqueta, ROTULO_STATUS, rotularFase, type LinhaDeFila,
} from "./kit-operacional"
import type { LinhaOperacional } from "./central-tarefas"
import {
  CATEGORIAS_ATENCAO, categoriasDaLinha, ordenarPorAtencaoOperacional, rotuloDeAtencao,
  type CategoriaAtencao,
} from "@/lib/operacional/atencao-operacional"
import { urlOperacionalDaTarefa, urlDistribuicaoDoProcesso } from "@/lib/operacional/navegacao"
import { MinhaOperacaoDetalhe } from "./minha-operacao-detalhe"

// `obrigacao-atribuicao.ts` importa o Prisma client em tempo de execução —
// não pode ser importado por um componente "use client". O literal aqui só
// precisa continuar igual ao `ORIGEM_OBRIGACAO_ATRIBUICAO` daquele arquivo.
const ORIGEM_OBRIGACAO_ATRIBUICAO = "obrigacao-atribuicao"

/**
 * O CARTÃO DA OBRIGAÇÃO ADMINISTRATIVA — "O QUE / ONDE / SITUAÇÃO / AÇÃO"
 * em vez de uma linha de tabela genérica. A natureza da tarefa (distribuir,
 * nunca executar uma certidão) muda a apresentação, nunca o fato de que é
 * trabalho real do usuário logado — por isso vive DENTRO de Minha Operação,
 * nunca numa tela separada.
 *
 * A CONTAGEM "N aguardando responsável" é lida agora (nunca guardada na
 * linha, de propósito — ver obrigacao-atribuicao.ts) pela MESMA leitura que
 * o chip "sem responsável" da Central usa.
 */
function CartaoObrigacaoAdministrativa({ l }: { l: LinhaOperacional }) {
  const router = useRouter()
  const [semResponsavel, setSemResponsavel] = useState<number | null>(null)

  useEffect(() => {
    if (l.processoId == null) return
    let vivo = true
    const p = new URLSearchParams({ processo: String(l.processoId), semResponsavel: "1", porPagina: "1" })
    p.append("tipoTarefa", "NORMAL")
    fetch(`/api/operacao/visao-global?${p.toString()}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { total: number }) => { if (vivo) setSemResponsavel(d.total) })
      .catch(() => { if (vivo) setSemResponsavel(null) })
    return () => { vivo = false }
  }, [l.processoId])

  const contexto = l.familiaNome ? `${l.familiaNome} · ${l.processoNome ?? "—"}` : l.processoNome ?? "—"
  const abrirDistribuicao = () => { if (l.processoId != null) router.push(urlDistribuicaoDoProcesso(l.processoId)) }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={abrirDistribuicao}
      onKeyDown={(e) => { if (e.key === "Enter") abrirDistribuicao() }}
      className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-[var(--info-tile)] bg-[var(--info-tile)]/25 px-4 py-3 transition-colors hover:bg-[var(--info-tile)]/40"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--info-tile)] text-[var(--info-text)]">
        <UserPlus className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">Atribuir tarefas</p>
        <p className="truncate text-[11.5px] text-[var(--text-secondary)]">{contexto}</p>
      </div>
      <p className="shrink-0 text-[12.5px] text-[var(--text-secondary)]">
        {semResponsavel == null ? "…" : `${semResponsavel} tarefa${semResponsavel === 1 ? "" : "s"} aguardando responsável`}
      </p>
      <span className="shrink-0 text-[11.5px] text-[var(--text-secondary)]">Responsável: {l.responsavelNome ?? "—"}</span>
      <button
        onClick={(e) => { e.stopPropagation(); abrirDistribuicao() }}
        className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--action-primary)] bg-[var(--action-primary)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--action-primary-ink)] transition-opacity hover:opacity-90"
      >
        Distribuir tarefas <ArrowUpRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

const ICONE_CATEGORIA: Record<CategoriaAtencao, React.ComponentType<{ className?: string }>> = {
  paraAgirAgora: Play,
  acompanharHoje: CalendarClock,
  atrasoInterno: AlertTriangle,
  terceirosAtrasados: Clock3,
  aguardandoTerceiros: Hourglass,
}
/** Mesmos tokens semânticos de tile/tinta que `visao-global.tsx` (Etapa 5) já usa — nunca cor inventada. */
const TOM_CATEGORIA: Record<CategoriaAtencao, string> = {
  paraAgirAgora: "bg-[var(--info-tile)] text-[var(--info-text)]",
  acompanharHoje: "bg-[var(--warning-tile)] text-[var(--warning-text)]",
  atrasoInterno: "bg-[var(--danger-tile)] text-[var(--danger-text)]",
  terceirosAtrasados: "bg-[var(--warning-tile)] text-[var(--warning-text)]",
  aguardandoTerceiros: "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]",
}

const TODOS = "todos"
const Z_POPOVER = "z-[10060]"

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-[var(--text-secondary)]">{rotulo}</span>
      {children}
    </label>
  )
}

/** A situação em linguagem de gente — mandato §16: passo ≠ estado operacional. */
function textoDaSituacao(l: LinhaOperacional): string {
  if (l.requerDecisao) return "Requer decisão"
  if (l.coluna === "AGUARDANDO_TERCEIRO") {
    return l.esperandoDe === "cliente" ? "Aguardando o cliente" : `Aguardando ${l.terceiroNome ?? "terceiro"}`
  }
  if (l.coluna === "BLOQUEADA") return l.motivoBloqueio ? `Bloqueada — ${l.motivoBloqueio}` : "Bloqueada"
  if (l.coluna === "A_FAZER") return "Ação necessária"
  if (l.coluna === "CONCLUIDA") return "Concluída"
  return ROTULO_STATUS[l.statusTarefa] ?? l.statusTarefa
}

/** A próxima ação/acontecimento — mandato §15, a coluna mais importante da tela. */
function textoDaProximaAcao(l: LinhaOperacional): string {
  if (l.proximoAcontecimento?.descricao) return l.proximoAcontecimento.descricao
  if (l.requerDecisao) return "Decidir o que fazer com esta operação"
  if (l.coluna === "A_FAZER") return l.etapaAtual ? `Executar: ${l.etapaAtual}` : "Iniciar"
  if (l.coluna === "AGUARDANDO_TERCEIRO") return `Aguardar ${l.terceiroNome ?? "terceiro"}`
  return l.etapaAtual ?? "—"
}

interface Filtros {
  busca: string
  fase: string | null
  terceiro: string | null
  prazo: "todos" | "atrasadas" | "hoje" | "7dias"
}
const SEM_FILTRO: Filtros = { busca: "", fase: null, terceiro: null, prazo: "todos" }

const POR_PAGINA = 10

export function MinhaOperacao() {
  const router = useRouter()
  const [resultado, setResultado] = useState<{ chave: string; lista: LinhaOperacional[] | null } | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [categoria, setCategoria] = useState<CategoriaAtencao | "todas">("todas")
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO)
  const [maisFiltros, setMaisFiltros] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [selecionado, setSelecionado] = useState<number | null>(null)
  const [usuario, setUsuario] = useState<{ nome?: string } | null>(null)

  useEffect(() => {
    try {
      const bruto = localStorage.getItem("user")
      if (bruto) setUsuario(JSON.parse(bruto))
    } catch { /* leitura best-effort — sem usuário salvo, cai no fallback do saudação */ }
  }, [])

  // A BUSCA TEM DEBOUNCE — não dispara um request por tecla (mandato §21).
  const [buscaDigitada, setBuscaDigitada] = useState("")
  useEffect(() => {
    const t = setTimeout(() => { setFiltros((f) => ({ ...f, busca: buscaDigitada })); setPagina(1) }, 350)
    return () => clearTimeout(t)
  }, [buscaDigitada])

  // ── FILTROS SERVER-SIDE (mandato §20): fase/terceiro/prazo/busca viram
  // query string e entram no `where` do banco, ANTES da paginação — a MESMA
  // leitura de `visaoGerencial`/Tarefas e Projetos. A categoria de atenção
  // (KPI/chip) continua client-side: é estado COMPOSTO (`categoriasDaLinha`),
  // não uma coluna do banco — filtrar por ela sobre o universo já filtrado
  // pelo servidor é o mesmo padrão que os TILES de Tarefas e Projetos usam.
  const query = useMemo(() => {
    const p = new URLSearchParams({ visao: "minha_fila" })
    if (filtros.busca.trim()) p.set("busca", filtros.busca.trim())
    if (filtros.fase) p.set("fase", filtros.fase)
    if (filtros.terceiro) p.set("terceiro", filtros.terceiro)
    if (filtros.prazo !== "todos") p.set("prazo", filtros.prazo)
    return p.toString()
  }, [filtros])

  const chave = `${query}#${recarga}`
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas?${query}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => { if (vivo) setResultado({ chave, lista: d.linhas ?? [] }) })
      .catch(() => { if (vivo) setResultado({ chave, lista: null }) })
    return () => { vivo = false }
  }, [chave, query])

  const carregando = resultado?.chave !== chave
  const linhas = carregando ? null : resultado?.lista ?? null
  const falhou = !carregando && linhas == null

  // A NATUREZA da tarefa muda a APRESENTAÇÃO, nunca o fato de que é trabalho
  // real do usuário: a obrigação administrativa vira CARTÃO próprio (O QUE/
  // ONDE/SITUAÇÃO/AÇÃO), nunca uma linha genérica da tabela operacional —
  // por isso sai do pipeline de categoria/tabela/paginação abaixo, mas
  // continua vindo da MESMA `linhas` (mesma `/api/operacao/tarefas`).
  const linhasAdministrativas = useMemo(() => linhas?.filter((l) => l.origem === ORIGEM_OBRIGACAO_ATRIBUICAO) ?? [], [linhas])
  // `null` preservado (nunca `[]`) — o pipeline de categoria/tabela abaixo
  // distingue "ainda carregando" de "carregou e está vazio" por isto.
  const linhasNormais = useMemo(() => (linhas ? linhas.filter((l) => l.origem !== ORIGEM_OBRIGACAO_ATRIBUICAO) : null), [linhas])

  // ── OPÇÕES DOS FILTROS — de um universo ESTÁVEL (fetch próprio, sem
  // filtro), nunca do resultado já filtrado — senão escolher uma fase faria
  // as outras fases desaparecerem do próprio seletor de fase.
  const [universo, setUniverso] = useState<LinhaOperacional[] | null>(null)
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas?visao=minha_fila`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => { if (vivo) setUniverso(d.linhas ?? []) })
      .catch(() => { if (vivo) setUniverso([]) })
    return () => { vivo = false }
  }, [recarga])
  const opcoesFase = useMemo(() => {
    const vistos = new Map<string, string>()
    for (const l of universo ?? []) if (l.faseMacroKey) vistos.set(l.faseMacroKey, rotularFase(l.faseMacroKey) ?? l.faseMacroKey)
    return [...vistos.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [universo])
  const opcoesTerceiro = useMemo(() => {
    const vistos = new Set<string>()
    for (const l of universo ?? []) if (l.terceiroNome) vistos.add(l.terceiroNome)
    return [...vistos].sort((a, b) => a.localeCompare(b))
  }, [universo])

  // ── AS 8 CONTAGENS DE ATENÇÃO — MESMO UNIVERSO da tabela (mandato §43: KPI e
  // filtro nunca podem divergir): sobre o resultado JÁ FILTRADO pelo servidor
  // (fase/terceiro/prazo/busca), nunca sobre o universo total. Cada linha
  // pode pertencer a várias categorias.
  const porCategoria = useMemo(() => {
    const mapa = new Map<CategoriaAtencao, LinhaOperacional[]>(CATEGORIAS_ATENCAO.map((c) => [c.chave, []]))
    for (const l of linhasNormais ?? []) for (const c of categoriasDaLinha(l)) mapa.get(c)?.push(l)
    return mapa
  }, [linhasNormais])

  const filtradas = useMemo(() => {
    if (!linhasNormais) return null
    if (categoria === "todas") return linhasNormais
    return linhasNormais.filter((l) => categoriasDaLinha(l).includes(categoria))
  }, [linhasNormais, categoria])

  const ordenadas = useMemo(() => (filtradas ? ordenarPorAtencaoOperacional(filtradas) : null), [filtradas])

  const totalPaginas = Math.max(1, Math.ceil((ordenadas?.length ?? 0) / POR_PAGINA))
  const paginaValida = Math.min(Math.max(pagina, 1), totalPaginas)
  const visiveis = ordenadas?.slice((paginaValida - 1) * POR_PAGINA, paginaValida * POR_PAGINA) ?? null

  const temFiltro = filtros.busca.trim() !== "" || filtros.fase != null || filtros.terceiro != null || filtros.prazo !== "todos" || categoria !== "todas"
  const limparFiltros = () => { setFiltros(SEM_FILTRO); setBuscaDigitada(""); setCategoria("todas"); setPagina(1) }

  const abrirNoProcesso = (l: LinhaOperacional) => router.push(urlOperacionalDaTarefa({ taskId: l.taskId, processoId: l.processoId }))

  const primeiroNome = usuario?.nome?.trim().split(/\s+/)[0]

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-page)]">
      {/* ── CABEÇALHO ── */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-6 py-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">
            {primeiroNome ? `Olá, ${primeiroNome}!` : "Minha Operação"}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Aqui está tudo o que precisa da sua atenção agora.</p>
        </div>
        <div className="relative w-full max-w-sm sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={buscaDigitada}
            onChange={(e) => setBuscaDigitada(e.target.value)}
            placeholder="Buscar por pessoa, processo, documento, cartório…"
            className="h-9 bg-[var(--surface-elevated)] pl-8 text-[13px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
        <div className="flex h-full min-h-0 gap-4">
          <div className={`flex min-h-0 min-w-0 flex-1 flex-col gap-3 ${selecionado != null ? "hidden lg:flex" : ""}`}>
            {/* ── OBRIGAÇÕES ADMINISTRATIVAS — cartão próprio, sempre visível
                independente da categoria/filtro ativo na tabela abaixo (a
                tabela é só para tarefas NORMAL/TRANSVERSAL). "Se existe uma
                tarefa canônica ativa atribuída a mim que exige uma ação
                minha, eu preciso encontrá-la em Minha Operação." ── */}
            {linhasAdministrativas.length > 0 && (
              <div className="flex flex-col gap-2">
                {linhasAdministrativas.map((l) => <CartaoObrigacaoAdministrativa key={l.taskId} l={l} />)}
              </div>
            )}

            {/* ── ESTADOS OPERACIONAIS — navegação única (redesign 16/09/2026).
                Antes eram DOIS controles pro MESMO estado: uma grade de 8
                tiles (KPI) e, embaixo, uma fileira de chips com o mesmo
                rótulo e a mesma contagem — a mesma decisão duplicada em dois
                lugares. Agora é uma barra só, compacta, com "Todas" incluída
                nela mesma; a categoria ativa fica evidente por sublinhado +
                cor, sem card pesado. ── */}
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-1.5">
              <button
                onClick={() => { setCategoria("todas"); setPagina(1) }}
                className={`flex items-center gap-1.5 rounded-md border-b-2 px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                  categoria === "todas"
                    ? "border-[var(--action-primary)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Todas <span className="tabular-nums text-[var(--text-muted)]">{linhasNormais?.length ?? 0}</span>
              </button>
              <span className="h-4 w-px shrink-0 bg-[var(--border-subtle)]" />
              {CATEGORIAS_ATENCAO.map((c) => {
                const Icone = ICONE_CATEGORIA[c.chave]
                const n = porCategoria.get(c.chave)?.length ?? 0
                const ativo = categoria === c.chave
                return (
                  <button
                    key={c.chave}
                    title={c.tooltip}
                    onClick={() => { setCategoria(ativo ? "todas" : c.chave); setPagina(1) }}
                    className={`flex items-center gap-1.5 rounded-md border-b-2 px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                      ativo
                        ? "border-[var(--action-primary)] text-[var(--text-primary)]"
                        : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icone className={`h-3.5 w-3.5 ${ativo ? "" : "opacity-70"}`} />
                    {c.rotulo} <span className="tabular-nums text-[var(--text-muted)]">{n}</span>
                  </button>
                )
              })}
            </div>

            {/* ── FILTROS — item 10 ── */}
            <div className="flex flex-wrap items-end gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5">
              <Campo rotulo="Fase">
                <Select value={filtros.fase ?? TODOS} onValueChange={(v) => { setFiltros((f) => ({ ...f, fase: v === TODOS ? null : v })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-40 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value={TODOS}>Todas as fases</SelectItem>
                    {opcoesFase.map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Terceiro">
                <Select value={filtros.terceiro ?? TODOS} onValueChange={(v) => { setFiltros((f) => ({ ...f, terceiro: v === TODOS ? null : v })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-40 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value={TODOS}>Todos os terceiros</SelectItem>
                    {opcoesTerceiro.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Prazo">
                <Select value={filtros.prazo} onValueChange={(v) => { setFiltros((f) => ({ ...f, prazo: v as Filtros["prazo"] })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-36 bg-[var(--surface-elevated)] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value="todos">Qualquer prazo</SelectItem>
                    <SelectItem value="atrasadas">Atrasadas</SelectItem>
                    <SelectItem value="hoje">Vencem hoje</SelectItem>
                    <SelectItem value="7dias">Vencem em 7 dias</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              <button
                onClick={() => setMaisFiltros((v) => !v)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)]"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Mais filtros
              </button>
              {temFiltro && (
                <button onClick={limparFiltros} className="flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]">
                  <XIcon className="h-3.5 w-3.5" /> Limpar filtros
                </button>
              )}
            </div>

            {/* ── TABELA — item 13 ── */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
              {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar sua operação." aoTentar={() => setRecarga((n) => n + 1)} />}
              {carregando && <Estado tipo="carregando" mensagem="Carregando sua operação…" />}
              {!carregando && !falhou && visiveis?.length === 0 && (
                <Estado
                  tipo="vazio"
                  mensagem={
                    temFiltro
                      ? "Nenhuma operação corresponde aos filtros selecionados."
                      : linhasAdministrativas.length > 0
                        ? "Nenhuma tarefa operacional pendente — veja a obrigação administrativa acima."
                        : "Nenhuma operação exige sua atenção agora."
                  }
                />
              )}
              {visiveis != null && visiveis.length > 0 && (
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 z-10 bg-[var(--surface-overlay)]">
                      <tr className="border-b border-[var(--border-subtle)] [&>th]:px-3 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-[var(--text-muted)]">
                        <th>Atenção</th>
                        <th>Operação</th>
                        <th>Passo</th>
                        <th>Situação / próxima ação</th>
                        <th>Prazo</th>
                        <th>Esperando há</th>
                        <th className="w-24">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.map((l) => {
                        const atencaoLinha = rotuloDeAtencao(l)
                        return (
                          <tr
                            key={l.taskId}
                            onClick={() => setSelecionado(l.taskId)}
                            className={`cursor-pointer border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-secondary)] ${selecionado === l.taskId ? "bg-[var(--surface-secondary)]" : ""}`}
                          >
                            <td className="px-3 py-2.5">
                              <Etiqueta tom={atencaoLinha.tom === "critico" ? "critico" : atencaoLinha.tom === "alerta" ? "alerta" : "neutro"}>{atencaoLinha.rotulo}</Etiqueta>
                            </td>
                            <td className="max-w-[220px] px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                {l.emRisco && (
                                  <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--danger)]"
                                    title={l.motivosRisco.length ? l.motivosRisco.join(" · ") : "Em risco"}
                                  />
                                )}
                                <span className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">{l.titulo}</span>
                              </div>
                              <div className="truncate text-[10.5px] text-[var(--text-muted)]">{[l.pessoaNome, l.processoNome].filter(Boolean).join(" · ") || "—"}</div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="text-[11.5px] tabular-nums text-[var(--text-primary)]">{l.passoAtual ? `${l.passoAtual.ordem}/${l.passoAtual.total}` : "—"}</div>
                              <div className="truncate text-[10.5px] text-[var(--text-muted)]">{rotularFase(l.faseMacroKey) ?? "—"}</div>
                            </td>
                            <td className="max-w-[260px] px-3 py-2.5">
                              <div className="text-[11.5px] text-[var(--text-secondary)]">{textoDaSituacao(l)}</div>
                              <div className="truncate text-[10.5px] text-[var(--text-muted)]">{textoDaProximaAcao(l)}</div>
                              {l.terceiroNome && (
                                <div className="mt-0.5 truncate text-[10px] text-[var(--info-text)]">Terceiro: {l.terceiroNome}</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className={`text-[11.5px] ${l.atrasada ? "text-[var(--danger-text)]" : "text-[var(--text-secondary)]"}`}>{l.rotuloDoPrazo}</div>
                              {l.dataPrazo && <div className="text-[10px] tabular-nums text-[var(--text-muted)]">{dataCurta(l.dataPrazo)}</div>}
                            </td>
                            <td className="px-3 py-2.5 text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                              {l.esperandoHaDias != null ? `${l.esperandoHaDias} dia${l.esperandoHaDias === 1 ? "" : "s"}` : "—"}
                            </td>
                            <td className="px-3 py-2.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); abrirNoProcesso(l) }}
                                className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-[10.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
                              >
                                Abrir <ArrowUpRight className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {ordenadas != null && ordenadas.length > 0 && (
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2">
                  <span className="text-[11px] text-[var(--text-muted)]">Mostrando {visiveis?.length ?? 0} de {ordenadas.length} operações</span>
                  {totalPaginas > 1 && (
                    <div className="flex items-center gap-2">
                      <button disabled={paginaValida <= 1} onClick={() => setPagina(paginaValida - 1)} className="rounded border border-[var(--border-default)] p-1 text-[var(--text-secondary)] disabled:opacity-40">
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-[11px] tabular-nums text-[var(--text-primary)]">{paginaValida} / {totalPaginas}</span>
                      <button disabled={paginaValida >= totalPaginas} onClick={() => setPagina(paginaValida + 1)} className="rounded border border-[var(--border-default)] p-1 text-[var(--text-secondary)] disabled:opacity-40">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── PAINEL DE DETALHE — item 21+ ── */}
          {selecionado != null && (
            <div className="flex w-full min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] lg:w-[420px]">
              <MinhaOperacaoDetalhe taskId={selecionado} aoFechar={() => setSelecionado(null)} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
