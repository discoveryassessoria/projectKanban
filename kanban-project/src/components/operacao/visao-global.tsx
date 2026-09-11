// src/components/operacao/visao-global.tsx
// ============================================================================
// TAREFAS E PROJETOS — a operação inteira, para quem responde por ela.
//
//   VISÃO GERAL   família/processo: fase atual, progresso, marco gerencial
//   LISTA         varrer, ordenar, achar
//   KANBAN        ver onde o trabalho está parado
//   CALENDÁRIO    o que vence, dia a dia
//
// As quatro são a MESMA consulta (`GET /api/operacao/visao-global[/familias]`)
// e o MESMO `taskId`/`processoId` que aparecem na Minha Fila e na Central.
// Trocar de aba não busca nada diferente, não cria estado e não escreve:
// reagrupa o que já está aqui. Os FILTROS são únicos para as quatro — a
// pergunta "o que a Daniela concluiu hoje" não muda de resposta por causa da
// aba em que foi feita.
//
// ─── IDENTIDADE VISUAL ──────────────────────────────────────────────────────
// Componentes de `components/ui/*` (shadcn/radix, já no tema Discovery
// ivory/azul) — nunca `<select>`/`<input>`/`<button>` cru. Elevação em
// `--elev-1/2/3`, superfícies de leitura sempre OPACAS (nunca
// `bg-.../30`), radius `--radius-md/lg`. Mesmo vocabulário de
// `src/components/home/home-primitives.tsx`.
//
// ─── A COLUNA NÃO É UMA MÁQUINA DE ESTADOS ──────────────────────────────────
// O Kanban global mostra o estado da TAREFA, nunca os passos do workflow. Uma
// certidão em "Em andamento" pode estar na etapa "Conferir certidão" — a etapa
// vive dentro da tarefa, e é lá que se executa. Se as etapas virassem colunas,
// existiriam duas máquinas de estado para o mesmo trabalho.
//
// Arrastar não escreve status: executa o COMANDO canônico correspondente. Onde
// não existe comando com significado inequívoco, não existe arrasto.
//
// ─── ESTA TELA NÃO ESCREVE ──────────────────────────────────────────────────
// Toda mudança sai por `POST /api/tarefas/{id}/comando` (ou, em lote,
// `POST /api/tarefas/redistribuir` — a MESMA porta, chamada várias vezes).
// ============================================================================
"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ListChecks, AlertTriangle, Clock, CheckCircle2, Users2, FileStack,
  Bookmark, ChevronDown, Plus, SlidersHorizontal, X as XIcon, MoreVertical, ArrowUpDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CampoData } from "@/src/components/ui/campo-data"
import { urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { ProcessoExpandido } from "./processo-expandido"
import type { FamiliaAgrupada, ProcessoAgrupado } from "@/lib/operacional/tarefa-projecoes"
import {
  auth, dataCurta, Estado, Etiqueta, ROTULO_PRIORIDADE, ROTULO_STATUS,
  rotularFase, SeletorResponsavel, type LinhaDeFila,
} from "./kit-operacional"

export interface LinhaGerencial extends LinhaDeFila {
  venceHoje: boolean
  coluna: ColunaKanban
  esperandoDe: "terceiro" | "cliente" | null
  esperandoDesde: string | null
  esperandoHaDias: number | null
  motivoBloqueio: string | null
  concluidaEm: string | null
}

type ColunaKanban =
  | "SEM_RESPONSAVEL" | "A_FAZER" | "EM_ANDAMENTO"
  | "AGUARDANDO_TERCEIRO" | "BLOQUEADA" | "CONCLUIDA"

const COLUNAS: Array<{ chave: ColunaKanban; rotulo: string; nota?: string }> = [
  { chave: "SEM_RESPONSAVEL", rotulo: "Sem responsável", nota: "esperando decisão de quem distribui" },
  { chave: "A_FAZER", rotulo: "A fazer" },
  { chave: "EM_ANDAMENTO", rotulo: "Em andamento" },
  { chave: "AGUARDANDO_TERCEIRO", rotulo: "Aguardando terceiro" },
  { chave: "BLOQUEADA", rotulo: "Bloqueada" },
  { chave: "CONCLUIDA", rotulo: "Concluída" },
]

interface Facetas {
  fases: Array<{ faseMacroKey: string; tarefas: number }>
  responsaveis: Array<{ responsavelId: number; nome: string; tarefas: number; atrasadas: number }>
}
interface Resposta {
  linhas: LinhaGerencial[]
  total: number
  indicadores: Record<string, number>
  facetas: Facetas
}
interface RespostaFamilias {
  familias: FamiliaAgrupada[]
  total: number
  indicadores: {
    tarefasAbertas: number; atrasadas: number; venceEm7Dias: number; concluidasHoje: number
    familias: number; processos: number
  }
}

type DataTipo = "criada" | "concluida" | "vencimento" | "ultimaAtividade" | "mudancaFase"

interface Filtros {
  busca: string
  responsavel: number | null
  semResponsavel: boolean
  fase: string | null
  prioridade: string | null
  statusTarefa: string[]
  statusProcesso: "ATIVO" | "CONCLUIDO" | null
  tipoTarefa: string[]
  familia: number | null
  processoId: number | null
  atrasadas: boolean
  venceHoje: boolean
  marcoFaseConcluida: boolean
  dataTipo: DataTipo
  dataInicio: string | null
  dataFim: string | null
}
const SEM_FILTRO: Filtros = {
  busca: "", responsavel: null, semResponsavel: false, fase: null, prioridade: null,
  statusTarefa: [], statusProcesso: null, tipoTarefa: [], familia: null, processoId: null,
  atrasadas: false, venceHoje: false, marcoFaseConcluida: false,
  dataTipo: "vencimento", dataInicio: null, dataFim: null,
}
const temFiltro = (f: Filtros) =>
  f.busca.trim() !== "" || f.responsavel != null || f.semResponsavel || f.fase != null || f.prioridade != null ||
  f.statusTarefa.length > 0 || f.statusProcesso != null || f.tipoTarefa.length > 0 || f.familia != null ||
  f.processoId != null || f.atrasadas || f.venceHoje || f.marcoFaseConcluida || f.dataInicio != null || f.dataFim != null

function queryDe(f: Filtros, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  if (f.busca.trim()) p.set("busca", f.busca.trim())
  if (f.responsavel != null) p.set("responsavel", String(f.responsavel))
  if (f.semResponsavel) p.set("semResponsavel", "1")
  if (f.fase) p.set("fase", f.fase)
  if (f.prioridade) p.set("prioridade", f.prioridade)
  for (const s of f.statusTarefa) p.append("status", s)
  if (f.statusProcesso) p.set("statusProcesso", f.statusProcesso)
  for (const t of f.tipoTarefa) p.append("tipoTarefa", t)
  if (f.familia != null) p.set("familia", String(f.familia))
  if (f.processoId != null) p.set("processo", String(f.processoId))
  if (f.atrasadas) p.set("atrasadas", "1")
  if (f.venceHoje) p.set("venceHoje", "1")
  if (f.marcoFaseConcluida) p.set("marcoFaseConcluida", "1")
  if (f.dataInicio || f.dataFim) {
    p.set("dataTipo", f.dataTipo)
    if (f.dataInicio) p.set("dataInicio", f.dataInicio)
    if (f.dataFim) p.set("dataFim", f.dataFim)
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  return p.toString()
}

const ROTULO_DATA_TIPO: Record<DataTipo, string> = {
  criada: "Criada em", concluida: "Concluída em", vencimento: "Vencimento",
  ultimaAtividade: "Última atividade", mudancaFase: "Mudança de fase",
}
/** Sentinela do shadcn Select — Radix não aceita `value=""`. `null`/`""` no domínio vira `"todos"` na UI. */
const TODOS = "todos"

/** Iniciais para o avatar — quem é o responsável se lê antes de ler o nome. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase()
}

function Responsavel({ nome }: { nome: string | null }) {
  if (!nome) return <span className="text-[12px] text-[var(--text-muted)]">Sem responsável</span>
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--surface-tertiary)] text-[10px] font-semibold text-[var(--text-primary)]">
        {iniciais(nome)}
      </span>
      <span className="truncate text-[12px] text-[var(--text-primary)]">{nome}</span>
    </span>
  )
}

/** Um campo rotulado da barra de filtros — rótulo em cima, controle embaixo, sempre a mesma forma. */
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-[var(--text-secondary)]">{rotulo}</span>
      {children}
    </label>
  )
}

const CLASSE_SELECT = "w-full bg-[var(--surface-elevated)] text-[13px] data-[size=default]:h-9"
/** SSOT de camadas (`src/lib/ui/layers.ts`, LAYER.popover=10060) — nunca o z-50 de fábrica do shadcn. */
const Z_POPOVER = "z-[10060]"

/** As condições derivadas que mudam a decisão de quem lê — nunca status novo. */
function Sinais({ l }: { l: LinhaGerencial }) {
  return (
    <>
      {l.atrasada && <Etiqueta tom="critico">Atrasada</Etiqueta>}
      {!l.atrasada && l.venceHoje && <Etiqueta tom="alerta">Vence hoje</Etiqueta>}
      {l.prioridade === "URGENTE" && <Etiqueta tom="alerta">Urgente</Etiqueta>}
      {l.responsavelId == null && l.coluna !== "CONCLUIDA" && <Etiqueta tom="acento">Sem responsável</Etiqueta>}
      {l.aguardandoDependencia && <Etiqueta tom="neutro">Depende de outra</Etiqueta>}
      {l.requerDecisao && <Etiqueta tom="alerta">Requer decisão</Etiqueta>}
    </>
  )
}

/** Os seis números do topo — CANÔNICOS e IDÊNTICOS nas quatro abas (nunca um número independente da listagem). */
const TILES: Array<{
  chave: keyof RespostaFamilias["indicadores"]; rotulo: string; tom: string; icone: typeof ListChecks
  iconeTom: string; filtro?: Partial<Filtros>
}> = [
  { chave: "tarefasAbertas", rotulo: "Tarefas abertas", tom: "text-[var(--text-primary)]", icone: ListChecks, iconeTom: "bg-[var(--info-tile)] text-[var(--info-text)]" },
  { chave: "atrasadas", rotulo: "Atrasadas", tom: "text-[var(--danger-text)]", icone: AlertTriangle, iconeTom: "bg-[var(--danger-tile)] text-[var(--danger-text)]", filtro: { atrasadas: true } },
  { chave: "venceEm7Dias", rotulo: "Vencem em 7 dias", tom: "text-[var(--warning-text)]", icone: Clock, iconeTom: "bg-[var(--warning-tile)] text-[var(--warning-text)]", filtro: { venceHoje: true } },
  {
    chave: "concluidasHoje", rotulo: "Concluídas (hoje)", tom: "text-[var(--success-text)]", icone: CheckCircle2, iconeTom: "bg-[var(--success-tile)] text-[var(--success-text)]",
    filtro: { dataTipo: "concluida", dataInicio: new Date().toISOString().slice(0, 10), dataFim: new Date().toISOString().slice(0, 10) },
  },
  { chave: "familias", rotulo: "Famílias", tom: "text-[var(--text-primary)]", icone: Users2, iconeTom: "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]" },
  { chave: "processos", rotulo: "Processos", tom: "text-[var(--text-primary)]", icone: FileStack, iconeTom: "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]" },
]

interface VisaoSalva { id: number; nome: string; spec: { filtros: Filtros; modo: string } }

export function VisaoGlobal() {
  const { pode } = usePermissoes()
  const podeAtribuir = pode("tarefas.editar")
  const [modo, setModo] = useState<"visaoGeral" | "lista" | "kanban" | "calendario">("visaoGeral")
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO)
  const [maisFiltros, setMaisFiltros] = useState(false)
  const [resultado, setResultado] = useState<{ chave: string; d: Resposta | null } | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [alvo, setAlvo] = useState<LinhaGerencial | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erroComando, setErroComando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ordem, setOrdem] = useState<{ campo: keyof LinhaGerencial; asc: boolean }>({ campo: "dataPrazo", asc: true })
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [alvoLote, setAlvoLote] = useState<{ linhas: LinhaGerencial[] } | null>(null)
  const router = useRouter()
  const irParaOProcesso = useCallback((taskId: number, processoId: number | null) => {
    router.push(urlOperacionalDaTarefa({ taskId, processoId }))
  }, [router])

  // A busca não pode disparar um pedido por tecla digitada.
  const [buscaDigitada, setBuscaDigitada] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => ({ ...f, busca: buscaDigitada })), 350)
    return () => clearTimeout(t)
  }, [buscaDigitada])

  const query = queryDe(filtros)
  const chave = `${query}#${recarga}`
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/visao-global?${query}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Resposta) => { if (vivo) setResultado({ chave, d }) })
      .catch(() => { if (vivo) setResultado({ chave, d: null }) })
    return () => { vivo = false }
  }, [chave, query])

  const carregando = resultado?.chave !== chave
  const dados = carregando ? null : resultado?.d ?? null
  const falhou = !carregando && dados == null
  const recarregar = useCallback(() => setRecarga((n) => n + 1), [])

  // A VISÃO GERAL É UMA CONSULTA À PARTE — resume a mesma operação por
  // família, com os MESMOS filtros (a barra é única para as quatro abas).
  const [resultadoFamilias, setResultadoFamilias] = useState<{ chave: string; d: RespostaFamilias | null } | null>(null)
  const [paginaFamilias, setPaginaFamilias] = useState(1)
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/visao-global/familias?${query}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RespostaFamilias) => { if (vivo) setResultadoFamilias({ chave, d }) })
      .catch(() => { if (vivo) setResultadoFamilias({ chave, d: null }) })
    return () => { vivo = false }
  }, [chave, query])
  const carregandoFamilias = resultadoFamilias?.chave !== chave
  const dadosFamilias = carregandoFamilias ? null : resultadoFamilias?.d ?? null
  const falhouFamilias = !carregandoFamilias && dadosFamilias == null

  /**
   * TODA MUDANÇA SAI POR UMA PORTA SÓ — inclusive as do Kanban.
   *
   * O 409 aparece na tela: quando outro gestor mexeu antes, quem chegou depois
   * é avisado e a lista recarrega, em vez de sobrescrever a decisão alheia.
   */
  const comandar = useCallback(
    async (tarefaId: number, corpo: Record<string, unknown>, sucesso: string) => {
      setOcupado(true)
      setErroComando(null)
      try {
        const r = await fetch(`/api/tarefas/${tarefaId}/comando`, {
          method: "POST", headers: auth(), body: JSON.stringify(corpo),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          setErroComando(
            r.status === 409 ? "Outra pessoa mexeu nesta tarefa agora. Recarregamos a lista."
            : r.status === 403 ? "Você não tem permissão para esta ação."
            : d?.error ?? `Falha (HTTP ${r.status}).`,
          )
          if (r.status === 409) recarregar()
          return false
        }
        setAviso(sucesso)
        setAlvo(null)
        recarregar()
        return true
      } catch {
        setErroComando("Não foi possível falar com o servidor.")
        return false
      } finally {
        setOcupado(false)
      }
    },
    [recarregar],
  )

  /**
   * ATRIBUIÇÃO EM LOTE — a MESMA porta de sempre, chamada uma vez por tarefa.
   */
  const atribuirEmLote = useCallback(async (alvos: LinhaGerencial[], responsavelId: number) => {
    setOcupado(true)
    setErroComando(null)
    let ok = 0
    let falha = 0
    for (const l of alvos) {
      try {
        const r = await fetch(`/api/tarefas/${l.taskId}/comando`, {
          method: "POST",
          headers: auth(),
          body: JSON.stringify({ acao: l.responsavelId == null ? "atribuir" : "transferir", responsavelId }),
        })
        if (r.ok) ok += 1
        else falha += 1
      } catch {
        falha += 1
      }
    }
    setOcupado(false)
    setAlvoLote(null)
    setSelecionados(new Set())
    setAviso(
      falha === 0
        ? `${ok} tarefa${ok === 1 ? "" : "s"} atribuída${ok === 1 ? "" : "s"}.`
        : `${ok} atribuída${ok === 1 ? "" : "s"}, ${falha} ${falha === 1 ? "falhou" : "falharam"}.`,
    )
    recarregar()
  }, [recarregar])

  const linhas = useMemo(() => dados?.linhas ?? [], [dados])
  const ordenadas = useMemo(() => {
    const { campo, asc } = ordem
    return [...linhas].sort((a, b) => {
      const va = a[campo], vb = b[campo]
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))
      return asc ? c : -c
    })
  }, [linhas, ordem])

  const porColuna = useMemo(() => {
    const m = new Map<ColunaKanban, LinhaGerencial[]>(COLUNAS.map((c) => [c.chave, []]))
    for (const l of linhas) m.get(l.coluna)?.push(l)
    return m
  }, [linhas])

  const todosSelecionadosVisiveis = ordenadas.length > 0 && ordenadas.every((l) => selecionados.has(l.taskId))
  const alternarTodos = () => setSelecionados(todosSelecionadosVisiveis ? new Set() : new Set(ordenadas.map((l) => l.taskId)))
  const alternarSelecao = (id: number) => setSelecionados((prev) => {
    const novo = new Set(prev)
    if (novo.has(id)) novo.delete(id); else novo.add(id)
    return novo
  })

  const aplicar = (p: Partial<Filtros>) => setFiltros((f) => ({ ...f, ...p }))
  const limpar = () => { setBuscaDigitada(""); setFiltros(SEM_FILTRO); setRascunho(SEM_FILTRO) }

  // ── RASCUNHO DE FILTROS — a segunda linha e "Mais filtros" só valem depois
  // de "Aplicar filtros". Busca e os TILES continuam instantâneos: são o
  // atalho rápido, não a composição de uma consulta complexa.
  const [rascunho, setRascunho] = useState<Filtros>(SEM_FILTRO)
  useEffect(() => { setRascunho(filtros) }, [filtros])
  const mudarRascunho = (p: Partial<Filtros>) => setRascunho((f) => ({ ...f, ...p }))
  const aplicarRascunho = () => setFiltros(rascunho)
  const rascunhoDivergeDoAplicado = JSON.stringify(rascunho) !== JSON.stringify(filtros)

  // ── SALVAR VISÃO / MINHAS VISÕES — reaproveita RelatorioVisao (dominio
  // "tarefas-e-projetos"), a MESMA tabela genérica de visão salva do motor de
  // Relatórios. Ver src/app/api/operacao/visao-global/visoes/route.ts.
  const [minhasVisoes, setMinhasVisoes] = useState<VisaoSalva[] | null>(null)
  const [salvarAberto, setSalvarAberto] = useState(false)
  const [nomeVisao, setNomeVisao] = useState("")
  const [salvandoVisao, setSalvandoVisao] = useState(false)
  const carregarVisoes = useCallback(() => {
    fetch("/api/operacao/visao-global/visoes", { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { visoes: VisaoSalva[] }) => setMinhasVisoes(d.visoes))
      .catch(() => setMinhasVisoes([]))
  }, [])
  const salvarVisaoAtual = async () => {
    const nome = nomeVisao.trim()
    if (!nome) return
    setSalvandoVisao(true)
    try {
      const r = await fetch("/api/operacao/visao-global/visoes", {
        method: "POST", headers: auth(), body: JSON.stringify({ nome, filtros, modo }),
      })
      if (r.ok) { setSalvarAberto(false); setNomeVisao(""); setAviso(`Visão "${nome}" salva.`); carregarVisoes() }
      else setErroComando("Não foi possível salvar a visão.")
    } catch {
      setErroComando("Não foi possível falar com o servidor.")
    } finally {
      setSalvandoVisao(false)
    }
  }
  const abrirVisaoSalva = (v: VisaoSalva) => {
    setFiltros(v.spec.filtros)
    setBuscaDigitada(v.spec.filtros.busca ?? "")
    if (v.spec.modo === "visaoGeral" || v.spec.modo === "lista" || v.spec.modo === "kanban" || v.spec.modo === "calendario") setModo(v.spec.modo)
  }
  const excluirVisaoSalva = async (id: number) => {
    await fetch(`/api/operacao/visao-global/visoes?id=${id}`, { method: "DELETE", headers: auth() }).catch(() => {})
    carregarVisoes()
  }

  // Opções de família/processo vêm do que EXISTE na agregação — nunca lista fixa.
  const opcoesProcesso = useMemo(() => {
    const vistos = new Map<number, string>()
    for (const f of dadosFamilias?.familias ?? []) for (const p of f.processos) vistos.set(p.processoId, p.nomeProcesso)
    return [...vistos.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [dadosFamilias])
  const opcoesFamilia = useMemo(() => {
    const vistos = new Map<number, string>()
    for (const f of dadosFamilias?.familias ?? []) if (f.familiaId != null) vistos.set(f.familiaId, f.nomeFamilia)
    return [...vistos.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [dadosFamilias])

  return (
    <div className="flex h-full flex-col bg-[var(--surface-page)]">
      {/* ── CABEÇALHO DA CENTRAL ── */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-6 py-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">Tarefas e Projetos</h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Acompanhe todas as tarefas, processos e atividades da sua equipe.</p>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={salvarAberto} onOpenChange={setSalvarAberto}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm"><Bookmark size={14} /> Salvar visão</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className={`w-72 bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
              <label className="block text-[11px] font-medium text-[var(--text-secondary)]">Nome da visão</label>
              <Input
                autoFocus value={nomeVisao} onChange={(e) => setNomeVisao(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && salvarVisaoAtual()}
                placeholder="Ex.: Minha fila de hoje"
                className="mt-1.5 h-9 bg-[var(--surface-elevated)] text-[13px]"
              />
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSalvarAberto(false)}>Cancelar</Button>
                <Button size="sm" disabled={!nomeVisao.trim() || salvandoVisao} onClick={salvarVisaoAtual}>Salvar</Button>
              </div>
            </PopoverContent>
          </Popover>

          <DropdownMenu onOpenChange={(v) => v && !minhasVisoes && carregarVisoes()}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">Minhas visões <ChevronDown size={14} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={`w-72 bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
              {minhasVisoes == null && <div className="px-2 py-2 text-[12px] text-[var(--text-muted)]">Carregando…</div>}
              {minhasVisoes?.length === 0 && <div className="px-2 py-2 text-[12px] text-[var(--text-muted)]">Nenhuma visão salva ainda.</div>}
              {minhasVisoes?.map((v, i) => (
                <Fragment key={v.id}>
                  {i > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem className="flex items-center justify-between gap-2" onSelect={() => abrirVisaoSalva(v)}>
                    <span className="min-w-0 flex-1 truncate">{v.nome}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); excluirVisaoSalva(v.id) }}
                      aria-label={`Excluir visão ${v.nome}`}
                      className="shrink-0 text-[var(--text-muted)] hover:text-[var(--danger-text)]"
                    >
                      <XIcon size={13} />
                    </button>
                  </DropdownMenuItem>
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button size="sm" onClick={() => setMaisFiltros(true)}><Plus size={14} /> Novo Filtro</Button>
        </div>
      </div>

      {/* ── NAVEGAÇÃO DE ABAS ── */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-6">
        {([
          ["visaoGeral", "Visão Geral"], ["lista", "Lista"], ["kanban", "Kanban"], ["calendario", "Calendário"],
        ] as const).map(([m, r]) => (
          <button
            key={m}
            onClick={() => setModo(m)}
            className={`relative px-3 py-3 text-[13px] font-medium transition-colors ${
              modo === m ? "text-[var(--action-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {r}
            {modo === m && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-[var(--action-primary)]" />}
          </button>
        ))}
      </div>

      {/* ── INDICADORES ── canônicos e clicáveis: cada número é um atalho de filtro. */}
      <div className="grid grid-cols-2 gap-3 px-6 py-5 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map((t) => {
          const Icone = t.icone
          return (
            <button
              key={t.chave}
              type="button"
              disabled={!t.filtro}
              onClick={() => t.filtro && aplicar(t.filtro)}
              className={`flex items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-3.5 text-left shadow-[var(--elev-1)] transition-all ${
                t.filtro ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[var(--elev-2)]" : "cursor-default"
              }`}
            >
              <div>
                <div className={`text-[24px] font-semibold leading-7 tabular-nums ${t.tom}`}>
                  {dadosFamilias ? dadosFamilias.indicadores[t.chave] : "—"}
                </div>
                <div className="mt-0.5 text-[12px] leading-4 text-[var(--text-muted)]">{t.rotulo}</div>
              </div>
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${t.iconeTom}`}>
                <Icone size={18} />
              </span>
            </button>
          )
        })}
      </div>

      {/* ── FILTROS ── uma barra só, para as quatro abas: primeira linha
          sempre visível, segunda linha com tipo/família/processo + ações,
          "Mais filtros" abre a terceira. Só "Aplicar filtros" busca — exceto
          Pesquisar e os TILES, que continuam instantâneos. */}
      <div className="mx-6 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] px-5 py-4 shadow-[var(--elev-1)]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Campo rotulo="Pesquisar">
            <Input
              value={buscaDigitada}
              onChange={(e) => setBuscaDigitada(e.target.value)}
              placeholder="Processo, família, tarefa…"
              className="h-9 bg-[var(--surface-elevated)] text-[13px]"
            />
          </Campo>
          <Campo rotulo="Período">
            <div className="flex flex-col gap-1">
              <CampoData
                value={rascunho.dataInicio} onChange={(v) => mudarRascunho({ dataInicio: v })} placeholder="De"
                className="w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
              />
              <CampoData
                value={rascunho.dataFim} onChange={(v) => mudarRascunho({ dataFim: v })} placeholder="Até"
                className="w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
              />
            </div>
          </Campo>
          <Campo rotulo="Responsável">
            <Select
              value={rascunho.semResponsavel ? "sem" : rascunho.responsavel != null ? String(rascunho.responsavel) : TODOS}
              onValueChange={(v) => mudarRascunho({ semResponsavel: v === "sem", responsavel: v !== TODOS && v !== "sem" ? Number(v) : null })}
            >
              <SelectTrigger className={CLASSE_SELECT}><SelectValue /></SelectTrigger>
              <SelectContent className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
                <SelectItem value={TODOS}>Todos</SelectItem>
                <SelectItem value="sem">Sem responsável</SelectItem>
                {dados?.facetas.responsaveis.map((r) => <SelectItem key={r.responsavelId} value={String(r.responsavelId)}>{r.nome} ({r.tarefas})</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Fase">
            <Select value={rascunho.fase ?? TODOS} onValueChange={(v) => mudarRascunho({ fase: v === TODOS ? null : v })}>
              <SelectTrigger className={CLASSE_SELECT}><SelectValue /></SelectTrigger>
              <SelectContent className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
                <SelectItem value={TODOS}>Todas</SelectItem>
                {dados?.facetas.fases.map((f) => <SelectItem key={f.faseMacroKey} value={f.faseMacroKey}>{rotularFase(f.faseMacroKey)} ({f.tarefas})</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Status da tarefa">
            <Select value={rascunho.statusTarefa[0] ?? TODOS} onValueChange={(v) => mudarRascunho({ statusTarefa: v === TODOS ? [] : [v] })}>
              <SelectTrigger className={CLASSE_SELECT}><SelectValue /></SelectTrigger>
              <SelectContent className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {Object.entries(ROTULO_STATUS).map(([k, r]) => <SelectItem key={k} value={k}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Status do processo">
            <Select value={rascunho.statusProcesso ?? TODOS} onValueChange={(v) => mudarRascunho({ statusProcesso: v === TODOS ? null : (v as Filtros["statusProcesso"]) })}>
              <SelectTrigger className={CLASSE_SELECT}><SelectValue /></SelectTrigger>
              <SelectContent className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
                <SelectItem value={TODOS}>Todos</SelectItem>
                <SelectItem value="ATIVO">Ativo</SelectItem>
                <SelectItem value="CONCLUIDO">Concluído</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
        </div>

        <div className="mt-3.5 grid grid-cols-2 items-end gap-3 border-t border-[var(--border-subtle)] pt-3.5 sm:grid-cols-3 lg:grid-cols-6">
          <Campo rotulo="Tipo de tarefa">
            <Select value={rascunho.tipoTarefa[0] ?? TODOS} onValueChange={(v) => mudarRascunho({ tipoTarefa: v === TODOS ? [] : [v] })}>
              <SelectTrigger className={CLASSE_SELECT}><SelectValue /></SelectTrigger>
              <SelectContent className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
                <SelectItem value={TODOS}>Todos</SelectItem>
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="TRANSVERSAL">Antecipada</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Família">
            <Select value={rascunho.familia != null ? String(rascunho.familia) : TODOS} onValueChange={(v) => mudarRascunho({ familia: v === TODOS ? null : Number(v) })}>
              <SelectTrigger className={CLASSE_SELECT}><SelectValue /></SelectTrigger>
              <SelectContent className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
                <SelectItem value={TODOS}>Todas</SelectItem>
                {opcoesFamilia.map(([id, nome]) => <SelectItem key={id} value={String(id)}>{nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Processo">
            <Select value={rascunho.processoId != null ? String(rascunho.processoId) : TODOS} onValueChange={(v) => mudarRascunho({ processoId: v === TODOS ? null : Number(v) })}>
              <SelectTrigger className={CLASSE_SELECT}><SelectValue /></SelectTrigger>
              <SelectContent className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`}>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {opcoesProcesso.map(([id, nome]) => <SelectItem key={id} value={String(id)}>{nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <div className="flex items-center gap-2">
            <Button
              variant={maisFiltros ? "secondary" : "outline"} size="sm"
              onClick={() => setMaisFiltros((v) => !v)}
            >
              <SlidersHorizontal size={13} /> Mais filtros
              {(rascunho.marcoFaseConcluida || rascunho.atrasadas || rascunho.venceHoje) && (
                <span className="grid h-4 w-4 place-items-center rounded-full bg-[var(--action-primary)] text-[9px] font-semibold text-[var(--action-primary-ink)]">
                  {[rascunho.marcoFaseConcluida, rascunho.atrasadas, rascunho.venceHoje].filter(Boolean).length}
                </span>
              )}
            </Button>
            {temFiltro(filtros) && <Button variant="link" size="sm" onClick={limpar} className="px-0 text-[var(--text-secondary)]">Limpar filtros</Button>}
          </div>
          <div className="col-span-2 flex items-center justify-end gap-3 sm:col-span-1 lg:col-span-3">
            <span className="text-[12px] tabular-nums text-[var(--text-muted)]">
              {modo === "visaoGeral" ? (dadosFamilias ? `${dadosFamilias.familias.length} famílias` : "")
                : dados ? `${linhas.length} de ${dados.total}` : ""}
            </span>
            <Button size="sm" onClick={aplicarRascunho} disabled={!rascunhoDivergeDoAplicado && !temFiltro(rascunho)}>Aplicar filtros</Button>
          </div>
        </div>

        {maisFiltros && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3.5">
            <Button
              variant={rascunho.marcoFaseConcluida ? "secondary" : "outline"} size="sm"
              onClick={() => mudarRascunho({ marcoFaseConcluida: !rascunho.marcoFaseConcluida })}
              title="Processos cuja fase (filtro 'Fase' = fase de origem) foi concluída no período"
            >
              Marco: fase concluída
            </Button>
            {([["atrasadas", "Atrasadas"], ["venceHoje", "Vence hoje"]] as const).map(([k, r]) => (
              <Button key={k} variant={rascunho[k] ? "secondary" : "outline"} size="sm" onClick={() => mudarRascunho({ [k]: !rascunho[k] } as Partial<Filtros>)}>
                {r}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* ── CHIPS DE FILTRO ATIVO ── */}
      {temFiltro(filtros) && (
        <div className="mx-6 mt-3 flex flex-wrap items-center gap-1.5">
          {filtros.busca && <Chip rotulo={`Buscar: ${filtros.busca}`} aoRemover={() => { setBuscaDigitada(""); aplicar({ busca: "" }) }} />}
          {(filtros.dataInicio || filtros.dataFim) && (
            <Chip
              rotulo={`${ROTULO_DATA_TIPO[filtros.dataTipo]}: ${filtros.dataInicio ?? "…"} – ${filtros.dataFim ?? "…"}`}
              aoRemover={() => aplicar({ dataInicio: null, dataFim: null })}
            />
          )}
          {filtros.semResponsavel && <Chip rotulo="Sem responsável" aoRemover={() => aplicar({ semResponsavel: false })} />}
          {filtros.responsavel != null && (
            <Chip
              rotulo={`Responsável: ${dados?.facetas.responsaveis.find((r) => r.responsavelId === filtros.responsavel)?.nome ?? filtros.responsavel}`}
              aoRemover={() => aplicar({ responsavel: null })}
            />
          )}
          {filtros.fase && <Chip rotulo={`Fase: ${rotularFase(filtros.fase)}`} aoRemover={() => aplicar({ fase: null })} />}
          {filtros.statusTarefa[0] && <Chip rotulo={`Status: ${ROTULO_STATUS[filtros.statusTarefa[0]]}`} aoRemover={() => aplicar({ statusTarefa: [] })} />}
          {filtros.statusProcesso && <Chip rotulo={`Processo: ${filtros.statusProcesso === "ATIVO" ? "Ativo" : "Concluído"}`} aoRemover={() => aplicar({ statusProcesso: null })} />}
          {filtros.tipoTarefa[0] && <Chip rotulo={`Tipo: ${filtros.tipoTarefa[0] === "TRANSVERSAL" ? "Antecipada" : "Normal"}`} aoRemover={() => aplicar({ tipoTarefa: [] })} />}
          {filtros.familia != null && <Chip rotulo={`Família: ${opcoesFamilia.find(([id]) => id === filtros.familia)?.[1] ?? filtros.familia}`} aoRemover={() => aplicar({ familia: null })} />}
          {filtros.processoId != null && <Chip rotulo={`Processo: ${opcoesProcesso.find(([id]) => id === filtros.processoId)?.[1] ?? filtros.processoId}`} aoRemover={() => aplicar({ processoId: null })} />}
          {filtros.marcoFaseConcluida && <Chip rotulo="Marco: fase concluída" aoRemover={() => aplicar({ marcoFaseConcluida: false })} />}
          {filtros.atrasadas && <Chip rotulo="Atrasadas" aoRemover={() => aplicar({ atrasadas: false })} />}
          {filtros.venceHoje && <Chip rotulo="Vence hoje" aoRemover={() => aplicar({ venceHoje: false })} />}
          <button
            onClick={() => { setNomeVisao(""); setSalvarAberto(true) }}
            className="ml-1 text-[12px] font-medium text-[var(--action-primary)] underline-offset-2 hover:underline"
          >
            Salvar filtro
          </button>
        </div>
      )}

      {(erroComando || aviso) && (
        <div className={`mx-6 mt-3 rounded-lg border px-3.5 py-2 text-[12.5px] ${erroComando ? "border-[var(--danger-tile)] bg-[var(--danger-tile)] text-[var(--danger-text)]" : "border-[var(--success-tile)] bg-[var(--success-tile)] text-[var(--success-text)]"}`}>
          {erroComando ?? aviso}
        </div>
      )}

      {modo !== "visaoGeral" && modo !== "calendario" && selecionados.size > 0 && (
        <div className="mx-6 mt-3 flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3.5 py-2">
          <span className="text-[12px] font-medium text-[var(--text-primary)]">{selecionados.size} selecionada{selecionados.size === 1 ? "" : "s"}</span>
          <Button size="sm" variant="outline" onClick={() => setAlvoLote({ linhas: linhas.filter((l) => selecionados.has(l.taskId)) })}>Atribuir para…</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelecionados(new Set())}>Limpar seleção</Button>
        </div>
      )}

      <div className="mx-6 mb-6 mt-4 min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--elev-1)]">
        <div className="h-full overflow-auto">
          {modo === "visaoGeral" && falhouFamilias && <Estado tipo="erro" mensagem="Não foi possível carregar a operação." aoTentar={recarregar} />}
          {modo === "visaoGeral" && carregandoFamilias && <Estado tipo="carregando" mensagem="Carregando a operação…" />}
          {modo === "visaoGeral" && dadosFamilias && dadosFamilias.familias.length === 0 && (
            <Estado tipo="vazio" mensagem={temFiltro(filtros) ? "Nenhum processo com esses filtros." : "Nenhuma tarefa na operação."} />
          )}
          {modo === "visaoGeral" && dadosFamilias && dadosFamilias.familias.length > 0 && (
            <VisaoGeralTabela
              familias={dadosFamilias.familias}
              pagina={paginaFamilias}
              aoMudarPagina={setPaginaFamilias}
              podeAtribuir={podeAtribuir}
              aoAbrirTarefa={irParaOProcesso}
            />
          )}
          {modo === "calendario" && (
            <Calendario linhas={linhas} carregando={carregando} falhou={falhou} aoAbrir={(id) => { const l = linhas.find((x) => x.taskId === id); if (l) irParaOProcesso(l.taskId, l.processoId) }} />
          )}
          {modo !== "visaoGeral" && modo !== "calendario" && falhou && <Estado tipo="erro" mensagem="Não foi possível carregar a operação." aoTentar={recarregar} />}
          {modo !== "visaoGeral" && modo !== "calendario" && carregando && <Estado tipo="carregando" mensagem="Carregando a operação…" />}
          {modo !== "visaoGeral" && modo !== "calendario" && dados && linhas.length === 0 && (
            <Estado tipo="vazio" mensagem={temFiltro(filtros) ? "Nenhuma tarefa com esses filtros." : "Nenhuma tarefa na operação."} />
          )}
          {dados && linhas.length > 0 && modo === "lista" && (
            <Lista
              linhas={ordenadas}
              ordem={ordem}
              aoOrdenar={(campo) => setOrdem((o) => ({ campo, asc: o.campo === campo ? !o.asc : true }))}
              aoAbrir={(id) => { const l = linhas.find((x) => x.taskId === id); if (l) irParaOProcesso(l.taskId, l.processoId) }}
              aoDistribuir={setAlvo}
              selecionados={selecionados}
              todosSelecionados={todosSelecionadosVisiveis}
              aoAlternarSelecao={alternarSelecao}
              aoAlternarTodos={alternarTodos}
            />
          )}
          {dados && linhas.length > 0 && modo === "kanban" && (
            <Quadro
              porColuna={porColuna}
              aoAbrir={(id) => { const l = linhas.find((x) => x.taskId === id); if (l) irParaOProcesso(l.taskId, l.processoId) }}
              aoDistribuir={setAlvo}
              aoComandar={comandar}
              ocupado={ocupado}
            />
          )}
        </div>
      </div>

      {alvoLote && (
        <SeletorResponsavel
          titulo={`Atribuir ${alvoLote.linhas.length} tarefa${alvoLote.linhas.length === 1 ? "" : "s"}`}
          atual={null} ocupado={ocupado} erro={erroComando}
          aoFechar={() => { setAlvoLote(null); setErroComando(null) }}
          aoEscolher={(id) => atribuirEmLote(alvoLote.linhas, id)}
        />
      )}

      {alvo && (
        <SeletorResponsavel
          titulo={alvo.responsavelId == null ? "Atribuir tarefa" : `Transferir de ${alvo.responsavelNome ?? "—"}`}
          atual={alvo.responsavelId} ocupado={ocupado} erro={erroComando}
          aoFechar={() => { setAlvo(null); setErroComando(null) }}
          aoEscolher={(id) =>
            comandar(alvo.taskId, { acao: alvo.responsavelId == null ? "atribuir" : "transferir", responsavelId: id },
              alvo.responsavelId == null ? "Tarefa atribuída." : "Tarefa transferida.")
          }
        />
      )}
    </div>
  )
}

function Chip({ rotulo, aoRemover }: { rotulo: string; aoRemover: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
      {rotulo}
      <button onClick={aoRemover} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Remover filtro ${rotulo}`}>
        <XIcon size={11} />
      </button>
    </span>
  )
}

const POR_PAGINA_FAMILIAS = 6

/**
 * A TABELA DA VISÃO GERAL — cada linha é uma FAMÍLIA. Expandir mostra o(s)
 * PROCESSO(S) da família; com um só processo (o caso comum), a expansão vai
 * direto para o painel completo (`ProcessoExpandido`) — sem clique extra.
 */
function VisaoGeralTabela({
  familias, pagina, aoMudarPagina, podeAtribuir, aoAbrirTarefa,
}: {
  familias: FamiliaAgrupada[]
  pagina: number
  aoMudarPagina: (p: number) => void
  podeAtribuir: boolean
  aoAbrirTarefa: (taskId: number, processoId: number | null) => void
}) {
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [processosAbertos, setProcessosAbertos] = useState<Set<number>>(new Set())
  const alternar = (chave: string) => setExpandidas((prev) => { const n = new Set(prev); n.has(chave) ? n.delete(chave) : n.add(chave); return n })
  const alternarProcesso = (id: number) => setProcessosAbertos((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const totalPaginas = Math.max(1, Math.ceil(familias.length / POR_PAGINA_FAMILIAS))
  const paginaValida = Math.min(Math.max(pagina, 1), totalPaginas)
  const visiveis = familias.slice((paginaValida - 1) * POR_PAGINA_FAMILIAS, paginaValida * POR_PAGINA_FAMILIAS)

  return (
    <div className="flex flex-col">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-[var(--surface-secondary)]">
          <tr className="border-b border-[var(--border-subtle)] [&>th]:px-4 [&>th]:py-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-[var(--text-secondary)]">
            <th>Família / Processo</th>
            <th className="w-36">Fase atual</th>
            <th className="w-16">Tarefas</th>
            <th className="w-16">A fazer</th>
            <th className="w-20">Concluídas</th>
            <th className="w-16">Atrasadas</th>
            <th className="w-28">Vencem em 7 dias</th>
            <th className="w-36">Responsável</th>
            <th className="w-40">Última atividade</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {visiveis.map((f) => {
            const chaveFamilia = f.familiaId != null ? `f:${f.familiaId}` : `p:${f.processos[0]?.processoId}`
            const aberta = expandidas.has(chaveFamilia)
            const umSoProcesso = f.processos.length === 1
            const marco = f.ultimoMarco
            return (
              <Fragment key={chaveFamilia}>
                <tr className={`border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-hover)] ${aberta ? "bg-[var(--surface-secondary)]" : ""}`}>
                  <td className="px-4 py-2.5">
                    <button onClick={() => alternar(chaveFamilia)} className="flex w-full items-center gap-2.5 text-left">
                      <ChevronDown size={13} className={`shrink-0 text-[var(--text-muted)] transition-transform ${aberta ? "" : "-rotate-90"}`} />
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent-text)]">
                        {iniciais(f.nomeFamilia)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{f.nomeFamilia}</span>
                        <span className="block truncate text-[11px] text-[var(--text-muted)]">
                          {umSoProcesso ? `Processo: ${f.processos[0].nomeProcesso}` : `${f.processos.length} processos`}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    {umSoProcesso ? <Etiqueta tom="acento">{rotularFase(f.processos[0].faseAtualKey) ?? "—"}</Etiqueta> : <span className="text-[12px] text-[var(--text-secondary)]">Vários processos</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[13px] font-medium tabular-nums text-[var(--text-primary)]">{f.total}</td>
                  <td className="px-4 py-2.5 text-[13px] tabular-nums text-[var(--text-secondary)]">{f.aFazer}</td>
                  <td className="px-4 py-2.5 text-[13px] font-medium tabular-nums text-[var(--success-text)]">{f.concluidas}</td>
                  <td className={`px-4 py-2.5 text-[13px] font-medium tabular-nums ${f.atrasadas > 0 ? "text-[var(--danger-text)]" : "text-[var(--text-muted)]"}`}>{f.atrasadas}</td>
                  <td className={`px-4 py-2.5 text-[13px] font-medium tabular-nums ${f.venceEm7Dias > 0 ? "text-[var(--warning-text)]" : "text-[var(--text-muted)]"}`}>{f.venceEm7Dias}</td>
                  <td className="px-4 py-2.5 text-[12px]">
                    {umSoProcesso && f.processos[0].aguardandoAtribuicao ? (
                      <Etiqueta tom="alerta">Aguardando atribuição</Etiqueta>
                    ) : (
                      <Responsavel nome={f.responsavelPrincipal?.nome ?? null} />
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-[var(--text-muted)]">
                    {marco ? (
                      <span className="block">
                        <span className="block text-[12px] font-medium text-[var(--text-primary)]">{marco.faseAnteriorLabel} concluída → {marco.faseNovaLabel ?? "—"}</span>
                        <span className="block tabular-nums">{marco.concluidasNaFaseAnterior}/{marco.totalNaFaseAnterior} · {dataCurta(f.ultimaAtividade)}</span>
                      </span>
                    ) : (
                      <span className="tabular-nums">{dataCurta(f.ultimaAtividade)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <MenuAcoesFamilia processoId={umSoProcesso ? f.processos[0].processoId : null} />
                  </td>
                </tr>
                {aberta && umSoProcesso && (
                  <tr>
                    <td colSpan={10} className="p-0">
                      <ProcessoExpandido processo={f.processos[0]} podeAtribuir={podeAtribuir} aoAbrirTarefa={aoAbrirTarefa} />
                    </td>
                  </tr>
                )}
                {aberta && !umSoProcesso && f.processos.map((p) => {
                  const abertoP = processosAbertos.has(p.processoId)
                  return (
                    <Fragment key={p.processoId}>
                      <tr className="cursor-pointer border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)]" onClick={() => alternarProcesso(p.processoId)}>
                        <td className="px-4 py-2 pl-11 text-[12px] font-medium text-[var(--text-secondary)]" colSpan={2}>
                          <ChevronDown size={12} className={`mr-1.5 inline-block text-[var(--text-muted)] transition-transform ${abertoP ? "" : "-rotate-90"}`} />
                          {p.nomeProcesso}
                        </td>
                        <td className="px-4 py-2 text-[12px] tabular-nums text-[var(--text-primary)]">{p.total}</td>
                        <td className="px-4 py-2 text-[12px] tabular-nums text-[var(--text-secondary)]">{p.aFazer}</td>
                        <td className="px-4 py-2 text-[12px] tabular-nums text-[var(--success-text)]">{p.concluidas}</td>
                        <td className={`px-4 py-2 text-[12px] tabular-nums ${p.atrasadas > 0 ? "text-[var(--danger-text)]" : "text-[var(--text-muted)]"}`}>{p.atrasadas}</td>
                        <td className={`px-4 py-2 text-[12px] tabular-nums ${p.venceEm7Dias > 0 ? "text-[var(--warning-text)]" : "text-[var(--text-muted)]"}`}>{p.venceEm7Dias}</td>
                        <td className="px-4 py-2 text-[12px]" colSpan={2}>
                          {p.aguardandoAtribuicao ? <Etiqueta tom="alerta">Aguardando atribuição</Etiqueta> : <Etiqueta tom="acento">{rotularFase(p.faseAtualKey) ?? "—"}</Etiqueta>}
                        </td>
                        <td />
                      </tr>
                      {abertoP && (
                        <tr>
                          <td colSpan={10} className="p-0">
                            <ProcessoExpandido processo={p} podeAtribuir={podeAtribuir} aoAbrirTarefa={aoAbrirTarefa} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {familias.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
          <span className="text-[12px] text-[var(--text-muted)]">Mostrando {visiveis.length} de {familias.length} famílias</span>
          {totalPaginas > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon-sm" disabled={paginaValida <= 1} onClick={() => aoMudarPagina(paginaValida - 1)}>‹</Button>
              <span className="text-[12px] tabular-nums text-[var(--text-primary)]">{paginaValida} / {totalPaginas}</span>
              <Button variant="outline" size="icon-sm" disabled={paginaValida >= totalPaginas} onClick={() => aoMudarPagina(paginaValida + 1)}>›</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** As DUAS ações reais desta linha — nunca um menu com item que não faz nada. */
function MenuAcoesFamilia({ processoId }: { processoId: number | null }) {
  if (processoId == null) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button onClick={(e) => e.stopPropagation()} className="rounded p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]">
          <MoreVertical size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={`bg-[var(--surface-overlay)] ${Z_POPOVER}`} onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem asChild><a href={`/processos/${processoId}`}>Abrir processo</a></DropdownMenuItem>
        <DropdownMenuItem asChild><a href={`/kanban?processoId=${processoId}&tab=central`}>Abrir na Central Operacional</a></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const COLUNAS_LISTA: Array<{ campo: keyof LinhaGerencial; rotulo: string; classe: string }> = [
  { campo: "titulo", rotulo: "Tarefa", classe: "w-[28%] min-w-[260px]" },
  { campo: "pessoaNome", rotulo: "Pessoa", classe: "w-40" },
  { campo: "processoNome", rotulo: "Processo", classe: "w-40" },
  { campo: "faseMacroKey", rotulo: "Fase", classe: "w-32" },
  { campo: "etapaAtual", rotulo: "Etapa atual", classe: "w-40" },
  { campo: "responsavelNome", rotulo: "Responsável", classe: "w-36" },
  { campo: "statusTarefa", rotulo: "Status", classe: "w-32" },
  { campo: "prioridade", rotulo: "Prioridade", classe: "w-24" },
  { campo: "dataPrazo", rotulo: "Prazo", classe: "w-28" },
  { campo: "diasParaPrazo", rotulo: "Atraso", classe: "w-24" },
  { campo: "criadaEm", rotulo: "Entrada", classe: "w-24" },
]

/** Quanto tempo, em linguagem de gente — "3 dias", não "-3". */
function tempo(dias: number | null, atrasada: boolean): string {
  if (dias == null) return "—"
  if (atrasada) { const d = Math.abs(dias); return `${d} dia${d === 1 ? "" : "s"} atrás` }
  if (dias === 0) return "hoje"
  return `em ${dias} dia${dias === 1 ? "" : "s"}`
}

function Lista({
  linhas, ordem, aoOrdenar, aoAbrir, aoDistribuir,
  selecionados, todosSelecionados, aoAlternarSelecao, aoAlternarTodos,
}: {
  linhas: LinhaGerencial[]
  ordem: { campo: keyof LinhaGerencial; asc: boolean }
  aoOrdenar: (c: keyof LinhaGerencial) => void
  aoAbrir: (id: number) => void
  aoDistribuir: (l: LinhaGerencial) => void
  selecionados: Set<number>
  todosSelecionados: boolean
  aoAlternarSelecao: (id: number) => void
  aoAlternarTodos: () => void
}) {
  return (
    <table className="w-full border-collapse text-left">
      <thead className="sticky top-0 z-10 bg-[var(--surface-secondary)]">
        <tr className="border-b border-[var(--border-subtle)]">
          <th className="w-8 px-4 py-2.5">
            <input type="checkbox" checked={todosSelecionados} onChange={aoAlternarTodos} aria-label="Selecionar todas as tarefas visíveis" className="cursor-pointer accent-[var(--action-primary)]" />
          </th>
          {COLUNAS_LISTA.map((c) => (
            <th key={String(c.campo)} className={`${c.classe} px-4 py-2.5`}>
              <button onClick={() => aoOrdenar(c.campo)} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
                {c.rotulo}
                {ordem.campo === c.campo ? <span className="text-[var(--action-primary)]">{ordem.asc ? "↑" : "↓"}</span> : <ArrowUpDown size={10} className="opacity-40" />}
              </button>
            </th>
          ))}
          <th className="w-24 px-4 py-2.5" />
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.taskId} className="group border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-hover)]">
            <td className="px-4 py-2.5 align-top">
              <input type="checkbox" checked={selecionados.has(l.taskId)} onChange={() => aoAlternarSelecao(l.taskId)} aria-label={`Selecionar ${l.titulo}`} className="cursor-pointer accent-[var(--action-primary)]" />
            </td>
            <td className="max-w-0 px-4 py-2.5 align-top">
              <button onClick={() => aoAbrir(l.taskId)} className="w-full cursor-pointer text-left">
                <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">{l.titulo}</span>
                <span className="mt-1 flex flex-wrap gap-1"><Sinais l={l} /></span>
              </button>
            </td>
            <td className="truncate px-4 py-2.5 text-[12px] text-[var(--text-secondary)]">{l.pessoaNome ?? "—"}</td>
            <td className="truncate px-4 py-2.5 text-[12px] text-[var(--text-secondary)]">{l.processoNome ?? "—"}</td>
            <td className="truncate px-4 py-2.5 text-[12px] text-[var(--text-secondary)]">{rotularFase(l.faseMacroKey) ?? "—"}</td>
            <td className="truncate px-4 py-2.5 text-[12px] text-[var(--text-secondary)]">{l.etapaAtual ?? "—"}</td>
            <td className="px-4 py-2.5"><Responsavel nome={l.responsavelNome} /></td>
            <td className="px-4 py-2.5 text-[12px] text-[var(--text-secondary)]">{ROTULO_STATUS[l.statusTarefa] ?? l.statusTarefa}</td>
            <td className="px-4 py-2.5 text-[12px] text-[var(--text-secondary)]">{ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade}</td>
            <td className={`px-4 py-2.5 text-[12px] tabular-nums ${l.atrasada ? "font-medium text-[var(--danger-text)]" : "text-[var(--text-secondary)]"}`}>{dataCurta(l.dataPrazo)}</td>
            <td className={`px-4 py-2.5 text-[12px] ${l.atrasada ? "text-[var(--danger-text)]" : "text-[var(--text-muted)]"}`}>{tempo(l.diasParaPrazo, l.atrasada)}</td>
            <td className="px-4 py-2.5 text-[12px] tabular-nums text-[var(--text-muted)]">{dataCurta(l.criadaEm)}</td>
            <td className="px-4 py-2.5 text-right">
              <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="sm" variant="outline" onClick={() => aoDistribuir(l)}>{l.responsavelId == null ? "Atribuir" : "Transferir"}</Button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * OS ÚNICOS ARRASTOS PERMITIDOS — os que têm um comando canônico equivalente.
 */
const ARRASTOS: Record<string, { acao: string; rotulo: string; pedeMotivo?: boolean }> = {
  "A_FAZER→EM_ANDAMENTO": { acao: "iniciar", rotulo: "Iniciar tarefa" },
  "EM_ANDAMENTO→AGUARDANDO_TERCEIRO": { acao: "aguardar_terceiro", rotulo: "Marcar espera por terceiro", pedeMotivo: true },
  "AGUARDANDO_TERCEIRO→EM_ANDAMENTO": { acao: "retomar_espera", rotulo: "Retomar o trabalho" },
  "EM_ANDAMENTO→BLOQUEADA": { acao: "bloquear", rotulo: "Bloquear", pedeMotivo: true },
  "A_FAZER→BLOQUEADA": { acao: "bloquear", rotulo: "Bloquear", pedeMotivo: true },
  "AGUARDANDO_TERCEIRO→BLOQUEADA": { acao: "bloquear", rotulo: "Bloquear", pedeMotivo: true },
  "BLOQUEADA→EM_ANDAMENTO": { acao: "desbloquear", rotulo: "Desbloquear" },
  "A_FAZER→SEM_RESPONSAVEL": { acao: "devolver_a_fila", rotulo: "Devolver à fila" },
  "EM_ANDAMENTO→SEM_RESPONSAVEL": { acao: "devolver_a_fila", rotulo: "Devolver à fila" },
  "AGUARDANDO_TERCEIRO→SEM_RESPONSAVEL": { acao: "devolver_a_fila", rotulo: "Devolver à fila" },
  "BLOQUEADA→SEM_RESPONSAVEL": { acao: "devolver_a_fila", rotulo: "Devolver à fila" },
}
const arrastoDe = (de: ColunaKanban, para: ColunaKanban) => ARRASTOS[`${de}→${para}`] ?? null

function Quadro({
  porColuna, aoAbrir, aoDistribuir, aoComandar, ocupado,
}: {
  porColuna: Map<ColunaKanban, LinhaGerencial[]>
  aoAbrir: (id: number) => void
  aoDistribuir: (l: LinhaGerencial) => void
  aoComandar: (id: number, corpo: Record<string, unknown>, ok: string) => Promise<boolean>
  ocupado: boolean
}) {
  const [arrastando, setArrastando] = useState<LinhaGerencial | null>(null)
  const [sobre, setSobre] = useState<ColunaKanban | null>(null)
  const [pedindo, setPedindo] = useState<null | { l: LinhaGerencial; acao: string; rotulo: string }>(null)
  const [motivo, setMotivo] = useState("")

  const soltar = async (coluna: ColunaKanban) => {
    const l = arrastando
    setArrastando(null); setSobre(null)
    if (!l || l.coluna === coluna) return
    const t = arrastoDe(l.coluna, coluna)
    if (!t) return
    if (t.pedeMotivo) { setMotivo(""); setPedindo({ l, acao: t.acao, rotulo: t.rotulo }); return }
    await aoComandar(l.taskId, { acao: t.acao }, `${t.rotulo}: feito.`)
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {COLUNAS.map((c) => {
        const linhas = porColuna.get(c.chave) ?? []
        const permitido = arrastando ? arrastoDe(arrastando.coluna, c.chave) : null
        const alvoValido = arrastando != null && arrastando.coluna !== c.chave && permitido != null
        const alvoInvalido = arrastando != null && arrastando.coluna !== c.chave && permitido == null
        return (
          <div
            key={c.chave}
            onDragOver={(e) => { if (alvoValido) { e.preventDefault(); setSobre(c.chave) } }}
            onDragLeave={() => setSobre((s) => (s === c.chave ? null : s))}
            onDrop={() => soltar(c.chave)}
            className={`flex h-full w-72 shrink-0 flex-col rounded-xl border transition-colors ${
              sobre === c.chave && alvoValido ? "border-[var(--action-primary)] bg-[var(--surface-secondary)]"
              : alvoInvalido ? "border-[var(--border-subtle)] bg-[var(--surface-secondary)]/60 opacity-40"
              : "border-[var(--border-default)] bg-[var(--surface-secondary)]"
            }`}
          >
            <div className="flex items-baseline justify-between border-b border-[var(--border-subtle)] px-3.5 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{c.rotulo}</span>
              <span className="rounded-full bg-[var(--surface-tertiary)] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">{linhas.length}</span>
            </div>
            {alvoValido && <div className="border-b border-[var(--border-default)] bg-[var(--accent-soft)] px-3.5 py-1.5 text-[11px] font-medium text-[var(--accent-text)]">{permitido.rotulo}</div>}
            <div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto p-2.5">
              {linhas.length === 0 && <p className="px-1 py-3 text-[12px] text-[var(--text-muted)]">{c.nota ?? "Nada aqui."}</p>}
              {linhas.map((l) => (
                <Card key={l.taskId} l={l} aoAbrir={() => aoAbrir(l.taskId)} aoDistribuir={() => aoDistribuir(l)} aoArrastar={(inicio) => setArrastando(inicio ? l : null)} />
              ))}
            </div>
          </div>
        )
      })}

      {pedindo && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={() => setPedindo(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4 shadow-[var(--elev-3)]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">{pedindo.rotulo}</h2>
            <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{pedindo.l.titulo}</p>
            <textarea
              value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
              placeholder="Por quê? Quem ler depois precisa entender sem perguntar."
              className="mt-3 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--action-primary)] focus:outline-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPedindo(null)}>Cancelar</Button>
              <Button
                size="sm"
                disabled={ocupado || motivo.trim().length < 3}
                onClick={async () => { const ok = await aoComandar(pedindo.l.taskId, { acao: pedindo.acao, motivo: motivo.trim() }, `${pedindo.rotulo}: feito.`); if (ok) setPedindo(null) }}
              >
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ l, aoAbrir, aoDistribuir, aoArrastar }: { l: LinhaGerencial; aoAbrir: () => void; aoDistribuir: () => void; aoArrastar: (inicio: boolean) => void }) {
  const contexto = [l.pessoaNome, l.processoNome].filter(Boolean).join(" · ")
  return (
    <div
      draggable
      onDragStart={() => aoArrastar(true)}
      onDragEnd={() => aoArrastar(false)}
      className={`cursor-grab rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3 shadow-[var(--elev-1)] transition-shadow hover:shadow-[var(--elev-2)] active:cursor-grabbing ${
        l.atrasada ? "border-l-[3px] border-l-[var(--danger)]" : l.venceHoje ? "border-l-[3px] border-l-[var(--warning)]" : ""
      }`}
    >
      <button onClick={aoAbrir} className="w-full cursor-pointer text-left">
        <p className="text-[13px] font-medium leading-4 text-[var(--text-primary)]">{l.titulo}</p>
        {contexto && <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">{contexto}</p>}
        <div className="mt-1.5 flex flex-wrap gap-1"><Sinais l={l} /></div>
        <div className="mt-1.5 space-y-0.5 text-[11px] text-[var(--text-muted)]">
          {rotularFase(l.faseMacroKey) && <p>{rotularFase(l.faseMacroKey)}</p>}
          {l.etapaAtual && <p className="truncate"><span className="text-[var(--text-muted)]">Etapa:</span> {l.etapaAtual}</p>}
          {l.esperandoHaDias != null && (
            <p className={l.esperandoHaDias >= 15 ? "font-medium text-[var(--warning-text)]" : ""}>
              Aguardando {l.esperandoDe === "cliente" ? "o cliente" : "terceiro"} há {l.esperandoHaDias} dia{l.esperandoHaDias === 1 ? "" : "s"}
            </p>
          )}
          {l.motivoBloqueio && <p className="text-[var(--danger-text)]">Bloqueio: {l.motivoBloqueio}</p>}
          {l.concluidaEm && <p>Concluída em {dataCurta(l.concluidaEm)}</p>}
        </div>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
        <Responsavel nome={l.responsavelNome} />
        <div className="flex shrink-0 items-center gap-2">
          {l.dataPrazo && <span className={`text-[11px] tabular-nums ${l.atrasada ? "font-medium text-[var(--danger-text)]" : "text-[var(--text-secondary)]"}`}>{dataCurta(l.dataPrazo)}</span>}
          <Button size="sm" variant="outline" onClick={aoDistribuir} className="h-6 px-2 text-[11px]">
            {l.responsavelId == null ? "Atribuir" : "Transferir"}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * CALENDÁRIO — a MESMA `visaoGerencial`, agrupada por dia de vencimento. Sem
 * tarefa concluída/cancelada (não têm o que vencer), sem prazo fica de fora
 * (não tem onde cair no mês).
 */
function Calendario({ linhas, carregando, falhou, aoAbrir }: { linhas: LinhaGerencial[]; carregando: boolean; falhou: boolean; aoAbrir: (id: number) => void }) {
  const [mesRef, setMesRef] = useState(() => { const d = new Date(); d.setDate(1); return d })
  if (falhou) return <Estado tipo="erro" mensagem="Não foi possível carregar a operação." />
  if (carregando) return <Estado tipo="carregando" mensagem="Carregando a operação…" />

  const ano = mesRef.getFullYear(), mes = mesRef.getMonth()
  const hoje = new Date()
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay()
  const diasNoMes = new Date(ano, mes + 1, 0).getDate()
  const porDia = new Map<number, LinhaGerencial[]>()
  for (const l of linhas) {
    if (!l.dataPrazo || l.coluna === "CONCLUIDA") continue
    const d = new Date(l.dataPrazo)
    if (d.getFullYear() === ano && d.getMonth() === mes) {
      const arr = porDia.get(d.getDate()) ?? []
      arr.push(l)
      porDia.set(d.getDate(), arr)
    }
  }
  const celulas: Array<number | null> = [...Array(primeiroDiaSemana).fill(null), ...Array.from({ length: diasNoMes }, (_, i) => i + 1)]
  const ehHoje = (d: number) => ano === hoje.getFullYear() && mes === hoje.getMonth() && d === hoje.getDate()

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-4 flex items-center justify-between">
        <Button variant="outline" size="icon-sm" onClick={() => setMesRef(new Date(ano, mes - 1, 1))}>‹</Button>
        <span className="text-[14px] font-semibold capitalize text-[var(--text-primary)]">{mesRef.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
        <Button variant="outline" size="icon-sm" onClick={() => setMesRef(new Date(ano, mes + 1, 1))}>›</Button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-1.5 grid flex-1 grid-cols-7 gap-1.5 overflow-y-auto">
        {celulas.map((dia, i) => (
          <div key={i} className={`min-h-[88px] rounded-lg border p-1.5 ${dia == null ? "border-transparent" : ehHoje(dia) ? "border-[var(--action-primary)] bg-[var(--accent-soft)]" : "border-[var(--border-subtle)] bg-[var(--surface-secondary)]"}`}>
            {dia != null && (
              <>
                <div className={`text-[11px] font-medium ${ehHoje(dia) ? "text-[var(--action-primary)]" : "text-[var(--text-muted)]"}`}>{dia}</div>
                <div className="mt-1 space-y-1">
                  {(porDia.get(dia) ?? []).slice(0, 3).map((l) => (
                    <button
                      key={l.taskId} onClick={() => aoAbrir(l.taskId)}
                      className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium ${l.atrasada ? "bg-[var(--danger-tile)] text-[var(--danger-text)]" : "bg-[var(--surface-tertiary)] text-[var(--text-primary)]"}`}
                    >
                      {l.titulo}
                    </button>
                  ))}
                  {(porDia.get(dia)?.length ?? 0) > 3 && (
                    <div className="text-[10px] text-[var(--text-muted)]">+{(porDia.get(dia)?.length ?? 0) - 3}</div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
