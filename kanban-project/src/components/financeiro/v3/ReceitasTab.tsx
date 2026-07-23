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
import {
  DollarSign, CheckSquare, Clock, CalendarDays, Search, RotateCcw, Plus, MoreVertical, X,
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

  useEffect(() => { fetch(`/api/financeiro/v3/receitas${processoId ? `?processoId=${processoId}` : ""}`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setD(j)).catch(() => setD({ kpis: {}, receitas: [] })) }, [processoId])
  const linhas = useMemo(() => (d?.receitas ?? []).filter((r: any) => !busca || `${r.descricao} ${r.requerente?.nome} ${r.servico} ${r.codigo}`.toLowerCase().includes(busca.toLowerCase())), [d, busca])
  if (!d) return <div className="py-10 text-sm text-neutral-500">carregando…</div>
  const k = d.kpis ?? {}
  const pct = (v: number) => k.totalContratado ? ((v / k.totalContratado) * 100).toFixed(2) : "0,00"

  return (
    <div className="flex gap-5">
      <div className="min-w-0 flex-1">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Kpi titulo="Total contratado" valor={fmt(k.totalContratado ?? 0)} sub={`${k.receitas ?? 0} receita(s)`} icon={DollarSign} classe="from-violet-800/50 to-violet-950/30 border-violet-700/40" iconClasse="text-violet-300" />
          <Kpi titulo="Recebido" valor={fmt(k.recebido ?? 0)} sub={`${pct(k.recebido ?? 0)}% do total`} icon={CheckSquare} classe="from-emerald-800/50 to-emerald-950/30 border-emerald-700/40" iconClasse="text-emerald-300" />
          <Kpi titulo="Saldo a receber" valor={fmt(k.saldoAReceber ?? 0)} sub={`${pct(k.saldoAReceber ?? 0)}% do total`} icon={Clock} classe="from-sky-800/50 to-sky-950/30 border-sky-700/40" iconClasse="text-sky-300" />
          <Kpi titulo="A vencer" valor={fmt(k.aVencer ?? 0)} sub={`${k.aVencerParcelas ?? 0} parcela(s) pendente(s)`} icon={CalendarDays} classe="from-yellow-800/40 to-yellow-950/20 border-yellow-700/30" iconClasse="text-yellow-300/80" />
          <Kpi titulo="Receitas" valor={String(k.receitas ?? 0)} sub="Total de receitas" classe="from-neutral-800/40 to-neutral-900/30 border-neutral-700/40" />
        </div>

        {/* Filtros */}
        <div className="mt-5 rounded-xl border border-neutral-800 bg-[#0f1114] p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Filtro rotulo="Agrupar por" valor="Requerente" />
            <Filtro rotulo="Fase" valor="Todas" />
            <Filtro rotulo="Status" valor="Todos" />
            <Filtro rotulo="Forma de cobrança" valor="Todas" />
            <div className="relative min-w-[280px] flex-1"><div className="mb-1 text-xs text-neutral-500">&nbsp;</div><Search className="pointer-events-none absolute left-3 top-[30px] h-4 w-4 text-neutral-500" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por requerente, serviço, descrição..." className="w-full rounded-lg border border-neutral-800 bg-[#0a0b0d] py-2 pl-9 pr-3 text-sm outline-none placeholder:text-neutral-600" /></div>
            <button onClick={() => setBusca("")} className="mb-[1px] inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-[#0a0b0d] px-3 py-2 text-sm text-neutral-300"><RotateCcw className="h-3.5 w-3.5" /> Limpar filtros</button>
          </div>
        </div>

        {/* Tabela */}
        <div className="mt-5 rounded-xl border border-neutral-800 bg-[#0f1114]">
          <div className="flex items-center justify-between border-b border-neutral-800 px-5 pt-4">
            <div className="flex items-center gap-6">
              {[["receitas", `Receitas (${linhas.length})`], ["req", "Por requerente"], ["forma", "Por forma de cobrança"], ["fase", "Por fase"]].map(([id, label]) => (
                <button key={id} onClick={() => setSubtab(id)} className={`-mb-px border-b-2 pb-3 text-sm ${subtab === id ? "border-amber-400 font-medium text-amber-400" : "border-transparent text-neutral-400 hover:text-neutral-200"}`}>{label}</button>
              ))}
            </div>
            <button className="mb-2 inline-flex items-center gap-2 rounded-lg bg-amber-500/90 px-3.5 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400"><Plus className="h-4 w-4" /> Nova Receita</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500">
              {["Receita", "Requerente", "Serviço", "Valor contratado", "Recebido", "Saldo", "Vencimento", "Status", "Ações"].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>{linhas.map((r: any) => (
              <tr key={r.obrigacaoId} onClick={() => setSel(r)} className="cursor-pointer border-t border-neutral-800/60 hover:bg-neutral-900/40">
                <td className="px-5 py-4"><div className="max-w-[240px] text-neutral-100">{r.descricao ?? r.codigo}</div><div className="text-xs text-neutral-500">{r.codigo}</div></td>
                <td className="px-5">{r.requerente ? <span className="inline-flex items-center gap-2 text-neutral-200">{r.requerente.nome}<span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] text-violet-300">{r.requerente.papel}</span></span> : "—"}</td>
                <td className="px-5 text-neutral-300">{r.servico ?? "—"}</td>
                <td className="px-5 text-neutral-100">{fmt(r.valorContratado, r.moeda)}</td>
                <td className="px-5 text-emerald-400">{fmt(r.recebido, r.moeda)}</td>
                <td className="px-5 text-sky-400">{fmt(r.saldo, r.moeda)}</td>
                <td className="px-5 text-neutral-300">{dataBR(r.vencimento)}</td>
                <td className="px-5"><span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">{r.statusLabel}</span></td>
                <td className="px-5" onClick={(e) => e.stopPropagation()}><button className="text-neutral-500 hover:text-neutral-300"><MoreVertical className="h-4 w-4" /></button></td>
              </tr>
            ))}{linhas.length === 0 && <tr><td colSpan={9} className="px-5 py-8 text-center text-neutral-500">Nenhuma receita.</td></tr>}</tbody>
          </table>
          <div className="flex items-center justify-between px-5 py-4 text-sm text-neutral-500">
            <span>Mostrando {linhas.length} de {linhas.length} registro{linhas.length === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-1"><button className="rounded border border-neutral-800 p-1.5 text-neutral-500"><ChevronLeft className="h-4 w-4" /></button><span className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-400">1</span><button className="rounded border border-neutral-800 p-1.5 text-neutral-500"><ChevronRight className="h-4 w-4" /></button></div>
          </div>
        </div>
      </div>

      {/* Drawer lateral */}
      {sel && <Drawer r={sel} onClose={() => setSel(null)} onRegistrar={() => router.push(`/financeiro/v3/receita/${sel.obrigacaoId}`)} />}
    </div>
  )
}

function Kpi({ titulo, valor, sub, icon: Icon, classe, iconClasse }: any) {
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${classe} p-4`}>
      <div className="flex items-center justify-between"><span className="text-xs text-neutral-300">{titulo}</span>{Icon && <Icon className={`h-4 w-4 ${iconClasse}`} />}</div>
      <div className="mt-2 text-2xl font-bold text-white">{valor}</div>
      <div className="mt-1 text-xs text-neutral-400">{sub}</div>
    </div>
  )
}
function Filtro({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <label className="text-xs text-neutral-500">{rotulo}
      <div className="mt-1 flex items-center justify-between gap-6 rounded-lg border border-neutral-800 bg-[#0a0b0d] px-3 py-2 text-sm text-neutral-200"><span>{valor}</span><ChevronDown className="h-3.5 w-3.5 text-neutral-500" /></div>
    </label>
  )
}
function Drawer({ r, onClose, onRegistrar }: { r: any; onClose: () => void; onRegistrar: () => void }) {
  return (
    <div className="w-[320px] shrink-0 self-start rounded-xl border border-neutral-800 bg-[#0f1114] p-4">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-neutral-200">Detalhes da receita</h3><button onClick={onClose} className="text-neutral-500 hover:text-neutral-300"><X className="h-4 w-4" /></button></div>
      <div className="mt-3 flex items-center justify-between"><span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">{r.statusLabel}</span><a href={`/financeiro/v3/receita/${r.obrigacaoId}`} className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline">Ver movimentações <ExternalLink className="h-3 w-3" /></a></div>
      <div className="mt-4 space-y-3">
        <Campo k="Descrição" v={r.descricao ?? "—"} />
        <Campo k="Processo" v={r.codigo ?? "—"} />
        <Campo k="Requerente">{r.requerente ? <span className="inline-flex items-center gap-2">{r.requerente.nome}<span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] text-violet-300">{r.requerente.papel}</span></span> : "—"}</Campo>
        <Campo k="Serviço" v={r.servico ?? "—"} />
        <Campo k="Forma de cobrança" v={r.formaCobranca} />
        <div className="border-t border-neutral-800" />
        <Campo k="Valor contratado" v={fmt(r.valorContratado, r.moeda)} />
        <Campo k="Recebido"><span className="text-emerald-400">{fmt(r.recebido, r.moeda)}</span></Campo>
        <Campo k="Saldo"><span className="text-sky-400">{fmt(r.saldo, r.moeda)}</span></Campo>
        <Campo k="Vencimento" v={dataBR(r.vencimento)} />
        <Campo k="Status"><span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">{r.statusLabel}</span></Campo>
        <Campo k="Observação" v="—" />
      </div>
      <div className="mt-5 text-sm font-medium text-neutral-300">Ações rápidas</div>
      <div className="mt-2 space-y-2">
        <button onClick={onRegistrar} className="flex w-full items-center gap-2 rounded-lg border border-emerald-700/40 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-400 hover:bg-emerald-600/20"><FileText className="h-4 w-4" /> Registrar pagamento</button>
        <button className="flex w-full items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-400 hover:bg-amber-600/20"><FileText className="h-4 w-4" /> Emitir cobrança</button>
        <button className="flex w-full items-center gap-2 rounded-lg border border-sky-700/40 bg-sky-600/10 px-3 py-2 text-sm text-sky-400 hover:bg-sky-600/20"><FileText className="h-4 w-4" /> Emitir nota fiscal</button>
        <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300"><Receipt className="hidden" />Mais ações <ChevronDown className="h-4 w-4" /></button>
      </div>
    </div>
  )
}
function Campo({ k, v, children }: { k: string; v?: string; children?: React.ReactNode }) {
  return <div><div className="text-xs text-neutral-500">{k}</div><div className="text-sm text-neutral-200">{children ?? v}</div></div>
}
