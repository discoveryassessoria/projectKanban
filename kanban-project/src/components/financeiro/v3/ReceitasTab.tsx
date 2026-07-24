// src/components/financeiro/v3/ReceitasTab.tsx
// ============================================================================
// ABA "RECEITAS" do Financeiro do Processo — tela executiva (Discovery DS).
// BRL é a moeda OPERACIONAL (cards/tabela/saldos); EUR é a BASE contratual com
// câmbio explícito. Fonte única: /api/financeiro/v3/receitas (listarReceitas),
// que já garante contratadoBrl = recebidoBrl + saldoBrl e saldoBrl = aVencer + vencido.
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { LancamentoManualModal } from "./LancamentoManualModal"
import RegistrarPagamentoModal from "./RegistrarPagamentoModal"
import { ReceitaCobrancaModal } from "@/src/components/financeiro/ReceitaCobrancaModal"
import {
  DollarSign, CheckCircle2, Clock, CalendarDays, AlertTriangle, Layers, Search, RotateCcw,
  Plus, X, ExternalLink, FileText, ChevronDown, ChevronLeft, ChevronRight, MoreVertical, Info,
} from "lucide-react"

const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0)
const fmtMoeda = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m || "BRL" }).format(v || 0)
const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : null)
const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }

// statusLabel do backend -> apresentação (label + estado semântico)
const STATUS: Record<string, { label: string; cls: string }> = {
  QUITADO: { label: "Pago", cls: "bg-[#4ade80]/15 text-[#4ade80]" },
  PARCIAL: { label: "Parcialmente pago", cls: "bg-[#7dd3fc]/15 text-[#7dd3fc]" },
  VENCIDO: { label: "Vencido", cls: "bg-[#f87171]/15 text-[#f87171]" },
  "A VENCER": { label: "A vencer", cls: "bg-[#d2a948]/15 text-[#d2a948]" },
}
const statusView = (s?: string) => STATUS[s ?? ""] ?? { label: s ?? "—", cls: "bg-[#252c35] text-white/70" }
const CAMBIO_BADGE: Record<string, string> = { FIXO: "Fixo", VARIAVEL: "Variável", HOJE: "Hoje", BRL: "—", NAO_DEFINIDO: "Não definido" }

const AGRUPAR: [string, string][] = [["receita", "Receita"], ["requerente", "Requerente"], ["forma", "Forma de cobrança"], ["fase", "Fase"]]
const PAGE = 10

export function ReceitasTab({ processoId }: { processoId?: number }) {
  const router = useRouter()
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState("")
  const [agrupar, setAgrupar] = useState("receita")
  const [fFase, setFFase] = useState("Todas")
  const [fStatus, setFStatus] = useState("Todos")
  const [fForma, setFForma] = useState("Todas")
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState<any>(null)
  const [novo, setNovo] = useState(false)
  const [pagar, setPagar] = useState<any | null>(null)
  const [cobrar, setCobrar] = useState<number | null>(null)

  const carregar = () => {
    setLoading(true); setErro(null)
    fetch(`/api/financeiro/v3/receitas${processoId ? `?processoId=${processoId}` : ""}`, { headers: authHeaders() })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j) => setD(j))
      .catch(() => setErro("Não foi possível carregar as receitas."))
      .finally(() => setLoading(false))
  }
  useEffect(() => { carregar() }, [processoId])
  useEffect(() => { setPage(1) }, [busca, fFase, fStatus, fForma, agrupar])

  const receitas: any[] = d?.receitas ?? []
  const k = d?.kpis ?? {}
  const nomeProc = d?.processo?.nome ?? d?.processo?.codigo ?? "deste processo"

  // opções REAIS (derivadas dos dados — nunca inventadas)
  const fases = useMemo(() => ["Todas", ...Array.from(new Set(receitas.map((r) => r.fase).filter(Boolean)))], [receitas])
  const formas = useMemo(() => ["Todas", ...Array.from(new Set(receitas.map((r) => r.formaCobranca).filter(Boolean)))], [receitas])
  const statusOpts = useMemo(() => ["Todos", ...Array.from(new Set(receitas.map((r) => statusView(r.statusLabel).label)))], [receitas])

  const filtradas = useMemo(() => receitas.filter((r) => {
    if (fFase !== "Todas" && (r.fase ?? "") !== fFase) return false
    if (fForma !== "Todas" && (r.formaCobranca ?? "") !== fForma) return false
    if (fStatus !== "Todos" && statusView(r.statusLabel).label !== fStatus) return false
    if (busca.trim()) { const q = busca.toLowerCase(); if (![r.descricao, r.requerente?.nome, r.servico, r.codigo].filter(Boolean).some((s: string) => String(s).toLowerCase().includes(q))) return false }
    return true
  }), [receitas, fFase, fForma, fStatus, busca])

  const grupoDe = (r: any): string =>
    agrupar === "requerente" ? (r.requerente?.nome ?? "Requerente não identificado")
    : agrupar === "forma" ? (r.formaCobranca ?? "—")
    : agrupar === "fase" ? (r.fase ?? "Sem fase")
    : "__flat"

  const limparFiltros = () => { setBusca(""); setFFase("Todas"); setFStatus("Todos"); setFForma("Todas") }

  // ── estados ──────────────────────────────────────────────────────────────
  if (loading && !d) return <SkeletonTela />
  if (erro) return (
    <div className="rounded-xl border border-white/10 bg-[#1b2027] p-10 text-center">
      <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-[#f87171]" />
      <div className="text-sm text-white/80">{erro}</div>
      <button onClick={carregar} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#20262e] px-4 py-2 text-sm text-white/85 hover:bg-[#252c35]"><RotateCcw className="h-4 w-4" /> Tentar novamente</button>
    </div>
  )

  return (
    <div className="flex gap-5">
      <div className="min-w-0 flex-1">
        {/* Breadcrumb */}
        <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-white/40">
          Processos <span className="text-white/25">›</span> <span className="text-white/60">{nomeProc}</span> <span className="text-white/25">›</span> Financeiro <span className="text-white/25">›</span> <span className="text-white/60">Receitas</span>
        </div>
        {/* Cabeçalho */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold text-white">Receitas</h1>
            <p className="text-sm text-white/45">Todas as receitas e cobranças do processo {nomeProc}.</p>
          </div>
          <button onClick={() => setNovo(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8]"><Plus className="h-4 w-4" /> Nova Receita</button>
        </div>

        {/* 6 CARDS */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <Card titulo="Total contratado" valor={brl(k.totalContratadoBrl ?? 0)} icon={DollarSign} cor="#9aa4b2"
            sub={<>{k.baseContratual ? <>Base contratual: {fmtMoeda(k.baseContratual.valor, k.baseContratual.moeda)}<br /></> : null}{k.receitas ?? 0} receita{(k.receitas ?? 0) === 1 ? "" : "s"}</>} />
          <Card titulo="Recebido" valor={brl(k.recebidoBrl ?? 0)} icon={CheckCircle2} cor="#4ade80" valorCor={(k.recebidoBrl ?? 0) > 0 ? "text-[#4ade80]" : undefined}
            sub={<>{pctDe(k.recebidoBrl, k.totalContratadoBrl)}% do total<br />{k.parcelasRecebidas ?? 0} parcela(s) recebida(s)</>} />
          <Card titulo="Saldo a receber" valor={brl(k.saldoBrl ?? 0)} icon={Clock} cor="#7dd3fc"
            sub={<>{pctDe(k.saldoBrl, k.totalContratadoBrl)}% do total<br />{(k.parcelasAVencer ?? 0) + (k.parcelasVencidas ?? 0)} parcela(s) em aberto</>} />
          <Card titulo="A vencer" valor={brl(k.aVencerBrl ?? 0)} icon={CalendarDays} cor="#d2a948"
            sub={<>{k.parcelasAVencer ?? 0} parcela(s)<br />{k.proximoVencimento ? <>Próximo vencimento: {dataBR(k.proximoVencimento)}</> : "Sem vencimento próximo"}</>} />
          <Card titulo="Vencido" valor={brl(k.vencidoBrl ?? 0)} icon={AlertTriangle} cor="#f87171" valorCor={(k.vencidoBrl ?? 0) > 0 ? "text-[#f87171]" : undefined}
            sub={<>{k.parcelasVencidas ?? 0} parcela(s) vencida(s){k.parcelasVencidas ? <><br />Requer atenção</> : null}</>} />
          <Card titulo="Receitas" valor={String(k.receitas ?? 0)} icon={Layers} cor="#a78bfa" sub="Total de receitas ativas" />
        </div>

        {/* FILTROS */}
        <div className="mt-5 rounded-xl border border-white/10 bg-[#1b2027] p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Sel rotulo="Agrupar por" value={agrupar} onChange={setAgrupar} options={AGRUPAR.map(([v, l]) => ({ value: v, label: l }))} />
            <Sel rotulo="Fase" value={fFase} onChange={setFFase} options={fases.map((f) => ({ value: f, label: f }))} />
            <Sel rotulo="Status" value={fStatus} onChange={setFStatus} options={statusOpts.map((s) => ({ value: s, label: s }))} />
            <Sel rotulo="Forma de cobrança" value={fForma} onChange={setFForma} options={formas.map((f) => ({ value: f, label: f }))} />
            <div className="relative min-w-[240px] flex-1">
              <div className="mb-1 text-xs text-white/40">Buscar</div>
              <Search className="pointer-events-none absolute left-3 top-[30px] h-4 w-4 text-white/40" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por receita, requerente, serviço…" className="w-full rounded-lg border border-white/10 bg-[#12161c] py-2 pl-9 pr-3 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-[#7dd3fc]/50" />
            </div>
            <button onClick={limparFiltros} className="mb-[1px] inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/70 hover:bg-[#20262e]"><RotateCcw className="h-3.5 w-3.5" /> Limpar filtros</button>
          </div>
        </div>

        {/* TABELA */}
        <div className="mt-5 rounded-xl border border-white/10 bg-[#1b2027]">
          {/* modos de agrupamento (sublinhado âmbar) */}
          <div className="flex items-center gap-6 border-b border-white/10 px-5 pt-4">
            {[["receita", `Todas (${filtradas.length})`], ["requerente", "Por requerente"], ["forma", "Por forma de cobrança"], ["fase", "Por fase"]].map(([id, label]) => (
              <button key={id} onClick={() => setAgrupar(id)} className={`-mb-px border-b-2 pb-3 text-sm ${agrupar === id ? "border-[#d2a948] font-medium text-[#d2a948]" : "border-transparent text-white/60 hover:text-white/80"}`}>{label}</button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-white/40">
                  {["Receita", "Requerente", "Serviço", "Valor-base (EUR)", "Valor contratado (BRL)", "Recebido", "Saldo", "Próximo vencimento", "Status", "Ações"].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 ? (
                  <tr><td colSpan={10} className="px-5 py-14 text-center">
                    <div className="text-sm font-medium text-white/80">Nenhuma receita cadastrada</div>
                    <div className="mt-1 text-sm text-white/40">Crie a primeira receita deste processo.</div>
                    <button onClick={() => setNovo(true)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8]"><Plus className="h-4 w-4" /> Nova Receita</button>
                  </td></tr>
                ) : agrupar === "receita" ? (
                  filtradas.slice((page - 1) * PAGE, page * PAGE).map((r) => <Linha key={r.obrigacaoId} r={r} onAbrir={() => router.push(`/financeiro/v3/receita/${r.obrigacaoId}`)} onDrawer={() => setSel(r)} />)
                ) : (
                  Object.entries(agruparPor(filtradas, grupoDe)).map(([grupo, rows]) => (
                    <FragmentGroup key={grupo} grupo={grupo} rows={rows} onAbrir={(r) => router.push(`/financeiro/v3/receita/${r.obrigacaoId}`)} onDrawer={(r) => setSel(r)} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* rodapé + paginação (só no modo flat) */}
          {agrupar === "receita" && filtradas.length > 0 && (
            <div className="flex items-center justify-between border-t border-white/10 px-5 py-4 text-sm text-white/40">
              <span>Mostrando {Math.min((page - 1) * PAGE + 1, filtradas.length)}–{Math.min(page * PAGE, filtradas.length)} de {filtradas.length} registro{filtradas.length === 1 ? "" : "s"}</span>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border border-white/10 p-1.5 text-white/60 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                <span className="rounded border border-[#d2a948]/40 bg-[#d2a948]/12 px-2.5 py-1 text-xs text-[#d2a948]">{page}</span>
                <button disabled={page * PAGE >= filtradas.length} onClick={() => setPage((p) => p + 1)} className="rounded border border-white/10 p-1.5 text-white/60 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </div>

        {/* BLOCO CAMBIAL */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#161b21] px-4 py-3">
          <div className="flex items-start gap-2 text-[12.5px] text-white/55">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-[#7dd3fc]" />
            <span>Os valores operacionais são apresentados em <strong className="text-white/80">Reais (BRL)</strong>. A moeda-base contratual {k.baseContratual ? <>é <strong className="text-white/80">{k.baseContratual.moeda === "EUR" ? "Euro (EUR)" : k.baseContratual.moeda}</strong></> : "pode ser estrangeira"}.</span>
          </div>
          <button onClick={() => router.push("/cambio")} className="text-[12.5px] font-medium text-[#7dd3fc] hover:underline">Entenda o câmbio aplicado</button>
        </div>
      </div>

      {/* Drawer lateral */}
      {sel && <Drawer r={sel} onClose={() => setSel(null)} onRegistrar={() => setPagar(sel)} onCobrar={() => (sel.receitaId ? setCobrar(sel.receitaId) : alert("Esta receita não tem origem vinculada para gerar cobrança."))} onCancelar={async () => {
        if (!window.confirm("Cancelar esta receita? O histórico é preservado (estorno auditável).")) return
        const res = await fetch(`/api/financeiro/v3/obrigacoes/${sel.obrigacaoId}/cancelar`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: "{}" })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j.ok) alert(j?.erro || `Falha ao cancelar (HTTP ${res.status}).`)
        else { setSel(null); carregar() }
      }} />}

      {novo && processoId != null && <LancamentoManualModal natureza="RECEITA" processoId={processoId} onClose={() => setNovo(false)} onCriado={() => { setNovo(false); carregar() }} />}
      {pagar && <RegistrarPagamentoModal obrigacaoId={pagar.obrigacaoId} moeda={pagar.moeda} saldo={pagar.saldo} natureza="RECEITA" onClose={() => setPagar(null)} onDone={() => { setPagar(null); setSel(null); carregar() }} />}
      {cobrar != null && <ReceitaCobrancaModal receitaId={cobrar} onClose={() => setCobrar(null)} onChanged={() => { setCobrar(null); carregar() }} />}
    </div>
  )
}

// ── helpers de dados ─────────────────────────────────────────────────────────
function pctDe(v: number, total: number): string { return total ? (((v || 0) / total) * 100).toFixed(2).replace(".", ",") : "0,00" }
function agruparPor(rows: any[], key: (r: any) => string): Record<string, any[]> {
  const out: Record<string, any[]> = {}
  for (const r of rows) { const g = key(r); (out[g] ??= []).push(r) }
  return out
}

// ── linha da tabela ──────────────────────────────────────────────────────────
function Linha({ r, onAbrir, onDrawer }: { r: any; onAbrir: () => void; onDrawer: () => void }) {
  const st = statusView(r.statusLabel)
  const isBrl = (r.moedaBase ?? "BRL") === "BRL"
  const badge = CAMBIO_BADGE[r.tipoCambio] ?? "—"
  return (
    <tr className="border-t border-white/10 hover:bg-[#20262e]">
      <td className="px-5 py-3.5">
        <div className="max-w-[220px] truncate font-medium text-white/95">{r.descricao ?? r.codigo ?? "Receita"}</div>
        {r.servico && <div className="truncate text-[12px] text-white/55">{r.servico}</div>}
        {r.codigo && <div className="text-[11px] text-white/35">{r.codigo}</div>}
      </td>
      <td className="px-5">
        {r.requerente ? <div><div className="text-white/85">{r.requerente.nome}</div><div className="text-[11px] text-white/40">{r.requerente.papel}</div></div> : <span className="text-white/40">Requerente não identificado</span>}
      </td>
      <td className="px-5 text-white/70">{r.servico ?? "—"}</td>
      <td className="px-5">
        {isBrl ? <span className="text-white/40">—</span> : (
          <div>
            <div className="text-white/85">{fmtMoeda(r.valorBase, r.moedaBase)}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/45">
              {r.cotacaoAplicada != null ? <>Câmbio: {brl(r.cotacaoAplicada)}</> : "Câmbio não definido"}
              <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${r.tipoCambio === "NAO_DEFINIDO" ? "bg-[#f87171]/15 text-[#f87171]" : "bg-white/10 text-white/60"}`}>{badge}</span>
            </div>
            {r.dataCotacao && <div className="text-[10.5px] text-white/30">{dataBR(r.dataCotacao)}</div>}
          </div>
        )}
      </td>
      <td className="px-5 font-semibold text-white/95">{brl(r.valorContratadoBrl)}</td>
      <td className="px-5">
        <div className={(r.recebidoBrl ?? 0) > 0 ? "text-[#4ade80]" : "text-white/70"}>{brl(r.recebidoBrl)}</div>
        <div className="text-[11px] text-white/40">{r.parcelasRecebidas ?? 0} parcela(s)</div>
      </td>
      <td className="px-5">
        <div className="text-[#7dd3fc]">{brl(r.saldoBrl)}</div>
        <div className="text-[11px] text-white/40">{r.parcelas ?? 0} parcela(s)</div>
      </td>
      <td className="px-5 text-white/70">{dataBR(r.proximoVencimento) ?? <span className="text-white/40">Não definido</span>}</td>
      <td className="px-5"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span></td>
      <td className="px-5">
        <div className="flex items-center gap-1.5">
          <button onClick={onAbrir} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#20262e] px-3 py-1.5 text-xs font-medium text-white/85 hover:bg-[#252c35]"><ExternalLink className="h-3.5 w-3.5" /> Abrir</button>
          <button onClick={onDrawer} title="Mais ações" className="grid h-7 w-7 place-items-center rounded-md text-white/40 hover:bg-white/10 hover:text-white/70"><MoreVertical className="h-4 w-4" /></button>
        </div>
      </td>
    </tr>
  )
}

function FragmentGroup({ grupo, rows, onAbrir, onDrawer }: { grupo: string; rows: any[]; onAbrir: (r: any) => void; onDrawer: (r: any) => void }) {
  const subtotal = rows.reduce((s, r) => s + (r.valorContratadoBrl || 0), 0)
  return (
    <>
      <tr className="border-t border-white/10 bg-[#161b21]">
        <td colSpan={10} className="px-5 py-2.5">
          <span className="text-[12px] font-semibold text-white/80">{grupo}</span>
          <span className="ml-2 rounded-full bg-[#252c35] px-2 py-0.5 text-[11px] text-white/60">{rows.length}</span>
          <span className="ml-2 text-[11px] text-white/40">{brl(subtotal)}</span>
        </td>
      </tr>
      {rows.map((r) => <Linha key={r.obrigacaoId} r={r} onAbrir={() => onAbrir(r)} onDrawer={() => onDrawer(r)} />)}
    </>
  )
}

// ── cards ─────────────────────────────────────────────────────────────────────
function Card({ titulo, valor, sub, icon: Icon, cor, valorCor }: { titulo: string; valor: string; sub: React.ReactNode; icon: any; cor: string; valorCor?: string }) {
  return (
    <div className="flex flex-col rounded-xl border border-white/10 bg-[#1b2027] p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{titulo}</span>
        <span className="grid h-8 w-8 flex-none place-items-center rounded-lg" style={{ background: `${cor}22`, color: cor }}><Icon className="h-4 w-4" /></span>
      </div>
      <div className={`mt-2 text-[22px] font-bold leading-tight ${valorCor ?? "text-white"}`}>{valor}</div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-white/45">{sub}</div>
    </div>
  )
}

function Sel({ rotulo, value, onChange, options }: { rotulo: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="text-xs text-white/40">{rotulo}
      <div className="relative mt-1">
        <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full appearance-none rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 pr-8 text-sm text-white/85 outline-none focus:border-[#7dd3fc]/50">
          {options.map((o) => <option key={o.value} value={o.value} className="bg-[#20262e]">{o.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
      </div>
    </label>
  )
}

// ── drawer (ações rápidas) ──────────────────────────────────────────────────
function Drawer({ r, onClose, onRegistrar, onCobrar, onCancelar }: { r: any; onClose: () => void; onRegistrar: () => void; onCobrar: () => void; onCancelar: () => void }) {
  const st = statusView(r.statusLabel)
  const isBrl = (r.moedaBase ?? "BRL") === "BRL"
  return (
    <div className="w-[320px] shrink-0 self-start rounded-xl border border-white/10 bg-[#1b2027] p-4">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-white/80">Detalhes da receita</h3><button onClick={onClose} className="text-white/40 hover:text-white/70"><X className="h-4 w-4" /></button></div>
      <div className="mt-3 flex items-center justify-between"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span><a href={`/financeiro/v3/receita/${r.obrigacaoId}`} className="inline-flex items-center gap-1 text-xs text-[#7dd3fc] hover:underline">Ver movimentações <ExternalLink className="h-3 w-3" /></a></div>
      <div className="mt-4 space-y-3">
        <Campo k="Descrição" v={r.descricao ?? "—"} />
        <Campo k="Requerente">{r.requerente ? <span>{r.requerente.nome} <span className="text-white/40">· {r.requerente.papel}</span></span> : "Requerente não identificado"}</Campo>
        <Campo k="Serviço" v={r.servico ?? "—"} />
        {!isBrl && <Campo k="Base contratual"><span>{fmtMoeda(r.valorBase, r.moedaBase)} <span className="text-white/40">· câmbio {r.cotacaoAplicada != null ? brl(r.cotacaoAplicada) : "não definido"} ({CAMBIO_BADGE[r.tipoCambio]})</span></span></Campo>}
        <div className="border-t border-white/10" />
        <Campo k="Valor contratado (BRL)"><span className="font-semibold text-white/95">{brl(r.valorContratadoBrl)}</span></Campo>
        <Campo k="Recebido"><span className="text-[#4ade80]">{brl(r.recebidoBrl)}</span></Campo>
        <Campo k="Saldo"><span className="text-[#7dd3fc]">{brl(r.saldoBrl)}</span></Campo>
        <Campo k="A vencer / Vencido"><span><span className="text-[#d2a948]">{brl(r.aVencerBrl)}</span> <span className="text-white/30">/</span> <span className="text-[#f87171]">{brl(r.vencidoBrl)}</span></span></Campo>
        <Campo k="Próximo vencimento" v={dataBR(r.proximoVencimento) ?? "Não definido"} />
      </div>
      <div className="mt-5 text-sm font-medium text-white/70">Ações rápidas</div>
      <div className="mt-2 space-y-2">
        <button onClick={onRegistrar} className="flex w-full items-center gap-2 rounded-lg border border-[#4ade80]/40 bg-[#4ade80]/10 px-3 py-2 text-sm text-[#4ade80] hover:bg-[#4ade80]/20"><FileText className="h-4 w-4" /> Registrar pagamento</button>
        <button onClick={onCobrar} className="flex w-full items-center gap-2 rounded-lg border border-[#d2a948]/40 bg-[#d2a948]/10 px-3 py-2 text-sm text-[#d2a948] hover:bg-[#d2a948]/20"><FileText className="h-4 w-4" /> Emitir cobrança</button>
        <button disabled title="Emissão de nota fiscal ainda não disponível" className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/40"><FileText className="h-4 w-4" /> Emitir nota fiscal <span className="ml-auto text-[10px] uppercase tracking-wide text-white/30">em breve</span></button>
        <button onClick={onCancelar} className="flex w-full items-center gap-2 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-sm text-[#f87171] hover:bg-[#f87171]/20">Cancelar lançamento</button>
      </div>
    </div>
  )
}
function Campo({ k, v, children }: { k: string; v?: string; children?: React.ReactNode }) {
  return <div><div className="text-xs text-white/40">{k}</div><div className="text-sm text-white/80">{children ?? v}</div></div>
}

// ── skeleton ────────────────────────────────────────────────────────────────
function SkeletonTela() {
  return (
    <div className="animate-pulse">
      <div className="mb-5 h-8 w-40 rounded bg-[#20262e]" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[104px] rounded-xl bg-[#1b2027]" />)}
      </div>
      <div className="mt-5 h-16 rounded-xl bg-[#1b2027]" />
      <div className="mt-5 h-72 rounded-xl bg-[#1b2027]" />
    </div>
  )
}
