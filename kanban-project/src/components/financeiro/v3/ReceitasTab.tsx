// src/components/financeiro/v3/ReceitasTab.tsx
// ============================================================================
// ABA "RECEITAS" do Financeiro V3 — reprodução fiel da especificação visual.
// KPIs + filtros + tabela + paginação + drawer lateral "Detalhes da receita".
// Dados exclusivamente do Motor V3 (/api/financeiro/v3/receitas). Ação
// "Registrar pagamento" abre a TELA própria da Receita (não modal).
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { LancamentoManualModal } from "./LancamentoManualModal"
import RegistrarPagamentoModal from "./RegistrarPagamentoModal"
import {
  DollarSign, CheckSquare, Clock, CalendarDays, Search, RotateCcw, Plus, X,
  ExternalLink, FileText, ChevronDown, ChevronLeft, ChevronRight, Receipt,
} from "lucide-react"

const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
const dataBR = (s?: string | null) => s ? new Date(s).toLocaleDateString("pt-BR") : "—"
const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }

export function ReceitasTab({ processoId }: { processoId?: number }) {
  const router = useRouter()
  const [d, setD] = useState<any>(null)
  const [busca, setBusca] = useState("")
  const [sel, setSel] = useState<any>(null)
  const [subtab, setSubtab] = useState("receitas")
  const [novo, setNovo] = useState(false)
  const [pagar, setPagar] = useState<any | null>(null)

  const carregar = () => { fetch(`/api/financeiro/v3/receitas${processoId ? `?processoId=${processoId}` : ""}`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setD(j)).catch(() => setD({ kpis: {}, receitas: [] })) }
  useEffect(() => { carregar() }, [processoId])
  const linhas = useMemo(() => (d?.receitas ?? []).filter((r: any) => !busca || `${r.descricao} ${r.requerente?.nome} ${r.servico} ${r.codigo}`.toLowerCase().includes(busca.toLowerCase())), [d, busca])
  if (!d) return <div className="py-10 text-sm text-white/40">carregando…</div>
  const k = d.kpis ?? {}
  const pct = (v: number) => k.totalContratado ? ((v / k.totalContratado) * 100).toFixed(2) : "0,00"

  return (
    <div className="flex gap-5">
      <div className="min-w-0 flex-1">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Kpi titulo="Total contratado" valor={fmt(k.totalContratado ?? 0, k.moeda)} sub={`${k.receitas ?? 0} receita(s)`} icon={DollarSign} cor="#4ade80" />
          <Kpi titulo="Recebido" valor={fmt(k.recebido ?? 0, k.moeda)} sub={`${pct(k.recebido ?? 0)}% do total`} icon={CheckSquare} cor="#4ade80" />
          <Kpi titulo="Saldo a receber" valor={fmt(k.saldoAReceber ?? 0, k.moeda)} sub={`${pct(k.saldoAReceber ?? 0)}% do total`} icon={Clock} cor="#7dd3fc" />
          <Kpi titulo="A vencer" valor={fmt(k.aVencer ?? 0, k.moeda)} sub={`${k.aVencerParcelas ?? 0} parcela(s) pendente(s)`} icon={CalendarDays} cor="#fbbf24" />
          <Kpi titulo="Receitas" valor={String(k.receitas ?? 0)} sub="Total de receitas" />
        </div>

        {/* Filtros */}
        <div className="mt-5 rounded-xl border border-white/10 bg-[#1b2027] p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Filtro rotulo="Agrupar por" valor="Requerente" />
            <Filtro rotulo="Fase" valor="Todas" />
            <Filtro rotulo="Status" valor="Todos" />
            <Filtro rotulo="Forma de cobrança" valor="Todas" />
            <div className="relative min-w-[280px] flex-1"><div className="mb-1 text-xs text-white/40">&nbsp;</div><Search className="pointer-events-none absolute left-3 top-[30px] h-4 w-4 text-white/40" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por requerente, serviço, descrição..." className="w-full rounded-lg border border-white/10 bg-[#12161c] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-white/30" /></div>
            <button onClick={() => setBusca("")} className="mb-[1px] inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/70"><RotateCcw className="h-3.5 w-3.5" /> Limpar filtros</button>
          </div>
        </div>

        {/* Tabela */}
        <div className="mt-5 rounded-xl border border-white/10 bg-[#1b2027]">
          <div className="flex items-center justify-between border-b border-white/10 px-5 pt-4">
            <div className="flex items-center gap-6">
              {[["receitas", `Receitas (${linhas.length})`], ["req", "Por requerente"], ["forma", "Por forma de cobrança"], ["fase", "Por fase"]].map(([id, label]) => (
                <button key={id} onClick={() => setSubtab(id)} className={`-mb-px border-b-2 pb-3 text-sm ${subtab === id ? "border-[#d2a948] font-medium text-[#d2a948]" : "border-transparent text-white/68 hover:text-white/80"}`}>{label}</button>
              ))}
            </div>
            <button onClick={() => setNovo(true)} className="mb-2 inline-flex items-center gap-2 rounded-lg bg-[#d2a948] px-3.5 py-2 text-sm font-medium text-[#1b1508] hover:bg-[#e0b957]"><Plus className="h-4 w-4" /> Nova Receita</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-white/40">
              {["Receita", "Requerente", "Serviço", "Valor contratado", "Recebido", "Saldo", "Vencimento", "Status", "Ações"].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>{linhas.map((r: any) => (
              <tr key={r.obrigacaoId} onClick={() => setSel(r)} className="cursor-pointer border-t border-white/10 hover:bg-[#252c35]">
                <td className="px-5 py-4"><div className="max-w-[240px] text-white/95">{r.descricao ?? r.codigo}</div><div className="text-xs text-white/40">{r.codigo}</div></td>
                <td className="px-5">{r.requerente ? <span className="inline-flex items-center gap-2 text-white/80">{r.requerente.nome}<span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">{r.requerente.papel}</span></span> : "—"}</td>
                <td className="px-5 text-white/70">{r.servico ?? "—"}</td>
                <td className="px-5 text-white/95">{fmt(r.valorContratado, r.moeda)}</td>
                <td className="px-5 text-[#4ade80]">{fmt(r.recebido, r.moeda)}</td>
                <td className="px-5 text-[#7dd3fc]">{fmt(r.saldo, r.moeda)}</td>
                <td className="px-5 text-white/70">{dataBR(r.vencimento)}</td>
                <td className="px-5"><span className="rounded bg-[#fbbf24]/15 px-2 py-0.5 text-[11px] font-semibold text-[#fbbf24]">{r.statusLabel}</span></td>
                <td className="px-5" onClick={(e) => e.stopPropagation()}><button onClick={() => router.push(`/financeiro/v3/receita/${r.obrigacaoId}`)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#1b2027] px-3 py-1.5 text-xs font-medium text-white/80 hover:border-white/25 hover:text-white"><ExternalLink className="h-3.5 w-3.5" /> Abrir</button></td>
              </tr>
            ))}{linhas.length === 0 && <tr><td colSpan={9} className="px-5 py-8 text-center text-white/40">Nenhuma receita.</td></tr>}</tbody>
          </table>
          <div className="flex items-center justify-between px-5 py-4 text-sm text-white/40">
            <span>Mostrando {linhas.length} de {linhas.length} registro{linhas.length === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-1"><button className="rounded border border-white/10 p-1.5 text-white/40"><ChevronLeft className="h-4 w-4" /></button><span className="rounded border border-[#d2a948]/40 bg-[#d2a948]/12 px-2.5 py-1 text-xs text-[#d2a948]">1</span><button className="rounded border border-white/10 p-1.5 text-white/40"><ChevronRight className="h-4 w-4" /></button></div>
          </div>
        </div>
      </div>

      {/* Drawer lateral */}
      {sel && <Drawer r={sel} onClose={() => setSel(null)} onRegistrar={() => setPagar(sel)} onCancelar={async () => {
        if (!window.confirm("Cancelar esta receita? O histórico é preservado (estorno auditável).")) return
        const res = await fetch(`/api/financeiro/v3/obrigacoes/${sel.obrigacaoId}/cancelar`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: "{}" })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j.ok) alert(j?.erro || `Falha ao cancelar (HTTP ${res.status}).`)
        else { setSel(null); carregar() }
      }} />}

      {/* Modal Nova Receita (lançamento manual) */}
      {novo && processoId != null && <LancamentoManualModal natureza="RECEITA" processoId={processoId} onClose={() => setNovo(false)} onCriado={() => { setNovo(false); carregar() }} />}
      {pagar && <RegistrarPagamentoModal obrigacaoId={pagar.obrigacaoId} moeda={pagar.moeda} saldo={pagar.saldo} natureza="RECEITA" onClose={() => setPagar(null)} onDone={() => { setPagar(null); setSel(null); carregar() }} />}
    </div>
  )
}

function Kpi({ titulo, valor, sub, icon: Icon, cor }: any) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#1b2027] p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-white/50">{titulo}</span>
        {Icon && <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${cor}22`, color: cor }}><Icon className="h-4 w-4" /></span>}
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{valor}</div>
      <div className="mt-1 text-xs text-white/45">{sub}</div>
    </div>
  )
}
function Filtro({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <label className="text-xs text-white/40">{rotulo}
      <div className="mt-1 flex items-center justify-between gap-6 rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/80"><span>{valor}</span><ChevronDown className="h-3.5 w-3.5 text-white/40" /></div>
    </label>
  )
}
function Drawer({ r, onClose, onRegistrar, onCancelar }: { r: any; onClose: () => void; onRegistrar: () => void; onCancelar: () => void }) {
  return (
    <div className="w-[320px] shrink-0 self-start rounded-xl border border-white/10 bg-[#1b2027] p-4">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-white/80">Detalhes da receita</h3><button onClick={onClose} className="text-white/40 hover:text-white/70"><X className="h-4 w-4" /></button></div>
      <div className="mt-3 flex items-center justify-between"><span className="rounded bg-[#fbbf24]/15 px-2 py-0.5 text-[11px] font-semibold text-[#fbbf24]">{r.statusLabel}</span><a href={`/financeiro/v3/receita/${r.obrigacaoId}`} className="inline-flex items-center gap-1 text-xs text-[#7dd3fc] hover:underline">Ver movimentações <ExternalLink className="h-3 w-3" /></a></div>
      <div className="mt-4 space-y-3">
        <Campo k="Descrição" v={r.descricao ?? "—"} />
        <Campo k="Processo" v={r.codigo ?? "—"} />
        <Campo k="Requerente">{r.requerente ? <span className="inline-flex items-center gap-2">{r.requerente.nome}<span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">{r.requerente.papel}</span></span> : "—"}</Campo>
        <Campo k="Serviço" v={r.servico ?? "—"} />
        <Campo k="Forma de cobrança" v={r.formaCobranca} />
        <div className="border-t border-white/10" />
        <Campo k="Valor contratado" v={fmt(r.valorContratado, r.moeda)} />
        <Campo k="Recebido"><span className="text-[#4ade80]">{fmt(r.recebido, r.moeda)}</span></Campo>
        <Campo k="Saldo"><span className="text-[#7dd3fc]">{fmt(r.saldo, r.moeda)}</span></Campo>
        <Campo k="Vencimento" v={dataBR(r.vencimento)} />
        <Campo k="Status"><span className="rounded bg-[#fbbf24]/15 px-2 py-0.5 text-[11px] font-semibold text-[#fbbf24]">{r.statusLabel}</span></Campo>
        <Campo k="Observação" v="—" />
      </div>
      <div className="mt-5 text-sm font-medium text-white/70">Ações rápidas</div>
      <div className="mt-2 space-y-2">
        <button onClick={onRegistrar} className="flex w-full items-center gap-2 rounded-lg border border-[#4ade80]/40 bg-[#4ade80]/10 px-3 py-2 text-sm text-[#4ade80] hover:bg-[#4ade80]/20"><FileText className="h-4 w-4" /> Registrar pagamento</button>
        <button className="flex w-full items-center gap-2 rounded-lg border border-[#d2a948]/40 bg-[#d2a948]/10 px-3 py-2 text-sm text-[#d2a948] hover:bg-[#d2a948]/20"><FileText className="h-4 w-4" /> Emitir cobrança</button>
        <button className="flex w-full items-center gap-2 rounded-lg border border-[#7dd3fc]/40 bg-[#7dd3fc]/10 px-3 py-2 text-sm text-[#7dd3fc] hover:bg-[#7dd3fc]/20"><FileText className="h-4 w-4" /> Emitir nota fiscal</button>
        <button onClick={onCancelar} className="flex w-full items-center gap-2 rounded-lg border border-red-800/40 bg-red-950/20 px-3 py-2 text-sm text-red-300 hover:bg-red-950/40"><Receipt className="hidden" />Cancelar lançamento</button>
      </div>
    </div>
  )
}
function Campo({ k, v, children }: { k: string; v?: string; children?: React.ReactNode }) {
  return <div><div className="text-xs text-white/40">{k}</div><div className="text-sm text-white/80">{children ?? v}</div></div>
}
