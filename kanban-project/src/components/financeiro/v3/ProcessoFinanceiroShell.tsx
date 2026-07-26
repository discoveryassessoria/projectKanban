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
import { VisaoGeral } from "@/src/components/financeiro/subabas/VisaoGeral"
import { FileText, FileMinus, CheckSquare, CalendarDays, AlertTriangle, Plus, Eye, Layers, ChevronLeft, ChevronRight, ChevronDown, ArrowDownRight, ArrowUpRight, RefreshCw, SlidersHorizontal, Download, Search, Wallet, BarChart3, Settings, RotateCcw } from "lucide-react"

const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
const dataBR = (s?: string | null) => s ? new Date(s).toLocaleDateString("pt-BR") : "—"
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
    <div className="text-white/80"><ReceitaDetalheView refParam={detalheRef} onVoltar={() => setDetalheRef(null)} /></div>
  )
  const abrirDetalhe = (id: number) => setDetalheRef(String(id))
  return (
    <div className="text-white/80">
      <div className="mb-5 flex flex-wrap gap-6 border-b border-white/10">
        {SUBTABS.map(([id, label]) => (
          <button key={id} onClick={() => setT(id)} className={`-mb-px border-b-2 px-1 pb-3 pt-1 text-sm ${t === id ? "border-[#d2a948] font-medium text-[#d2a948]" : "border-transparent text-white/68 hover:text-white/80"}`}>{label}</button>
        ))}
      </div>
      {t === "visao" && <VisaoGeral processoId={processoId} fxHoje={fxEur} onIrPara={(a) => setT(a)} />}
      {t === "receitas" && <ReceitasTab processoId={processoId} onAbrirDetalhe={abrirDetalhe} />}
      {t === "custos" && <CustosTab processoId={processoId} fx={fxEur} />}
      {t === "extrato" && <ExtratoTab processoId={processoId} fx={fxEur} onAbrirDetalhe={abrirDetalhe} />}
      {t === "timeline" && <TimelineTab processoId={processoId} fx={fxEur} onAbrirDetalhe={abrirDetalhe} />}
    </div>
  )
}

// Custos — lista do processo (obrigações de natureza CUSTO). Discovery Design System.
function CustosTab({ processoId, fx }: { processoId: number; fx: number }) {
  const [obrs, setObrs] = useState<any[] | null>(null)
  const [novo, setNovo] = useState(false)
  const [cancelando, setCancelando] = useState<number | null>(null)
  const [pagar, setPagar] = useState<any | null>(null)
  const [sub, setSub] = useState<"todos" | "pagos" | "apagar">("todos")
  const carregar = () => { fetch(`/api/financeiro/v3/obrigacoes?processoId=${processoId}&natureza=CUSTO`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setObrs(j.obrigacoes ?? [])).catch(() => setObrs([])) }
  async function cancelar(id: number) {
    if (!window.confirm("Cancelar este custo? O histórico é preservado (estorno auditável).")) return
    setCancelando(id)
    try {
      const res = await fetch(`/api/financeiro/v3/obrigacoes/${id}/cancelar`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: "{}" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) alert(j?.erro || `Falha ao cancelar (HTTP ${res.status}).`)
      else carregar()
    } finally { setCancelando(null) }
  }
  useEffect(() => { carregar() }, [processoId])
  if (!obrs) return <div className="py-8 text-sm text-white/40">carregando…</div>

  // BRL vem da FONTE ÚNICA (listarObrigacoes → computeCambioAging), não de fx estimado.
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const quitado = (o: any) => o.recebido >= o.valorContratado - 0.005
  const emAtraso = obrs.filter((o) => o.vencimento && new Date(o.vencimento) < hoje && o.saldo > 0.005)
  const totais = {
    total: obrs.reduce((s, o) => s + (o.contratadoBrl ?? 0), 0),
    pago: obrs.reduce((s, o) => s + (o.recebidoBrl ?? 0), 0),
    apagar: obrs.reduce((s, o) => s + (o.saldoBrl ?? 0), 0),
    atraso: emAtraso.length,
  }
  const lista = obrs.filter((o) => sub === "pagos" ? quitado(o) : sub === "apagar" ? !quitado(o) : true)

  const KpiC = ({ titulo, valor, sub: s, icon: Ic, cor }: any) => (
    <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
      <div className="flex items-start justify-between gap-2"><span className="text-[11px] font-medium uppercase tracking-wide text-white/45">{titulo}</span>{Ic && <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${cor}22`, color: cor }}><Ic className="h-4 w-4" /></span>}</div>
      <div className="mt-2 text-2xl font-bold text-white">{valor}</div>
      <div className="mt-1 text-[11px] text-white/40">{s}</div>
    </div>
  )

  return (
    <div>
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">Custos</h2><p className="text-sm text-white/45">Despesas e custos do processo</p></div>
        <div className="flex items-center gap-2">
          <button disabled title="Visão por fases aplicadas indisponível nesta tela" className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#1b2027] px-3.5 py-2 text-sm text-white/80 hover:bg-[#252c35] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#1b2027]"><Layers className="h-4 w-4" /> Fases aplicadas</button>
          <button onClick={() => setNovo(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#d2a948] px-3.5 py-2 text-sm font-medium text-[#1b1508] hover:bg-[#e0b957]"><Plus className="h-4 w-4" /> Novo Custo</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiC titulo="Total" valor={fmt(totais.total)} sub={`${obrs.length} custo(s)`} icon={FileMinus} cor="#7dd3fc" />
        <KpiC titulo="Pago" valor={fmt(totais.pago)} sub="pago em caixa" icon={CheckSquare} cor="#4ade80" />
        <KpiC titulo="A pagar" valor={fmt(totais.apagar)} sub="a pagar" icon={CalendarDays} cor="#fbbf24" />
        <KpiC titulo="Em atraso" valor={`${totais.atraso} parc.`} sub={`${totais.atraso} parcelas`} icon={AlertTriangle} cor="#f87171" />
      </div>

      {/* Tabela */}
      <div className="mt-5 rounded-xl border border-white/10 bg-[#1b2027]">
        <div className="flex items-center gap-6 border-b border-white/10 px-5 pt-4">
          {([["todos", "Todos"], ["pagos", "Pagos"], ["apagar", "A Pagar"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setSub(id)} className={`-mb-px border-b-2 pb-3 text-sm ${sub === id ? "border-[#d2a948] font-medium text-[#d2a948]" : "border-transparent text-white/68 hover:text-white/80"}`}>{label}</button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-white/40">{["Descrição", "Categoria", "Total", "Total (BRL)", "Câmbio", "Vencimento", "Progresso", "Status", "Ações"].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>{lista.map((o) => {
              const prog = o.valorContratado > 0 ? Math.min(100, Math.round((o.recebido / o.valorContratado) * 100)) : 0
              const quit = quitado(o)
              return (
                <tr key={o.obrigacaoId} className="border-t border-white/10 hover:bg-[#20262e]">
                  <td className="px-5 py-4"><div className="max-w-[220px] text-white/95">{o.descricao ?? o.codigoOperacional ?? `#${o.obrigacaoId}`}</div>{o.codigoOperacional && <div className="text-xs text-white/40">{o.codigoOperacional}</div>}</td>
                  <td className="px-5 text-white/70">{o.categoria ?? "—"}</td>
                  <td className="px-5 text-white/95">{fmt(o.valorContratado, o.moeda)}</td>
                  <td className="px-5 text-white/70">{fmt(o.contratadoBrl ?? 0)}</td>
                  <td className="px-5"><span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">{o.moeda}</span></td>
                  <td className="px-5 text-white/70">{o.vencimento ? dataBR(o.vencimento) : "—"}</td>
                  <td className="px-5"><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[#4ade80]" style={{ width: `${prog}%` }} /></div><span className="text-[11px] text-white/50">{prog}%</span></div></td>
                  <td className="px-5">{quit ? <span className="rounded bg-[#4ade80]/15 px-2 py-0.5 text-[11px] font-semibold text-[#4ade80]">Pago</span> : <span className="rounded bg-[#fbbf24]/15 px-2 py-0.5 text-[11px] font-semibold text-[#fbbf24]">A pagar</span>}</td>
                  <td className="px-5"><div className="flex items-center gap-2">{!quit && <button onClick={() => setPagar(o)} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500">Pagar</button>}<button onClick={() => cancelar(o.obrigacaoId)} disabled={cancelando === o.obrigacaoId} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 hover:border-[#f87171]/50 hover:text-[#f87171] disabled:opacity-50">{cancelando === o.obrigacaoId ? "…" : "Cancelar"}</button></div></td>
                </tr>
              )
            })}{lista.length === 0 && <tr><td colSpan={9} className="px-5 py-8 text-center text-white/40">Nenhum custo neste processo.</td></tr>}</tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-4 text-sm text-white/40"><span>Mostrando {lista.length} de {lista.length} registro{lista.length === 1 ? "" : "s"}</span><div className="flex items-center gap-1"><button disabled title="Página única" className="rounded border border-white/10 p-1.5 text-white/40 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="rounded border border-[#d2a948]/40 bg-[#d2a948]/12 px-2.5 py-1 text-xs text-[#d2a948]">1</span><button disabled title="Página única" className="rounded border border-white/10 p-1.5 text-white/40 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>
      </div>
      {novo && <LancamentoManualModal natureza="CUSTO" processoId={processoId} onClose={() => setNovo(false)} onCriado={() => { setNovo(false); carregar() }} />}
      {pagar && <RegistrarPagamentoModal obrigacaoId={pagar.obrigacaoId} moeda={pagar.moeda} saldo={pagar.saldo} natureza="CUSTO" onClose={() => setPagar(null)} onDone={() => { setPagar(null); carregar() }} />}
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
  if (!movs) return <div className="py-8 text-sm text-white/40">carregando…</div>
  const totEntradas = movs.filter((m) => m.entradaSaida === "ENTRADA").reduce((s, m) => s + (m.valorBrl || 0), 0)
  const totSaidas = movs.filter((m) => m.entradaSaida === "SAIDA").reduce((s, m) => s + (m.valorBrl || 0), 0)
  const resultado = Math.round((totEntradas - totSaidas) * 100) / 100
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">Extrato financeiro</h2><p className="text-sm text-white/45">Projeção cronológica dos movimentos do razão (Ledger) do processo.</p></div>
        <button onClick={() => baixarCSV("extrato-ledger", lista.map((m) => ({ Data: dataBR(m.data), Tipo: m.tipo, Documento: m.codigo ?? "", Descricao: m.descricao, Fluxo: m.entradaSaida, Valor: m.valorBrl, SaldoObrigacao: m.saldoObrigacaoApos })))} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#1b2027] px-3.5 py-2 text-sm text-white/80 hover:bg-[#252c35]"><Download className="h-4 w-4" /> Exportar</button>
      </div>
      <div className="mt-4 rounded-xl border border-white/10 bg-[#1b2027] p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <FiltroBox label="Fluxo" valor={fluxo === "entradas" ? "Entradas" : fluxo === "saidas" ? "Saídas" : "Todos"} options={["Todos", "Entradas", "Saídas"]} onChange={(v) => setFluxo(v === "Entradas" ? "entradas" : v === "Saídas" ? "saidas" : "todos")} />
          <FiltroBox label="Tipo de movimento" valor={fTipo} options={tiposMov} onChange={setFTipo} />
          <div className="relative md:col-span-2"><div className="mb-1 text-xs text-white/40">Buscar</div><Search className="pointer-events-none absolute left-3 top-[30px] h-4 w-4 text-white/40" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar descrição, documento, tipo..." className="w-full rounded-lg border border-white/10 bg-[#12161c] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-white/30" /></div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <ExtKpi titulo="Entradas (caixa)" valor={fmt(totEntradas)} sub="recebimentos" icon={ArrowDownRight} cor="#4ade80" />
        <ExtKpi titulo="Saídas (caixa)" valor={fmt(totSaidas)} sub="pagamentos" icon={ArrowUpRight} cor="#fbbf24" />
        <ExtKpi titulo="Resultado de caixa" valor={fmt(resultado)} sub="Entradas − Saídas" icon={BarChart3} cor="#7dd3fc" />
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-white/10 bg-[#1b2027]">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-white/40">{["Data", "Movimento", "Documento", "Descrição", "Entrada", "Saída", "Saldo da obrigação", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{lista.map((m, i) => (
            <tr key={`${m.transacaoId}-${i}`} className="border-t border-white/10 hover:bg-[#20262e]">
              <td className="px-4 py-3.5 text-white/70">{dataBR(m.data)}</td>
              <td className="px-4"><span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">{m.tipo}</span></td>
              <td className="px-4 text-white/68">{m.codigo ?? "—"}</td>
              <td className="px-4"><div className="max-w-[260px] text-white/90">{m.descricao}</div></td>
              <td className="px-4 tabular-nums text-[#4ade80]">{m.entradaSaida === "ENTRADA" ? fmt(m.valorBrl) : "—"}</td>
              <td className="px-4 tabular-nums text-[#fbbf24]">{m.entradaSaida === "SAIDA" ? fmt(m.valorBrl) : "—"}</td>
              <td className="px-4 tabular-nums text-[#7dd3fc]">{fmt(m.saldoObrigacaoApos)}</td>
              <td className="px-4"><button onClick={() => onAbrirDetalhe ? onAbrirDetalhe(m.obrigacaoId) : router.push(`/financeiro/v3/receita/${m.obrigacaoId}`)} title="Abrir obrigação" className="grid h-7 w-7 place-items-center rounded-md text-white/40 hover:bg-white/10 hover:text-white/70"><Eye className="h-4 w-4" /></button></td>
            </tr>
          ))}{lista.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-white/40">Sem movimentos no razão.</td></tr>}</tbody>
        </table>
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-sm text-white/40"><span>Mostrando {lista.length} de {lista.length} movimento{lista.length === 1 ? "" : "s"}</span></div>
      </div>
    </div>
  )
}
function FiltroBox({ label, valor, className = "", options, onChange }: { label: string; valor: string; className?: string; options?: string[]; onChange?: (v: string) => void }) {
  if (options && onChange) {
    return (
      <label className={`text-xs text-white/40 ${className}`}>{label}
        <div className="relative mt-1">
          <select value={valor} onChange={(e) => onChange(e.target.value)} className="w-full appearance-none rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 pr-8 text-sm text-white/80 outline-none focus:border-[#7dd3fc]/50">
            {options.map((o) => <option key={o} value={o} className="bg-[#20262e]">{o}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
        </div>
      </label>
    )
  }
  return (
    <label className={`text-xs text-white/40 ${className}`}>{label}
      <div className="mt-1 flex items-center justify-between rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm"><span className="text-white/70">{valor}</span><ChevronDown className="h-3.5 w-3.5 text-white/40" /></div>
    </label>
  )
}
function ExtKpi({ titulo, valor, sub, icon: Ic, cor }: any) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
      <div className="flex items-start justify-between gap-2"><span className="text-[11px] font-medium uppercase tracking-wide text-white/45">{titulo}</span><Ic className="h-4 w-4" style={{ color: cor }} /></div>
      <div className="mt-2 text-2xl font-bold" style={{ color: cor }}>{valor}</div>
      <div className="mt-1 text-[11px] text-white/40">{sub}</div>
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
    let acc = 0
    const comSaldo = asc.map((mv) => { acc += mv.receita ? mv.valorBRL : -mv.valorBRL; return { ...mv, saldoAcum: acc } })
    return comSaldo.reverse()
  }, [obrs, fx])
  const cats = useMemo(() => ["Todas", ...Array.from(new Set(movsAll.map((mv) => mv.categoria)))], [movsAll])
  const respOpts = useMemo(() => ["Todos", ...Array.from(new Set(movsAll.map((mv) => mv.responsavel).filter((v): v is string => !!v)))], [movsAll])
  const movs = useMemo(() => movsAll.filter((mv) => (fCat === "Todas" || mv.categoria === fCat) && (fResp === "Todos" || mv.responsavel === fResp) && (!soPend || !mv.quitado) && (!busca || `${mv.descricao} ${mv.codigo} ${mv.categoria} ${mv.responsavel ?? ""}`.toLowerCase().includes(busca.toLowerCase()))), [movsAll, fCat, fResp, soPend, busca])
  const iniciais = (nome: string | null) => (nome ?? "").split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "—"
  const horaBR = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""
  if (!obrs) return <div className="py-8 text-sm text-white/40">carregando…</div>
  const totReceitas = movsAll.filter((m) => m.receita).reduce((s, m) => s + m.valorBRL, 0)
  const totCustos = movsAll.filter((m) => !m.receita).reduce((s, m) => s + m.valorBRL, 0)
  const saldoFinal = totReceitas - totCustos
  // resumo por categoria
  const catMap = new Map<string, number>()
  movsAll.forEach((m) => catMap.set(m.categoria, (catMap.get(m.categoria) ?? 0) + m.valorBRL))
  const totCat = [...catMap.values()].reduce((s, v) => s + v, 0) || 1
  const CORES = ["#4ade80", "#fbbf24", "#7dd3fc", "#a78bfa", "#f87171"]
  const categorias = [...catMap.entries()].sort((a, b) => b[1] - a[1]).map(([nome, valor], i) => ({ nome, valor, pct: (valor / totCat) * 100, cor: CORES[i % CORES.length] }))
  const hojeStr = new Date().toISOString().slice(0, 10)
  const hojeN = movsAll.filter((m) => (m.data ?? "").slice(0, 10) === hojeStr).length
  const recebidas = movsAll.filter((m) => m.receita && m.quitado).length
  const pendentes = movsAll.filter((m) => !m.quitado).length

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">Timeline financeira</h2><p className="text-sm text-white/45">Linha do tempo completa de todas as movimentações e eventos financeiros do processo.</p></div>
        <button onClick={() => baixarCSV("timeline-financeira", movs.map((mv) => ({ Data: mv.data ? dataBR(mv.data) : "", Tipo: mv.receita ? "Receita" : "Custo", Categoria: mv.categoria, Descricao: mv.descricao, Documento: mv.codigo, Valor: mv.valorBRL, SaldoApos: mv.saldoAcum, Responsavel: mv.responsavel ?? "", Status: mv.quitado ? (mv.receita ? "Recebido" : "Pago") : (mv.receita ? "A receber" : "A pagar") })))} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#1b2027] px-3.5 py-2 text-sm text-white/80 hover:bg-[#252c35]"><Download className="h-4 w-4" /> Exportar</button>
      </div>

      {/* Filtros */}
      <div className="mt-4 rounded-xl border border-white/10 bg-[#1b2027] p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <label className="text-xs text-white/40">Período<div className="mt-1 flex items-center justify-between rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm"><span className="text-white/70">01/06/2026 - 24/07/2026</span><CalendarDays className="h-3.5 w-3.5 text-white/40" /></div></label>
          <FiltroBox label="Tipo" valor="Todos" />
          <FiltroBox label="Categoria" valor={fCat} options={cats} onChange={setFCat} />
          <FiltroBox label="Fase" valor="Todas" />
          <FiltroBox label="Responsável" valor={fResp} options={respOpts} onChange={setFResp} />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="relative min-w-[240px] flex-1"><div className="mb-1 text-xs text-white/40">Buscar</div><Search className="pointer-events-none absolute left-3 top-[30px] h-4 w-4 text-white/40" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar descrição, documento, origem..." className="w-full rounded-lg border border-white/10 bg-[#12161c] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-white/30" /></div>
          <button onClick={() => setSoPend((v) => !v)} className={`mb-[1px] inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${soPend ? "border-[#d2a948]/50 bg-[#d2a948]/12 text-[#d2a948]" : "border-white/10 bg-[#12161c] text-white/70"}`}><SlidersHorizontal className="h-3.5 w-3.5" /> {soPend ? "Só pendentes" : "Filtros rápidos"}</button>
          <button onClick={() => setBusca("")} className="mb-[1px] inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/70"><RotateCcw className="h-3.5 w-3.5" /> Limpar filtros</button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
        {/* Timeline */}
        <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
          <div className="mb-3 text-xs text-white/40">Ordenado por: Data (mais recente)</div>
          {movs.length === 0 ? <div className="py-10 text-center text-sm text-white/40">Sem movimentações financeiras.</div> : (
            <div className="relative pl-1">
              {movs.map((mv, i) => (
                <div key={mv.id} className="flex gap-3">
                  <div className="flex w-16 shrink-0 flex-col items-end pt-1 text-right"><span className="text-[11px] text-white/60">{mv.data ? dataBR(mv.data) : "—"}</span><span className="text-[10px] text-white/35">{horaBR(mv.data)}</span></div>
                  <div className="flex flex-col items-center">
                    <span className="grid h-9 w-9 place-items-center rounded-full" style={{ background: `${mv.receita ? "#4ade80" : "#fbbf24"}22`, color: mv.receita ? "#4ade80" : "#fbbf24" }}>{mv.receita ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</span>
                    {i < movs.length - 1 && <span className="mt-1 w-px flex-1 bg-white/10" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium" style={{ color: mv.receita ? "#4ade80" : "#fbbf24" }}>{mv.receita ? "Receita" : "Custo"} <span className="text-white/40">· {mv.codigo}</span></div>
                        <div className="mt-0.5 truncate text-sm text-white/90">{mv.descricao}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5"><span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">{mv.categoria}</span></div>
                      </div>
                      <div className="flex shrink-0 items-start gap-3">
                        <div className="text-right">
                          <div className="tabular-nums text-sm font-semibold" style={{ color: mv.receita ? "#4ade80" : "#fbbf24" }}>{mv.receita ? "" : "-"}{fmt(mv.valorBRL)}</div>
                          <div className="text-[11px] text-white/40">Saldo após: {fmt(mv.saldoAcum)}</div>
                          <div className="mt-1 flex items-center justify-end gap-2">
                            {mv.quitado ? <span className="rounded bg-[#4ade80]/15 px-2 py-0.5 text-[11px] font-semibold text-[#4ade80]">{mv.receita ? "Recebido" : "Pago"}</span> : <span className="rounded bg-[#fbbf24]/15 px-2 py-0.5 text-[11px] font-semibold text-[#fbbf24]">{mv.receita ? "A receber" : "A pagar"}</span>}
                          </div>
                          {mv.responsavel && <div className="mt-1.5 flex items-center justify-end gap-1.5"><span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-[9px] font-semibold text-white/70">{iniciais(mv.responsavel)}</span><span className="text-[11px] text-white/50">{mv.responsavel}</span></div>}
                        </div>
                        <button onClick={() => onAbrirDetalhe ? onAbrirDetalhe(mv.id) : router.push(`/financeiro/v3/receita/${mv.id}`)} title="Abrir movimentação" className="mt-0.5 grid h-7 w-7 place-items-center rounded-md text-white/40 hover:bg-white/10 hover:text-white/70"><span className="text-lg leading-none">⋮</span></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 border-t border-white/10 pt-3 text-center text-xs text-white/40">Mostrando {movs.length} de {movs.length} registro{movs.length === 1 ? "" : "s"}</div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
            <div className="mb-3 text-sm font-semibold text-white">Resumo do período</div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-white/68">Saldo inicial</span><span className="tabular-nums text-white/80">{fmt(0)}</span></div>
              <div className="flex justify-between"><span className="text-white/68">Total receitas</span><span className="tabular-nums text-[#4ade80]">{fmt(totReceitas)}</span></div>
              <div className="flex justify-between"><span className="text-white/68">Total custos</span><span className="tabular-nums text-[#fbbf24]">{fmt(totCustos)}</span></div>
              <div className="flex justify-between"><span className="text-white/68">Ajustes</span><span className="tabular-nums text-white/70">{fmt(0)}</span></div>
              <div className="mt-1 flex justify-between border-t border-white/10 pt-2"><span className="font-medium text-white/80">Saldo final</span><span className="tabular-nums font-semibold text-[#7dd3fc]">{fmt(saldoFinal)}</span></div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
            <div className="mb-3 text-sm font-semibold text-white">Resumo por categoria</div>
            <div className="flex items-center gap-4">
              <MiniDonut itens={categorias} total={totCat === 1 ? 0 : totCat} />
              <div className="flex-1 space-y-1.5 text-xs">
                {categorias.length === 0 ? <span className="text-white/40">Sem dados.</span> : categorias.slice(0, 5).map((c, i) => (
                  <div key={i} className="flex items-center justify-between gap-2"><span className="inline-flex min-w-0 items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.cor }} /><span className="truncate text-white/70">{c.nome}</span></span><span className="shrink-0 text-white/50">{c.pct.toFixed(1)}%</span></div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
            <div className="mb-3 text-sm font-semibold text-white">Atividade recente</div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-white/68">{hojeN} movimentação(ões) hoje</span></div>
              <div className="flex justify-between"><span className="text-white/68">{pendentes} pendente(s)</span></div>
              <div className="flex justify-between"><span className="text-white/68">{recebidas} recebida(s)</span><span className="tabular-nums text-[#4ade80]">{fmt(movs.filter((m) => m.receita && m.quitado).reduce((s, m) => s + m.valorBRL, 0))}</span></div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
            <div className="mb-2 text-sm font-semibold text-white">Legenda de tipos</div>
            <div className="grid grid-cols-2 gap-y-1.5 text-xs text-white/60">
              <span className="inline-flex items-center gap-1.5"><ArrowDownRight className="h-3.5 w-3.5 text-[#4ade80]" /> Receita</span>
              <span className="inline-flex items-center gap-1.5"><ArrowUpRight className="h-3.5 w-3.5 text-[#fbbf24]" /> Custo</span>
              <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 text-[#7dd3fc]" /> Transferência</span>
              <span className="inline-flex items-center gap-1.5"><Settings className="h-3.5 w-3.5 text-[#a78bfa]" /> Ajuste</span>
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
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={thick} />
        {soma > 0 && itens.filter((x) => x.valor > 0).map((x, i) => { const frac = x.valor / soma; const dash = frac * circ; const off = acc * circ; acc += frac; return <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={x.cor} strokeWidth={thick} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-off} /> })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[10px] text-white/40">Total</span><span className="text-xs font-bold text-white">{fmt(total)}</span></div>
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
  if (!pos) return <div className="py-8 text-sm text-white/40">carregando…</div>
  const ENTRADA = new Set(["PAGAMENTO", "PAGAMENTO_PARCIAL", "JUROS", "MULTA"])
  return (
    <div className="rounded-xl border border-white/10 bg-[#1b2027] p-5">
      <div className="mb-3 text-sm font-semibold text-white/80">{modo === "extrato" ? "Extrato do processo" : "Timeline financeira"}</div>
      {eventos.length === 0 ? <div className="text-sm text-white/40">Sem movimentações.</div> : modo === "extrato" ? (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-white/40">{["Data", "Descrição", "Origem", "Valor", "Status", ""].map((h) => <th key={h} className="py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{eventos.map((e, i) => (
            <tr key={i} className="border-t border-white/10"><td className="py-2.5 text-white/70">{dataBR(e.data)}</td><td className="text-white/80">{e.tipo}{e.manual && <span className="ml-2 rounded bg-[#7dd3fc]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#7dd3fc]">manual</span>}</td><td className="text-white/68">{e.obrigacao ?? "—"}</td><td className={ENTRADA.has(e.tipo) ? "text-[#4ade80]" : "text-white/80"}>{ENTRADA.has(e.tipo) ? "+" : ""}{fmt(e.valor, e.moeda)}</td><td className="text-white/68">{e.status}</td><td>{e.comprovanteUrl && <a href={e.comprovanteUrl} target="_blank" rel="noreferrer" className="text-xs text-[#7dd3fc]">comprovante</a>}</td></tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="space-y-4">{eventos.map((e, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-16 shrink-0 text-right text-[11px] text-white/40">{dataBR(e.data)}</div>
            <div className="flex flex-col items-center"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#252c35] text-[#4ade80]"><FileText className="h-3.5 w-3.5" /></div>{i < eventos.length - 1 && <div className="mt-1 w-px flex-1 bg-[#252c35]" />}</div>
            <div className="flex-1 pb-2"><div className="text-sm font-medium text-white/95">{e.tipo} <span className="text-xs text-white/40">· {e.obrigacao}</span></div><div className="text-sm text-white/68">{fmt(e.valor, e.moeda)}</div></div>
          </div>
        ))}</div>
      )}
    </div>
  )
}
