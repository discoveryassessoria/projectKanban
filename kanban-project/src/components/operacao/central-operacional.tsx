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

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"
import { gravarLocal, useJsonLocalStorage } from "@/src/lib/cliente"
import {
  auth, dataCurta, Estado, Etiqueta, ROTULO_PRIORIDADE, rotularFase,
  SeletorResponsavel, type LinhaDeFila,
} from "./kit-operacional"

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
interface LinhaGerencial extends LinhaDeFila {
  venceHoje: boolean
  esperandoDe: "terceiro" | "cliente" | null
  esperandoHaDias: number | null
  motivoBloqueio: string | null
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

const CONDICOES: Array<{ chave: ChaveCondicao; rotulo: string }> = [
  { chave: "executavelAgora", rotulo: "Executável agora" },
  { chave: "atrasadas", rotulo: "Atrasadas" },
  { chave: "venceHoje", rotulo: "Vence hoje" },
  { chave: "proximos7Dias", rotulo: "Próximos 7 dias" },
  { chave: "semResponsavel", rotulo: "Sem responsável" },
  { chave: "bloqueada", rotulo: "Bloqueadas" },
  { chave: "aguardandoTerceiro", rotulo: "Aguardando terceiro" },
  { chave: "semMovimentacao", rotulo: "Sem movimentação (7d)" },
  { chave: "pendenciasFasesAnteriores", rotulo: "Pendências de fases anteriores" },
]

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

function queryDe(f: FiltrosCentral, pagina: number): string {
  const p = new URLSearchParams()
  p.set("escopo", f.escopo)
  if (f.fase) p.set("fase", f.fase)
  if (f.equipe) p.set("equipe", f.equipe)
  if (f.escopo === "tudo" && f.responsavel != null) p.set("responsavel", String(f.responsavel))
  for (const pr of f.prioridade) p.append("prioridade", pr)
  if (f.busca.trim()) p.set("busca", f.busca.trim())
  for (const c of f.condicoes) {
    if (c === "semMovimentacao") p.set("semMovimentacaoDias", "7")
    else p.set(c, "1")
  }
  p.set("ordenacao", f.ordenacao)
  p.set("pagina", String(pagina))
  p.set("porPagina", "30")
  return p.toString()
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "?"
}

const PONTO_TOM: Record<string, string> = {
  executavelAgora: "text-white/80", atrasadas: "text-red-700/90", venceEm7Dias: "text-amber-800/90",
  semResponsavel: "text-[var(--text-secondary)]/90", bloqueadas: "text-red-700/90", aguardandoTerceiro: "text-amber-800/90",
}

export function CentralOperacional() {
  const router = useRouter()
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
  const [fasesAbertas, setFasesAbertas] = useState<Set<string>>(new Set())
  const [tarefasPorFase, setTarefasPorFase] = useState<Map<string, { carregando: boolean; linhas: LinhaGerencial[] | null }>>(new Map())
  const [loteAlvo, setLoteAlvo] = useState<{ familia: FamiliaAgrupada; acao: "atribuir" | "repriorizar" } | null>(null)
  const [loteOcupado, setLoteOcupado] = useState(false)
  const [loteAviso, setLoteAviso] = useState<string | null>(null)

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
  const recarregar = useCallback(() => setRecarga((n) => n + 1), [])

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

  const alternarFase = useCallback((chaveFase: string, familiaId: number | null, processoId: number, faseMacroKey: string) => {
    setFasesAbertas((prev) => {
      const novo = new Set(prev)
      if (novo.has(chaveFase)) novo.delete(chaveFase); else novo.add(chaveFase)
      return novo
    })
    if (tarefasPorFase.has(chaveFase)) return
    setTarefasPorFase((m) => new Map(m).set(chaveFase, { carregando: true, linhas: null }))
    const p = new URLSearchParams({ processo: String(processoId), fase: faseMacroKey, incluirEncerradas: "1", porPagina: "200" })
    if (familiaId != null) p.set("familia", String(familiaId))
    fetch(`/api/operacao/visao-global?${p.toString()}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas: LinhaGerencial[] }) => setTarefasPorFase((m) => new Map(m).set(chaveFase, { carregando: false, linhas: d.linhas })))
      .catch(() => setTarefasPorFase((m) => new Map(m).set(chaveFase, { carregando: false, linhas: null })))
  }, [tarefasPorFase])

  const irParaOProcesso = useCallback((l: LinhaGerencial) => {
    router.push(urlOperacionalDaTarefa({ taskId: l.taskId, processoId: l.processoId }))
  }, [router])

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

  // O LOTE AGE SOBRE O QUE ESTÁ NA TELA AGORA — busca as tarefas da família
  // com o MESMO recorte de filtro ativo, nunca "todas as tarefas que já
  // existiram". Reatribuir/repriorizar, nunca concluir.
  const executarLote = async (novoValor: number | string) => {
    if (!loteAlvo) return
    setLoteOcupado(true)
    setLoteAviso(null)
    try {
      const p = new URLSearchParams(query)
      p.set("familia", String(loteAlvo.familia.familiaId ?? loteAlvo.familia.processos[0]?.processoId ?? ""))
      p.set("porPagina", "500")
      const r = await fetch(`/api/operacao/visao-global?${p.toString()}`, { headers: auth() })
      const d: { linhas: LinhaGerencial[] } = await r.json()
      const tarefaIds = d.linhas.map((l) => l.taskId)
      if (tarefaIds.length === 0) { setLoteAviso("Nenhuma tarefa nesta família com o filtro atual."); setLoteOcupado(false); return }

      const rota = loteAlvo.acao === "atribuir" ? "/api/tarefas/redistribuir" : "/api/tarefas/repriorizar"
      const corpo = loteAlvo.acao === "atribuir"
        ? { tarefaIds, novoResponsavelId: novoValor === "" ? null : Number(novoValor), motivo: "Ação em lote pela Central Operacional" }
        : { tarefaIds, novaPrioridade: novoValor, motivo: "Ação em lote pela Central Operacional" }
      const resp = await fetch(rota, { method: "POST", headers: auth(), body: JSON.stringify(corpo) })
      const res: { total: number; sucesso: number; falha: number } = await resp.json()
      setLoteAviso(`${res.sucesso} de ${res.total} tarefa(s) atualizada(s).${res.falha > 0 ? ` ${res.falha} não puderam mudar.` : ""}`)
      setTarefasPorFase(new Map())
      recarregar()
    } catch {
      setLoteAviso("Não foi possível concluir a ação em lote.")
    } finally {
      setLoteOcupado(false)
    }
  }

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

      {/* ── CONDIÇÕES COMPOSTAS — cada chip é um filtro real, combinável ── */}
      <div className="flex flex-wrap gap-1.5">
        {CONDICOES.map((c) => {
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

      {loteAviso && (
        <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
          {loteAviso}
          <button onClick={() => setLoteAviso(null)} className="ml-2 text-[var(--text-muted)] hover:text-white/70">fechar</button>
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
                        {umSoProcesso ? f.processos[0].nomeProcesso : `${f.processos.length} processos`}
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
                    <span className="hidden text-[var(--text-secondary)] sm:inline">
                      {f.responsavelPrincipal?.nome ?? "Vários"}
                    </span>
                    <span className="hidden text-[var(--text-muted)] md:inline">{dataCurta(f.ultimaAtividade)}</span>
                  </div>
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setLoteAlvo({ familia: f, acao: "atribuir" })}
                      className="rounded border border-[var(--border-default)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
                    >
                      Atribuir
                    </button>
                    <button
                      onClick={() => setLoteAlvo({ familia: f, acao: "repriorizar" })}
                      className="ml-1 rounded border border-[var(--border-default)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
                    >
                      Repriorizar
                    </button>
                  </div>
                </div>

                {aberta && f.processos.map((p) => (
                  <div key={p.processoId} className="bg-[var(--surface-primary)]/30">
                    {!umSoProcesso && (
                      <div className="px-3 py-1.5 pl-9 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        Processo: {p.nomeProcesso} · fase atual: {rotularFase(p.faseAtualKey) ?? "—"}
                      </div>
                    )}
                    {p.fases.map((fa) => {
                      const chaveFase = `${p.processoId}:${fa.faseMacroKey}`
                      const faseAberta = fasesAbertas.has(chaveFase)
                      const carga = tarefasPorFase.get(chaveFase)
                      return (
                        <div key={fa.faseMacroKey}>
                          <button
                            onClick={() => alternarFase(chaveFase, f.familiaId, p.processoId, fa.faseMacroKey)}
                            className="flex w-full items-center gap-2 px-3 py-2 pl-12 text-left hover:bg-[var(--surface-primary)]"
                          >
                            <span className="w-3 shrink-0 text-[9px] text-[var(--text-muted)]">{faseAberta ? "▾" : "▸"}</span>
                            <span className="min-w-0 flex-1 text-[11px] text-[var(--text-secondary)]">{fa.label}</span>
                            <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                              <span
                                className="block h-full rounded-full bg-[var(--action-primary)]"
                                style={{ width: `${fa.total > 0 ? Math.round((fa.concluidas / fa.total) * 100) : 0}%` }}
                              />
                            </span>
                            <span className="w-24 shrink-0 text-right text-[10px] tabular-nums text-[var(--text-muted)]">
                              {fa.concluidas}/{fa.total}
                              {fa.atrasadas > 0 && <span className="text-red-700/90"> · {fa.atrasadas} atr.</span>}
                            </span>
                          </button>
                          {faseAberta && (
                            <div className="pb-1 pl-16 pr-3">
                              {carga?.carregando && <div className="py-2 text-[10px] text-[var(--text-muted)]">Carregando etapas…</div>}
                              {carga && !carga.carregando && (carga.linhas?.length ?? 0) === 0 && (
                                <div className="py-2 text-[10px] text-[var(--text-muted)]">Nenhuma tarefa nesta fase.</div>
                              )}
                              {carga?.linhas?.map((l) => (
                                <button
                                  key={l.taskId}
                                  onClick={() => irParaOProcesso(l)}
                                  className="flex w-full items-center gap-2 border-b border-white/[0.04] py-1.5 text-left last:border-b-0 hover:bg-[var(--surface-primary)]"
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[11px] text-white/85">{l.etapaAtual ?? l.titulo}</span>
                                    <span className="block truncate text-[9px] text-[var(--text-muted)]">
                                      {l.pessoaNome ?? "—"} · {l.responsavelNome ?? "sem responsável"}
                                    </span>
                                  </span>
                                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                                    {l.executavelAgora && <Etiqueta tom="acento">Executável</Etiqueta>}
                                    {l.atrasada && <Etiqueta tom="critico">Atrasada</Etiqueta>}
                                    {!l.atrasada && l.venceHoje && <Etiqueta tom="alerta">Vence hoje</Etiqueta>}
                                    {l.statusTarefa === "BLOQUEADA" && <Etiqueta tom="critico">Bloqueada</Etiqueta>}
                                    {l.esperandoDe && <Etiqueta tom="alerta">Aguardando {l.terceiroNome ?? l.esperandoDe}</Etiqueta>}
                                    {l.aguardandoDependencia && <Etiqueta tom="neutro">Depende de outra</Etiqueta>}
                                    <span className="text-[9px] text-[var(--text-muted)]">{ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade}</span>
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
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

      {loteAlvo && (
        loteAlvo.acao === "atribuir" ? (
          <SeletorResponsavel
            titulo={`Atribuir família "${loteAlvo.familia.nomeFamilia}" (recorte atual)`}
            atual={null}
            ocupado={loteOcupado}
            erro={loteAviso}
            aoEscolher={(id) => { void executarLote(id) }}
            aoFechar={() => setLoteAlvo(null)}
          />
        ) : (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={() => setLoteAlvo(null)}>
            <div
              className="w-full max-w-xs overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--elev-3)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-white/[0.08] px-4 py-3">
                <h2 className="text-[13px] font-medium text-white/90">Repriorizar família "{loteAlvo.familia.nomeFamilia}" (recorte atual)</h2>
              </div>
              <div className="flex flex-col gap-1 p-2">
                {(["URGENTE", "ALTA", "MEDIA", "BAIXA"] as const).map((p) => (
                  <button
                    key={p}
                    disabled={loteOcupado}
                    onClick={() => void executarLote(p)}
                    className="rounded px-3 py-2 text-left text-[12px] text-white/85 transition-colors hover:bg-[var(--surface-primary)] disabled:opacity-40"
                  >
                    {ROTULO_PRIORIDADE[p]}
                  </button>
                ))}
              </div>
              <div className="flex justify-end border-t border-white/[0.08] px-4 py-2.5">
                <button onClick={() => setLoteAlvo(null)} className="rounded px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:text-white/80">Fechar</button>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  )
}
