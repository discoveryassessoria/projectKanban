// src/components/financeiro/v3/ReceitasTab.tsx
// ============================================================================
// ABA "RECEITAS" do Financeiro do Processo — tela executiva (Discovery DS · dark).
// UMA LINHA por Receita CONSOLIDADA (ReceitaGrupo) com subgrid expansível
// "Distribuição Financeira" (participantes financeiros por requerente).
// BRL é a moeda OPERACIONAL; EUR/USD é a BASE contratual com câmbio explícito.
// Fonte única: /api/financeiro/v3/receitas (listarReceitas) — shape AGRUPADO
// (d.kpis + d.receitas: ReceitaGrupo[] + d.processo). O pagamento vive no detalhe.
// ============================================================================
"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRevalidacaoFinanceira, emitirMutacaoFinanceira } from "@/src/lib/financeiro-bus"
import { useRouter } from "next/navigation"
import { LancamentoFinanceiroModal } from "./lancamento/LancamentoFinanceiroModal"
import EditarReceitaView from "./EditarReceitaView"
import EditarDistribuicaoView from "./EditarDistribuicaoView"
import RegistrarPagamentoModal from "./RegistrarPagamentoModal"
import DuplicarReceitaModal from "./DuplicarReceitaModal"
import CancelamentoAvancadoModal from "./CancelamentoAvancadoModal"
import AcaoReceitaModal from "./AcaoReceitaModal"
import ExcluirReceitaModal from "./ExcluirReceitaModal"
import {
  DollarSign, CheckCircle2, Wallet, Users, Layers, Search, RotateCcw,
  Plus, ExternalLink, ChevronDown, ChevronRight, ChevronLeft, MoreVertical,
  AlertTriangle, SlidersHorizontal, Download,
  Pencil, GitBranch, CalendarClock, Copy, CreditCard, Ban, Archive, Trash2, X,
} from "lucide-react"

import { ValorBrl, AvisoNaoConvertido } from "./ValorBrl"
import { authHeaders } from "@/src/lib/financeiro/http"
import { fmtBrl as brl } from "@/src/lib/financeiro/formato"
import { fmtMoeda } from "@/src/lib/financeiro/formato"

const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : null)
const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"

// statusConsolidado/status do backend -> apresentação (label + estado semântico)
const STATUS: Record<string, { label: string; cor: string }> = {
  QUITADO: { label: "Quitado", cor: "var(--success)" },
  PARCIAL: { label: "Parcial", cor: "var(--info)" },
  VENCIDO: { label: "Vencido", cor: "var(--danger)" },
  "A VENCER": { label: "A vencer", cor: "var(--accent-primary)" },
  CANCELADO: { label: "Cancelado", cor: "var(--text-muted)" },
}
const statusView = (s?: string) => STATUS[s ?? ""] ?? { label: s ?? "—", cor: "var(--text-secondary)" }

// pílula de status — cor semântica via color-mix (sem hex/opacidade Tailwind sobre var())
function StatusPill({ st }: { st: { label: string; cor: string } }) {
  return (
    <span className="rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${st.cor} 15%, transparent)`, color: st.cor }}>
      {st.label}
    </span>
  )
}

// mapa statusConsolidado -> aba de status (PARCIAL fica em "A vencer": ainda tem saldo)
const ABA_DE: Record<string, string> = { "A VENCER": "avencer", PARCIAL: "avencer", VENCIDO: "vencidas", QUITADO: "pagas", CANCELADO: "canceladas" }
const ABAS: [string, string][] = [["todas", "Todas"], ["avencer", "A vencer"], ["vencidas", "Vencidas"], ["pagas", "Pagas"], ["canceladas", "Canceladas"]]
const PAGE = 10

interface Participante {
  obrigacaoId: number; receitaId: number | null; nome: string; papel: string
  valorBase: number; moedaBase: string; cotacao: number | null; tipoCambio: string
  valorContratadoBrl: number; recebidoBrl: number; saldoBrl: number; aVencerBrl: number; vencidoBrl: number
  naoConvertido?: number
  proximoVencimento: string | null; status: string; parcelas: number; parcelasRecebidas: number
}
interface Grupo {
  id: number; codigo: string | null; descricao: string | null; servico: string | null
  moedaBase: string; valorBaseTotal: number | null; valorContratadoBrlTotal: number
  recebidoBrlTotal: number; saldoBrlTotal: number; aVencerBrlTotal: number; vencidoBrlTotal: number
  naoConvertidoTotal?: number
  proximoVencimento: string | null; statusConsolidado: string; participantesCount: number; participantes: Participante[]
}

// ações rápidas de estado disponíveis no menu "3 pontos" de cada linha
type AcaoRow = "editar" | "distribuicao" | "vencimento" | "pagamento" | "duplicar" | "cancelar" | "arquivar" | "excluir"

export function ReceitasTab({ processoId, onAbrirDetalhe }: { processoId?: number; onAbrirDetalhe?: (id: number) => void }) {
  const router = useRouter()
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState("")
  const [aba, setAba] = useState("todas")
  const [page, setPage] = useState(1)
  const [expandido, setExpandido] = useState<Set<number>>(new Set())
  const [novo, setNovo] = useState(false)
  // ação rápida de estado disparada no menu "3 pontos" de uma linha (Receita consolidada).
  // O modal/editor correspondente vive no fim da árvore (renderiza só o alvo por vez).
  const [acao, setAcao] = useState<{ tipo: AcaoRow; g: Grupo } | null>(null)
  // Após uma ação da lista, a receita pode mudar de situação (ex.: alterar vencimento
  // → aging VENCIDO→A VENCER) e sair da aba filtrada. Em vez de "sumir" em silêncio,
  // avisamos e oferecemos "Ver em Todas" — o filtro do operador é preservado.
  const [movida, setMovida] = useState<{ id: number; nome: string } | null>(null)

  const carregar = useCallback(() => {
    setLoading(true); setErro(null)
    fetch(`/api/financeiro/v3/receitas${processoId ? `?processoId=${processoId}` : ""}`, { headers: authHeaders() })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j) => setD(j))
      .catch(() => setErro("Não foi possível carregar as receitas."))
      .finally(() => setLoading(false))
  }, [processoId])

  // MONTAGEM/troca de processo: busca no efeito, estado só na continuação.
  useEffect(() => {
    const ac = new AbortController()
    fetch(`/api/financeiro/v3/receitas${processoId ? `?processoId=${processoId}` : ""}`, { headers: authHeaders(), signal: ac.signal })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j) => { if (!ac.signal.aborted) setD(j) })
      .catch(() => { if (!ac.signal.aborted) setErro("Não foi possível carregar as receitas.") })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [processoId])

  // Paginação e aviso "saiu da aba" são DERIVADOS da busca/aba: ajuste de estado
  // durante o render, sem efeito.
  const [filtroPaginado, setFiltroPaginado] = useState(`${busca}|${aba}`)
  if (filtroPaginado !== `${busca}|${aba}`) {
    setFiltroPaginado(`${busca}|${aba}`)
    setPage(1)
    setMovida(null)
  }
  // Revalidação automática: recarrega a lista quando QUALQUER mutação financeira ocorre
  // (registrar pagamento, editar, redistribuir, estornar, arquivar…) — sem recarregar a página.
  useRevalidacaoFinanceira(carregar)

  // Memorizado: é dependência dos cálculos de contagem/filtro abaixo.
  const grupos: Grupo[] = useMemo(() => d?.receitas ?? [], [d])
  const k = d?.kpis ?? {}
  const nomeProc = d?.processo?.nome ?? d?.processo?.codigo ?? "deste processo"

  const abrir = (id: number) => (onAbrirDetalhe ? onAbrirDetalhe(id) : router.push(`/financeiro/v3/receita/${id}`))
  const toggle = (id: number) => setExpandido((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // conclusão padrão de uma ação da lista: fecha o modal, recarrega, propaga no bus e
  // passa a observar a receita (para avisar caso ela saia da aba filtrada após a mutação).
  const aoConcluir = useCallback((g: Grupo) => {
    setAcao(null); carregar(); emitirMutacaoFinanceira()
    setMovida({ id: g.id, nome: g.descricao ?? g.codigo ?? `#${g.id}` })
  }, [carregar])

  // contagem por aba (sobre TODOS os grupos, independente da busca)
  const contagem = useMemo(() => {
    const c: Record<string, number> = { todas: grupos.length, avencer: 0, vencidas: 0, pagas: 0, canceladas: 0 }
    for (const g of grupos) { const a = ABA_DE[g.statusConsolidado]; if (a) c[a] = (c[a] ?? 0) + 1 }
    return c
  }, [grupos])

  const filtrados = useMemo(() => grupos.filter((g) => {
    if (aba !== "todas" && ABA_DE[g.statusConsolidado] !== aba) return false
    if (busca.trim()) {
      const q = busca.toLowerCase()
      const campos = [g.descricao, g.codigo, g.servico, ...g.participantes.map((p) => p.nome)]
      if (!campos.filter(Boolean).some((s) => String(s).toLowerCase().includes(q))) return false
    }
    return true
  }), [grupos, aba, busca])

  const totalPag = Math.max(1, Math.ceil(filtrados.length / PAGE))
  const pagina = filtrados.slice((page - 1) * PAGE, page * PAGE)
  const limpar = () => { setBusca(""); setAba("todas") }
  // Mostra o aviso só quando a receita observada AINDA existe (não foi excluída) mas saiu
  // da aba filtrada atual — o caso do "sumiu após alterar o vencimento".
  const movidaForaDoFiltro = movida != null && aba !== "todas"
    && grupos.some((g) => g.id === movida.id) && !filtrados.some((g) => g.id === movida.id)

  const exportarCsv = () => {
    const head = ["ID", "Codigo", "Receita", "Servico", "ValorBase", "MoedaBase", "ContratadoBRL", "RecebidoBRL", "SaldoBRL", "ProximoVencimento", "Status", "Participantes"]
    const linhas = filtrados.map((g) => [g.id, g.codigo ?? "", g.descricao ?? "", g.servico ?? "", g.valorBaseTotal ?? "", g.moedaBase, g.valorContratadoBrlTotal, g.recebidoBrlTotal, g.saldoBrlTotal, dataBR(g.proximoVencimento) ?? "", statusView(g.statusConsolidado).label, g.participantes.map((p) => p.nome).join("; ")])
    const csv = [head, ...linhas].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a"); a.href = url; a.download = `receitas${processoId ? `-${processoId}` : ""}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  // ── estados ──────────────────────────────────────────────────────────────
  if (loading && !d) return <SkeletonTela />
  if (erro) return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-10 text-center">
      <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-[var(--danger)]" />
      <div className="text-sm text-[var(--text-secondary)]">{erro}</div>
      <button onClick={carregar} className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-hover)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-active)]"><RotateCcw className="h-4 w-4" /> Tentar novamente</button>
    </div>
  )

  return (
    <div className="min-w-0">
      {/* Breadcrumb */}
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
        Processos <span className="text-[var(--text-muted)]">›</span> <span className="text-[var(--text-secondary)]">{nomeProc}</span> <span className="text-[var(--text-muted)]">›</span> Financeiro <span className="text-[var(--text-muted)]">›</span> <span className="text-[var(--text-secondary)]">Receitas</span>
      </div>
      {/* Cabeçalho */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--text-primary)]">Receitas</h1>
          <p className="text-sm text-[var(--text-muted)]">Receitas consolidadas do processo {nomeProc}, com a distribuição por participante financeiro.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportarCsv} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-hover)] px-3.5 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-active)]"><Download className="h-4 w-4" /> Exportar</button>
          <button onClick={() => setNovo(true)} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--info)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:brightness-110"><Plus className="h-4 w-4" /> Nova Receita</button>
        </div>
      </div>

      {/* 5 CARDS */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Card titulo="Receitas" valor={String(k.receitas ?? 0)} icon={Layers} cor="var(--text-secondary)" sub="Total de receitas" />
        <Card titulo="Participantes financeiros" valor={String(k.participantesFinanceiros ?? 0)} icon={Users} cor="var(--text-secondary)" sub="Responsáveis pelo pagamento" />
        <Card titulo="Valor contratado" valor={brl(k.totalContratadoBrl ?? 0)} icon={DollarSign} cor="var(--text-secondary)" sub="Total contratado (BRL)" />
        <Card titulo="Recebido" valor={brl(k.recebidoBrl ?? 0)} icon={CheckCircle2} cor="var(--success)" valorCor={(k.recebidoBrl ?? 0) > 0 ? "text-[var(--success)]" : undefined} sub="Total recebido (BRL)" />
        <Card titulo="Saldo" valor={brl(k.saldoBrl ?? 0)} icon={Wallet} cor="var(--info)" valorCor="text-[var(--info)]" sub="Total em aberto" />
      </div>
      <AvisoNaoConvertido className="mt-2" quantidade={grupos.filter((g) => Number(g.naoConvertidoTotal ?? 0) > 0).length} />

      {/* TABELA */}
      <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)]">
        {/* Abas de status + busca */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] px-5 pt-4">
          <div className="flex items-center gap-6">
            {ABAS.map(([id, label]) => (
              <button key={id} onClick={() => setAba(id)} className={`-mb-px border-b-2 pb-3 text-sm ${aba === id ? "border-[var(--accent-primary)] font-medium text-[var(--accent-primary)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-secondary)]"}`}>
                {label} ({contagem[id] ?? 0})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar receita, serviço, participante…" className="w-[260px] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] py-1.5 pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--info)]" />
            </div>
            <button disabled title="Filtros avançados indisponíveis — use a busca ao lado" className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--surface-secondary)]"><SlidersHorizontal className="h-3.5 w-3.5" /> Filtros</button>
            <button onClick={limpar} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><RotateCcw className="h-3.5 w-3.5" /> Limpar filtros</button>
          </div>
        </div>

        {movidaForaDoFiltro && movida && (
          <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--info)] bg-[var(--surface-secondary)] px-4 py-2.5 text-sm text-[var(--text-secondary)]">
            <span>A receita <span className="font-medium text-[var(--text-primary)]">{movida.nome}</span> mudou de situação e saiu deste filtro.</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setAba("todas")} className="rounded-[var(--radius-sm)] border border-[var(--info)] px-2.5 py-1 text-xs font-medium text-[var(--info)] hover:bg-[var(--surface-hover)]">Ver em Todas</button>
              <button onClick={() => setMovida(null)} title="Dispensar" className="rounded-[var(--radius-sm)] p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"><X className="h-4 w-4" /></button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] table-fixed text-sm">
            <colgroup>
              <col className="w-10" />
              <col className="min-w-[240px]" />
              <col className="w-[152px]" />
              <col className="w-[132px]" />
              <col className="w-[132px]" />
              <col className="w-[116px]" />
              <col className="w-[136px]" />
              <col className="w-[116px]" />
              <col className="w-[72px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-[var(--border-default)] text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                <th className="px-3 py-3" />
                <th className="px-4 py-3 text-left font-medium">Receita</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3 text-right font-medium">Recebido</th>
                <th className="px-4 py-3 text-right font-medium">Saldo</th>
                <th className="px-4 py-3 text-center font-medium">Vencimento</th>
                <th className="px-4 py-3 text-center font-medium">Participantes</th>
                <th className="px-4 py-3 text-center font-medium">Situação</th>
                <th className="px-3 py-3 text-center font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={9} className="px-5 py-14 text-center">
                  <div className="text-sm font-medium text-[var(--text-secondary)]">Nenhuma receita cadastrada</div>
                  <div className="mt-1 text-sm text-[var(--text-muted)]">Crie a primeira receita deste processo.</div>
                  <button onClick={() => setNovo(true)} className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--info)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:brightness-110"><Plus className="h-4 w-4" /> Nova Receita</button>
                </td></tr>
              ) : (
                pagina.map((g) => (
                  <LinhaGrupo key={g.id} g={g} aberto={expandido.has(g.id)} onToggle={() => toggle(g.id)} onAbrir={() => abrir(g.id)} onAbrirParticipante={abrir} onAcao={(tipo) => setAcao({ tipo, g })} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* rodapé + paginação */}
        {filtrados.length > 0 && (
          <div className="flex items-center justify-between border-t border-[var(--border-default)] px-5 py-4 text-sm text-[var(--text-muted)]">
            <span>Mostrando {Math.min((page - 1) * PAGE + 1, filtrados.length)}–{Math.min(page * PAGE, filtrados.length)} de {filtrados.length} registro{filtrados.length === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border border-[var(--border-default)] p-1.5 text-[var(--text-secondary)] disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              <span className="rounded border px-2.5 py-1 text-xs" style={{ borderColor: "color-mix(in srgb, var(--accent-primary) 40%, transparent)", background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)", color: "var(--accent-primary)" }}>{page} / {totalPag}</span>
              <button disabled={page >= totalPag} onClick={() => setPage((p) => p + 1)} className="rounded border border-[var(--border-default)] p-1.5 text-[var(--text-secondary)] disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </div>

      {novo && processoId != null && <LancamentoFinanceiroModal natureza="RECEITA" processoId={processoId} onClose={() => setNovo(false)} onCriado={(r) => { setNovo(false); carregar(); if (r?.obrigacaoRef) abrir(r.obrigacaoRef) }} />}

      {/* ── ações rápidas de estado (reuso de fluxos já prontos; cada onDone recarrega a lista) ── */}
      {acao?.tipo === "editar" && (
        <EditarReceitaView obrigacaoId={acao.g.id} receitaRef={String(acao.g.id)} natureza="RECEITA" onClose={() => setAcao(null)} onDone={() => aoConcluir(acao.g)} />
      )}
      {acao?.tipo === "vencimento" && (
        <EditarReceitaView obrigacaoId={acao.g.id} receitaRef={String(acao.g.id)} natureza="RECEITA" onClose={() => setAcao(null)} onDone={() => aoConcluir(acao.g)} />
      )}
      {acao?.tipo === "distribuicao" && (
        <EditarDistribuicaoView obrigacaoId={acao.g.id} receitaRef={String(acao.g.id)} onClose={() => setAcao(null)} onDone={() => aoConcluir(acao.g)} />
      )}
      {acao?.tipo === "pagamento" && (
        <RegistrarPagamentoModal obrigacaoId={acao.g.id} moeda={acao.g.moedaBase} saldo={acao.g.saldoBrlTotal} natureza="RECEITA" onClose={() => setAcao(null)} onDone={() => aoConcluir(acao.g)} />
      )}
      {acao?.tipo === "duplicar" && (
        <DuplicarReceitaModal receitaRef={String(acao.g.id)} onClose={() => setAcao(null)} onDone={(novoId) => { aoConcluir(acao.g); if (novoId) abrir(novoId) }} />
      )}
      {acao?.tipo === "cancelar" && (
        <CancelamentoAvancadoModal receitaRef={String(acao.g.id)} onClose={() => setAcao(null)} onDone={() => aoConcluir(acao.g)} />
      )}
      {acao?.tipo === "arquivar" && (
        <AcaoReceitaModal acao="arquivar" receitaRef={String(acao.g.id)} natureza="RECEITA" onClose={() => setAcao(null)} onDone={() => aoConcluir(acao.g)} />
      )}
      {acao?.tipo === "excluir" && (
        <ExcluirReceitaModal receitaRef={String(acao.g.id)} onClose={() => setAcao(null)} onDone={() => aoConcluir(acao.g)} />
      )}
    </div>
  )
}

// ── linha do grupo (Receita consolidada) + subgrid ───────────────────────────
function LinhaGrupo({ g, aberto, onToggle, onAbrir, onAbrirParticipante, onAcao }: { g: Grupo; aberto: boolean; onToggle: () => void; onAbrir: () => void; onAbrirParticipante: (id: number) => void; onAcao: (tipo: AcaoRow) => void }) {
  const st = statusView(g.statusConsolidado)
  const cotacao = g.participantes[0]?.cotacao ?? null
  const nomes = g.participantes.map((p) => p.nome)
  const nomesFull = nomes.join(", ") || "—"
  const primeiroNome = nomes[0] ?? "—"
  const vencido = g.statusConsolidado === "VENCIDO"
  const temBase = g.valorBaseTotal != null && g.moedaBase !== "BRL"
  return (
    <>
      {/* Clique na linha (ou no nome) abre o DETALHE. Seta só expande a distribuição. */}
      <tr className={`border-t border-[var(--border-default)] cursor-pointer align-middle ${aberto ? "bg-[var(--surface-active)]" : "hover:bg-[var(--surface-hover)]"}`} onClick={onAbrir}>
        <td className="px-3 py-3.5 align-middle" onClick={(e) => e.stopPropagation()}>
          <button onClick={onToggle} title={aberto ? "Ocultar distribuição" : "Ver distribuição"} className="grid h-6 w-6 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]">
            {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-4 py-3.5 align-middle">
          <div className="truncate font-semibold text-[var(--text-primary)]" title={g.descricao ?? g.codigo ?? undefined}>{g.descricao ?? g.codigo ?? "Receita"}</div>
          <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]" title={[g.codigo, g.servico].filter(Boolean).join(" · ")}>{[g.codigo, g.servico].filter(Boolean).join(" · ") || "—"}</div>
        </td>
        <td className="px-4 align-middle text-right">
          <div className="font-semibold tabular-nums text-[var(--text-primary)]"><ValorBrl valor={g.valorContratadoBrlTotal} naoConvertido={g.naoConvertidoTotal} moeda={g.moedaBase} /></div>
          {temBase && <div className="mt-0.5 truncate text-[11px] tabular-nums text-[var(--text-muted)]" title={cotacao != null ? `Câmbio ${brl(cotacao)}` : undefined}>{fmtMoeda(g.valorBaseTotal as number, g.moedaBase)}{cotacao != null ? ` · ${brl(cotacao)}` : ""}</div>}
        </td>
        <td className="px-4 align-middle text-right tabular-nums"><span className={(g.recebidoBrlTotal ?? 0) > 0 ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}>{brl(g.recebidoBrlTotal)}</span></td>
        <td className="px-4 align-middle text-right tabular-nums text-[var(--info)]">{brl(g.saldoBrlTotal)}</td>
        <td className="px-4 align-middle text-center text-[13px]"><span className={vencido ? "font-medium text-[var(--danger)]" : "text-[var(--text-secondary)]"}>{dataBR(g.proximoVencimento) ?? <span className="text-[var(--text-muted)]">—</span>}</span></td>
        <td className="px-4 align-middle">
          <div className="flex items-center justify-center gap-1.5" title={nomesFull}>
            <span className="inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "color-mix(in srgb, var(--text-secondary) 15%, transparent)", color: "var(--text-secondary)" }}><Users className="h-3 w-3" />{g.participantesCount}</span>
            {/* nome só quando há UM participante (evita "primeiro de N" cortado e confuso) */}
            {g.participantesCount === 1 && <span className="max-w-[84px] truncate text-[11px] text-[var(--text-muted)]">{primeiroNome}</span>}
          </div>
        </td>
        <td className="px-4 align-middle text-center"><StatusPill st={st} /></td>
        <td className="px-3 align-middle text-center" onClick={(e) => e.stopPropagation()}>
          <RowMenu onAbrir={onAbrir} onToggle={onToggle} aberto={aberto} codigo={g.codigo} onAcao={onAcao} saldo={g.saldoBrlTotal} statusConsolidado={g.statusConsolidado} />
        </td>
      </tr>

      {aberto && (
        <tr className="border-t border-[var(--border-default)] bg-[var(--surface-primary)]">
          <td className="px-3 py-4" />
          <td colSpan={8} className="px-4 py-4 pr-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--text-secondary)]" style={{ background: "color-mix(in srgb, var(--text-secondary) 15%, transparent)" }}><Users className="h-4 w-4" /></span>
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">Distribuição Financeira</div>
                <div className="text-[11px] text-[var(--text-muted)]">Responsáveis pelo pagamento desta receita</div>
              </div>
            </div>
            <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)]">
              <table className="w-full min-w-[900px] table-fixed text-sm">
                <colgroup>
                  <col className="min-w-[220px]" /><col className="w-[130px]" /><col className="w-[150px]" />
                  <col className="w-[130px]" /><col className="w-[130px]" /><col className="w-[116px]" />
                  <col className="w-[116px]" /><col className="w-[64px]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-[var(--border-default)] text-[10.5px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-4 py-2.5 text-left font-medium">Participante</th>
                    <th className="px-4 py-2.5 text-right font-medium">Valor base</th>
                    <th className="px-4 py-2.5 text-right font-medium">Contratado (BRL)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Recebido</th>
                    <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                    <th className="px-4 py-2.5 text-center font-medium">Vencimento</th>
                    <th className="px-4 py-2.5 text-center font-medium">Situação</th>
                    <th className="px-3 py-2.5 text-center font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {g.participantes.map((p) => {
                    const pst = statusView(p.status)
                    return (
                      <tr key={p.obrigacaoId} className="cursor-pointer border-t border-[var(--border-default)] align-middle hover:bg-[var(--surface-hover)]" onClick={() => onAbrirParticipante(p.obrigacaoId)}>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-2.5">
                            <span className="grid h-8 w-8 flex-none place-items-center rounded-full text-[11px] font-semibold text-[var(--text-secondary)]" style={{ background: "color-mix(in srgb, var(--text-secondary) 15%, transparent)" }}>{iniciais(p.nome)}</span>
                            <div className="min-w-0">
                              <div className="truncate text-[var(--text-primary)]" title={p.nome}>{p.nome}</div>
                              <div className="truncate text-[11px] text-[var(--text-muted)]">{p.papel}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 align-middle text-right tabular-nums text-[var(--text-primary)]">{p.moedaBase !== "BRL" ? fmtMoeda(p.valorBase, p.moedaBase) : <span className="text-[var(--text-muted)]">—</span>}</td>
                        <td className="px-4 align-middle text-right font-semibold tabular-nums text-[var(--text-primary)]"><ValorBrl valor={p.valorContratadoBrl} naoConvertido={p.naoConvertido} moeda={p.moedaBase} /></td>
                        <td className="px-4 align-middle text-right tabular-nums">
                          <div className={(p.recebidoBrl ?? 0) > 0 ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}>{brl(p.recebidoBrl)}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">{p.parcelasRecebidas ?? 0} parc.</div>
                        </td>
                        <td className="px-4 align-middle text-right tabular-nums">
                          <div className="text-[var(--info)]">{brl(p.saldoBrl)}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">{p.parcelas ?? 0} parc.</div>
                        </td>
                        <td className="px-4 align-middle text-center text-[13px] text-[var(--text-secondary)]">{dataBR(p.proximoVencimento) ?? <span className="text-[var(--text-muted)]">—</span>}</td>
                        <td className="px-4 align-middle text-center"><StatusPill st={pst} /></td>
                        <td className="px-3 align-middle text-center">
                          <button onClick={(e) => { e.stopPropagation(); onAbrirParticipante(p.obrigacaoId) }} title="Abrir participante" className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"><ExternalLink className="h-4 w-4" /></button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── menu de ações secundárias (3 pontos) ────────────────────────────────────
// Portal p/ o body: a tabela vive em overflow-x-auto (que recorta o eixo Y) e
// dentro do modal do processo (z-9999) — o dropdown precisa escapar de ambos.
function RowMenu({ onAbrir, onToggle, aberto, codigo, onAcao, saldo, statusConsolidado }: { onAbrir: () => void; onToggle: () => void; aberto: boolean; codigo: string | null; onAcao: (tipo: AcaoRow) => void; saldo: number; statusConsolidado: string }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
  }, [open])
  const semSaldo = (saldo ?? 0) <= 0            // Registrar Pagamento sem alvo → desabilita
  const cancelado = statusConsolidado === "CANCELADO"  // já cancelada → não recancelar
  // dispara a ação no nível da tabela e fecha o menu (portal) — modais coexistem no fim da árvore
  const fire = (tipo: AcaoRow) => { setOpen(false); onAcao(tipo) }
  return (
    <>
      <button ref={btnRef} onClick={() => setOpen((o) => !o)} title="Ações" className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"><MoreVertical className="h-4 w-4" /></button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[10049]" onClick={() => setOpen(false)} />
          <div className="fixed z-[10050] max-h-[70vh] w-56 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-popover)] py-1 text-left shadow-[var(--shadow-surface)]" style={{ top: pos.top, right: pos.right }}>
            <MenuItem icon={<ExternalLink className="h-4 w-4" />} onClick={() => { setOpen(false); onAbrir() }}>Abrir detalhe</MenuItem>
            <MenuItem icon={<Users className="h-4 w-4" />} onClick={() => { setOpen(false); onToggle() }}>{aberto ? "Ocultar" : "Ver"} distribuição</MenuItem>
            {codigo && <MenuItem icon={<Layers className="h-4 w-4" />} onClick={() => { setOpen(false); navigator.clipboard?.writeText(codigo).catch(() => {}) }}>Copiar código</MenuItem>}

            <MenuDivider />
            <MenuLabel>Gestão</MenuLabel>
            <MenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => fire("editar")}>Editar Receita</MenuItem>
            <MenuItem icon={<GitBranch className="h-4 w-4" />} onClick={() => fire("distribuicao")}>Editar Distribuição</MenuItem>
            <MenuItem icon={<CalendarClock className="h-4 w-4" />} onClick={() => fire("vencimento")}>Alterar Vencimento</MenuItem>
            <MenuItem icon={<Copy className="h-4 w-4" />} onClick={() => fire("duplicar")}>Duplicar Receita</MenuItem>

            <MenuDivider />
            <MenuLabel>Cobrança</MenuLabel>
            <MenuItem icon={<CreditCard className="h-4 w-4" />} disabled={semSaldo} title={semSaldo ? "Sem saldo em aberto" : undefined} onClick={() => fire("pagamento")}>Registrar Pagamento</MenuItem>

            <MenuDivider />
            <MenuLabel>Encerramento</MenuLabel>
            <MenuItem icon={<Ban className="h-4 w-4" />} disabled={cancelado} title={cancelado ? "Receita já cancelada" : undefined} onClick={() => fire("cancelar")}>Cancelar Receita</MenuItem>
            <MenuItem icon={<Archive className="h-4 w-4" />} onClick={() => fire("arquivar")}>Arquivar</MenuItem>
            <MenuItem icon={<Trash2 className="h-4 w-4" />} danger onClick={() => fire("excluir")}>Excluir Receita</MenuItem>
          </div>
        </>, document.body)}
    </>
  )
}
function MenuItem({ icon, onClick, children, disabled, title, danger }: { icon: React.ReactNode; onClick: () => void; children: React.ReactNode; disabled?: boolean; title?: string; danger?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"}`}
    >{icon}{children}</button>
  )
}
function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{children}</div>
}
function MenuDivider() {
  return <div className="my-1 border-t border-[var(--border-default)]" />
}

// ── cards ─────────────────────────────────────────────────────────────────────
function Card({ titulo, valor, sub, icon: Icon, cor, valorCor }: { titulo: string; valor: string; sub: React.ReactNode; icon: any; cor: string; valorCor?: string }) {
  return (
    <div className="flex flex-col rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{titulo}</span>
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[var(--radius-sm)]" style={{ background: `color-mix(in srgb, ${cor} 15%, transparent)`, color: cor }}><Icon className="h-4 w-4" /></span>
      </div>
      <div className={`mt-2 text-[22px] font-bold leading-tight ${valorCor ?? "text-[var(--text-primary)]"}`}>{valor}</div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">{sub}</div>
    </div>
  )
}

// ── skeleton ────────────────────────────────────────────────────────────────
function SkeletonTela() {
  return (
    <div className="animate-pulse">
      <div className="mb-5 h-8 w-40 rounded bg-[var(--surface-hover)]" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[104px] rounded-[var(--radius-md)] bg-[var(--surface-primary)]" />)}
      </div>
      <div className="mt-5 h-96 rounded-[var(--radius-md)] bg-[var(--surface-primary)]" />
    </div>
  )
}
