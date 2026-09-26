// src/components/operacao/central-operacional.tsx
// ============================================================================
// A CENTRAL OPERACIONAL — "o que a empresa precisa fazer agora?"
//
// SEMPRE agrupada por FAMÍLIA → Processo → Fase → Etapa → Tarefa. Família é
// agrupamento VISUAL — nunca dono de tarefa, nunca alvo de "concluir tudo".
//
// Lê /api/operacao/central (agregacaoPorFamilia) para o nível Família →
// Processo → Fase, e /api/operacao/visao-global (visaoGerencial) — a MESMA
// leitura da tela Tarefas e Projetos — para o drill-down Etapa → Tarefa.
// Nenhum motor novo: os dois endpoints chamam `whereGerencial` por baixo, e é
// por isso que os contadores aqui e lá nunca discordam.
//
// Ações em lote (atribuir/repriorizar) saem por `/api/tarefas/redistribuir` e
// `/api/tarefas/repriorizar` — as MESMAS portas canônicas, item a item,
// auditadas. Nunca "concluir tudo": a única ação sem confirmação individual
// que existe é atribuição e prioridade.
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { gravarLocal, useJsonLocalStorage } from "@/src/lib/cliente"
import {
  auth, dataCurta, Estado, ROTULO_PRIORIDADE, rotularFase, useRotulosDeFaseProntos,
  type LinhaOperacional,
} from "./kit-operacional"
import { FamiliaTabelaExpandida, CartaoObrigacaoAdministrativa, ORIGEM_OBRIGACAO_ATRIBUICAO } from "./tabela-familia"
import { MinhaOperacaoDetalhe } from "./minha-operacao-detalhe"

// ── tipos que espelham a projeção canônica (lib/operacional/tarefa-projecoes.ts) ──

interface Contagens {
  total: number; aFazer: number; concluidas: number; atrasadas: number; venceEm7Dias: number
  semResponsavel: number; bloqueadas: number; aguardandoTerceiro: number; executavelAgora: number
}
interface FaseAgrupada extends Contagens { faseMacroKey: string; label: string; ordem: number }
interface ProcessoAgrupado extends Contagens {
  processoId: number; nomeProcesso: string; faseAtualKey: string | null; fases: FaseAgrupada[]; pendenciasFaseAnterior: number
}
interface FamiliaAgrupada extends Contagens {
  familiaId: number | null; nomeFamilia: string; processos: ProcessoAgrupado[]
  responsavelPrincipal: { id: number; nome: string } | null; ultimaAtividade: string | null; pendenciasFaseAnterior: number
}
interface RespostaCentral {
  familias: FamiliaAgrupada[]
  total: number
  paginacao: { pagina: number; porPagina: number; totalPaginas: number; totalFamilias: number }
  fases: Array<{ phaseKey: string; label: string; code: string }>
  equipes: Array<{ equipeKey: string; tarefas: number }>
  responsaveis: Array<{ responsavelId: number; nome: string; tarefas: number; atrasadas: number }>
  indicadores: Record<string, number>
}

const PRIORIDADES_FILTRO = ["URGENTE", "ALTA", "MEDIA", "BAIXA"] as const

type OrdenacaoFamilia = "atencao" | "prazo" | "familia" | "ultimaAtividade"
const ORDENACOES: Array<{ chave: OrdenacaoFamilia; rotulo: string }> = [
  { chave: "atencao", rotulo: "Atenção necessária" },
  { chave: "prazo", rotulo: "Prazo mais próximo" },
  { chave: "familia", rotulo: "Nome da família" },
  { chave: "ultimaAtividade", rotulo: "Última atividade" },
]

// ── condições compostas — cada uma é um filtro real no backend, nunca client-side ──

type ChaveCondicao =
  | "executavelAgora" | "atrasadas" | "venceHoje" | "proximos7Dias" | "semResponsavel"
  | "bloqueada" | "aguardandoTerceiro" | "semMovimentacao" | "pendenciasFasesAnteriores"

// SITUAÇÃO — os 5 recortes mais usados no dia a dia, sempre visíveis.
// PRAZO/RESPONSÁVEL secundários entram em "Mais filtros": nenhum some da
// tela, só param de competir visualmente com os resultados quando ninguém
// pediu por eles (mandato "modernização visual", 19/09/2026).
const CONDICOES_PRINCIPAIS: Array<{ chave: ChaveCondicao; rotulo: string }> = [
  { chave: "executavelAgora", rotulo: "Executável agora" },
  { chave: "atrasadas", rotulo: "Atrasadas" },
  { chave: "venceHoje", rotulo: "Vence hoje" },
  { chave: "aguardandoTerceiro", rotulo: "Aguardando terceiro" },
  { chave: "semResponsavel", rotulo: "Sem responsável" },
]
const CONDICOES_SECUNDARIAS: Array<{ chave: ChaveCondicao; rotulo: string }> = [
  { chave: "proximos7Dias", rotulo: "Próximos 7 dias" },
  { chave: "bloqueada", rotulo: "Bloqueadas" },
  { chave: "semMovimentacao", rotulo: "Sem movimentação (7d)" },
  { chave: "pendenciasFasesAnteriores", rotulo: "Pendências de fases anteriores" },
]
const CONDICOES: Array<{ chave: ChaveCondicao; rotulo: string }> = [...CONDICOES_PRINCIPAIS, ...CONDICOES_SECUNDARIAS]

interface FiltrosCentral {
  escopo: "minha_fila" | "sem_responsavel" | "tudo"
  fase: string | null
  equipe: string | null
  /** Só faz sentido dentro de `escopo: "tudo"` — recorta a operação inteira por UMA pessoa, sem virar um quarto escopo. */
  responsavel: number | null
  prioridade: Set<(typeof PRIORIDADES_FILTRO)[number]>
  busca: string
  condicoes: Set<ChaveCondicao>
  ordenacao: OrdenacaoFamilia
}
const FILTROS_VAZIOS: FiltrosCentral = {
  escopo: "minha_fila", fase: null, equipe: null, responsavel: null, prioridade: new Set(),
  busca: "", condicoes: new Set(), ordenacao: "atencao",
}

interface VistaSalva {
  nome: string
  filtros: {
    escopo: FiltrosCentral["escopo"]; fase: string | null; equipe: string | null
    responsavel: number | null; prioridade: Array<(typeof PRIORIDADES_FILTRO)[number]>
    busca: string; condicoes: ChaveCondicao[]; ordenacao: OrdenacaoFamilia
  }
}
const CHAVE_VISTAS = "central-operacional:vistas-salvas"

/**
 * SÓ A PARTE QUE É FILTRO DE VERDADE (fase/prioridade/busca/condições) —
 * sem escopo/ordenação/paginação, que não fazem sentido pra uma família já
 * escolhida. `parseFiltrosGerenciais` (mesmo parser de `/api/operacao/
 * visao-global` e `/api/operacao/tarefas`) lê exatamente estas chaves —
 * reaproveitada aqui pra tabela por família nunca divergir dos chips do
 * topo (achado real 25/09/2026: clicar "Vence hoje" filtrava os ladrilhos
 * mas a tabela da família continuava mostrando tudo).
 */
function queryDeFiltros(f: FiltrosCentral): URLSearchParams {
  const p = new URLSearchParams()
  if (f.fase) p.set("fase", f.fase)
  for (const pr of f.prioridade) p.append("prioridade", pr)
  if (f.busca.trim()) p.set("busca", f.busca.trim())
  for (const c of f.condicoes) {
    if (c === "semMovimentacao") p.set("semMovimentacaoDias", "7")
    else p.set(c, "1")
  }
  return p
}

function queryDe(f: FiltrosCentral, pagina: number): string {
  const p = queryDeFiltros(f)
  p.set("escopo", f.escopo)
  if (f.equipe) p.set("equipe", f.equipe)
  if (f.escopo === "tudo" && f.responsavel != null) p.set("responsavel", String(f.responsavel))
  p.set("ordenacao", f.ordenacao)
  p.set("pagina", String(pagina))
  p.set("porPagina", "30")
  return p.toString()
}

/** Primeira + ÚLTIMA palavra (não a segunda) — um nome entre colchetes como
 *  "[TESTE VISUAL] [TESTE F]" não vira "[V": a segunda palavra de um nome
 *  raramente é quem identifica a pessoa/família, a última costuma ser
 *  (sobrenome). Mesmo critério de `visao-global.tsx`/`central-tarefas.tsx`. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter((p) => /[a-zA-ZÀ-ÿ0-9]/.test(p))
  if (partes.length === 0) return "?"
  const primeira = partes[0]?.match(/[a-zA-ZÀ-ÿ0-9]/)?.[0] ?? ""
  const ultima = partes.length > 1 ? partes[partes.length - 1]?.match(/[a-zA-ZÀ-ÿ0-9]/)?.[0] ?? "" : ""
  return (primeira + ultima).toUpperCase() || "?"
}

const PONTO_TOM: Record<string, string> = {
  executavelAgora: "text-white/80", atrasadas: "text-red-700/90", venceEm7Dias: "text-amber-800/90",
  semResponsavel: "text-[var(--text-secondary)]/90", bloqueadas: "text-red-700/90", aguardandoTerceiro: "text-amber-800/90",
}

export function CentralOperacional() {
  useRotulosDeFaseProntos()
  const paramsIniciais = useSearchParams()
  // DEEP-LINK — a Home ("Trabalho para distribuir", famílias) linka pra cá já
  // com o recorte pronto. Lido só uma vez, no mount: depois disso quem manda
  // é o estado local, como em qualquer filtro desta tela.
  const [filtros, setFiltros] = useState<FiltrosCentral>(() => {
    const escopoUrl = paramsIniciais.get("escopo")
    const buscaUrl = paramsIniciais.get("busca") ?? ""
    return {
      ...FILTROS_VAZIOS,
      escopo: escopoUrl === "tudo" || escopoUrl === "sem_responsavel" ? escopoUrl : FILTROS_VAZIOS.escopo,
      busca: buscaUrl,
    }
  })
  const [pagina, setPagina] = useState(1)
  const [buscaDigitada, setBuscaDigitada] = useState(() => paramsIniciais.get("busca") ?? "")
  const [isAdmin, setIsAdmin] = useState(false)
  const [resultado, setResultado] = useState<{ chave: string; d: RespostaCentral | null } | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [maisFiltrosAberto, setMaisFiltrosAberto] = useState(false)
  // PAINEL DE DETALHE — a mesma gaveta lateral que Minha Operação já usava,
  // agora compartilhada por qualquer família expandida nesta tela (uma só de
  // cada vez, nunca uma por família).
  const [selecionado, setSelecionado] = useState<{ taskId: number; processoId: number | null } | null>(null)

  useEffect(() => {
    try { setIsAdmin(JSON.parse(localStorage.getItem("user") ?? "{}")?.tipo === "admin") } catch { /* ignora */ }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => ({ ...f, busca: buscaDigitada })), 350)
    return () => clearTimeout(t)
  }, [buscaDigitada])

  // Mudar filtro/ordenação enquanto olha a página 3 deixaria a tela numa
  // página que pode nem existir mais no novo recorte.
  const chaveFiltro = queryDe(filtros, 1)
  useEffect(() => { setPagina(1) }, [chaveFiltro])

  const query = queryDe(filtros, pagina)
  const chave = `${query}#${recarga}`
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/central?${query}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RespostaCentral) => { if (vivo) setResultado({ chave, d }) })
      .catch(() => { if (vivo) setResultado({ chave, d: null }) })
    return () => { vivo = false }
  }, [chave, query])

  const carregando = resultado?.chave !== chave
  const dados = carregando ? null : resultado?.d ?? null
  const falhou = !carregando && dados == null
  const recarregar = () => setRecarga((n) => n + 1)

  // ── CONCLUÍDAS HOJE, POR PROCESSO ───────────────────────────────────────
  // `linhas` de cada família expandida NUNCA inclui concluídas quando o
  // escopo é `minha_fila` (`minhaFila()` exclui de propósito — "o que já foi
  // entregue não é trabalho de hoje"). Por isso o contador de "concluídas
  // hoje" do mini-ladrilho vem de UMA leitura à parte, aqui em cima, e desce
  // por processo — o mesmo padrão que Minha Operação já usava antes da
  // fusão, só que agora escopado por `filtros.escopo` também.
  const [concluidasPorProcesso, setConcluidasPorProcesso] = useState<Map<number, number>>(new Map())
  useEffect(() => {
    let vivo = true
    const hoje = new Date().toISOString().slice(0, 10)
    const p = filtros.escopo === "minha_fila"
      ? new URLSearchParams({ visao: "concluidas_hoje" })
      : (() => {
          const q = new URLSearchParams({ dataTipo: "concluida", dataInicio: hoje, dataFim: hoje, porPagina: "500" })
          if (filtros.escopo === "sem_responsavel") q.set("semResponsavel", "1")
          return q
        })()
    const url = filtros.escopo === "minha_fila" ? `/api/operacao/tarefas?${p}` : `/api/operacao/visao-global?${p}`
    fetch(url, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => {
        if (!vivo) return
        const mapa = new Map<number, number>()
        for (const l of d.linhas ?? []) {
          if (l.processoId == null) continue
          mapa.set(l.processoId, (mapa.get(l.processoId) ?? 0) + 1)
        }
        setConcluidasPorProcesso(mapa)
      })
      .catch(() => { if (vivo) setConcluidasPorProcesso(new Map()) })
    return () => { vivo = false }
  }, [filtros.escopo, recarga])

  // ── OBRIGAÇÃO ADMINISTRATIVA ("Atribuir tarefas") ───────────────────────
  // Cartão próprio, sempre visível no topo, independente de filtro — só faz
  // sentido em "Minha fila" (é trabalho ATRIBUÍDO ao usuário logado; "Toda a
  // operação"/"Sem responsável" já mostram a operação inteira, o cartão seria
  // redundante ali).
  const [linhasAdministrativasBrutas, setLinhasAdministrativasBrutas] = useState<LinhaOperacional[]>([])
  useEffect(() => {
    if (filtros.escopo !== "minha_fila") return
    let vivo = true
    fetch(`/api/operacao/tarefas?visao=minha_fila`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => {
        if (vivo) setLinhasAdministrativasBrutas((d.linhas ?? []).filter((l) => l.origem === ORIGEM_OBRIGACAO_ATRIBUICAO))
      })
      .catch(() => { if (vivo) setLinhasAdministrativasBrutas([]) })
    return () => { vivo = false }
  }, [filtros.escopo, recarga])
  // Só faz sentido em "Minha fila" — nunca mostra dado velho de outro escopo.
  const linhasAdministrativas = filtros.escopo === "minha_fila" ? linhasAdministrativasBrutas : []

  const vistas = useJsonLocalStorage<VistaSalva[]>(CHAVE_VISTAS) ?? []

  const alternarCondicao = (c: ChaveCondicao) => setFiltros((f) => {
    const novo = new Set(f.condicoes)
    if (novo.has(c)) novo.delete(c); else novo.add(c)
    return { ...f, condicoes: novo }
  })

  const alternarFamilia = (chaveFamilia: string) => setExpandidas((prev) => {
    const novo = new Set(prev)
    if (novo.has(chaveFamilia)) novo.delete(chaveFamilia); else novo.add(chaveFamilia)
    return novo
  })

  const salvarVista = () => {
    const nome = window.prompt("Nome desta vista:")?.trim()
    if (!nome) return
    const nova: VistaSalva = {
      nome,
      filtros: {
        escopo: filtros.escopo, fase: filtros.fase, equipe: filtros.equipe,
        responsavel: filtros.responsavel, prioridade: [...filtros.prioridade],
        busca: filtros.busca, condicoes: [...filtros.condicoes], ordenacao: filtros.ordenacao,
      },
    }
    gravarLocal(CHAVE_VISTAS, [...vistas.filter((v) => v.nome !== nome), nova])
  }
  const aplicarVista = (v: VistaSalva) => {
    setFiltros({
      escopo: v.filtros.escopo, fase: v.filtros.fase, equipe: v.filtros.equipe ?? null,
      responsavel: v.filtros.responsavel ?? null, prioridade: new Set(v.filtros.prioridade ?? []),
      busca: v.filtros.busca, condicoes: new Set(v.filtros.condicoes), ordenacao: v.filtros.ordenacao ?? "atencao",
    })
    setBuscaDigitada(v.filtros.busca)
  }
  const removerVista = (nome: string) => gravarLocal(CHAVE_VISTAS, vistas.filter((v) => v.nome !== nome))

  const tiles = useMemo(() => {
    if (!dados) return []
    return [
      { chave: "tarefas", rotulo: "Tarefas abertas" },
      { chave: "executavelAgora", rotulo: "Executáveis agora" },
      { chave: "atrasadas", rotulo: "Atrasadas" },
      { chave: "venceEm7Dias", rotulo: "Vencem em 7 dias" },
      { chave: "semResponsavel", rotulo: "Sem responsável" },
      { chave: "bloqueadas", rotulo: "Bloqueadas" },
      { chave: "aguardandoTerceiro", rotulo: "Aguardando terceiro" },
      { chave: "pendenciasFaseAnterior", rotulo: "Pendências de fases anteriores" },
      { chave: "familias", rotulo: "Famílias" },
    ]
  }, [dados])

  return (
    <div className="flex flex-col gap-4">
      {/* ── OBRIGAÇÃO ADMINISTRATIVA — sempre visível, independente de
          filtro/condição/fase (a tabela abaixo é só para tarefas NORMAL/
          TRANSVERSAL). "Se existe uma tarefa canônica ativa atribuída a mim
          que exige uma ação minha, eu preciso encontrá-la aqui." ── */}
      {linhasAdministrativas.length > 0 && (
        <div className="flex flex-col gap-2">
          {linhasAdministrativas.map((l) => <CartaoObrigacaoAdministrativa key={l.taskId} l={l} />)}
        </div>
      )}

      {/* ── ESCOPO + BUSCA ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] p-0.5">
          {(["minha_fila", "tudo", "sem_responsavel"] as const)
            .filter((e) => isAdmin || e === "minha_fila")
            .map((e) => (
              <button
                key={e}
                onClick={() => setFiltros((f) => ({ ...f, escopo: e }))}
                className={`rounded px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  filtros.escopo === e ? "bg-[var(--surface-primary)] text-white/90" : "text-[var(--text-secondary)] hover:text-white/75"
                }`}
              >
                {e === "minha_fila" ? "Minha fila" : e === "tudo" ? "Toda a operação" : "Sem responsável"}
              </button>
            ))}
        </div>
        {filtros.escopo === "tudo" && dados && dados.responsaveis.length > 0 && (
          <select
            value={filtros.responsavel ?? ""}
            onChange={(e) => setFiltros((f) => ({ ...f, responsavel: e.target.value ? Number(e.target.value) : null }))}
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-[11px] text-white/85 outline-none"
          >
            <option value="">Qualquer responsável</option>
            {dados.responsaveis.map((r) => (
              <option key={r.responsavelId} value={r.responsavelId}>{r.nome} ({r.tarefas})</option>
            ))}
          </select>
        )}
        <input
          value={buscaDigitada}
          onChange={(e) => setBuscaDigitada(e.target.value)}
          placeholder="Buscar família, pessoa, processo, documento, protocolo, órgão…"
          className="min-w-[260px] flex-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-[12px] text-white/90 placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--action-primary)]"
        />
        <button
          onClick={salvarVista}
          className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-primary)]"
        >
          Salvar vista
        </button>
        {vistas.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {vistas.map((v) => (
              <span key={v.nome} className="inline-flex items-center rounded border border-[var(--border-default)] bg-[var(--surface-secondary)]">
                <button onClick={() => aplicarVista(v)} className="px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-white/85">{v.nome}</button>
                <button onClick={() => removerVista(v.nome)} className="px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:text-red-700/90">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── SITUAÇÃO — os recortes mais usados, sempre visíveis. O resto (Prazo/
          Responsável mais específicos) fica atrás de "Mais filtros": nada
          desaparece, só para de competir com os resultados sem ter sido
          pedido (mandato "modernização visual", 19/09/2026). ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CONDICOES_PRINCIPAIS.map((c) => {
          const ativo = filtros.condicoes.has(c.chave)
          return (
            <button
              key={c.chave}
              onClick={() => alternarCondicao(c.chave)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                ativo
                  ? "border-[var(--action-primary)] bg-[var(--action-primary)]/15 text-white/90"
                  : "border-[var(--border-default)] text-[var(--text-secondary)] hover:text-white/75"
              }`}
            >
              {c.rotulo}
            </button>
          )
        })}
        {(() => {
          const ativasEscondidas = CONDICOES_SECUNDARIAS.filter((c) => filtros.condicoes.has(c.chave)).length
          return (
            <button
              onClick={() => setMaisFiltrosAberto((v) => !v)}
              aria-expanded={maisFiltrosAberto}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                ativasEscondidas > 0
                  ? "border-[var(--action-primary)] bg-[var(--action-primary)]/15 text-white/90"
                  : "border-[var(--border-default)] text-[var(--text-secondary)] hover:text-white/75"
              }`}
            >
              Mais filtros{ativasEscondidas > 0 ? ` (${ativasEscondidas})` : ""} {maisFiltrosAberto ? "▲" : "▼"}
            </button>
          )
        })()}
        {filtros.condicoes.size > 0 && (
          <button onClick={() => setFiltros((f) => ({ ...f, condicoes: new Set() }))} className="text-[10px] text-[var(--text-muted)] hover:text-white/70">
            limpar condições
          </button>
        )}
        <span className="ml-2 h-4 w-px bg-white/[0.08]" />
        {PRIORIDADES_FILTRO.map((pr) => {
          const ativo = filtros.prioridade.has(pr)
          return (
            <button
              key={pr}
              onClick={() => setFiltros((f) => {
                const novo = new Set(f.prioridade)
                if (novo.has(pr)) novo.delete(pr); else novo.add(pr)
                return { ...f, prioridade: novo }
              })}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                ativo
                  ? "border-[var(--action-primary)] bg-[var(--action-primary)]/15 text-white/90"
                  : "border-[var(--border-default)] text-[var(--text-secondary)] hover:text-white/75"
              }`}
            >
              {ROTULO_PRIORIDADE[pr] ?? pr}
            </button>
          )
        })}
        <span className="ml-auto flex items-center gap-1.5">
          <label className="text-[10px] text-[var(--text-muted)]">Ordenar por</label>
          <select
            value={filtros.ordenacao}
            onChange={(e) => setFiltros((f) => ({ ...f, ordenacao: e.target.value as OrdenacaoFamilia }))}
            className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-[10px] text-white/85 outline-none"
          >
            {ORDENACOES.map((o) => <option key={o.chave} value={o.chave}>{o.rotulo}</option>)}
          </select>
        </span>
      </div>

      {/* ── MAIS FILTROS — Prazo/Responsável mais específicos, escondidos até pedidos ── */}
      {maisFiltrosAberto && (
        <div className="flex flex-wrap gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
          {CONDICOES_SECUNDARIAS.map((c) => {
            const ativo = filtros.condicoes.has(c.chave)
            return (
              <button
                key={c.chave}
                onClick={() => alternarCondicao(c.chave)}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  ativo
                    ? "border-[var(--action-primary)] bg-[var(--action-primary)]/15 text-white/90"
                    : "border-[var(--border-default)] text-[var(--text-secondary)] hover:text-white/75"
                }`}
              >
                {c.rotulo}
              </button>
            )
          })}
        </div>
      )}

      {/* ── FASES — do catálogo canônico, nunca hardcoded ── */}
      {dados && dados.fases.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-white/[0.06] pb-2">
          <button
            onClick={() => setFiltros((f) => ({ ...f, fase: null }))}
            className={`rounded px-2.5 py-1 text-[11px] ${filtros.fase == null ? "bg-[var(--surface-primary)] text-white/90" : "text-[var(--text-secondary)] hover:text-white/75"}`}
          >
            Todas as fases
          </button>
          {dados.fases.map((f) => (
            <button
              key={f.phaseKey}
              onClick={() => setFiltros((filt) => ({ ...filt, fase: f.phaseKey }))}
              className={`rounded px-2.5 py-1 text-[11px] ${filtros.fase === f.phaseKey ? "bg-[var(--surface-primary)] text-white/90" : "text-[var(--text-secondary)] hover:text-white/75"}`}
            >
              {f.label}
            </button>
          ))}
          {dados.equipes.length > 0 && (
            <select
              value={filtros.equipe ?? ""}
              onChange={(e) => setFiltros((f) => ({ ...f, equipe: e.target.value || null }))}
              className="ml-auto rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-[10px] text-white/85 outline-none"
              title="Equipe — texto livre do passo (ainda sem cadastro próprio)"
            >
              <option value="">Todas as equipes</option>
              {dados.equipes.map((e) => (
                <option key={e.equipeKey} value={e.equipeKey}>{e.equipeKey} ({e.tarefas})</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* ── RESUMO — os tiles refletem o recorte ativo (condições + fase + busca) ── */}
      {dados && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {tiles.map((t) => (
            <div key={t.chave} className="rounded-md border border-white/[0.06] bg-[var(--surface-secondary)] px-2.5 py-2">
              <div className={`text-[15px] font-semibold tabular-nums ${PONTO_TOM[t.chave] ?? "text-white/85"}`}>
                {dados.indicadores[t.chave] ?? 0}
              </div>
              <div className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">{t.rotulo}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── LISTA ── */}
      {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar a Central Operacional." aoTentar={recarregar} />}
      {carregando && <Estado tipo="carregando" mensagem="Carregando o que precisa ser feito…" />}
      {dados && dados.familias.length === 0 && <Estado tipo="vazio" mensagem="Nada bate com este recorte — tudo limpo por aqui." />}

      {dados && dados.familias.length > 0 && (
        <div className="overflow-hidden rounded-md border border-white/[0.06]">
          {dados.familias.map((f) => {
            const chaveFamilia = f.familiaId != null ? `f:${f.familiaId}` : `p:${f.processos[0]?.processoId}`
            const aberta = expandidas.has(chaveFamilia)
            const umSoProcesso = f.processos.length === 1
            const processoPrincipalId = f.processos[0]?.processoId ?? null
            return (
              <div key={chaveFamilia} className="border-b border-white/[0.05] last:border-b-0">
                <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--surface-primary)]">
                  <button onClick={() => alternarFamilia(chaveFamilia)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span className="w-3 shrink-0 text-[10px] text-[var(--text-muted)]">{aberta ? "▾" : "▸"}</span>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--surface-secondary)] text-[10px] font-medium text-white/80">
                      {iniciais(f.nomeFamilia)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-white/90">{f.nomeFamilia}</span>
                      <span className="block text-[10px] text-[var(--text-muted)]">
                        {/* Família com 1 só processo homônimo (nome do processo ==
                            nome da família): repetir seria título e subtítulo
                            idênticos, sem informação nova. */}
                        {umSoProcesso
                          ? (f.processos[0].nomeProcesso !== f.nomeFamilia ? f.processos[0].nomeProcesso : null)
                          : `${f.processos.length} processos`}
                        {f.pendenciasFaseAnterior > 0 && (
                          <span className="text-amber-800/90"> · {f.pendenciasFaseAnterior} pendência(s) de fase anterior</span>
                        )}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums">
                    <span className="text-white/80">{f.total} tarefas</span>
                    {f.executavelAgora > 0 && <span className="text-white/70">{f.executavelAgora} executáveis</span>}
                    {f.atrasadas > 0 && <span className="text-red-700/90">{f.atrasadas} atrasadas</span>}
                    {f.bloqueadas > 0 && <span className="text-red-700/90">{f.bloqueadas} bloqueadas</span>}
                    {f.semResponsavel > 0 && (
                      <span className="rounded-full bg-[var(--warning-tile)] px-2.5 py-1 font-semibold text-[var(--warning-text)]">
                        {f.semResponsavel} sem responsável
                      </span>
                    )}
                    <span className="hidden text-[var(--text-secondary)] sm:inline">
                      {f.responsavelPrincipal?.nome ?? "Vários"}
                    </span>
                    <span className="hidden text-[var(--text-muted)] md:inline">{dataCurta(f.ultimaAtividade)}</span>
                  </div>
                </div>

                {/* A FAMÍLIA EXPANDE DIRETO NA TABELA RICA — sem o nível
                    intermediário "família → fase → lista" que existia antes
                    (achado do usuário, 25/09/2026: um clique a mais que só
                    atrapalhava, e a lista simples não tinha ação nenhuma —
                    só navegava pra fora). Todas as fases da família juntas,
                    cada linha já mostra a sua na coluna Fase. */}
                {aberta && (
                  <FamiliaTabelaExpandida
                    familiaId={f.familiaId}
                    processoId={processoPrincipalId}
                    nomeFamilia={f.nomeFamilia}
                    escopo={filtros.escopo}
                    filtrosQuery={queryDeFiltros(filtros).toString()}
                    concluidasHoje={f.processos.reduce((soma, p) => soma + (concluidasPorProcesso.get(p.processoId) ?? 0), 0)}
                    selecionado={selecionado?.taskId ?? null}
                    aoSelecionar={(taskId, processoId) => setSelecionado({ taskId, processoId })}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── PAGINAÇÃO — recortada no BACKEND (`/api/operacao/central`), nunca `.slice()` no cliente ── */}
      {dados && dados.paginacao.totalPaginas > 1 && (
        <div className="flex items-center justify-between gap-2 px-1 py-1">
          <span className="text-[11px] text-[var(--text-muted)]">
            {dados.familias.length} de {dados.paginacao.totalFamilias} famílias
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={dados.paginacao.pagina <= 1}
              onClick={() => setPagina((n) => Math.max(1, n - 1))}
              className="rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)] disabled:opacity-40"
            >
              ‹
            </button>
            <span className="text-[11px] tabular-nums text-white/80">{dados.paginacao.pagina} / {dados.paginacao.totalPaginas}</span>
            <button
              disabled={dados.paginacao.pagina >= dados.paginacao.totalPaginas}
              onClick={() => setPagina((n) => n + 1)}
              className="rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)] disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      )}

      {/* ── PAINEL DE DETALHE — a mesma gaveta lateral de Minha Operação, agora
          acionável a partir de QUALQUER família expandida. ── */}
      {selecionado != null && (
        <div className="fixed inset-0 z-[70] flex items-stretch justify-end bg-[var(--overlay-modal)]" onClick={() => setSelecionado(null)}>
          <div
            className="flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--elev-3)]"
            onClick={(e) => e.stopPropagation()}
          >
            <MinhaOperacaoDetalhe taskId={selecionado.taskId} aoFechar={() => setSelecionado(null)} />
          </div>
        </div>
      )}
    </div>
  )
}
