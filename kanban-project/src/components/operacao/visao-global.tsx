// src/components/operacao/visao-global.tsx
// ============================================================================
// TAREFAS E PROJETOS — a operação inteira, para quem responde por ela.
//
//   LISTA    varrer, ordenar, achar
//   KANBAN   ver onde o trabalho está parado
//
// As duas são a MESMA consulta (`GET /api/operacao/visao-global`) e o MESMO
// `taskId` que aparece na Minha Fila e na Central. Trocar de modo não busca
// nada diferente, não cria estado e não escreve: reagrupa o que já está aqui.
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
// Toda mudança sai por `POST /api/tarefas/{id}/comando`.
// ============================================================================
"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"
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

interface Indicadores {
  total: number
  semResponsavel: number
  emAndamento: number
  aguardandoTerceiro: number
  bloqueadas: number
  atrasadas: number
  venceHoje: number
  concluidas: number
}
interface Facetas {
  fases: Array<{ faseMacroKey: string; tarefas: number }>
  responsaveis: Array<{ responsavelId: number; nome: string; tarefas: number; atrasadas: number }>
}
interface Resposta {
  linhas: LinhaGerencial[]
  total: number
  indicadores: Indicadores
  facetas: Facetas
}

interface Contagens {
  total: number
  aFazer: number
  concluidas: number
  atrasadas: number
  venceEm7Dias: number
}
interface FaseAgrupada extends Contagens {
  faseMacroKey: string
  label: string
  ordem: number
}
interface ProcessoAgrupado extends Contagens {
  processoId: number
  nomeProcesso: string
  faseAtualKey: string | null
  fases: FaseAgrupada[]
}
interface FamiliaAgrupada extends Contagens {
  familiaId: number | null
  nomeFamilia: string
  processos: ProcessoAgrupado[]
  responsavelPrincipal: { id: number; nome: string } | null
  ultimaAtividade: string | null
}
interface RespostaFamilias {
  familias: FamiliaAgrupada[]
  total: number
  indicadores: { tarefas: number; aFazer: number; atrasadas: number; venceEm7Dias: number; familias: number; processos: number }
}

interface Filtros {
  responsavel: number | null
  semResponsavel: boolean
  fase: string | null
  prioridade: string | null
  atrasadas: boolean
  venceHoje: boolean
  busca: string
  /** Preenchido só pelo drill-down família → fase. Não tem controle próprio na barra de filtros. */
  processoId: number | null
}
const SEM_FILTRO: Filtros = {
  responsavel: null, semResponsavel: false, fase: null,
  prioridade: null, atrasadas: false, venceHoje: false, busca: "", processoId: null,
}
const temFiltro = (f: Filtros) =>
  f.responsavel != null || f.semResponsavel || f.fase != null || f.prioridade != null ||
  f.atrasadas || f.venceHoje || f.busca.trim() !== "" || f.processoId != null

function queryDe(f: Filtros, coluna: ColunaKanban | null): string {
  const p = new URLSearchParams()
  if (f.responsavel != null) p.set("responsavel", String(f.responsavel))
  if (f.semResponsavel) p.set("semResponsavel", "1")
  if (f.fase) p.set("fase", f.fase)
  if (f.prioridade) p.set("prioridade", f.prioridade)
  if (f.atrasadas) p.set("atrasadas", "1")
  if (f.venceHoje) p.set("venceHoje", "1")
  if (f.busca.trim()) p.set("busca", f.busca.trim())
  if (f.processoId != null) p.set("processo", String(f.processoId))
  if (coluna) p.set("coluna", coluna)
  return p.toString()
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

const INDICADORES: Array<{ chave: keyof Indicadores; rotulo: string; filtro: Partial<Filtros>; tom: string }> = [
  { chave: "semResponsavel", rotulo: "Sem responsável", filtro: { semResponsavel: true }, tom: "text-[var(--text-secondary)]/90" },
  { chave: "emAndamento", rotulo: "Em andamento", filtro: {}, tom: "text-white/80" },
  { chave: "aguardandoTerceiro", rotulo: "Aguardando terceiro", filtro: {}, tom: "text-white/80" },
  { chave: "bloqueadas", rotulo: "Bloqueadas", filtro: {}, tom: "text-white/80" },
  { chave: "atrasadas", rotulo: "Atrasadas", filtro: { atrasadas: true }, tom: "text-red-700/90" },
  { chave: "venceHoje", rotulo: "Vence hoje", filtro: { venceHoje: true }, tom: "text-amber-800/90" },
]

/** Os tiles da Agrupada não filtram — resumem o universo inteiro, sem recorte. */
const AGRUPADA_TILES: Array<{ chave: keyof RespostaFamilias["indicadores"]; rotulo: string; tom: string }> = [
  { chave: "tarefas", rotulo: "Tarefas abertas", tom: "text-white/80" },
  { chave: "atrasadas", rotulo: "Atrasadas", tom: "text-red-700/90" },
  { chave: "venceEm7Dias", rotulo: "Vencem em 7 dias", tom: "text-amber-800/90" },
  { chave: "familias", rotulo: "Famílias", tom: "text-white/80" },
  { chave: "processos", rotulo: "Processos", tom: "text-white/80" },
]

export function VisaoGlobal() {
  const [modo, setModo] = useState<"agrupada" | "lista" | "kanban">("agrupada")
  /** Contexto do drill-down família → fase — só existe quando se chega pela Agrupada. */
  const [drillDown, setDrillDown] = useState<{ nomeFamilia: string; faseLabel: string } | null>(null)
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO)
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
  /**
   * A MESMA NAVEGAÇÃO DA MINHA FILA — uma tarefa, um destino.
   *
   * Supervisionar e executar são coisas diferentes: aqui o clique na linha abre
   * o painel de leitura, e "Abrir no processo" leva ao lugar onde o trabalho
   * acontece. As duas telas usam a mesma função para montar a URL.
   */
  const irParaOProcesso = useCallback((l: LinhaGerencial) => {
    router.push(urlOperacionalDaTarefa({ taskId: l.taskId, processoId: l.processoId }))
  }, [router])

  // A busca não pode disparar um pedido por tecla digitada.
  const [buscaDigitada, setBuscaDigitada] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => ({ ...f, busca: buscaDigitada })), 350)
    return () => clearTimeout(t)
  }, [buscaDigitada])

  const query = queryDe(filtros, null)
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

  // A AGRUPADA É UMA CONSULTA À PARTE — resume a mesma operação por família,
  // sem os filtros da Lista/Kanban (que não fazem sentido num resumo). Só
  // busca quando a aba está aberta, e de novo a cada recarga.
  const [resultadoFamilias, setResultadoFamilias] = useState<{ chave: string; d: RespostaFamilias | null } | null>(null)
  const [paginaFamilias, setPaginaFamilias] = useState(1)
  useEffect(() => {
    if (modo !== "agrupada") return
    let vivo = true
    const chaveFamilias = `${recarga}`
    fetch(`/api/operacao/visao-global/familias`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RespostaFamilias) => { if (vivo) setResultadoFamilias({ chave: chaveFamilias, d }) })
      .catch(() => { if (vivo) setResultadoFamilias({ chave: chaveFamilias, d: null }) })
    return () => { vivo = false }
  }, [modo, recarga])
  const carregandoFamilias = resultadoFamilias?.chave !== `${recarga}`
  const dadosFamilias = carregandoFamilias ? null : resultadoFamilias?.d ?? null
  const falhouFamilias = !carregandoFamilias && dadosFamilias == null

  /** Do resumo por família direto para a Lista, já filtrada — o mesmo `taskId` do sempre. */
  const abrirFaseDaFamilia = useCallback((nomeFamilia: string, faseLabel: string, processoId: number, faseMacroKey: string) => {
    setDrillDown({ nomeFamilia, faseLabel })
    setFiltros({ ...SEM_FILTRO, processoId, fase: faseMacroKey })
    setModo("lista")
  }, [])

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

  // Referência ESTÁVEL: `dados?.linhas ?? []` cria um array novo a cada render,
  // e os dois `useMemo` abaixo recalculariam sempre — inclusive a ordenação de
  // uma lista de centenas de linhas, a cada tecla digitada na busca.

  /**
   * ATRIBUIÇÃO EM LOTE — a MESMA porta de sempre, chamada uma vez por tarefa.
   *
   * Nada de endpoint novo: cada linha do lote passa pelo `/api/tarefas/{id}/
   * comando` de sempre, com `acao` decidida pelo estado ATUAL daquela linha
   * (quem já tem dono é "transferir", quem não tem é "atribuir"). Uma falha
   * isolada não trava as demais; o resumo no final é honesto sobre as duas
   * contagens, e só há uma confirmação — a da lista, no fim.
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

  return (
    <div className="flex h-full flex-col">
      {/* ── RESUMO ── na Agrupada é o universo inteiro; na Lista/Kanban, cada número é um filtro */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        {modo === "agrupada" ? (
          AGRUPADA_TILES.map((t) => (
            <div key={t.chave} className="rounded border border-[var(--border-default)] px-2.5 py-1.5">
              <div className={`text-[15px] font-medium tabular-nums leading-5 ${t.tom}`}>
                {dadosFamilias ? dadosFamilias.indicadores[t.chave] : "—"}
              </div>
              <div className="text-[10px] leading-4 text-[var(--text-muted)]">{t.rotulo}</div>
            </div>
          ))
        ) : (
          INDICADORES.map((ind) => {
            const ativo =
              (ind.filtro.semResponsavel && filtros.semResponsavel) ||
              (ind.filtro.atrasadas && filtros.atrasadas) ||
              (ind.filtro.venceHoje && filtros.venceHoje)
            const clicavel = Object.keys(ind.filtro).length > 0
            return (
              <button
                key={ind.chave}
                type="button"
                disabled={!clicavel}
                onClick={() => clicavel && aplicar(
                  ativo ? { semResponsavel: false, atrasadas: false, venceHoje: false } : { ...SEM_FILTRO, ...ind.filtro, busca: filtros.busca },
                )}
                className={`rounded border px-2.5 py-1.5 text-left transition-colors ${
                  ativo ? "border-[var(--border-strong)] bg-[var(--surface-primary)]" : "border-[var(--border-default)] hover:bg-[var(--surface-primary)]"
                } ${clicavel ? "cursor-pointer" : "cursor-default"}`}
              >
                <div className={`text-[15px] font-medium tabular-nums leading-5 ${ind.tom}`}>
                  {dados ? dados.indicadores[ind.chave] : "—"}
                </div>
                <div className="text-[10px] leading-4 text-[var(--text-muted)]">{ind.rotulo}</div>
              </button>
            )
          })
        )}
        <div className="ml-auto flex items-center gap-1 rounded border border-[var(--border-default)] p-0.5">
          {(["agrupada", "lista", "kanban"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setModo(m); setDrillDown(null); aplicar({ processoId: null }) }}
              className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                modo === m ? "bg-[var(--surface-primary)] text-white/90" : "text-[var(--text-secondary)] hover:text-white/75"
              }`}
            >
              {m === "agrupada" ? "Agrupada" : m === "lista" ? "Lista" : "Kanban"}
            </button>
          ))}
        </div>
      </div>

      {drillDown && modo === "lista" && (
        <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-2 text-[11px]">
          <button
            onClick={() => { setDrillDown(null); setModo("agrupada"); aplicar({ processoId: null }) }}
            className="text-[var(--text-secondary)] hover:text-white/80"
          >
            ← Agrupada
          </button>
          <span className="text-[var(--text-muted)]">/</span>
          <span className="text-white/80">{drillDown.nomeFamilia}</span>
          <span className="text-[var(--text-muted)]">/</span>
          <span className="text-white/80">{drillDown.faseLabel}</span>
        </div>
      )}

      {/* ── FILTROS ── combináveis, e o que existe vem do que existe. Não existem na Agrupada: são filtro de TAREFA, e ali a unidade é a família. */}
      {modo !== "agrupada" && (
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <input
          value={buscaDigitada}
          onChange={(e) => setBuscaDigitada(e.target.value)}
          placeholder="Buscar tarefa, pessoa ou processo…"
          className="w-64 rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-1.5 text-[12px] text-white/85 placeholder:text-[var(--text-muted)] focus:border-white/25 focus:outline-none"
        />
        <select
          value={filtros.semResponsavel ? "sem" : filtros.responsavel ?? ""}
          onChange={(e) => {
            const v = e.target.value
            aplicar({ semResponsavel: v === "sem", responsavel: v && v !== "sem" ? Number(v) : null })
          }}
          className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
        >
          <option value="">Todos os responsáveis</option>
          <option value="sem">Sem responsável</option>
          {dados?.facetas.responsaveis.map((r) => (
            <option key={r.responsavelId} value={r.responsavelId}>
              {r.nome} ({r.tarefas})
            </option>
          ))}
        </select>
        <select
          value={filtros.fase ?? ""}
          onChange={(e) => aplicar({ fase: e.target.value || null })}
          className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
        >
          <option value="">Todas as fases</option>
          {dados?.facetas.fases.map((f) => (
            <option key={f.faseMacroKey} value={f.faseMacroKey}>
              {rotularFase(f.faseMacroKey)} ({f.tarefas})
            </option>
          ))}
        </select>
        <select
          value={filtros.prioridade ?? ""}
          onChange={(e) => aplicar({ prioridade: e.target.value || null })}
          className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-[12px] text-white/80 focus:outline-none"
        >
          <option value="">Toda prioridade</option>
          {["URGENTE", "ALTA", "MEDIA", "BAIXA"].map((p) => (
            <option key={p} value={p}>{ROTULO_PRIORIDADE[p]}</option>
          ))}
        </select>
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
        {temFiltro(filtros) && (
          <button onClick={limpar} className="text-[11px] text-[var(--text-secondary)] underline-offset-2 hover:text-white/80 hover:underline">
            Limpar filtros
          </button>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-[var(--text-muted)]">
          {dados ? `${linhas.length} de ${dados.total}` : ""}
        </span>
      </div>
      )}

      {/* ── CARGA DO FUNCIONÁRIO SELECIONADO ── informação, não ranking */}
      {filtros.responsavel != null && dados && (
        <CargaDoResponsavel
          nome={dados.facetas.responsaveis.find((r) => r.responsavelId === filtros.responsavel)?.nome ?? "—"}
          linhas={linhas}
        />
      )}

      {(erroComando || aviso) && (
        <div
          className={`border-b px-4 py-2 text-[11px] ${
            erroComando ? "border-[var(--border-default)] bg-[var(--surface-secondary)] text-red-700/90" : "border-[var(--border-default)] bg-[var(--surface-secondary)] text-green-800/90"
          }`}
        >
          {erroComando ?? aviso}
        </div>
      )}

      {/* SELEÇÃO EM MASSA — a mesma porta de uma linha só, chamada em lote. */}
      {selecionados.size > 0 && (
        <div className="flex items-center gap-3 border-b border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-2">
          <span className="text-[11px] text-white/85">
            {selecionados.size} selecionada{selecionados.size === 1 ? "" : "s"}
          </span>
          <button
            onClick={() => setAlvoLote({ linhas: linhas.filter((l) => selecionados.has(l.taskId)) })}
            className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-1 text-[11px] text-white/85 transition-colors hover:bg-[var(--surface-primary)]"
          >
            Atribuir para…
          </button>
          <button
            onClick={() => setSelecionados(new Set())}
            className="text-[11px] text-[var(--text-secondary)] hover:text-white/80"
          >
            Limpar seleção
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {modo === "agrupada" && falhouFamilias && <Estado tipo="erro" mensagem="Não foi possível carregar a operação." aoTentar={recarregar} />}
        {modo === "agrupada" && carregandoFamilias && <Estado tipo="carregando" mensagem="Carregando a operação…" />}
        {modo === "agrupada" && dadosFamilias && dadosFamilias.familias.length === 0 && (
          <Estado tipo="vazio" mensagem="Nenhuma tarefa na operação." />
        )}
        {modo === "agrupada" && dadosFamilias && dadosFamilias.familias.length > 0 && (
          <Agrupada
            familias={dadosFamilias.familias}
            pagina={paginaFamilias}
            aoMudarPagina={setPaginaFamilias}
            aoAbrirFase={abrirFaseDaFamilia}
          />
        )}
        {modo !== "agrupada" && falhou && <Estado tipo="erro" mensagem="Não foi possível carregar a operação." aoTentar={recarregar} />}
        {modo !== "agrupada" && carregando && <Estado tipo="carregando" mensagem="Carregando a operação…" />}
        {modo !== "agrupada" && dados && linhas.length === 0 && (
          <Estado
            tipo="vazio"
            mensagem={temFiltro(filtros) ? "Nenhuma tarefa com esses filtros." : "Nenhuma tarefa na operação."}
          />
        )}
        {dados && linhas.length > 0 && modo === "lista" && (
          <Lista
            linhas={ordenadas}
            ordem={ordem}
            aoOrdenar={(campo) => setOrdem((o) => ({ campo, asc: o.campo === campo ? !o.asc : true }))}
            aoAbrir={(id) => { const l = linhas.find((x) => x.taskId === id); if (l) irParaOProcesso(l) }}
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
            aoAbrir={(id) => { const l = linhas.find((x) => x.taskId === id); if (l) irParaOProcesso(l) }}
            aoDistribuir={setAlvo}
            aoComandar={comandar}
            ocupado={ocupado}
          />
        )}
      </div>

      {alvoLote && (
        <SeletorResponsavel
          titulo={`Atribuir ${alvoLote.linhas.length} tarefa${alvoLote.linhas.length === 1 ? "" : "s"}`}
          atual={null}
          ocupado={ocupado}
          erro={erroComando}
          aoFechar={() => { setAlvoLote(null); setErroComando(null) }}
          aoEscolher={(id) => atribuirEmLote(alvoLote.linhas, id)}
        />
      )}

      {alvo && (
        <SeletorResponsavel
          titulo={alvo.responsavelId == null ? "Atribuir tarefa" : `Transferir de ${alvo.responsavelNome ?? "—"}`}
          atual={alvo.responsavelId}
          ocupado={ocupado}
          erro={erroComando}
          aoFechar={() => { setAlvo(null); setErroComando(null) }}
          aoEscolher={(id) =>
            comandar(
              alvo.taskId,
              { acao: alvo.responsavelId == null ? "atribuir" : "transferir", responsavelId: id },
              alvo.responsavelId == null ? "Tarefa atribuída." : "Tarefa transferida.",
            )
          }
        />
      )}
    </div>
  )
}

/**
 * A CARGA DE QUEM FOI SELECIONADO — derivada das tarefas já em tela.
 *
 * Não é produtividade nem ranking: é o que a pessoa tem na mão agora, para o
 * gestor decidir se pode mandar mais. Contar aqui, e não no servidor, mantém o
 * número coerente com o que está sendo mostrado.
 */
function CargaDoResponsavel({ nome, linhas }: { nome: string; linhas: LinhaGerencial[] }) {
  const ativas = linhas.filter((l) => l.coluna !== "CONCLUIDA")
  const n = [
    ["ativas", ativas.length],
    ["atrasadas", ativas.filter((l) => l.atrasada).length],
    ["aguardando terceiro", ativas.filter((l) => l.coluna === "AGUARDANDO_TERCEIRO").length],
    ["bloqueadas", ativas.filter((l) => l.coluna === "BLOQUEADA").length],
  ] as const
  return (
    <div className="flex items-center gap-4 border-b border-white/[0.06] bg-[var(--surface-primary)] px-4 py-2">
      <span className="text-[11px] text-[var(--text-secondary)]">{nome}</span>
      {n.map(([r, v]) => (
        <span key={r} className="text-[11px] text-[var(--text-muted)]">
          <span className="tabular-nums text-white/70">{v}</span> {r}
        </span>
      ))}
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

const POR_PAGINA_FAMILIAS = 6

/**
 * A AGRUPADA — cada linha é uma FAMÍLIA, não uma tarefa.
 *
 * Existe para responder "como está a família Medina Olivares" sem rolar uma
 * lista de centenas de linhas. Expandir mostra as FASES do(s) processo(s) da
 * família; clicar numa fase vai para a MESMA Lista de sempre, já filtrada por
 * processo e fase — não existe uma segunda tabela de tarefas por trás disto.
 */
function Agrupada({
  familias, pagina, aoMudarPagina, aoAbrirFase,
}: {
  familias: FamiliaAgrupada[]
  pagina: number
  aoMudarPagina: (p: number) => void
  aoAbrirFase: (nomeFamilia: string, faseLabel: string, processoId: number, faseMacroKey: string) => void
}) {
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const alternar = (chave: string) => setExpandidas((prev) => {
    const novo = new Set(prev)
    if (novo.has(chave)) novo.delete(chave); else novo.add(chave)
    return novo
  })

  const totalPaginas = Math.max(1, Math.ceil(familias.length / POR_PAGINA_FAMILIAS))
  const paginaValida = Math.min(Math.max(pagina, 1), totalPaginas)
  const visiveis = familias.slice((paginaValida - 1) * POR_PAGINA_FAMILIAS, paginaValida * POR_PAGINA_FAMILIAS)

  return (
    <div className="flex flex-col">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-[var(--surface-overlay)]">
          <tr className="border-b border-white/[0.08] [&>th]:px-3 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-[var(--text-muted)]">
            <th>Família / Processo / Fase</th>
            <th className="w-20">Tarefas</th>
            <th className="w-20">A fazer</th>
            <th className="w-24">Concluídas</th>
            <th className="w-20">Atrasadas</th>
            <th className="w-28">Vencem em 7 dias</th>
            <th className="w-40">Fase atual</th>
            <th className="w-36">Responsável</th>
            <th className="w-28">Última atividade</th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((f) => {
            const chaveFamilia = f.familiaId != null ? `f:${f.familiaId}` : `p:${f.processos[0]?.processoId}`
            const aberta = expandidas.has(chaveFamilia)
            const umSoProcesso = f.processos.length === 1
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
                  <td className="px-3 py-2 text-[12px] tabular-nums text-white/85">{f.total}</td>
                  <td className="px-3 py-2 text-[12px] tabular-nums text-white/70">{f.aFazer}</td>
                  <td className="px-3 py-2 text-[12px] tabular-nums text-green-800/90">{f.concluidas}</td>
                  <td className={`px-3 py-2 text-[12px] tabular-nums ${f.atrasadas > 0 ? "text-red-700/90" : "text-[var(--text-muted)]"}`}>{f.atrasadas}</td>
                  <td className={`px-3 py-2 text-[12px] tabular-nums ${f.venceEm7Dias > 0 ? "text-amber-800/90" : "text-[var(--text-muted)]"}`}>{f.venceEm7Dias}</td>
                  <td className="px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                    {umSoProcesso ? (rotularFase(f.processos[0].faseAtualKey) ?? "—") : "Vários processos"}
                  </td>
                  <td className="px-3 py-2 text-[11px]"><Responsavel nome={f.responsavelPrincipal?.nome ?? null} /></td>
                  <td className="px-3 py-2 text-[11px] tabular-nums text-[var(--text-muted)]">{dataCurta(f.ultimaAtividade)}</td>
                </tr>
                {aberta && f.processos.map((p) => (
                  <Fragment key={p.processoId}>
                    {!umSoProcesso && (
                      <tr className="border-b border-white/[0.05] bg-[var(--surface-primary)]/40">
                        <td colSpan={9} className="px-3 py-1.5 pl-9 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                          Processo: {p.nomeProcesso}
                        </td>
                      </tr>
                    )}
                    {p.fases.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-2 pl-12 text-[11px] text-[var(--text-muted)]">Nenhuma tarefa neste processo.</td>
                      </tr>
                    )}
                    {p.fases.map((fa) => (
                      <tr
                        key={fa.faseMacroKey}
                        className="cursor-pointer border-b border-white/[0.05] hover:bg-[var(--surface-primary)]"
                        onClick={() => aoAbrirFase(f.nomeFamilia, fa.label, p.processoId, fa.faseMacroKey)}
                      >
                        <td className="px-3 py-2 pl-12 text-[11px] text-[var(--text-secondary)]">{fa.label}</td>
                        <td className="px-3 py-2 text-[12px] tabular-nums text-white/80">{fa.total}</td>
                        <td className="px-3 py-2 text-[12px] tabular-nums text-white/70">{fa.aFazer}</td>
                        <td className="px-3 py-2 text-[12px] tabular-nums text-green-800/90">{fa.concluidas}</td>
                        <td className={`px-3 py-2 text-[12px] tabular-nums ${fa.atrasadas > 0 ? "text-red-700/90" : "text-[var(--text-muted)]"}`}>{fa.atrasadas}</td>
                        <td className={`px-3 py-2 text-[12px] tabular-nums ${fa.venceEm7Dias > 0 ? "text-amber-800/90" : "text-[var(--text-muted)]"}`}>{fa.venceEm7Dias}</td>
                        <td className="px-3 py-2" colSpan={3}>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                              <div
                                className="h-full rounded-full bg-[var(--action-primary)]"
                                style={{ width: `${fa.total > 0 ? Math.round((fa.concluidas / fa.total) * 100) : 0}%` }}
                              />
                            </div>
                            <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-muted)]">
                              {fa.total > 0 ? Math.round((fa.concluidas / fa.total) * 100) : 0}% ({fa.concluidas} de {fa.total})
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {familias.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <span className="text-[11px] text-[var(--text-muted)]">
            Mostrando {visiveis.length} de {familias.length} famílias
          </span>
          {totalPaginas > 1 && (
            <div className="flex items-center gap-2">
              <button
                disabled={paginaValida <= 1}
                onClick={() => aoMudarPagina(paginaValida - 1)}
                className="rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)] disabled:opacity-40"
              >
                ‹
              </button>
              <span className="text-[11px] tabular-nums text-white/80">{paginaValida} / {totalPaginas}</span>
              <button
                disabled={paginaValida >= totalPaginas}
                onClick={() => aoMudarPagina(paginaValida + 1)}
                className="rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)] disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
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
            <input
              type="checkbox"
              checked={todosSelecionados}
              onChange={aoAlternarTodos}
              aria-label="Selecionar todas as tarefas visíveis"
              className="cursor-pointer"
            />
          </th>
          {COLUNAS_LISTA.map((c) => (
            <th key={String(c.campo)} className={`${c.classe} px-3 py-2`}>
              <button
                onClick={() => aoOrdenar(c.campo)}
                className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)] transition-colors hover:text-white/70"
              >
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
              <input
                type="checkbox"
                checked={selecionados.has(l.taskId)}
                onChange={() => aoAlternarSelecao(l.taskId)}
                aria-label={`Selecionar ${l.titulo}`}
                className="cursor-pointer"
              />
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
            <td className={`px-3 py-2 text-[11px] tabular-nums ${l.atrasada ? "text-red-700/90" : "text-[var(--text-secondary)]"}`}>
              {dataCurta(l.dataPrazo)}
            </td>
            <td className={`px-3 py-2 text-[11px] ${l.atrasada ? "text-red-700/80" : "text-[var(--text-muted)]"}`}>
              {tempo(l.diasParaPrazo, l.atrasada)}
            </td>
            <td className="px-3 py-2 text-[11px] tabular-nums text-[var(--text-muted)]">{dataCurta(l.criadaEm)}</td>
            <td className="px-3 py-2 text-right">
              <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => aoDistribuir(l)}
                  className="rounded border border-[var(--border-default)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-primary)] hover:text-white/90"
                >
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
 *
 * Cada entrada é uma transição com significado inequívoco. O que não está aqui
 * não é arrastável, e a razão aparece na tela:
 *
 *   → CONCLUÍDA          nunca. Tarefa conclui pelo ÚLTIMO PASSO do workflow,
 *                        executado no executor da etapa. Arrastar para cá
 *                        "concluiria" trabalho que ninguém fez.
 *   → SEM RESPONSÁVEL    é `devolver_a_fila`: existe e está aqui.
 *   SEM RESPONSÁVEL →    não. Antes de andar, a tarefa precisa de dono — o
 *                        gesto certo é Atribuir, e ele já está no card.
 *   → A FAZER            não existe "des-iniciar" no domínio.
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
            {alvoValido && (
              <div className="border-b border-[var(--border-default)] px-3 py-1.5 text-[10px] text-[var(--text-secondary)]/80">{permitido.rotulo}</div>
            )}
            <div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto p-2">
              {linhas.length === 0 && <p className="px-1 py-3 text-[11px] text-[var(--text-muted)]">{c.nota ?? "Nada aqui."}</p>}
              {linhas.map((l) => (
                <Card
                  key={l.taskId}
                  l={l}
                  aoAbrir={() => aoAbrir(l.taskId)}
                  aoDistribuir={() => aoDistribuir(l)}
                  aoArrastar={(inicio) => setArrastando(inicio ? l : null)}
                />
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
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder="Por quê? Quem ler depois precisa entender sem perguntar."
              className="mt-3 w-full rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-2 text-[12px] text-white/85 placeholder:text-[var(--text-muted)] focus:border-white/25 focus:outline-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setPedindo(null)} className="rounded px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:text-white/80">
                Cancelar
              </button>
              <button
                disabled={ocupado || motivo.trim().length < 3}
                onClick={async () => {
                  const ok = await aoComandar(pedindo.l.taskId, { acao: pedindo.acao, motivo: motivo.trim() }, `${pedindo.rotulo}: feito.`)
                  if (ok) setPedindo(null)
                }}
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

function Card({
  l, aoAbrir, aoDistribuir, aoArrastar,
}: {
  l: LinhaGerencial
  aoAbrir: () => void
  aoDistribuir: () => void
  aoArrastar: (inicio: boolean) => void
}) {
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
          {/* HÁ QUANTO TEMPO ESPERA — sem isso, "aguardando terceiro" é um
              estado onde o trabalho envelhece sem ninguém notar. */}
          {l.esperandoHaDias != null && (
            <p className={l.esperandoHaDias >= 15 ? "text-amber-800/70" : ""}>
              Aguardando {l.esperandoDe === "cliente" ? "o cliente" : "terceiro"} há {l.esperandoHaDias} dia
              {l.esperandoHaDias === 1 ? "" : "s"}
            </p>
          )}
          {/* POR QUE PAROU — na cara, não a cinco telas de distância. */}
          {l.motivoBloqueio && <p className="text-red-700/70">Bloqueio: {l.motivoBloqueio}</p>}
          {l.concluidaEm && <p>Concluída em {dataCurta(l.concluidaEm)}</p>}
        </div>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
        <Responsavel nome={l.responsavelNome} />
        <div className="flex shrink-0 items-center gap-2">
          {l.dataPrazo && (
            <span className={`text-[10px] tabular-nums ${l.atrasada ? "text-red-700/90" : "text-[var(--text-secondary)]"}`}>
              {dataCurta(l.dataPrazo)}
            </span>
          )}
          <button
            onClick={aoDistribuir}
            className="rounded border border-[var(--border-default)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-primary)] hover:text-white/90"
          >
            {l.responsavelId == null ? "Atribuir" : "Transferir"}
          </button>
        </div>
      </div>
    </div>
  )
}
