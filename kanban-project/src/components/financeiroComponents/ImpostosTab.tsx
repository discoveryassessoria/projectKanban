// CRIAR EM: src/components/financeiroComponents/ImpostosTab.tsx
//
// Aba "IMPOSTOS E TRIBUTOS" — porte fiel do renderImpostos() do mockup, glass.
// ⚠ Aba inteira é "prévia": o schema não tem tabela de tributos.
// Busca /api/financas/impostos (dados de exemplo).

"use client"

import { useEffect, useState } from "react"
import { Receipt, BarChart3, Plus, Calendar, Info, Loader2 } from "lucide-react"

function fmtBRL(v: number): string { return `R$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtPct(v: number): string { return `${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` }
function fmtDate(d: string | null): string {
  if (!d) return "—"
  return new Date(d + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function fmtMonth(p: string): string {
  const [a, m] = p.split("-")
  return new Date(Number(a), Number(m) - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
}

interface Tributo { id: string; tipo: string; competencia: string; base: number; aliquota: number; provisao: number; vencimento: string; status: string; pagoEm?: string }
interface CalItem { date: string; tipo: string; valor: number; status: string; dueText: string }
interface ImpostosData {
  previa: boolean
  kpis: { provisaoMes: number; qtdGuias: number; aPagar: number; qtdPendentes: number; pagosMes: number; atrasados: number; totalAtrasado: number }
  calendario: CalItem[]
  cargaTributaria: { mes: string; pct: number }[]
  tributos: Tributo[]
}

function statusBadge(status: string) {
  if (status === "pago") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">Pago</span>
  if (status === "previsto") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-white/60 border border-white/20">Previsto</span>
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">A pagar</span>
}

export default function ImpostosTab() {
  const [data, setData] = useState<ImpostosData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    fetch("/api/financas/impostos", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => setData(d)).catch(e => console.error(e)).finally(() => setLoading(false))
  }, [])

  if (loading || !data) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>

  const d = data
  const k = d.kpis

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Receipt className="h-5 w-5" /> Impostos e Tributos <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded font-normal">prévia</span></h2>
          <div className="text-xs text-white/60 mt-1">Provisão automática · {k.qtdPendentes} guias em aberto · regime Simples Nacional</div>
        </div>
        <div className="flex items-center gap-2">
          <GlassBtn icon={<BarChart3 className="h-3.5 w-3.5" />}>Relatório fiscal</GlassBtn>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white"><Plus className="h-3.5 w-3.5" /> Provisionar</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Provisão do mês" value={fmtBRL(k.provisaoMes)} valueColor="text-amber-400" sub={`${k.qtdGuias} guias a vencer`} />
        <Kpi label="Total A Pagar" value={fmtBRL(k.aPagar)} sub={`${k.qtdPendentes} tributos pendentes`} />
        <Kpi label="Pago no mês" value={fmtBRL(k.pagosMes)} valueColor="text-green-400" sub="IRRF · Folha" />
        <Kpi label="Em Atraso" value={`${k.atrasados}`} valueColor={k.atrasados > 0 ? "text-red-400" : "text-white"} sub={k.atrasados > 0 ? fmtBRL(k.totalAtrasado) : "Nenhum atraso"} />
      </div>

      {/* CALENDÁRIO + CARGA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* calendário de vencimentos */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white flex items-center gap-2"><Calendar className="h-4 w-4" /> Calendário de Vencimentos</div>
            <span className="text-[11px] text-white/40">{d.calendario.length} vencimentos</span>
          </div>
          <div className="space-y-2">
            {d.calendario.map((c, i) => {
              const cor = c.status === "pago" ? "border-l-green-400" : c.status === "previsto" ? "border-l-sky-400" : "border-l-amber-400"
              return (
                <div key={i} className={`border-l-2 ${cor} pl-3 py-1`}>
                  <div className="text-[10px] text-white/40">{fmtDate(c.date)} · {c.dueText}</div>
                  <div className="flex justify-between items-center mt-0.5">
                    <span className="text-sm text-white/80 font-medium">{c.tipo}</span>
                    <span className={`text-sm font-bold tabular-nums ${c.status === "pago" ? "text-green-400" : "text-white"}`}>{fmtBRL(c.valor)}</span>
                  </div>
                  <div className="mt-1">{statusBadge(c.status)}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* carga tributária */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
          <div className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><BarChart3 className="h-4 w-4" /> Carga Tributária · Histórico</div>
          <div className="space-y-3">
            {d.cargaTributaria.map((c, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-white/60">{c.mes}</span>
                  <strong className="text-white">{fmtPct(c.pct)}</strong>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-red-500/70 rounded-full" style={{ width: `${(c.pct / 20) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2 mt-4 p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg text-xs text-sky-200/80">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Carga tributária estável em torno de 15% da receita. Avaliar Lucro Presumido se o faturamento ultrapassar R$ 4,8M anuais.</span>
          </div>
        </div>
      </div>

      {/* TABELA */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead>
            <tr className="text-white/40 text-xs border-b border-white/10">
              <th className="text-left font-medium py-1.5">Tributo</th>
              <th className="text-left font-medium py-1.5">Competência</th>
              <th className="text-right font-medium py-1.5">Base</th>
              <th className="text-right font-medium py-1.5">Alíquota</th>
              <th className="text-right font-medium py-1.5">Provisão</th>
              <th className="text-right font-medium py-1.5">Vencimento</th>
              <th className="text-center font-medium py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {d.tributos.map(t => (
              <tr key={t.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                <td className="py-2 text-white/90 font-medium">{t.tipo}</td>
                <td className="py-2 text-white/60 capitalize">{fmtMonth(t.competencia)}</td>
                <td className="py-2 text-right text-white/70 tabular-nums">{fmtBRL(t.base)}</td>
                <td className="py-2 text-right text-white/70 tabular-nums">{t.aliquota.toFixed(1)}%</td>
                <td className="py-2 text-right text-white font-medium tabular-nums">{fmtBRL(t.provisao)}</td>
                <td className="py-2 text-right tabular-nums">
                  <div className="text-white/80">{fmtDate(t.vencimento)}</div>
                  <div className="text-[10px] text-white/40">{t.status === "pago" ? "pago em " + fmtDate(t.pagoEm ?? null) : ""}</div>
                </td>
                <td className="py-2 text-center">{statusBadge(t.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* nota */}
      <div className="flex items-start gap-2 text-xs text-white/50 bg-white/5 border border-white/10 rounded-lg p-3">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>Esta aba é uma <strong className="text-white/70">prévia</strong> com dados de exemplo. A provisão automática de tributos (calculada sobre a receita real) será ligada a uma estrutura própria numa próxima etapa.</span>
      </div>
    </div>
  )
}

// SUBCOMPONENTES
function GlassBtn({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-transparent border border-white/30 text-white hover:bg-white/10">{icon}{children}</button>
}
function Kpi({ label, value, sub, valueColor = "text-white" }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 relative">
      <span className="absolute top-2 right-2 text-[9px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded">prévia</span>
      <div className="text-white/50 text-xs font-medium">{label}</div>
      <div className={`font-bold mt-1.5 text-xl ${valueColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-1">{sub}</div>}
    </div>
  )
}