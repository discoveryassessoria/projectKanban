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

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRevalidacaoFinanceira } from "@/src/lib/financeiro-bus"
import { useRouter } from "next/navigation"
import { LancamentoManualModal } from "./LancamentoManualModal"
import {
  DollarSign, CheckCircle2, Wallet, Users, Layers, Search, RotateCcw,
  Plus, ExternalLink, ChevronDown, ChevronRight, ChevronLeft, MoreVertical,
  AlertTriangle, SlidersHorizontal, Download,
} from "lucide-react"

import { ValorBrl, AvisoNaoConvertido } from "./ValorBrl"

const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0)
const fmtMoeda = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m || "BRL" }).format(v || 0)
const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : null)
const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"

// statusConsolidado/status do backend -> apresentação (label + estado semântico)
const STATUS: Record<string, { label: string; cor: string }> = {
  QUITADO: { label: "Quitado", cor: "var(--success)" },
  PARCIAL: { label: "Parcial", cor: "var(--info)" },
  VENCIDO: { label: "Vencido", cor: "var(--danger)" },
  "A VENCER": { label: "A vencer", cor: "var(--accent-primary)" },
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
const ABA_DE: Record<string, string> = { "A VENCER": "avencer", PARCIAL: "avencer", VENCIDO: "vencidas", QUITADO: "pagas" }
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

  const carregar = () => {
    setLoading(true); setErro(null)
    fetch(`/api/financeiro/v3/receitas${processoId ? `?processoId=${processoId}` : ""}`, { headers: authHeaders() })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j) => setD(j))
      .catch(() => setErro("Não foi possível carregar as receitas."))
      .finally(() => setLoading(false))
  }
  useEffect(() => { carregar() }, [processoId])
  useEffect(() => { setPage(1) }, [busca, aba])
  // Revalidação automática: recarrega a lista quando QUALQUER mutação financeira ocorre
  // (registrar pagamento, editar, redistribuir, estornar, arquivar…) — sem recarregar a página.
  useRevalidacaoFinanceira(useCallback(() => carregar(), [processoId]))

  const grupos: Grupo[] = d?.receitas ?? []
  const k = d?.kpis ?? {}
  const nomeProc = d?.processo?.nome ?? d?.processo?.codigo ?? "deste processo"

  const abrir = (id: number) => (onAbrirDetalhe ? onAbrirDetalhe(id) : router.push(`/financeiro/v3/receita/${id}`))
  const toggle = (id: number) => setExpandido((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

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

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border-default)] text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                <th className="w-8 px-3 py-3" />
                {["Receita", "Serviço", "Valor-base (EUR)", "Valor contratado (BRL)", "Recebido (BRL)", "Saldo (BRL)", "Próximo vencimento", "Participantes", "Status", "Ações"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={11} className="px-5 py-14 text-center">
                  <div className="text-sm font-medium text-[var(--text-secondary)]">Nenhuma receita cadastrada</div>
                  <div className="mt-1 text-sm text-[var(--text-muted)]">Crie a primeira receita deste processo.</div>
                  <button onClick={() => setNovo(true)} className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--info)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:brightness-110"><Plus className="h-4 w-4" /> Nova Receita</button>
                </td></tr>
              ) : (
                pagina.map((g) => (
                  <LinhaGrupo key={g.id} g={g} aberto={expandido.has(g.id)} onToggle={() => toggle(g.id)} onAbrir={() => abrir(g.id)} onAbrirParticipante={abrir} />
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

      {novo && processoId != null && <LancamentoManualModal natureza="RECEITA" processoId={processoId} onClose={() => setNovo(false)} onCriado={(r) => { setNovo(false); carregar(); if (r?.obrigacaoRef) abrir(r.obrigacaoRef) }} />}
    </div>
  )
}

// ── linha do grupo (Receita consolidada) + subgrid ───────────────────────────
function LinhaGrupo({ g, aberto, onToggle, onAbrir, onAbrirParticipante }: { g: Grupo; aberto: boolean; onToggle: () => void; onAbrir: () => void; onAbrirParticipante: (id: number) => void }) {
  const st = statusView(g.statusConsolidado)
  const cotacao = g.participantes[0]?.cotacao ?? null
  const nomes = g.participantes.map((p) => p.nome)
  const nomesLabel = nomes.length <= 2 ? nomes.join(", ") : `${nomes[0]} + ${nomes.length - 1}`
  return (
    <>
      <tr className={`border-t border-[var(--border-default)] cursor-pointer ${aberto ? "bg-[var(--surface-active)]" : "hover:bg-[var(--surface-hover)]"}`} onClick={onToggle}>
        <td className="px-3 py-3.5 align-top">
          <button onClick={(e) => { e.stopPropagation(); onToggle() }} className="grid h-6 w-6 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]">
            {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-4 py-3.5 align-top">
          <div className="flex items-center gap-2">
            <span className="max-w-[220px] truncate font-semibold text-[var(--text-primary)]">{g.descricao ?? g.codigo ?? "Receita"}</span>
            <span className="flex-none rounded bg-[var(--surface-active)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">ID {g.id}</span>
          </div>
          {g.codigo && <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{g.codigo}</div>}
        </td>
        <td className="px-4 align-top text-[var(--text-secondary)]">{g.servico ?? "—"}</td>
        <td className="px-4 align-top">
          {g.valorBaseTotal != null && g.moedaBase !== "BRL" ? (
            <div>
              <div className="text-[var(--text-primary)]">{fmtMoeda(g.valorBaseTotal, g.moedaBase)}</div>
              {cotacao != null && <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">Câmbio: {brl(cotacao)}</div>}
            </div>
          ) : <span className="text-[var(--text-muted)]">—</span>}
        </td>
        <td className="px-4 align-top font-semibold text-[var(--text-primary)]"><ValorBrl valor={g.valorContratadoBrlTotal} naoConvertido={g.naoConvertidoTotal} moeda={g.moedaBase} /></td>
        <td className="px-4 align-top"><span className={(g.recebidoBrlTotal ?? 0) > 0 ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}>{brl(g.recebidoBrlTotal)}</span></td>
        <td className="px-4 align-top text-[var(--info)]">{brl(g.saldoBrlTotal)}</td>
        <td className="px-4 align-top text-[var(--text-secondary)]">{dataBR(g.proximoVencimento) ?? <span className="text-[var(--text-muted)]">Não definido</span>}</td>
        <td className="px-4 align-top">
          <div className="inline-flex flex-col gap-0.5">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "color-mix(in srgb, var(--text-secondary) 15%, transparent)", color: "var(--text-secondary)" }}><Users className="h-3 w-3" /> {g.participantesCount}</span>
            <span className="max-w-[150px] truncate text-[11px] text-[var(--text-muted)]">{nomesLabel}</span>
          </div>
        </td>
        <td className="px-4 align-top"><StatusPill st={st} /></td>
        <td className="px-4 align-top">
          <div className="flex items-center gap-1.5">
            <button onClick={(e) => { e.stopPropagation(); onAbrir() }} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-active)]"><ExternalLink className="h-3.5 w-3.5" /> Abrir</button>
            <button onClick={(e) => { e.stopPropagation(); onToggle() }} title="Ver distribuição" className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"><MoreVertical className="h-4 w-4" /></button>
          </div>
        </td>
      </tr>

      {aberto && (
        <tr className="border-t border-[var(--border-default)] bg-[var(--surface-primary)]">
          <td className="px-3 py-4" />
          <td colSpan={10} className="px-4 py-4 pr-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--text-secondary)]" style={{ background: "color-mix(in srgb, var(--text-secondary) 15%, transparent)" }}><Users className="h-4 w-4" /></span>
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">Distribuição Financeira</div>
                <div className="text-[11px] text-[var(--text-muted)]">Responsáveis pelo pagamento desta receita</div>
              </div>
            </div>
            <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)]">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-default)] text-left text-[10.5px] uppercase tracking-wider text-[var(--text-muted)]">
                    {["Participante", "Valor base (EUR)", "Valor contratado (BRL)", "Recebido (BRL)", "Saldo (BRL)", "Próximo vencimento", "Status", "Ações"].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {g.participantes.map((p) => {
                    const pst = statusView(p.status)
                    return (
                      <tr key={p.obrigacaoId} className="border-t border-[var(--border-default)] hover:bg-[var(--surface-hover)]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="grid h-8 w-8 flex-none place-items-center rounded-full text-[11px] font-semibold text-[var(--text-secondary)]" style={{ background: "color-mix(in srgb, var(--text-secondary) 15%, transparent)" }}>{iniciais(p.nome)}</span>
                            <div>
                              <div className="text-[var(--text-primary)]">{p.nome}</div>
                              <div className="text-[11px] text-[var(--text-muted)]">{p.papel}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 text-[var(--text-primary)]">{p.moedaBase !== "BRL" ? fmtMoeda(p.valorBase, p.moedaBase) : <span className="text-[var(--text-muted)]">—</span>}</td>
                        <td className="px-4 font-semibold text-[var(--text-primary)]"><ValorBrl valor={p.valorContratadoBrl} naoConvertido={p.naoConvertido} moeda={p.moedaBase} /></td>
                        <td className="px-4">
                          <div className={(p.recebidoBrl ?? 0) > 0 ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}>{brl(p.recebidoBrl)}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">{p.parcelasRecebidas ?? 0} parcela(s)</div>
                        </td>
                        <td className="px-4">
                          <div className="text-[var(--info)]">{brl(p.saldoBrl)}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">{p.parcelas ?? 0} parcela(s)</div>
                        </td>
                        <td className="px-4 text-[var(--text-secondary)]">{dataBR(p.proximoVencimento) ?? <span className="text-[var(--text-muted)]">Não definido</span>}</td>
                        <td className="px-4"><StatusPill st={pst} /></td>
                        <td className="px-4">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => onAbrirParticipante(p.obrigacaoId)} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-hover)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-active)]"><ExternalLink className="h-3.5 w-3.5" /> Abrir</button>
                            <button onClick={() => onAbrirParticipante(p.obrigacaoId)} title="Abrir participante" className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"><MoreVertical className="h-4 w-4" /></button>
                          </div>
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
