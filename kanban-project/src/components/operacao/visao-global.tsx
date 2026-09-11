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

/** Iniciais para o avatar — quem é o responsável se lê antes de ler o nome. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase()
}

function Responsavel({ nome }: { nome: string | null }) {
  if (!nome) return <span className="text-[11px] text-[var(--text-muted)]">Sem responsável</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--surface-primary)] text-[9px] font-medium text-white/70">
        {iniciais(nome)}
      </span>
      <span className="truncate text-[11px] text-white/70">{nome}</span>
    </span>
  )
}

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

/** Os seis números do topo — CANÔNICOS e IDÊNTICOS nas quatro abas (spec §4: nunca um número independente da listagem). */
const TILES: Array<{ chave: keyof RespostaFamilias["indicadores"]; rotulo: string; tom: string; filtro?: Partial<Filtros> }> = [
  { chave: "tarefasAbertas", rotulo: "Tarefas abertas", tom: "text-white/80" },
  { chave: "atrasadas", rotulo: "Atrasadas", tom: "text-red-700/90", filtro: { atrasadas: true } },
  { chave: "venceEm7Dias", rotulo: "Vencem em 7 dias", tom: "text-amber-800/90" },
  { chave: "concluidasHoje", rotulo: "Concluídas (hoje)", tom: "text-green-800/90", filtro: { dataTipo: "concluida", dataInicio: new Date().toISOString().slice(0, 10), dataFim: new Date().toISOString().slice(0, 10) } },
  { chave: "familias", rotulo: "Famílias", tom: "text-white/80" },
  { chave: "processos", rotulo: "Processos", tom: "text-white/80" },
]

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
  const limpar = () => { setBuscaDigitada(""); setFiltros(SEM_FILTRO) }

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
    <div className="flex h-full flex-col">
      {/* ── CABEÇALHO DA CENTRAL ── */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <div>
          <h1 className="text-[16px] font-medium text-white/95">Tarefas e Projetos</h1>
          <p className="text-[11px] text-[var(--text-muted)]">Acompanhe todas as tarefas, processos e atividades da sua equipe.</p>
        </div>
        <div className="flex items-center gap-1 rounded border border-[var(--border-default)] p-0.5">
          {([
            ["visaoGeral", "Visão Geral"], ["lista", "Lista"], ["kanban", "Kanban"], ["calendario", "Calendário"],
          ] as const).map(([m, r]) => (
            <button
              key={m}
              onClick={() => setModo(m)}
              className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                modo === m ? "bg-[var(--surface-primary)] text-white/90" : "text-[var(--text-secondary)] hover:text-white/75"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* ── INDICADORES ── canônicos e clicáveis: cada número é um atalho de filtro. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        {TILES.map((t) => (
          <button
            key={t.chave}
            type="button"
            disabled={!t.filtro}
            onClick={() => t.filtro && aplicar(t.filtro)}
            className={`rounded border px-2.5 py-1.5 text-left transition-colors ${
              t.filtro ? "cursor-pointer border-[var(--border-default)] hover:bg-[var(--surface-primary)]" : "cursor-default border-[var(--border-default)]"
            }`}
          >
            <div className={`text-[15px] font-medium tabular-nums leading-5 ${t.tom}`}>
              {dadosFamilias ? dadosFamilias.indicadores[t.chave] : "—"}
            </div>
            <div className="text-[10px] leading-4 text-[var(--text-muted)]">{t.rotulo}</div>
          </button>
        ))}
      </div>

      {/* ── FILTROS ── uma barra só, para as quatro abas (spec §5). */}
      <div className="flex flex-wrap items-end gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Pesquisar</span>
          <input
            value={buscaDigitada}
            onChange={(e) => setBuscaDigitada(e.target.value)}
            placeholder="Processo, família, tarefa…"
            className="w-56 rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-1.5 text-[12px] text-white/85 placeholder:text-[var(--text-muted)] focus:border-white/25 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Período</span>
          <div className="flex items-center gap-1">
            <select
              value={filtros.dataTipo}
              onChange={(e) => aplicar({ dataTipo: e.target.value as DataTipo })}
              className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-1.5 py-1.5 text-[11px] text-white/80 focus:outline-none"
            >
              {(Object.keys(ROTULO_DATA_TIPO) as DataTipo[]).map((k) => <option key={k} value={k}>{ROTULO_DATA_TIPO[k]}</option>)}
            </select>
            <input
              type="date" value={filtros.dataInicio ?? ""} onChange={(e) => aplicar({ dataInicio: e.target.value || null })}
              className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-1.5 py-1.5 text-[11px] text-white/80 focus:outline-none"
            />
            <span className="text-[10px] text-[var(--text-muted)]">–</span>
            <input
              type="date" value={filtros.dataFim ?? ""} onChange={(e) => aplicar({ dataFim: e.target.value || null })}
              className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-1.5 py-1.5 text-[11px] text-white/80 focus:outline-none"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Responsável</span>
          <select
            value={filtros.semResponsavel ? "sem" : filtros.responsavel ?? ""}
            onChange={(e) => { const v = e.target.value; aplicar({ semResponsavel: v === "sem", responsavel: v && v !== "sem" ? Number(v) : null }) }}
            className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
          >
            <option value="">Todos</option>
            <option value="sem">Sem responsável</option>
            {dados?.facetas.responsaveis.map((r) => <option key={r.responsavelId} value={r.responsavelId}>{r.nome} ({r.tarefas})</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Fase</span>
          <select
            value={filtros.fase ?? ""} onChange={(e) => aplicar({ fase: e.target.value || null })}
            className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
          >
            <option value="">Todas</option>
            {dados?.facetas.fases.map((f) => <option key={f.faseMacroKey} value={f.faseMacroKey}>{rotularFase(f.faseMacroKey)} ({f.tarefas})</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Status da tarefa</span>
          <select
            value={filtros.statusTarefa[0] ?? ""}
            onChange={(e) => aplicar({ statusTarefa: e.target.value ? [e.target.value] : [] })}
            className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
          >
            <option value="">Todos</option>
            {Object.entries(ROTULO_STATUS).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--text-muted)]">Status do processo</span>
          <select
            value={filtros.statusProcesso ?? ""}
            onChange={(e) => aplicar({ statusProcesso: (e.target.value || null) as Filtros["statusProcesso"] })}
            className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
          >
            <option value="">Todos</option>
            <option value="ATIVO">Ativo</option>
            <option value="CONCLUIDO">Concluído</option>
          </select>
        </label>
        <button
          onClick={() => setMaisFiltros((v) => !v)}
          className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] transition-colors ${
            maisFiltros ? "border-[var(--border-strong)] bg-[var(--surface-primary)] text-white/90" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:text-white/80"
          }`}
        >
          Mais filtros
          {(filtros.tipoTarefa.length > 0 || filtros.familia != null || filtros.processoId != null || filtros.marcoFaseConcluida) && (
            <span className="grid h-4 w-4 place-items-center rounded-full bg-[var(--action-primary)] text-[9px] text-white">
              {[filtros.tipoTarefa.length > 0, filtros.familia != null, filtros.processoId != null, filtros.marcoFaseConcluida].filter(Boolean).length}
            </span>
          )}
        </button>
        {temFiltro(filtros) && (
          <button onClick={limpar} className="text-[11px] text-[var(--text-secondary)] underline-offset-2 hover:text-white/80 hover:underline">
            Limpar filtros
          </button>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-[var(--text-muted)]">
          {modo === "visaoGeral" ? (dadosFamilias ? `${dadosFamilias.familias.length} famílias` : "")
            : dados ? `${linhas.length} de ${dados.total}` : ""}
        </span>
      </div>

      {maisFiltros && (
        <div className="flex flex-wrap items-end gap-2 border-b border-white/[0.06] bg-[var(--surface-primary)]/40 px-4 py-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--text-muted)]">Tipo de tarefa</span>
            <select
              value={filtros.tipoTarefa[0] ?? ""}
              onChange={(e) => aplicar({ tipoTarefa: e.target.value ? [e.target.value] : [] })}
              className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
            >
              <option value="">Todos</option>
              <option value="NORMAL">Normal</option>
              <option value="TRANSVERSAL">Antecipada</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--text-muted)]">Família</span>
            <select
              value={filtros.familia ?? ""} onChange={(e) => aplicar({ familia: e.target.value ? Number(e.target.value) : null })}
              className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
            >
              <option value="">Todas</option>
              {opcoesFamilia.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--text-muted)]">Processo</span>
            <select
              value={filtros.processoId ?? ""} onChange={(e) => aplicar({ processoId: e.target.value ? Number(e.target.value) : null })}
              className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
            >
              <option value="">Todos</option>
              {opcoesProcesso.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            </select>
          </label>
          <button
            onClick={() => aplicar({ marcoFaseConcluida: !filtros.marcoFaseConcluida })}
            className={`rounded border px-2.5 py-1.5 text-[11px] transition-colors ${
              filtros.marcoFaseConcluida ? "border-[var(--border-strong)] bg-[var(--surface-primary)] text-white/85" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:text-white/80"
            }`}
            title="Processos cuja fase (filtro 'Fase' = fase de origem) foi concluída no período"
          >
            Marco: fase concluída
          </button>
          {([["atrasadas", "Atrasadas"], ["venceHoje", "Vence hoje"]] as const).map(([k, r]) => (
            <button
              key={k}
              onClick={() => aplicar({ [k]: !filtros[k] } as Partial<Filtros>)}
              className={`rounded border px-2.5 py-1.5 text-[11px] transition-colors ${
                filtros[k] ? "border-[var(--border-strong)] bg-[var(--surface-primary)] text-white/85" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:text-white/80"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {/* ── CHIPS DE FILTRO ATIVO ── */}
      {temFiltro(filtros) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-4 py-2">
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
        </div>
      )}

      {(erroComando || aviso) && (
        <div className={`border-b px-4 py-2 text-[11px] ${erroComando ? "border-[var(--border-default)] bg-[var(--surface-secondary)] text-red-700/90" : "border-[var(--border-default)] bg-[var(--surface-secondary)] text-green-800/90"}`}>
          {erroComando ?? aviso}
        </div>
      )}

      {modo !== "visaoGeral" && modo !== "calendario" && selecionados.size > 0 && (
        <div className="flex items-center gap-3 border-b border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-2">
          <span className="text-[11px] text-white/85">{selecionados.size} selecionada{selecionados.size === 1 ? "" : "s"}</span>
          <button
            onClick={() => setAlvoLote({ linhas: linhas.filter((l) => selecionados.has(l.taskId)) })}
            className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-1 text-[11px] text-white/85 transition-colors hover:bg-[var(--surface-primary)]"
          >
            Atribuir para…
          </button>
          <button onClick={() => setSelecionados(new Set())} className="text-[11px] text-[var(--text-secondary)] hover:text-white/80">
            Limpar seleção
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
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
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-0.5 text-[10px] text-white/80">
      {rotulo}
      <button onClick={aoRemover} className="text-[var(--text-muted)] hover:text-white/90" aria-label={`Remover filtro ${rotulo}`}>×</button>
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
        <thead className="sticky top-0 z-10 bg-[var(--surface-overlay)]">
          <tr className="border-b border-white/[0.08] [&>th]:px-3 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-[var(--text-muted)]">
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
                <tr className="border-b border-white/[0.05] hover:bg-[var(--surface-primary)]">
                  <td className="px-3 py-2">
                    <button onClick={() => alternar(chaveFamilia)} className="flex w-full items-center gap-2 text-left">
                      <span className="w-3 shrink-0 text-[10px] text-[var(--text-muted)]">{aberta ? "▾" : "▸"}</span>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--surface-secondary)] text-[10px] font-medium text-white/80">
                        {iniciais(f.nomeFamilia)}
                      </span>
                      <span>
                        <span className="block text-[12px] font-medium text-white/90">{f.nomeFamilia}</span>
                        <span className="block text-[10px] text-[var(--text-muted)]">
                          {umSoProcesso ? `Processo: ${f.processos[0].nomeProcesso}` : `${f.processos.length} processos`}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                    {umSoProcesso ? (rotularFase(f.processos[0].faseAtualKey) ?? "—") : "Vários processos"}
                  </td>
                  <td className="px-3 py-2 text-[12px] tabular-nums text-white/85">{f.total}</td>
                  <td className="px-3 py-2 text-[12px] tabular-nums text-white/70">{f.aFazer}</td>
                  <td className="px-3 py-2 text-[12px] tabular-nums text-green-800/90">{f.concluidas}</td>
                  <td className={`px-3 py-2 text-[12px] tabular-nums ${f.atrasadas > 0 ? "text-red-700/90" : "text-[var(--text-muted)]"}`}>{f.atrasadas}</td>
                  <td className={`px-3 py-2 text-[12px] tabular-nums ${f.venceEm7Dias > 0 ? "text-amber-800/90" : "text-[var(--text-muted)]"}`}>{f.venceEm7Dias}</td>
                  <td className="px-3 py-2 text-[11px]">
                    {umSoProcesso && f.processos[0].aguardandoAtribuicao ? (
                      <Etiqueta tom="alerta">Aguardando atribuição</Etiqueta>
                    ) : (
                      <Responsavel nome={f.responsavelPrincipal?.nome ?? null} />
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-[var(--text-muted)]">
                    {marco ? (
                      <span className="block">
                        <span className="block text-[11px] text-white/85">{marco.faseAnteriorLabel} concluída → {marco.faseNovaLabel ?? "—"}</span>
                        <span className="block text-[10px] tabular-nums">{marco.concluidasNaFaseAnterior}/{marco.totalNaFaseAnterior} · {dataCurta(f.ultimaAtividade)}</span>
                      </span>
                    ) : (
                      <span className="tabular-nums">{dataCurta(f.ultimaAtividade)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
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
                      <tr className="cursor-pointer border-b border-white/[0.05] bg-[var(--surface-primary)]/40 hover:bg-[var(--surface-primary)]" onClick={() => alternarProcesso(p.processoId)}>
                        <td className="px-3 py-1.5 pl-9 text-[11px] text-[var(--text-secondary)]" colSpan={2}>
                          <span className="mr-1.5 text-[10px] text-[var(--text-muted)]">{abertoP ? "▾" : "▸"}</span>
                          {p.nomeProcesso}
                        </td>
                        <td className="px-3 py-1.5 text-[12px] tabular-nums text-white/80">{p.total}</td>
                        <td className="px-3 py-1.5 text-[12px] tabular-nums text-white/70">{p.aFazer}</td>
                        <td className="px-3 py-1.5 text-[12px] tabular-nums text-green-800/90">{p.concluidas}</td>
                        <td className={`px-3 py-1.5 text-[12px] tabular-nums ${p.atrasadas > 0 ? "text-red-700/90" : "text-[var(--text-muted)]"}`}>{p.atrasadas}</td>
                        <td className={`px-3 py-1.5 text-[12px] tabular-nums ${p.venceEm7Dias > 0 ? "text-amber-800/90" : "text-[var(--text-muted)]"}`}>{p.venceEm7Dias}</td>
                        <td className="px-3 py-1.5 text-[11px]" colSpan={2}>
                          {p.aguardandoAtribuicao ? <Etiqueta tom="alerta">Aguardando atribuição</Etiqueta> : rotularFase(p.faseAtualKey)}
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
        <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <span className="text-[11px] text-[var(--text-muted)]">Mostrando {visiveis.length} de {familias.length} famílias</span>
          {totalPaginas > 1 && (
            <div className="flex items-center gap-2">
              <button disabled={paginaValida <= 1} onClick={() => aoMudarPagina(paginaValida - 1)} className="rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)] disabled:opacity-40">‹</button>
              <span className="text-[11px] tabular-nums text-white/80">{paginaValida} / {totalPaginas}</span>
              <button disabled={paginaValida >= totalPaginas} onClick={() => aoMudarPagina(paginaValida + 1)} className="rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)] disabled:opacity-40">›</button>
              <label className="ml-2 flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                Itens por página
                <select className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-1.5 py-1 text-[11px] text-white/80" disabled value={POR_PAGINA_FAMILIAS}>
                  <option value={POR_PAGINA_FAMILIAS}>{POR_PAGINA_FAMILIAS}</option>
                </select>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** As DUAS ações reais desta linha — nunca um menu com item que não faz nada. */
function MenuAcoesFamilia({ processoId }: { processoId: number | null }) {
  const [aberto, setAberto] = useState(false)
  if (processoId == null) return null
  return (
    <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setAberto((v) => !v)} className="rounded px-1.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-white/90">⋮</button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 z-20 mt-1 w-44 rounded border border-[var(--border-default)] bg-[var(--surface-overlay)] py-1 shadow-[var(--elev-3)]">
            <a href={`/processos/${processoId}`} className="block px-3 py-1.5 text-[11px] text-white/85 hover:bg-[var(--surface-primary)]">Abrir processo</a>
          </div>
        </>
      )}
    </div>
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
      <thead className="sticky top-0 z-10 bg-[var(--surface-overlay)]">
        <tr className="border-b border-white/[0.08]">
          <th className="w-8 px-3 py-2">
            <input type="checkbox" checked={todosSelecionados} onChange={aoAlternarTodos} aria-label="Selecionar todas as tarefas visíveis" className="cursor-pointer" />
          </th>
          {COLUNAS_LISTA.map((c) => (
            <th key={String(c.campo)} className={`${c.classe} px-3 py-2`}>
              <button onClick={() => aoOrdenar(c.campo)} className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)] transition-colors hover:text-white/70">
                {c.rotulo}
                {ordem.campo === c.campo && <span className="ml-1 text-[var(--text-secondary)]">{ordem.asc ? "↑" : "↓"}</span>}
              </button>
            </th>
          ))}
          <th className="w-24 px-3 py-2" />
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.taskId} className="group border-b border-white/[0.05] hover:bg-[var(--surface-primary)]">
            <td className="px-3 py-2 align-top">
              <input type="checkbox" checked={selecionados.has(l.taskId)} onChange={() => aoAlternarSelecao(l.taskId)} aria-label={`Selecionar ${l.titulo}`} className="cursor-pointer" />
            </td>
            <td className="max-w-0 px-3 py-2 align-top">
              <button onClick={() => aoAbrir(l.taskId)} className="w-full cursor-pointer text-left">
                <span className="block truncate text-[12px] text-white/90">{l.titulo}</span>
                <span className="mt-1 flex flex-wrap gap-1"><Sinais l={l} /></span>
              </button>
            </td>
            <td className="truncate px-3 py-2 text-[11px] text-[var(--text-secondary)]">{l.pessoaNome ?? "—"}</td>
            <td className="truncate px-3 py-2 text-[11px] text-[var(--text-secondary)]">{l.processoNome ?? "—"}</td>
            <td className="truncate px-3 py-2 text-[11px] text-[var(--text-secondary)]">{rotularFase(l.faseMacroKey) ?? "—"}</td>
            <td className="truncate px-3 py-2 text-[11px] text-[var(--text-secondary)]">{l.etapaAtual ?? "—"}</td>
            <td className="px-3 py-2"><Responsavel nome={l.responsavelNome} /></td>
            <td className="px-3 py-2 text-[11px] text-[var(--text-secondary)]">{ROTULO_STATUS[l.statusTarefa] ?? l.statusTarefa}</td>
            <td className="px-3 py-2 text-[11px] text-[var(--text-secondary)]">{ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade}</td>
            <td className={`px-3 py-2 text-[11px] tabular-nums ${l.atrasada ? "text-red-700/90" : "text-[var(--text-secondary)]"}`}>{dataCurta(l.dataPrazo)}</td>
            <td className={`px-3 py-2 text-[11px] ${l.atrasada ? "text-red-700/80" : "text-[var(--text-muted)]"}`}>{tempo(l.diasParaPrazo, l.atrasada)}</td>
            <td className="px-3 py-2 text-[11px] tabular-nums text-[var(--text-muted)]">{dataCurta(l.criadaEm)}</td>
            <td className="px-3 py-2 text-right">
              <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button onClick={() => aoDistribuir(l)} className="rounded border border-[var(--border-default)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-primary)] hover:text-white/90">
                  {l.responsavelId == null ? "Atribuir" : "Transferir"}
                </button>
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
            className={`flex h-full w-72 shrink-0 flex-col rounded-lg border transition-colors ${
              sobre === c.chave && alvoValido ? "border-[var(--border-default)] bg-[var(--surface-secondary)]"
              : alvoInvalido ? "border-white/[0.04] bg-[var(--surface-primary)] opacity-40"
              : "border-white/[0.08] bg-[var(--surface-primary)]"
            }`}
          >
            <div className="flex items-baseline justify-between border-b border-white/[0.06] px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">{c.rotulo}</span>
              <span className="text-[11px] tabular-nums text-[var(--text-muted)]">{linhas.length}</span>
            </div>
            {alvoValido && <div className="border-b border-[var(--border-default)] px-3 py-1.5 text-[10px] text-[var(--text-secondary)]/80">{permitido.rotulo}</div>}
            <div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto p-2">
              {linhas.length === 0 && <p className="px-1 py-3 text-[11px] text-[var(--text-muted)]">{c.nota ?? "Nada aqui."}</p>}
              {linhas.map((l) => (
                <Card key={l.taskId} l={l} aoAbrir={() => aoAbrir(l.taskId)} aoDistribuir={() => aoDistribuir(l)} aoArrastar={(inicio) => setArrastando(inicio ? l : null)} />
              ))}
            </div>
          </div>
        )
      })}

      {pedindo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={() => setPedindo(null)}>
          <div className="w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[13px] font-medium text-white/90">{pedindo.rotulo}</h2>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{pedindo.l.titulo}</p>
            <textarea
              value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
              placeholder="Por quê? Quem ler depois precisa entender sem perguntar."
              className="mt-3 w-full rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-2 text-[12px] text-white/85 placeholder:text-[var(--text-muted)] focus:border-white/25 focus:outline-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setPedindo(null)} className="rounded px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:text-white/80">Cancelar</button>
              <button
                disabled={ocupado || motivo.trim().length < 3}
                onClick={async () => { const ok = await aoComandar(pedindo.l.taskId, { acao: pedindo.acao, motivo: motivo.trim() }, `${pedindo.rotulo}: feito.`); if (ok) setPedindo(null) }}
                className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-[11px] text-white/85 disabled:opacity-40"
              >
                Confirmar
              </button>
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
      className={`cursor-grab rounded border border-white/[0.08] bg-[var(--surface-primary)] p-2.5 transition-colors hover:border-[var(--border-strong)] active:cursor-grabbing ${
        l.atrasada ? "border-l-2 border-l-red-400/60" : l.venceHoje ? "border-l-2 border-l-amber-300/60" : ""
      }`}
    >
      <button onClick={aoAbrir} className="w-full cursor-pointer text-left">
        <p className="text-[12px] font-medium leading-4 text-white/90">{l.titulo}</p>
        {contexto && <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">{contexto}</p>}
        <div className="mt-1.5 flex flex-wrap gap-1"><Sinais l={l} /></div>
        <div className="mt-1.5 space-y-0.5 text-[10px] text-[var(--text-muted)]">
          {rotularFase(l.faseMacroKey) && <p>{rotularFase(l.faseMacroKey)}</p>}
          {l.etapaAtual && <p className="truncate"><span className="text-[var(--text-muted)]">Etapa:</span> {l.etapaAtual}</p>}
          {l.esperandoHaDias != null && (
            <p className={l.esperandoHaDias >= 15 ? "text-amber-800/70" : ""}>
              Aguardando {l.esperandoDe === "cliente" ? "o cliente" : "terceiro"} há {l.esperandoHaDias} dia{l.esperandoHaDias === 1 ? "" : "s"}
            </p>
          )}
          {l.motivoBloqueio && <p className="text-red-700/70">Bloqueio: {l.motivoBloqueio}</p>}
          {l.concluidaEm && <p>Concluída em {dataCurta(l.concluidaEm)}</p>}
        </div>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
        <Responsavel nome={l.responsavelNome} />
        <div className="flex shrink-0 items-center gap-2">
          {l.dataPrazo && <span className={`text-[10px] tabular-nums ${l.atrasada ? "text-red-700/90" : "text-[var(--text-secondary)]"}`}>{dataCurta(l.dataPrazo)}</span>}
          <button onClick={aoDistribuir} className="rounded border border-[var(--border-default)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-primary)] hover:text-white/90">
            {l.responsavelId == null ? "Atribuir" : "Transferir"}
          </button>
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

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => setMesRef(new Date(ano, mes - 1, 1))} className="rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">‹</button>
        <span className="text-[12px] font-medium text-white/90">{mesRef.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
        <button onClick={() => setMesRef(new Date(ano, mes + 1, 1))} className="rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-[var(--text-muted)]">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-1 grid flex-1 grid-cols-7 gap-1 overflow-y-auto">
        {celulas.map((dia, i) => (
          <div key={i} className={`min-h-[84px] rounded border p-1 ${dia == null ? "border-transparent" : "border-white/[0.06]"}`}>
            {dia != null && (
              <>
                <div className="text-[10px] text-[var(--text-muted)]">{dia}</div>
                <div className="mt-0.5 space-y-0.5">
                  {(porDia.get(dia) ?? []).slice(0, 3).map((l) => (
                    <button
                      key={l.taskId} onClick={() => aoAbrir(l.taskId)}
                      className={`block w-full truncate rounded px-1 py-0.5 text-left text-[9px] ${l.atrasada ? "bg-red-950/40 text-red-300" : "bg-[var(--surface-secondary)] text-white/75"}`}
                    >
                      {l.titulo}
                    </button>
                  ))}
                  {(porDia.get(dia)?.length ?? 0) > 3 && (
                    <div className="text-[9px] text-[var(--text-muted)]">+{(porDia.get(dia)?.length ?? 0) - 3}</div>
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
