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

import { useCallback, useEffect, useMemo, useState } from "react"
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

interface Avaliacao {
  usuarioId: number
  nome: string
  elegivel: boolean
  motivos: Array<{ codigo: string; texto: string }>
  carga: {
    ativas: number; executaveis: number; emAndamento: number; naoIniciadas: number
    aguardandoTerceiro: number; bloqueadas: number; atrasadas: number; urgentes: number
  }
  score: number
  parcelas: Array<{ componente: string; quantidade: number; peso: number; subtotal: number; explicacao: string }>
}
interface Simulacao {
  taskId: number
  titulo: string
  recomendado: { usuarioId: number; nome: string; score: number } | null
  abstencao: { codigo: string; texto: string } | null
  explicacao: string[]
  decididoNoDesempateTecnico: boolean
  avaliacoes: Avaliacao[]
  equipe: { exigidaPelaTarefa: string | null; cadastrada: boolean; membros: number[]; nota: string } | null
  criteriosAusentes: Array<{ criterio: string; porque: string }>
}

interface Filtros {
  responsavel: number | null
  semResponsavel: boolean
  fase: string | null
  prioridade: string | null
  atrasadas: boolean
  venceHoje: boolean
  busca: string
}
const SEM_FILTRO: Filtros = {
  responsavel: null, semResponsavel: false, fase: null,
  prioridade: null, atrasadas: false, venceHoje: false, busca: "",
}
const temFiltro = (f: Filtros) =>
  f.responsavel != null || f.semResponsavel || f.fase != null || f.prioridade != null ||
  f.atrasadas || f.venceHoje || f.busca.trim() !== ""

function queryDe(f: Filtros, coluna: ColunaKanban | null): string {
  const p = new URLSearchParams()
  if (f.responsavel != null) p.set("responsavel", String(f.responsavel))
  if (f.semResponsavel) p.set("semResponsavel", "1")
  if (f.fase) p.set("fase", f.fase)
  if (f.prioridade) p.set("prioridade", f.prioridade)
  if (f.atrasadas) p.set("atrasadas", "1")
  if (f.venceHoje) p.set("venceHoje", "1")
  if (f.busca.trim()) p.set("busca", f.busca.trim())
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
  { chave: "semResponsavel", rotulo: "Sem responsável", filtro: { semResponsavel: true }, tom: "text-sky-700/90" },
  { chave: "emAndamento", rotulo: "Em andamento", filtro: {}, tom: "text-white/80" },
  { chave: "aguardandoTerceiro", rotulo: "Aguardando terceiro", filtro: {}, tom: "text-white/80" },
  { chave: "bloqueadas", rotulo: "Bloqueadas", filtro: {}, tom: "text-white/80" },
  { chave: "atrasadas", rotulo: "Atrasadas", filtro: { atrasadas: true }, tom: "text-red-700/90" },
  { chave: "venceHoje", rotulo: "Vence hoje", filtro: { venceHoje: true }, tom: "text-amber-700/90" },
]

export function VisaoGlobal() {
  const [modo, setModo] = useState<"lista" | "kanban">("lista")
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO)
  const [resultado, setResultado] = useState<{ chave: string; d: Resposta | null } | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [alvo, setAlvo] = useState<LinhaGerencial | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erroComando, setErroComando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ordem, setOrdem] = useState<{ campo: keyof LinhaGerencial; asc: boolean }>({ campo: "dataPrazo", asc: true })
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
  /** A tarefa cuja sugestão está aberta. `null` = nenhuma. */
  const [sugerindo, setSugerindo] = useState<{ l: LinhaGerencial; s: Simulacao | null; erro: string | null } | null>(null)

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
   * SUGERIR RESPONSÁVEL — pergunta, não decide.
   *
   * É um GET. Não atribui, não altera `responsavelId`, não notifica ninguém: o
   * gestor lê a recomendação e confirma pelo mesmo "Atribuir" de sempre, que
   * continua sendo a única porta que escreve.
   */
  const sugerir = useCallback(async (l: LinhaGerencial) => {
    setSugerindo({ l, s: null, erro: null })
    try {
      const r = await fetch(`/api/operacao/sugestao?taskId=${l.taskId}`, { headers: auth() })
      if (!r.ok) {
        setSugerindo({ l, s: null, erro: r.status === 403 ? "Você não tem permissão para ver a recomendação." : `Falha (HTTP ${r.status}).` })
        return
      }
      const d = (await r.json()) as { simulacao: Simulacao }
      setSugerindo({ l, s: d.simulacao, erro: null })
    } catch {
      setSugerindo({ l, s: null, erro: "Não foi possível falar com o servidor." })
    }
  }, [])

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

  const aplicar = (p: Partial<Filtros>) => setFiltros((f) => ({ ...f, ...p }))
  const limpar = () => { setBuscaDigitada(""); setFiltros(SEM_FILTRO) }

  return (
    <div className="flex h-full flex-col">
      {/* ── INDICADORES ── contagem do universo filtrado, e cada um é um filtro */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        {INDICADORES.map((ind) => {
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
        })}
        <div className="ml-auto flex items-center gap-1 rounded border border-[var(--border-default)] p-0.5">
          {(["lista", "kanban"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModo(m)}
              className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                modo === m ? "bg-[var(--surface-primary)] text-white/90" : "text-[var(--text-secondary)] hover:text-white/75"
              }`}
            >
              {m === "lista" ? "Lista" : "Kanban"}
            </button>
          ))}
        </div>
      </div>

      {/* ── FILTROS ── combináveis, e o que existe vem do que existe */}
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
            erroComando ? "border-red-200 bg-red-50 text-red-700/90" : "border-emerald-200 bg-emerald-50 text-emerald-700/90"
          }`}
        >
          {erroComando ?? aviso}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar a operação." aoTentar={recarregar} />}
        {carregando && <Estado tipo="carregando" mensagem="Carregando a operação…" />}
        {dados && linhas.length === 0 && (
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
            aoSugerir={sugerir}
          />
        )}
        {dados && linhas.length > 0 && modo === "kanban" && (
          <Quadro
            porColuna={porColuna}
            aoAbrir={(id) => { const l = linhas.find((x) => x.taskId === id); if (l) irParaOProcesso(l) }}
            aoDistribuir={setAlvo}
            aoSugerir={sugerir}
            aoComandar={comandar}
            ocupado={ocupado}
          />
        )}
      </div>

      {sugerindo && (
        <PainelSugestao
          alvo={sugerindo}
          aoFechar={() => setSugerindo(null)}
          aoAtribuir={(l) => { setSugerindo(null); setAlvo(l) }}
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

function Lista({
  linhas, ordem, aoOrdenar, aoAbrir, aoDistribuir, aoSugerir,
}: {
  linhas: LinhaGerencial[]
  ordem: { campo: keyof LinhaGerencial; asc: boolean }
  aoOrdenar: (c: keyof LinhaGerencial) => void
  aoAbrir: (id: number) => void
  aoDistribuir: (l: LinhaGerencial) => void
  aoSugerir: (l: LinhaGerencial) => void
}) {
  return (
    <table className="w-full border-collapse text-left">
      <thead className="sticky top-0 z-10 bg-[var(--surface-overlay)]">
        <tr className="border-b border-white/[0.08]">
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
            <td className="max-w-0 px-3 py-2 align-top">
              <button onClick={() => aoAbrir(l.taskId)} className="w-full cursor-pointer text-left">
                <span className="block truncate text-[12px] text-white/90">{l.titulo}</span>
                <span className="mt-1 flex flex-wrap gap-1"><Sinais l={l} /></span>
              </button>
            </td>
            <td className="truncate px-3 py-2 text-[11px] text-white/60">{l.pessoaNome ?? "—"}</td>
            <td className="truncate px-3 py-2 text-[11px] text-white/60">{l.processoNome ?? "—"}</td>
            <td className="truncate px-3 py-2 text-[11px] text-[var(--text-secondary)]">{rotularFase(l.faseMacroKey) ?? "—"}</td>
            <td className="truncate px-3 py-2 text-[11px] text-white/60">{l.etapaAtual ?? "—"}</td>
            <td className="px-3 py-2"><Responsavel nome={l.responsavelNome} /></td>
            <td className="px-3 py-2 text-[11px] text-white/60">{ROTULO_STATUS[l.statusTarefa] ?? l.statusTarefa}</td>
            <td className="px-3 py-2 text-[11px] text-white/60">{ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade}</td>
            <td className={`px-3 py-2 text-[11px] tabular-nums ${l.atrasada ? "text-red-700/90" : "text-white/60"}`}>
              {dataCurta(l.dataPrazo)}
            </td>
            <td className={`px-3 py-2 text-[11px] ${l.atrasada ? "text-red-700/80" : "text-[var(--text-muted)]"}`}>
              {tempo(l.diasParaPrazo, l.atrasada)}
            </td>
            <td className="px-3 py-2 text-[11px] tabular-nums text-[var(--text-muted)]">{dataCurta(l.criadaEm)}</td>
            <td className="px-3 py-2 text-right">
              <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {/* Só onde não há dono: sugerir para quem já tem responsável
                    seria propor redistribuição, que é outro problema. */}
                {l.responsavelId == null && (
                  <button
                    onClick={() => aoSugerir(l)}
                    className="rounded border border-sky-200 px-2 py-1 text-[10px] text-sky-700/80 transition-colors hover:bg-sky-50 hover:text-sky-100"
                  >
                    Sugerir
                  </button>
                )}
                <button
                  onClick={() => aoDistribuir(l)}
                  className="rounded border border-[var(--border-default)] px-2 py-1 text-[10px] text-white/60 transition-colors hover:bg-[var(--surface-primary)] hover:text-white/90"
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
  porColuna, aoAbrir, aoDistribuir, aoSugerir, aoComandar, ocupado,
}: {
  porColuna: Map<ColunaKanban, LinhaGerencial[]>
  aoAbrir: (id: number) => void
  aoDistribuir: (l: LinhaGerencial) => void
  aoSugerir: (l: LinhaGerencial) => void
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
              sobre === c.chave && alvoValido ? "border-sky-200 bg-sky-400/[0.06]"
              : alvoInvalido ? "border-white/[0.04] bg-[var(--surface-primary)] opacity-40"
              : "border-white/[0.08] bg-[var(--surface-primary)]"
            }`}
          >
            <div className="flex items-baseline justify-between border-b border-white/[0.06] px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/60">{c.rotulo}</span>
              <span className="text-[11px] tabular-nums text-[var(--text-muted)]">{linhas.length}</span>
            </div>
            {alvoValido && (
              <div className="border-b border-sky-200 px-3 py-1.5 text-[10px] text-sky-700/80">{permitido.rotulo}</div>
            )}
            <div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto p-2">
              {linhas.length === 0 && <p className="px-1 py-3 text-[11px] text-[var(--text-muted)]">{c.nota ?? "Nada aqui."}</p>}
              {linhas.map((l) => (
                <Card
                  key={l.taskId}
                  l={l}
                  aoAbrir={() => aoAbrir(l.taskId)}
                  aoDistribuir={() => aoDistribuir(l)}
                  aoSugerir={() => aoSugerir(l)}
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
  l, aoAbrir, aoDistribuir, aoSugerir, aoArrastar,
}: {
  l: LinhaGerencial
  aoAbrir: () => void
  aoDistribuir: () => void
  aoSugerir: () => void
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
            <p className={l.esperandoHaDias >= 15 ? "text-amber-700/70" : ""}>
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
          {l.responsavelId == null && (
            <button
              onClick={aoSugerir}
              className="rounded border border-sky-200 px-1.5 py-0.5 text-[10px] text-sky-700/80 transition-colors hover:bg-sky-50 hover:text-sky-100"
            >
              Sugerir
            </button>
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

/**
 * O PAINEL DA SUGESTÃO — o modo auditor, na tela.
 *
 * Uma recomendação que só diz um nome pede fé. Esta mostra a conta inteira:
 * quem é elegível e quem não é (com o motivo), a carga de cada um, o score
 * decomposto parcela a parcela, e — o que costuma faltar — o que o sistema NÃO
 * sabe. O gestor decide com o mesmo botão de sempre; aqui não há nada que
 * escreva.
 */
function PainelSugestao({
  alvo,
  aoFechar,
  aoAtribuir,
}: {
  alvo: { l: LinhaGerencial; s: Simulacao | null; erro: string | null }
  aoFechar: () => void
  aoAtribuir: (l: LinhaGerencial) => void
}) {
  const { l, s, erro } = alvo
  const elegiveis = (s?.avaliacoes ?? []).filter((a) => a.elegivel).sort((a, b) => a.score - b.score)
  const inelegiveis = (s?.avaliacoes ?? []).filter((a) => !a.elegivel)
  const [auditor, setAuditor] = useState(false)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={aoFechar}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/[0.08] px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Sugerir responsável</p>
          <h2 className="mt-0.5 truncate text-[14px] font-medium text-white/95">{l.titulo}</h2>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            {[l.pessoaNome, l.processoNome].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {erro && <div className="border-b border-red-200 bg-red-50 px-4 py-2.5 text-[11px] text-red-700/90">{erro}</div>}
          {!s && !erro && <Estado tipo="carregando" mensagem="Calculando elegibilidade e carga…" />}

          {s && (
            <>
              {/* ── A RESPOSTA ── */}
              <div className="border-b border-white/[0.06] px-4 py-3.5">
                {s.recomendado ? (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-50 text-[10px] font-medium text-emerald-700/90">
                        {iniciais(s.recomendado.nome)}
                      </span>
                      <span className="text-[15px] font-medium text-white/95">{s.recomendado.nome}</span>
                      <span className="text-[11px] tabular-nums text-[var(--text-muted)]">custo operacional {s.recomendado.score}</span>
                    </div>
                    <ul className="mt-2.5 space-y-1">
                      {s.explicacao.map((linha, i) => (
                        <li key={i} className={`text-[11px] leading-4 ${
                          linha.startsWith("⚠") ? "text-amber-700/80" : linha.startsWith("ℹ") ? "text-[var(--text-secondary)]" : "text-white/65"
                        }`}>
                          {linha}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    {/* A ABSTENÇÃO É UMA RESPOSTA — com motivo, nunca um nome inventado. */}
                    <p className="text-[13px] font-medium text-amber-700/90">Sem recomendação automática</p>
                    <p className="mt-1 text-[11px] leading-4 text-white/60">{s.abstencao?.texto}</p>
                    <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
                      Código: {s.abstencao?.codigo}. A decisão continua sendo sua — atribuir manualmente segue disponível.
                    </p>
                  </>
                )}
              </div>

              {/* ── QUEM PODE, E QUANTO CADA UM CARREGA ── */}
              {elegiveis.length > 0 && (
                <div className="border-b border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    Elegíveis · {elegiveis.length}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {elegiveis.map((a) => (
                      <div key={a.usuarioId} className="rounded border border-white/[0.07] px-2.5 py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`text-[12px] ${a.usuarioId === s.recomendado?.usuarioId ? "text-emerald-700/90" : "text-white/80"}`}>
                            {a.nome}
                          </span>
                          <span className="text-[11px] tabular-nums text-[var(--text-secondary)]">custo {a.score}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
                          <span><span className="tabular-nums text-white/65">{a.carga.executaveis}</span> executáveis</span>
                          <span><span className="tabular-nums text-white/65">{a.carga.ativas}</span> ativas</span>
                          <span className={a.carga.atrasadas > 0 ? "text-red-700/70" : ""}>
                            <span className="tabular-nums">{a.carga.atrasadas}</span> atrasadas
                          </span>
                          <span><span className="tabular-nums text-white/65">{a.carga.urgentes}</span> urgentes</span>
                          <span><span className="tabular-nums text-white/65">{a.carga.aguardandoTerceiro}</span> aguardando terceiro</span>
                          <span><span className="tabular-nums text-white/65">{a.carga.bloqueadas}</span> bloqueadas</span>
                        </div>
                        {auditor && (
                          <div className="mt-1.5 space-y-0.5 border-t border-white/[0.06] pt-1.5">
                            {a.parcelas.map((p) => (
                              <div key={p.componente} className="flex justify-between text-[10px] text-[var(--text-muted)]">
                                <span>{p.explicacao}</span>
                                <span className="tabular-nums">{p.quantidade} × {p.peso} = {p.subtotal}</span>
                              </div>
                            ))}
                            <div className="flex justify-between border-t border-white/[0.06] pt-1 text-[10px] text-white/60">
                              <span>custo operacional</span>
                              <span className="tabular-nums">{a.score}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── QUEM NÃO PODE, E POR QUÊ ── */}
              {inelegiveis.length > 0 && (
                <div className="border-b border-white/[0.06] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    Inelegíveis · {inelegiveis.length}
                  </p>
                  <div className="mt-2 space-y-1">
                    {inelegiveis.map((a) => (
                      <div key={a.usuarioId} className="flex gap-2 text-[11px]">
                        <span className="shrink-0 text-[var(--text-secondary)]">{a.nome}</span>
                        <span className="text-[var(--text-muted)]">{a.motivos.map((m) => m.texto).join(" ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── O QUE O SISTEMA NÃO SABE ── */}
              <div className="px-4 py-3">
                <button
                  onClick={() => setAuditor((v) => !v)}
                  className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] transition-colors hover:text-white/70"
                >
                  {auditor ? "▾" : "▸"} Como esta conta foi feita
                </button>
                {auditor && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[10px] leading-4 text-[var(--text-secondary)]">
                      Elegibilidade tem um critério só neste sistema: permissão de executar tarefa. Os critérios abaixo
                      são frequentemente esperados e <span className="text-white/70">não existem no cadastro</span> —
                      nenhum foi inventado:
                    </p>
                    {s.criteriosAusentes.map((c) => (
                      <div key={c.criterio} className="text-[10px] leading-4 text-[var(--text-muted)]">
                        <span className="text-[var(--text-secondary)]">{c.criterio}</span> — {c.porque}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/[0.08] px-4 py-2.5">
          <span className="text-[10px] text-[var(--text-muted)]">Nada foi alterado. A atribuição continua sendo sua.</span>
          <div className="flex gap-2">
            <button onClick={aoFechar} className="rounded px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-white/80">
              Fechar
            </button>
            {/* Confirmar abre o MESMO seletor de sempre — a porta que escreve é uma só. */}
            <button
              onClick={() => aoAtribuir(l)}
              className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-[11px] text-white/85 transition-colors hover:bg-[var(--surface-primary)]"
            >
              Atribuir…
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
