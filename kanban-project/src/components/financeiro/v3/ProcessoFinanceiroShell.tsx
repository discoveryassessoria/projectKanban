// src/components/financeiro/v3/ProcessoFinanceiroShell.tsx
// ============================================================================
// FINANCEIRO DO PROCESSO — shell único (dentro do processo). Subtabs: Visão
// Geral / Receitas / Custos / Extrato / Timeline. Consome o backend financeiro
// já existente, filtrado pelo processo aberto. Sem módulo global, sem termos
// técnicos na interface.
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ReceitasTab } from "./ReceitasTab"
import { ReceitaDetalheView } from "./ReceitaDetalheView"
import { LancamentoManualModal } from "./LancamentoManualModal"
import RegistrarPagamentoModal from "./RegistrarPagamentoModal"
import EditarReceitaView from "./EditarReceitaView"
import CancelamentoAvancadoModal from "./CancelamentoAvancadoModal"
import ExcluirReceitaModal from "./ExcluirReceitaModal"
import DuplicarReceitaModal from "./DuplicarReceitaModal"
import AcaoReceitaModal from "./AcaoReceitaModal"
import { createPortal } from "react-dom"
import { useRef } from "react"
import { emitirMutacaoFinanceira } from "@/src/lib/financeiro-bus"
import { ContasAPagarDashboard } from "./ContasAPagarDashboard"
import { MoreVertical, Pencil, Copy, Ban, Trash2, Archive, ThumbsDown } from "lucide-react"
import { VisaoGeral } from "@/src/components/financeiro/subabas/VisaoGeral"
import { FileText, FileMinus, CheckSquare, CalendarDays, AlertTriangle, Plus, Eye, ChevronLeft, ChevronRight, ChevronDown, ArrowDownRight, ArrowUpRight, RefreshCw, SlidersHorizontal, Download, Search, Wallet, BarChart3, Settings, RotateCcw } from "lucide-react"

import { ValorBrl, AvisoNaoConvertido, semCotacao } from "./ValorBrl"
import { ROTULO_ESTADO_CUSTO } from "@/lib/financeiro/dominio/estado-custo"
import { ESTADOS_REPROVAVEIS } from "@/lib/financeiro/acoes/reprovar-custo"

// F4.3 — cor semântica do estado de negócio do custo (badge; SÓ ícone/badge tem cor, kit DS).
const COR_ESTADO_CUSTO: Record<string, string> = {
  PREVISTO: "var(--text-muted)", APROVADO: "var(--info)", CONTRATADO: "var(--text-secondary)",
  EXECUTADO: "var(--info)", PAGO: "var(--success)", CONCILIADO: "var(--success)",
  CANCELADO_PARCIAL: "var(--warning)", CANCELADO: "var(--danger)", ARQUIVADO: "var(--text-muted)",
}
function EstadoCustoBadge({ estado }: { estado: string }) {
  const cor = COR_ESTADO_CUSTO[estado] ?? "var(--text-secondary)"
  return <span className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${cor} 16%, transparent)`, color: cor }}>{ROTULO_ESTADO_CUSTO[estado as keyof typeof ROTULO_ESTADO_CUSTO] ?? estado}</span>
}

const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
const dataBR = (s?: string | null) => s ? new Date(s).toLocaleDateString("pt-BR") : "—"
// Apresentação de valor não convertido: componente compartilhado (ValorBrl).
const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const SUBTABS: [string, string][] = [["visao", "Visão Geral"], ["receitas", "Receitas"], ["custos", "Custos"], ["extrato", "Extrato"], ["timeline", "Timeline"]]
// Exporta linhas já carregadas como CSV (client-side, sem endpoint dedicado).
function baixarCSV(nome: string, rows: Record<string, any>[]) {
  if (!rows.length) { alert("Nada para exportar."); return }
  const cols = Object.keys(rows[0])
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`
  const csv = [cols.join(";"), ...rows.map((r) => cols.map((c) => esc(r[c])).join(";"))].join("\n")
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a"); a.href = url; a.download = `${nome}.csv`; a.click(); URL.revokeObjectURL(url)
}

export function ProcessoFinanceiroShell({ processoId }: { processoId: number }) {
  const [t, setT] = useState("visao")
  const [fxEur, setFxEur] = useState(5.5)
  const [detalheRef, setDetalheRef] = useState<string | null>(null)
  useEffect(() => { fetch("/api/cambio").then((r) => r.json()).then((d) => setFxEur(Number(d?.eur) || 5.5)).catch(() => {}) }, [])
  if (detalheRef) return (
    <div className="text-[var(--text-secondary)]"><ReceitaDetalheView refParam={detalheRef} onVoltar={() => setDetalheRef(null)} /></div>
  )
  const abrirDetalhe = (id: number) => setDetalheRef(String(id))
  return (
    <div className="text-[var(--text-secondary)]">
      <div className="mb-5 flex flex-wrap gap-6 border-b border-[var(--border-default)]">
        {SUBTABS.map(([id, label]) => (
          <button key={id} onClick={() => setT(id)} className={`-mb-px border-b-2 px-1 pb-3 pt-1 text-sm ${t === id ? "border-[var(--accent-primary)] font-medium text-[var(--accent-primary)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-secondary)]"}`}>{label}</button>
        ))}
      </div>
      {t === "visao" && <VisaoGeral processoId={processoId} fxHoje={fxEur} onIrPara={(a) => setT(a)} />}
      {t === "receitas" && <ReceitasTab processoId={processoId} onAbrirDetalhe={abrirDetalhe} />}
      {t === "custos" && <CustosTab processoId={processoId} fx={fxEur} onAbrirDetalhe={abrirDetalhe} />}
      {t === "extrato" && <ExtratoTab processoId={processoId} fx={fxEur} onAbrirDetalhe={abrirDetalhe} />}
      {t === "timeline" && <TimelineTab processoId={processoId} fx={fxEur} onAbrirDetalhe={abrirDetalhe} />}
    </div>
  )
}

// Custos — lista do processo (obrigações de natureza CUSTO). Discovery Design System.
// KPI card (nível de módulo — evita recriar componente no render).
function KpiC({ titulo, valor, sub: s, icon: Ic, cor }: any) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
      <div className="flex items-start justify-between gap-2"><span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{titulo}</span>{Ic && <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)]" style={{ background: `color-mix(in srgb, ${cor} 15%, transparent)`, color: cor }}><Ic className="h-4 w-4" /></span>}</div>
      <div className="mt-2 text-2xl font-bold text-[var(--text-primary)]">{valor}</div>
      <div className="mt-1 text-[11px] text-[var(--text-muted)]">{s}</div>
    </div>
  )
}

// F5-UI.3 — RowMenu de ações rápidas da linha de Contas a Pagar (portal, paridade com
// o RowMenu de Receitas). Reusa os modais compartilhados via callback onAcao.
function RowMenuCusto({ onAcao, pode, estadoCusto }: { onAcao: (tipo: string) => void; pode: (op: string) => boolean; estadoCusto?: string | null }) {
  // Reprovar só faz sentido enquanto o custo está EM ANÁLISE (mesma regra do servidor).
  const reprovavel = ESTADOS_REPROVAVEIS.includes(String(estadoCusto ?? "") as any)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const abrir = () => { const r = btn.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right }); setOpen(true) }
  // F6 — a UI só CONSOME as permissões (o enforcement real é server-side). Ação sem permissão
  // fica desabilitada com tooltip honesto (nunca botão morto), não escondida.
  const item = (tipo: string, label: string, Icon: any, op: string, danger = false) => {
    const ok = pode(op)
    return (
      <button disabled={!ok} onClick={() => { if (!ok) return; setOpen(false); onAcao(tipo) }} title={ok ? undefined : "Você não tem permissão para esta ação"} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${ok ? "hover:bg-[var(--surface-hover)]" : "cursor-not-allowed opacity-40"} ${danger ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"}`}><Icon className={`h-4 w-4 ${danger ? "" : "text-[var(--text-muted)]"}`} /> {label}</button>
    )
  }
  return (
    <>
      <button ref={btn} onClick={abrir} title="Mais ações" className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-hover)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-active)]"><MoreVertical className="h-4 w-4" /></button>
      {open && pos && createPortal(<>
        <div className="fixed inset-0 z-[10049]" onClick={() => setOpen(false)} />
        <div className="fixed z-[10050] w-48 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-overlay)] py-1 shadow-[var(--shadow-surface)]" style={{ top: pos.top, right: pos.right }}>
          {item("editar", "Editar custo", Pencil, "editar")}
          {item("duplicar", "Duplicar custo", Copy, "criar")}
          {item("arquivar", "Arquivar custo", Archive, "arquivar")}
          {reprovavel && item("reprovar", "Reprovar custo", ThumbsDown, "reprovar", true)}
          {item("cancelar", "Cancelar custo", Ban, "cancelar", true)}
          {item("excluir", "Excluir custo", Trash2, "excluir", true)}
        </div>
      </>, document.body)}
    </>
  )
}

// Etapa 3: abre o MESMO Detalhe da Obrigação (parametrizado por direção) usado por Receitas.
function CustosTab({ processoId, fx, onAbrirDetalhe }: { processoId: number; fx: number; onAbrirDetalhe?: (id: number) => void }) {
  const [obrs, setObrs] = useState<any[] | null>(null)
  const [novo, setNovo] = useState(false)
  const [pagar, setPagar] = useState<any | null>(null)
  const [sub, setSub] = useState<"todos" | "pagos" | "apagar">("todos")
  const [vista, setVista] = useState<"lista" | "painel">("lista")
  // F5-UI.3 — lista rica (paridade com ReceitasTab): busca, filtros, ordenação, paginação,
  // persistência de filtros, RowMenu de ações (reuso dos modais compartilhados).
  const [busca, setBusca] = useState("")
  const [fFornecedor, setFFornecedor] = useState("")
  const [fMoeda, setFMoeda] = useState("Todas")
  const [fEstado, setFEstado] = useState("Todos")
  const [ordenar, setOrdenar] = useState<"vencimento" | "valor" | "estado" | "descricao">("vencimento")
  const [ordem, setOrdem] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [acao, setAcao] = useState<{ tipo: string; o: any } | null>(null)
  // F6 — permissões EFETIVAS de custo (consumo da UI; server-side é a fonte de verdade).
  // Enquanto não carregam (null), não bloqueia a UI — o servidor rejeita o que não é permitido.
  const [perm, setPerm] = useState<Record<string, boolean> | null>(null)
  const pode = (op: string) => !perm || perm[op] === true
  const PAGE = 12
  const chaveFiltros = `cp-filtros-${processoId}`
  const carregar = () => { fetch(`/api/financeiro/v3/obrigacoes?processoId=${processoId}&natureza=CUSTO`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setObrs(j.obrigacoes ?? [])).catch(() => setObrs([])) }
  // persistência de filtros (localStorage por processo)
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem(chaveFiltros) || "{}"); if (s.sub) setSub(s.sub); if (s.busca) setBusca(s.busca); if (s.fMoeda) setFMoeda(s.fMoeda); if (s.fEstado) setFEstado(s.fEstado); if (s.ordenar) setOrdenar(s.ordenar); if (s.ordem) setOrdem(s.ordem) } catch { /* ignore */ } }, [chaveFiltros])
  useEffect(() => { try { localStorage.setItem(chaveFiltros, JSON.stringify({ sub, busca, fMoeda, fEstado, ordenar, ordem })) } catch { /* ignore */ } }, [chaveFiltros, sub, busca, fMoeda, fEstado, ordenar, ordem])
  // conclusão de uma ação de linha: fecha, recarrega, propaga no bus.
  const aoConcluir = () => { setAcao(null); carregar(); emitirMutacaoFinanceira() }
  // F4.3 — avança o estado de negócio do custo (Aprovar/Contratar/Executar) via ação server-side.
  const mudarEstado = async (obrigacaoId: number, estado: string) => {
    try {
      const r = await fetch(`/api/financeiro/v3/obrigacoes/${obrigacaoId}/estado`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ estado }) }).then((x) => x.json())
      if (!r?.ok) { alert(r?.erro ?? "Não foi possível mudar o estado."); return }
      carregar()
    } catch { alert("Falha ao mudar o estado.") }
  }
  // próxima ação de avanço contextual (null quando não há avanço manual disponível).
  const proximoAvanco: Record<string, { estado: string; label: string }> = { PREVISTO: { estado: "APROVADO", label: "Aprovar" }, APROVADO: { estado: "CONTRATADO", label: "Contratar" }, CONTRATADO: { estado: "EXECUTADO", label: "Marcar executado" } }
  // Cancelamento (com motivo auditável) mora no Detalhe único da Obrigação — paridade
  // com Receita, sem duplicar lógica nem cancelar sem justificativa a partir da lista.
  useEffect(() => { carregar() }, [processoId])
  useEffect(() => { fetch(`/api/financeiro/v3/permissoes-custo`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setPerm(j?.permissoes ?? null)).catch(() => setPerm(null)) }, [])
  if (!obrs) return <div className="py-8 text-sm text-[var(--text-muted)]">carregando…</div>

  // BRL vem da FONTE ÚNICA (listarObrigacoes → computeCambioAging), não de fx estimado.
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const quitado = (o: any) => o.recebido >= o.valorContratado - 0.005
  const emAtraso = obrs.filter((o) => o.vencimento && new Date(o.vencimento) < hoje && o.saldo > 0.005)
  const totais = {
    total: obrs.reduce((s, o) => s + (o.contratadoBrl ?? 0), 0),
    pago: obrs.reduce((s, o) => s + (o.recebidoBrl ?? 0), 0),
    apagar: obrs.reduce((s, o) => s + (o.saldoBrl ?? 0), 0),
    atraso: emAtraso.length,
    naoConvertido: obrs.reduce((s, o) => s + (o.naoConvertido ?? 0), 0),
    semCotacaoQtd: obrs.filter(semCotacao).length,
  }
  const filtrados = obrs.filter((o) => {
    if (sub === "pagos" && !quitado(o)) return false
    if (sub === "apagar" && quitado(o)) return false
    if (fMoeda !== "Todas" && o.moeda !== fMoeda) return false
    if (fEstado !== "Todos" && (o.estadoCusto ?? "") !== fEstado) return false
    if (fFornecedor && !(o.fornecedor ?? "").toLowerCase().includes(fFornecedor.toLowerCase())) return false
    if (busca.trim()) { const q = busca.toLowerCase(); const hay = [o.descricao, o.codigoOperacional, o.fornecedor].filter(Boolean).map(String).join(" ").toLowerCase(); if (!hay.includes(q)) return false }
    return true
  })
  const dir = ordem === "asc" ? 1 : -1
  const ordenados = [...filtrados].sort((a, b) => {
    if (ordenar === "valor") return (Number(a.saldoBrl ?? 0) - Number(b.saldoBrl ?? 0)) * dir
    if (ordenar === "estado") return String(a.estadoCusto ?? "").localeCompare(String(b.estadoCusto ?? "")) * dir
    if (ordenar === "descricao") return String(a.descricao ?? "").localeCompare(String(b.descricao ?? "")) * dir
    const av = a.vencimento ? new Date(a.vencimento).getTime() : Infinity, bv = b.vencimento ? new Date(b.vencimento).getTime() : Infinity
    return (av - bv) * dir
  })
  const totalPag = Math.max(1, Math.ceil(ordenados.length / PAGE))
  const pageSafe = Math.min(page, totalPag)
  const lista = ordenados.slice((pageSafe - 1) * PAGE, pageSafe * PAGE)
  const estadosDistintos = [...new Set(obrs.map((o) => o.estadoCusto).filter(Boolean))] as string[]
  const moedasDistintas = [...new Set(obrs.map((o) => o.moeda).filter(Boolean))] as string[]
  const limparFiltros = () => { setBusca(""); setFFornecedor(""); setFMoeda("Todas"); setFEstado("Todos"); setSub("todos"); setPage(1) }


  return (
    <div>
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-[var(--text-primary)]">Custos</h2><p className="text-sm text-[var(--text-muted)]">Despesas e custos do processo</p></div>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-strong)]">
            {(["lista", "painel"] as const).map((v) => <button key={v} onClick={() => setVista(v)} className={`px-3.5 py-2 text-sm ${vista === v ? "bg-[var(--accent-primary)] text-[var(--accent-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>{v === "lista" ? "Lista" : "Painel"}</button>)}
          </div>
          <button onClick={() => setNovo(true)} disabled={!pode("criar")} title={pode("criar") ? undefined : "Você não tem permissão para criar custos"} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3.5 py-2 text-sm font-medium text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-4 w-4" /> Novo Custo</button>
        </div>
      </div>

      {/* F5-UI.4 — painel dedicado (dashboard/relatório de Contas a Pagar) */}
      {vista === "painel" && <div className="mt-4"><ContasAPagarDashboard processoId={processoId} /></div>}

      {vista === "lista" && (<>
      {/* KPIs */}
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiC titulo="Total" valor={fmt(totais.total)} sub={`${obrs.length} custo(s)`} icon={FileMinus} cor="var(--info)" />
        <KpiC titulo="Pago" valor={fmt(totais.pago)} sub="pago em caixa" icon={CheckSquare} cor="var(--success)" />
        <KpiC titulo="A pagar" valor={fmt(totais.apagar)} sub="a pagar" icon={CalendarDays} cor="var(--warning)" />
        <KpiC titulo="Em atraso" valor={`${totais.atraso} parc.`} sub={`${totais.atraso} parcelas`} icon={AlertTriangle} cor="var(--danger)" />
      </div>
      <AvisoNaoConvertido className="mt-2" quantidade={totais.semCotacaoQtd} />

      {/* Tabela */}
      <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)]">
        <div className="flex items-center gap-6 border-b border-[var(--border-default)] px-5 pt-4">
          {([["todos", "Todos"], ["pagos", "Pagos"], ["apagar", "A Pagar"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => { setSub(id); setPage(1) }} className={`-mb-px border-b-2 pb-3 text-sm ${sub === id ? "border-[var(--accent-primary)] font-medium text-[var(--accent-primary)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-secondary)]"}`}>{label}</button>
          ))}
        </div>
        {/* F5-UI.3 — busca + filtros avançados + ordenação (persistidos) */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" /><input value={busca} onChange={(e) => { setBusca(e.target.value); setPage(1) }} placeholder="Buscar descrição, código, fornecedor…" className="w-[240px] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] py-1.5 pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]" /></div>
          <input value={fFornecedor} onChange={(e) => { setFFornecedor(e.target.value); setPage(1) }} placeholder="Fornecedor" className="w-[150px] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
          <select value={fMoeda} onChange={(e) => { setFMoeda(e.target.value); setPage(1) }} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1.5 text-sm text-[var(--text-secondary)]"><option value="Todas">Moeda</option>{moedasDistintas.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <select value={fEstado} onChange={(e) => { setFEstado(e.target.value); setPage(1) }} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1.5 text-sm text-[var(--text-secondary)]"><option value="Todos">Estado</option>{estadosDistintos.map((s) => <option key={s} value={s}>{ROTULO_ESTADO_CUSTO[s as keyof typeof ROTULO_ESTADO_CUSTO] ?? s}</option>)}</select>
          <select value={`${ordenar}:${ordem}`} onChange={(e) => { const [o, dd] = e.target.value.split(":"); setOrdenar(o as any); setOrdem(dd as any) }} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1.5 text-sm text-[var(--text-secondary)]"><option value="vencimento:asc">Vencimento ↑</option><option value="vencimento:desc">Vencimento ↓</option><option value="valor:desc">Saldo ↓</option><option value="valor:asc">Saldo ↑</option><option value="estado:asc">Estado</option><option value="descricao:asc">Descrição</option></select>
          <button onClick={limparFiltros} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"><RotateCcw className="h-3.5 w-3.5" /> Limpar</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{["Descrição", "Categoria", "Total", "Total (BRL)", "Câmbio", "Vencimento", "Progresso", "Status", "Ações"].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>{lista.map((o) => {
              const prog = o.valorContratado > 0 ? Math.min(100, Math.round((o.recebido / o.valorContratado) * 100)) : 0
              const quit = quitado(o)
              return (
                <tr key={o.obrigacaoId} className="border-t border-[var(--border-default)] hover:bg-[var(--surface-hover)]">
                  <td className="px-5 py-4"><div className="max-w-[220px] text-[var(--text-primary)]">{o.descricao ?? o.codigoOperacional ?? `#${o.obrigacaoId}`}</div>{o.fornecedor && <div className="max-w-[220px] truncate text-xs text-[var(--text-secondary)]" title={o.fornecedor}>{o.fornecedor}</div>}{o.codigoOperacional && <div className="text-xs text-[var(--text-muted)]">{o.codigoOperacional}</div>}</td>
                  <td className="px-5 text-[var(--text-secondary)]">{o.categoria ?? "—"}</td>
                  <td className="px-5 text-[var(--text-primary)]">{fmt(o.valorContratado, o.moeda)}</td>
                  <td className="px-5 text-[var(--text-secondary)]"><ValorBrl valor={o.contratadoBrl ?? 0} naoConvertido={o.naoConvertido} moeda={o.moeda} /></td>
                  <td className="px-5"><span className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]" style={{ background: "var(--surface-active)" }}>{o.moeda}</span></td>
                  <td className="px-5 text-[var(--text-secondary)]">{o.vencimento ? dataBR(o.vencimento) : "—"}</td>
                  <td className="px-5"><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "var(--surface-active)" }}><span className="block h-full rounded-full" style={{ background: "var(--success)", width: `${prog}%` }} /></div><span className="text-[11px] text-[var(--text-muted)]">{prog}%</span></div></td>
                  <td className="px-5">{o.estadoCusto ? <EstadoCustoBadge estado={o.estadoCusto} /> : (quit ? <span className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold" style={{ background: "color-mix(in srgb, var(--success) 16%, transparent)", color: "var(--success)" }}>Pago</span> : <span className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold" style={{ background: "color-mix(in srgb, var(--warning) 16%, transparent)", color: "var(--warning)" }}>A pagar</span>)}</td>
                  <td className="px-5"><div className="flex items-center gap-2"><button onClick={() => onAbrirDetalhe?.(o.obrigacaoId)} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-hover)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-active)]"><Eye className="h-3.5 w-3.5" /> Abrir</button>{o.estadoCusto && proximoAvanco[o.estadoCusto] && (() => { const opAv = proximoAvanco[o.estadoCusto].estado === "APROVADO" ? "aprovar" : "editar"; const okAv = pode(opAv); return <button disabled={!okAv} title={okAv ? undefined : "Você não tem permissão para esta ação"} onClick={() => mudarEstado(o.obrigacaoId, proximoAvanco[o.estadoCusto].estado)} className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-hover)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-active)] disabled:cursor-not-allowed disabled:opacity-40">{proximoAvanco[o.estadoCusto].label}</button> })()}{!quit && <button onClick={() => setPagar(o)} disabled={!pode("pagar")} title={pode("pagar") ? undefined : "Você não tem permissão para pagar"} className="rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-medium text-[var(--accent-ink)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40" style={{ background: "var(--success)" }}>Pagar</button>}<RowMenuCusto pode={pode} estadoCusto={o.estadoCusto} onAcao={(tipo) => setAcao({ tipo, o })} /></div></td>
                </tr>
              )
            })}{lista.length === 0 && <tr><td colSpan={9} className="px-5 py-8 text-center text-[var(--text-muted)]">Nenhum custo neste processo.</td></tr>}</tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-4 text-sm text-[var(--text-muted)]"><span>Mostrando {ordenados.length === 0 ? 0 : (pageSafe - 1) * PAGE + 1}–{Math.min(pageSafe * PAGE, ordenados.length)} de {ordenados.length} registro{ordenados.length === 1 ? "" : "s"}</span><div className="flex items-center gap-1"><button disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs" style={{ borderColor: "color-mix(in srgb, var(--accent-primary) 40%, transparent)", background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)", color: "var(--accent-primary)" }}>{pageSafe}/{totalPag}</span><button disabled={pageSafe >= totalPag} onClick={() => setPage(pageSafe + 1)} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>
      </div>
      </>)}

      {novo && <LancamentoManualModal natureza="CUSTO" processoId={processoId} onClose={() => setNovo(false)} onCriado={() => { setNovo(false); carregar() }} />}
      {pagar && <RegistrarPagamentoModal obrigacaoId={pagar.obrigacaoId} moeda={pagar.moeda} saldo={pagar.saldo} natureza="CUSTO" onClose={() => setPagar(null)} onDone={() => { setPagar(null); carregar() }} />}

      {/* F5-UI.3 — modais compartilhados das ações rápidas da linha (mesmos de Receitas) */}
      {acao?.tipo === "editar" && <EditarReceitaView obrigacaoId={acao.o.obrigacaoId} receitaRef={String(acao.o.obrigacaoId)} natureza="CUSTO" onClose={() => setAcao(null)} onDone={aoConcluir} />}
      {acao?.tipo === "duplicar" && <DuplicarReceitaModal receitaRef={String(acao.o.obrigacaoId)} onClose={() => setAcao(null)} onDone={(novoId?: number) => { aoConcluir(); if (novoId) onAbrirDetalhe?.(novoId) }} />}
      {acao?.tipo === "arquivar" && <AcaoReceitaModal acao="arquivar" receitaRef={String(acao.o.obrigacaoId)} natureza="CUSTO" onClose={() => setAcao(null)} onDone={aoConcluir} />}
      {acao?.tipo === "reprovar" && <AcaoReceitaModal acao="reprovar" receitaRef={String(acao.o.obrigacaoId)} natureza="CUSTO" onClose={() => setAcao(null)} onDone={aoConcluir} />}
      {acao?.tipo === "cancelar" && <CancelamentoAvancadoModal receitaRef={String(acao.o.obrigacaoId)} onClose={() => setAcao(null)} onDone={aoConcluir} />}
      {acao?.tipo === "excluir" && <ExcluirReceitaModal receitaRef={String(acao.o.obrigacaoId)} onClose={() => setAcao(null)} onDone={aoConcluir} />}
    </div>
  )
}

// Extrato financeiro — movimentações do processo (Receitas/Custos) com saldo
// acumulado. Discovery Design System. Fonte: obrigações do motor V3.
function ExtratoTab({ processoId, onAbrirDetalhe }: { processoId: number; fx?: number; onAbrirDetalhe?: (id: number) => void }) {
  const router = useRouter()
  const [movs, setMovs] = useState<any[] | null>(null)
  const [fluxo, setFluxo] = useState<"todos" | "entradas" | "saidas">("todos")
  const [fTipo, setFTipo] = useState("Todos")
  const [busca, setBusca] = useState("")
  // EXTRATO = projeção do LEDGER (movimentos reais), não contratos. Ver /v3/extrato.
  useEffect(() => { fetch(`/api/financeiro/v3/extrato?processoId=${processoId}`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setMovs(j.movimentos ?? [])).catch(() => setMovs([])) }, [processoId])
  const tiposMov = useMemo(() => ["Todos", ...Array.from(new Set((movs ?? []).map((m) => m.tipo)))], [movs])
  const lista = useMemo(() => (movs ?? []).filter((m) =>
    (fluxo === "entradas" ? m.entradaSaida === "ENTRADA" : fluxo === "saidas" ? m.entradaSaida === "SAIDA" : true)
    && (fTipo === "Todos" || m.tipo === fTipo)
    && (!busca || `${m.descricao} ${m.codigo ?? ""} ${m.tipo}`.toLowerCase().includes(busca.toLowerCase()))
  ), [movs, fluxo, fTipo, busca])
  if (!movs) return <div className="py-8 text-sm text-[var(--text-muted)]">carregando…</div>
  const totEntradas = movs.filter((m) => m.entradaSaida === "ENTRADA").reduce((s, m) => s + (m.valorBrl || 0), 0)
  const totSaidas = movs.filter((m) => m.entradaSaida === "SAIDA").reduce((s, m) => s + (m.valorBrl || 0), 0)
  const resultado = Math.round((totEntradas - totSaidas) * 100) / 100
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-[var(--text-primary)]">Extrato financeiro</h2><p className="text-sm text-[var(--text-muted)]">Projeção cronológica dos movimentos do razão (Ledger) do processo.</p></div>
        <button onClick={() => baixarCSV("extrato-ledger", lista.map((m) => ({ Data: dataBR(m.data), Tipo: m.tipo, Documento: m.codigo ?? "", Descricao: m.descricao, Fluxo: m.entradaSaida, Valor: m.valorBrl, SaldoObrigacao: m.saldoObrigacaoApos })))} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-primary)] px-3.5 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-active)]"><Download className="h-4 w-4" /> Exportar</button>
      </div>
      <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <FiltroBox label="Fluxo" valor={fluxo === "entradas" ? "Entradas" : fluxo === "saidas" ? "Saídas" : "Todos"} options={["Todos", "Entradas", "Saídas"]} onChange={(v) => setFluxo(v === "Entradas" ? "entradas" : v === "Saídas" ? "saidas" : "todos")} />
          <FiltroBox label="Tipo de movimento" valor={fTipo} options={tiposMov} onChange={setFTipo} />
          <div className="relative md:col-span-2"><div className="mb-1 text-xs text-[var(--text-muted)]">Buscar</div><Search className="pointer-events-none absolute left-3 top-[30px] h-4 w-4 text-[var(--text-muted)]" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar descrição, documento, tipo..." className="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--text-muted)]" /></div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <ExtKpi titulo="Entradas (caixa)" valor={fmt(totEntradas)} sub="recebimentos" icon={ArrowDownRight} cor="var(--success)" />
        <ExtKpi titulo="Saídas (caixa)" valor={fmt(totSaidas)} sub="pagamentos" icon={ArrowUpRight} cor="var(--warning)" />
        <ExtKpi titulo="Resultado de caixa" valor={fmt(resultado)} sub="Entradas − Saídas" icon={BarChart3} cor="var(--info)" />
      </div>
      <div className="mt-5 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)]">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[var(--border-default)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{["Data", "Movimento", "Documento", "Descrição", "Entrada", "Saída", "Saldo da obrigação", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{lista.map((m, i) => (
            <tr key={`${m.transacaoId}-${i}`} className="border-t border-[var(--border-default)] hover:bg-[var(--surface-hover)]">
              <td className="px-4 py-3.5 text-[var(--text-secondary)]">{dataBR(m.data)}</td>
              <td className="px-4"><span className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]" style={{ background: "var(--surface-active)" }}>{m.tipo}</span></td>
              <td className="px-4 text-[var(--text-secondary)]">{m.codigo ?? "—"}</td>
              <td className="px-4"><div className="max-w-[260px] text-[var(--text-primary)]">{m.descricao}</div></td>
              <td className="px-4 tabular-nums text-[var(--success)]">{m.entradaSaida === "ENTRADA" ? fmt(m.valorBrl) : "—"}</td>
              <td className="px-4 tabular-nums text-[var(--warning)]">{m.entradaSaida === "SAIDA" ? fmt(m.valorBrl) : "—"}</td>
              <td className="px-4 tabular-nums text-[var(--info)]">{fmt(m.saldoObrigacaoApos)}</td>
              <td className="px-4"><button onClick={() => onAbrirDetalhe ? onAbrirDetalhe(m.obrigacaoId) : router.push(`/financeiro/v3/receita/${m.obrigacaoId}`)} title="Abrir obrigação" className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"><Eye className="h-4 w-4" /></button></td>
            </tr>
          ))}{lista.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">Sem movimentos no razão.</td></tr>}</tbody>
        </table>
        <div className="flex items-center justify-between border-t border-[var(--border-default)] px-4 py-3 text-sm text-[var(--text-muted)]"><span>Mostrando {lista.length} de {lista.length} movimento{lista.length === 1 ? "" : "s"}</span></div>
      </div>
    </div>
  )
}
function FiltroBox({ label, valor, className = "", options, onChange }: { label: string; valor: string; className?: string; options?: string[]; onChange?: (v: string) => void }) {
  if (options && onChange) {
    return (
      <label className={`text-xs text-[var(--text-muted)] ${className}`}>{label}
        <div className="relative mt-1">
          <select value={valor} onChange={(e) => onChange(e.target.value)} className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 pr-8 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--info)]">
            {options.map((o) => <option key={o} value={o} className="bg-[var(--surface-popover)]">{o}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
        </div>
      </label>
    )
  }
  return (
    <label className={`text-xs text-[var(--text-muted)] ${className}`}>{label}
      <div className="mt-1 flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm"><span className="text-[var(--text-secondary)]">{valor}</span><ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" /></div>
    </label>
  )
}
function ExtKpi({ titulo, valor, sub, icon: Ic, cor }: any) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
      <div className="flex items-start justify-between gap-2"><span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{titulo}</span><Ic className="h-4 w-4" style={{ color: cor }} /></div>
      <div className="mt-2 text-2xl font-bold" style={{ color: cor }}>{valor}</div>
      <div className="mt-1 text-[11px] text-[var(--text-muted)]">{sub}</div>
    </div>
  )
}

// Timeline financeira — linha do tempo das movimentações + resumos laterais.
// Discovery Design System. Fonte: obrigações do motor V3.
function TimelineTab({ processoId, fx, onAbrirDetalhe }: { processoId: number; fx: number; onAbrirDetalhe?: (id: number) => void }) {
  const router = useRouter()
  const [obrs, setObrs] = useState<any[] | null>(null)
  const [fCat, setFCat] = useState("Todas")
  const [fResp, setFResp] = useState("Todos")
  const [soPend, setSoPend] = useState(false)
  const [busca, setBusca] = useState("")
  useEffect(() => { fetch(`/api/financeiro/v3/obrigacoes?processoId=${processoId}`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setObrs(j.obrigacoes ?? [])).catch(() => setObrs([])) }, [processoId])
  const movsAll = useMemo(() => {
    // BRL da FONTE ÚNICA (listarObrigacoes → computeCambioAging); sem fx estimado.
    const base = (obrs ?? []).filter((o) => o.status !== "CANCELADO").map((o) => ({
      id: o.obrigacaoId, receita: o.direcao === "A_RECEBER", codigo: o.codigoOperacional ?? `#${o.obrigacaoId}`,
      descricao: o.descricao ?? o.codigoOperacional ?? `#${o.obrigacaoId}`, categoria: o.categoria ?? (o.direcao === "A_RECEBER" ? "Receita" : "Custo"),
      valorBRL: o.contratadoBrl ?? 0, data: o.criadoEm ?? o.vencimento, responsavel: o.responsavel ?? null, requerente: o.requerente ?? null, quitado: o.recebido >= o.valorContratado - 0.005,
    }))
    const asc = [...base].sort((a, b) => a.id - b.id)
    const comSaldo = asc.reduce<Array<typeof asc[number] & { saldoAcum: number }>>((arr, mv) => {
      const prev = arr.length ? arr[arr.length - 1].saldoAcum : 0
      return [...arr, { ...mv, saldoAcum: prev + (mv.receita ? mv.valorBRL : -mv.valorBRL) }]
    }, [])
    return comSaldo.reverse()
  }, [obrs, fx])
  const cats = useMemo(() => ["Todas", ...Array.from(new Set(movsAll.map((mv) => mv.categoria)))], [movsAll])
  const respOpts = useMemo(() => ["Todos", ...Array.from(new Set(movsAll.map((mv) => mv.responsavel).filter((v): v is string => !!v)))], [movsAll])
  const movs = useMemo(() => movsAll.filter((mv) => (fCat === "Todas" || mv.categoria === fCat) && (fResp === "Todos" || mv.responsavel === fResp) && (!soPend || !mv.quitado) && (!busca || `${mv.descricao} ${mv.codigo} ${mv.categoria} ${mv.responsavel ?? ""}`.toLowerCase().includes(busca.toLowerCase()))), [movsAll, fCat, fResp, soPend, busca])
  const iniciais = (nome: string | null) => (nome ?? "").split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "—"
  const horaBR = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""
  if (!obrs) return <div className="py-8 text-sm text-[var(--text-muted)]">carregando…</div>
  const totReceitas = movsAll.filter((m) => m.receita).reduce((s, m) => s + m.valorBRL, 0)
  const totCustos = movsAll.filter((m) => !m.receita).reduce((s, m) => s + m.valorBRL, 0)
  const saldoFinal = totReceitas - totCustos
  // resumo por categoria
  const catMap = new Map<string, number>()
  movsAll.forEach((m) => catMap.set(m.categoria, (catMap.get(m.categoria) ?? 0) + m.valorBRL))
  const totCat = [...catMap.values()].reduce((s, v) => s + v, 0) || 1
  // Paleta oficial de gráfico do DS (5 séries distintas) — não colapsar em semânticas.
  const CORES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]
  const categorias = [...catMap.entries()].sort((a, b) => b[1] - a[1]).map(([nome, valor], i) => ({ nome, valor, pct: (valor / totCat) * 100, cor: CORES[i % CORES.length] }))
  const hojeStr = new Date().toISOString().slice(0, 10)
  const hojeN = movsAll.filter((m) => (m.data ?? "").slice(0, 10) === hojeStr).length
  const recebidas = movsAll.filter((m) => m.receita && m.quitado).length
  const pendentes = movsAll.filter((m) => !m.quitado).length

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-[var(--text-primary)]">Timeline financeira</h2><p className="text-sm text-[var(--text-muted)]">Linha do tempo completa de todas as movimentações e eventos financeiros do processo.</p></div>
        <button onClick={() => baixarCSV("timeline-financeira", movs.map((mv) => ({ Data: mv.data ? dataBR(mv.data) : "", Tipo: mv.receita ? "Receita" : "Custo", Categoria: mv.categoria, Descricao: mv.descricao, Documento: mv.codigo, Valor: mv.valorBRL, SaldoApos: mv.saldoAcum, Responsavel: mv.responsavel ?? "", Status: mv.quitado ? (mv.receita ? "Recebido" : "Pago") : (mv.receita ? "A receber" : "A pagar") })))} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-primary)] px-3.5 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-active)]"><Download className="h-4 w-4" /> Exportar</button>
      </div>

      {/* Filtros */}
      <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <label className="text-xs text-[var(--text-muted)]">Período<div className="mt-1 flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm"><span className="text-[var(--text-secondary)]">01/06/2026 - 24/07/2026</span><CalendarDays className="h-3.5 w-3.5 text-[var(--text-muted)]" /></div></label>
          <FiltroBox label="Tipo" valor="Todos" />
          <FiltroBox label="Categoria" valor={fCat} options={cats} onChange={setFCat} />
          <FiltroBox label="Fase" valor="Todas" />
          <FiltroBox label="Responsável" valor={fResp} options={respOpts} onChange={setFResp} />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="relative min-w-[240px] flex-1"><div className="mb-1 text-xs text-[var(--text-muted)]">Buscar</div><Search className="pointer-events-none absolute left-3 top-[30px] h-4 w-4 text-[var(--text-muted)]" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar descrição, documento, origem..." className="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-[var(--text-muted)]" /></div>
          <button onClick={() => setSoPend((v) => !v)} className={`mb-[1px] inline-flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-sm ${soPend ? "text-[var(--accent-primary)]" : "border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-secondary)]"}`} style={soPend ? { borderColor: "color-mix(in srgb, var(--accent-primary) 50%, transparent)", background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" } : undefined}><SlidersHorizontal className="h-3.5 w-3.5" /> {soPend ? "Só pendentes" : "Filtros rápidos"}</button>
          <button onClick={() => setBusca("")} className="mb-[1px] inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-secondary)]"><RotateCcw className="h-3.5 w-3.5" /> Limpar filtros</button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
        {/* Timeline */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
          <div className="mb-3 text-xs text-[var(--text-muted)]">Ordenado por: Data (mais recente)</div>
          {movs.length === 0 ? <div className="py-10 text-center text-sm text-[var(--text-muted)]">Sem movimentações financeiras.</div> : (
            <div className="relative pl-1">
              {movs.map((mv, i) => (
                <div key={mv.id} className="flex gap-3">
                  <div className="flex w-16 shrink-0 flex-col items-end pt-1 text-right"><span className="text-[11px] text-[var(--text-secondary)]">{mv.data ? dataBR(mv.data) : "—"}</span><span className="text-[10px] text-[var(--text-muted)]">{horaBR(mv.data)}</span></div>
                  <div className="flex flex-col items-center">
                    <span className="grid h-9 w-9 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${mv.receita ? "var(--success)" : "var(--warning)"} 16%, transparent)`, color: mv.receita ? "var(--success)" : "var(--warning)" }}>{mv.receita ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</span>
                    {i < movs.length - 1 && <span className="mt-1 w-px flex-1" style={{ background: "var(--border-default)" }} />}
                  </div>
                  <div className="min-w-0 flex-1 pb-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium" style={{ color: mv.receita ? "var(--success)" : "var(--warning)" }}>{mv.receita ? "Receita" : "Custo"} <span className="text-[var(--text-muted)]">· {mv.codigo}</span></div>
                        <div className="mt-0.5 truncate text-sm text-[var(--text-primary)]">{mv.descricao}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5"><span className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]" style={{ background: "var(--surface-active)" }}>{mv.categoria}</span></div>
                      </div>
                      <div className="flex shrink-0 items-start gap-3">
                        <div className="text-right">
                          <div className="tabular-nums text-sm font-semibold" style={{ color: mv.receita ? "var(--success)" : "var(--warning)" }}>{mv.receita ? "" : "-"}{fmt(mv.valorBRL)}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">Saldo após: {fmt(mv.saldoAcum)}</div>
                          <div className="mt-1 flex items-center justify-end gap-2">
                            {mv.quitado ? <span className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold" style={{ background: "color-mix(in srgb, var(--success) 16%, transparent)", color: "var(--success)" }}>{mv.receita ? "Recebido" : "Pago"}</span> : <span className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold" style={{ background: "color-mix(in srgb, var(--warning) 16%, transparent)", color: "var(--warning)" }}>{mv.receita ? "A receber" : "A pagar"}</span>}
                          </div>
                          {mv.responsavel && <div className="mt-1.5 flex items-center justify-end gap-1.5"><span className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-semibold text-[var(--text-secondary)]" style={{ background: "var(--surface-active)" }}>{iniciais(mv.responsavel)}</span><span className="text-[11px] text-[var(--text-muted)]">{mv.responsavel}</span></div>}
                        </div>
                        <button onClick={() => onAbrirDetalhe ? onAbrirDetalhe(mv.id) : router.push(`/financeiro/v3/receita/${mv.id}`)} title="Abrir movimentação" className="mt-0.5 grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"><span className="text-lg leading-none">⋮</span></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 border-t border-[var(--border-default)] pt-3 text-center text-xs text-[var(--text-muted)]">Mostrando {movs.length} de {movs.length} registro{movs.length === 1 ? "" : "s"}</div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
            <div className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Resumo do período</div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Saldo inicial</span><span className="tabular-nums text-[var(--text-secondary)]">{fmt(0)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Total receitas</span><span className="tabular-nums text-[var(--success)]">{fmt(totReceitas)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Total custos</span><span className="tabular-nums text-[var(--warning)]">{fmt(totCustos)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Ajustes</span><span className="tabular-nums text-[var(--text-secondary)]">{fmt(0)}</span></div>
              <div className="mt-1 flex justify-between border-t border-[var(--border-default)] pt-2"><span className="font-medium text-[var(--text-secondary)]">Saldo final</span><span className="tabular-nums font-semibold text-[var(--info)]">{fmt(saldoFinal)}</span></div>
            </div>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
            <div className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Resumo por categoria</div>
            <div className="flex items-center gap-4">
              <MiniDonut itens={categorias} total={totCat === 1 ? 0 : totCat} />
              <div className="flex-1 space-y-1.5 text-xs">
                {categorias.length === 0 ? <span className="text-[var(--text-muted)]">Sem dados.</span> : categorias.slice(0, 5).map((c, i) => (
                  <div key={i} className="flex items-center justify-between gap-2"><span className="inline-flex min-w-0 items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.cor }} /><span className="truncate text-[var(--text-secondary)]">{c.nome}</span></span><span className="shrink-0 text-[var(--text-muted)]">{c.pct.toFixed(1)}%</span></div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
            <div className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Atividade recente</div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-[var(--text-secondary)]">{hojeN} movimentação(ões) hoje</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-secondary)]">{pendentes} pendente(s)</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-secondary)]">{recebidas} recebida(s)</span><span className="tabular-nums text-[var(--success)]">{fmt(movs.filter((m) => m.receita && m.quitado).reduce((s, m) => s + m.valorBRL, 0))}</span></div>
            </div>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
            <div className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Legenda de tipos</div>
            <div className="grid grid-cols-2 gap-y-1.5 text-xs text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1.5"><ArrowDownRight className="h-3.5 w-3.5 text-[var(--success)]" /> Receita</span>
              <span className="inline-flex items-center gap-1.5"><ArrowUpRight className="h-3.5 w-3.5 text-[var(--warning)]" /> Custo</span>
              <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 text-[var(--info)]" /> Transferência</span>
              <span className="inline-flex items-center gap-1.5"><Settings className="h-3.5 w-3.5 text-[var(--info)]" /> Ajuste</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
function MiniDonut({ itens, total }: { itens: { valor: number; cor: string }[]; total: number }) {
  const size = 108, thick = 15, r = (size - thick) / 2, c = size / 2, circ = 2 * Math.PI * r
  const soma = itens.reduce((s, x) => s + x.valor, 0)
  let acc = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-hover)" strokeWidth={thick} />
        {soma > 0 && itens.filter((x) => x.valor > 0).map((x, i) => { const frac = x.valor / soma; const dash = frac * circ; const off = acc * circ; acc += frac; return <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={x.cor} strokeWidth={thick} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-off} /> })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[10px] text-[var(--text-muted)]">Total</span><span className="text-xs font-bold text-[var(--text-primary)]">{fmt(total)}</span></div>
    </div>
  )
}

// Extrato / Timeline — movimentações do processo (todas as ocorrências do Ledger).
function Movimentacoes({ processoId, modo }: { processoId: number; modo: "extrato" | "timeline" }) {
  const [pos, setPos] = useState<any>(null)
  useEffect(() => { fetch(`/api/financeiro/v3/processo/${processoId}`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setPos(j.posicao)).catch(() => setPos({ obrigacoes: [] })) }, [processoId])
  const eventos = useMemo(() => {
    const out: any[] = []
    for (const o of pos?.obrigacoes ?? []) for (const t of o.timeline ?? []) out.push({ ...t, obrigacao: o.codigoOperacional })
    return out.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
  }, [pos])
  if (!pos) return <div className="py-8 text-sm text-[var(--text-muted)]">carregando…</div>
  const ENTRADA = new Set(["PAGAMENTO", "PAGAMENTO_PARCIAL", "JUROS", "MULTA"])
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
      <div className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">{modo === "extrato" ? "Extrato do processo" : "Timeline financeira"}</div>
      {eventos.length === 0 ? <div className="text-sm text-[var(--text-muted)]">Sem movimentações.</div> : modo === "extrato" ? (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-[var(--text-muted)]">{["Data", "Descrição", "Origem", "Valor", "Status", ""].map((h) => <th key={h} className="py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{eventos.map((e, i) => (
            <tr key={i} className="border-t border-[var(--border-default)]"><td className="py-2.5 text-[var(--text-secondary)]">{dataBR(e.data)}</td><td className="text-[var(--text-secondary)]">{e.tipo}{e.manual && <span className="ml-2 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "color-mix(in srgb, var(--info) 16%, transparent)", color: "var(--info)" }}>manual</span>}</td><td className="text-[var(--text-secondary)]">{e.obrigacao ?? "—"}</td><td className={ENTRADA.has(e.tipo) ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}>{ENTRADA.has(e.tipo) ? "+" : ""}{fmt(e.valor, e.moeda)}</td><td className="text-[var(--text-secondary)]">{e.status}</td><td>{e.comprovanteUrl && <a href={e.comprovanteUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--info)]">comprovante</a>}</td></tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="space-y-4">{eventos.map((e, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-16 shrink-0 text-right text-[11px] text-[var(--text-muted)]">{dataBR(e.data)}</div>
            <div className="flex flex-col items-center"><div className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--success)]" style={{ background: "var(--surface-active)" }}><FileText className="h-3.5 w-3.5" /></div>{i < eventos.length - 1 && <div className="mt-1 w-px flex-1" style={{ background: "var(--surface-active)" }} />}</div>
            <div className="flex-1 pb-2"><div className="text-sm font-medium text-[var(--text-primary)]">{e.tipo} <span className="text-xs text-[var(--text-muted)]">· {e.obrigacao}</span></div><div className="text-sm text-[var(--text-secondary)]">{fmt(e.valor, e.moeda)}</div></div>
          </div>
        ))}</div>
      )}
    </div>
  )
}
