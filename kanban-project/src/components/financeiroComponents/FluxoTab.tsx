// CRIAR EM: src/components/financeiroComponents/FluxoTab.tsx
//
// Aba "FLUXO DE CAIXA" — porte fiel do renderFluxo() do mockup, estilo glass.
// Autossuficiente: busca /api/financas/fluxo. Dados REAIS (parcelas a receber
// + contas a pagar combinadas numa timeline). Gráfico combinado Chart.js
// (barras entradas/saídas + linha de saldo acumulado), calendário e timeline.

"use client"

import { useEffect, useState, useRef } from "react"
import { Activity, Download, Upload, Calendar, FileText, Wallet, Loader2 } from "lucide-react"

function fmtBRL(v: number): string { return `R$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtBRLshort(v: number): string {
  const n = Math.abs(v ?? 0)
  if (n >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}k`
  return fmtBRL(v)
}
function fmtDate(d: string | Date | null): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

interface FluxoData {
  kpis: { saldoAtual: number; entradas30: number; qtdEntradas30: number; saidas30: number; qtdSaidas30: number; saldoProjetado30: number; net30: number }
  serie: { date: string; entrada: number; saida: number; saldo: number }[]
  calendario: { day: number | null; hasIn: boolean; hasOut: boolean; isToday: boolean }[]
  mesLabel: string
  timeline: { date: string; desc: string; entrada: number; saida: number; realizado: boolean; past: boolean }[]
}

export default function FluxoTab() {
  const [data, setData] = useState<FluxoData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    fetch("/api/financas/fluxo", { headers: { Authorization: `Bearer ${token}` } })
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
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Activity className="h-5 w-5" /> Fluxo de Caixa</h2>
          <div className="text-xs text-white/60 mt-1">Previsto vs Realizado · 90 dias passados + 90 dias futuros</div>
        </div>
        <div className="flex items-center gap-2">
          <GlassBtn icon={<Upload className="h-3.5 w-3.5" />}>Exportar</GlassBtn>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<Wallet className="h-3.5 w-3.5" />} label="Saldo Atual" value={fmtBRL(k.saldoAtual)} sub="Caixa consolidado" />
        <Kpi icon={<Download className="h-3.5 w-3.5" />} label="Entradas · 30 dias" value={fmtBRL(k.entradas30)} valueColor="text-green-400" sub={`${k.qtdEntradas30} eventos previstos`} />
        <Kpi icon={<Upload className="h-3.5 w-3.5" />} label="Saídas · 30 dias" value={fmtBRL(k.saidas30)} valueColor="text-red-400" sub={`${k.qtdSaidas30} pagamentos`} />
        <Kpi icon={<Activity className="h-3.5 w-3.5" />} label="Saldo Projetado · 30d" value={fmtBRL(k.saldoProjetado30)} valueColor={k.net30 >= 0 ? "text-green-400" : "text-red-400"} sub={`Variação: ${k.net30 >= 0 ? "+" : ""}${fmtBRLshort(k.net30)}`} />
      </div>

      {/* GRÁFICO */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white flex items-center gap-2"><Activity className="h-4 w-4" /> Fluxo Previsto vs Realizado</div>
          <div className="flex gap-3 text-xs text-white/60">
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Entradas</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Saídas</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-300" /> Saldo</span>
          </div>
        </div>
        {d.serie.length === 0 ? (
          <p className="text-sm text-white/40 py-16 text-center">Sem movimentações na janela de tempo.</p>
        ) : (
          <FluxoChart serie={d.serie} />
        )}
      </div>

      {/* CALENDÁRIO + TIMELINE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* calendário */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
          <div className="text-sm font-semibold text-white flex items-center gap-2 mb-3 capitalize"><Calendar className="h-4 w-4" /> Calendário · {d.mesLabel}</div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((dd, i) => <div key={i} className="text-[10px] text-white/40 font-bold py-1">{dd}</div>)}
            {d.calendario.map((c, i) => {
              if (c.day === null) return <div key={i} />
              let bg = "bg-white/5"
              if (c.hasIn && c.hasOut) bg = "bg-gradient-to-br from-green-500/40 to-red-500/40"
              else if (c.hasIn) bg = "bg-green-500/30"
              else if (c.hasOut) bg = "bg-red-500/30"
              return (
                <div key={i} className={`aspect-square flex items-center justify-center rounded text-xs ${bg} ${c.isToday ? "ring-1 ring-white text-white font-bold" : "text-white/70"}`}>
                  {c.day}
                </div>
              )
            })}
          </div>
          <div className="flex gap-4 mt-3 justify-center text-[11px] text-white/60">
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" /> Entrada</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> Saída</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-2 rounded" style={{ background: "linear-gradient(90deg,#22c55e 50%,#ef4444 50%)" }} /> Ambos</span>
          </div>
        </div>

        {/* timeline */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
          <div className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><FileText className="h-4 w-4" /> Timeline de Eventos</div>
          {d.timeline.length === 0 ? (
            <p className="text-sm text-white/40 py-8 text-center">Sem eventos na janela.</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto pr-1 space-y-2">
              {d.timeline.map((t, i) => {
                const cor = t.entrada > 0 && t.saida > 0 ? "border-l-amber-400" : t.entrada > 0 ? "border-l-green-400" : "border-l-red-400"
                return (
                  <div key={i} className={`border-l-2 ${cor} pl-3 py-1`}>
                    <div className="text-[10px] text-white/40">{fmtDate(t.date)} · {t.past || t.realizado ? "realizado" : "previsto"}</div>
                    <div className="text-sm text-white/80">{t.desc}</div>
                    <div className="flex gap-3 text-xs mt-0.5 tabular-nums">
                      {t.entrada > 0 && <span className="text-green-400 font-semibold">+{fmtBRL(t.entrada)}</span>}
                      {t.saida > 0 && <span className="text-red-400 font-semibold">−{fmtBRL(t.saida)}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// GRÁFICO combinado (barras entradas/saídas + linha saldo) — Chart.js
// ============================================================
function FluxoChart({ serie }: { serie: FluxoData["serie"] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)
  useEffect(() => {
    let cancelled = false
    async function draw() {
      const Chart = (await import("chart.js/auto")).default
      if (cancelled || !ref.current) return
      if (chartRef.current) chartRef.current.destroy()
      const labels = serie.map(s => new Date(s.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }))
      chartRef.current = new Chart(ref.current, {
        data: {
          labels,
          datasets: [
            { type: "bar", label: "Entradas", data: serie.map(s => s.entrada), backgroundColor: "rgba(34,197,94,0.55)", borderColor: "#22c55e", borderWidth: 1, borderRadius: 3, stack: "flow" },
            { type: "bar", label: "Saídas", data: serie.map(s => -s.saida), backgroundColor: "rgba(239,68,68,0.55)", borderColor: "#ef4444", borderWidth: 1, borderRadius: 3, stack: "flow" },
            { type: "line", label: "Saldo", data: serie.map(s => s.saldo), borderColor: "#7dd3fc", backgroundColor: "rgba(125,211,252,0.08)", fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 2, yAxisID: "y1" },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { ticks: { callback: (v: any) => "R$ " + (v / 1000).toFixed(0) + "k", color: "rgba(255,255,255,0.5)", font: { size: 10.5 } }, grid: { color: "rgba(255,255,255,0.08)" } },
            y1: { position: "right", ticks: { callback: (v: any) => "R$ " + (v / 1000).toFixed(0) + "k", color: "rgba(125,211,252,0.7)", font: { size: 10 } }, grid: { display: false } },
            x: { ticks: { color: "rgba(255,255,255,0.5)", font: { size: 10 }, maxTicksLimit: 14 }, grid: { display: false } },
          },
        },
      })
    }
    draw()
    return () => { cancelled = true; if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [serie])
  return <div className="h-72"><canvas ref={ref} /></div>
}

// ============================================================
// SUBCOMPONENTES
// ============================================================
function GlassBtn({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-transparent border border-white/30 text-white hover:bg-white/10">{icon}{children}</button>
}
function Kpi({ icon, label, value, sub, valueColor = "text-white" }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; valueColor?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4">
      <div className="flex items-center gap-1.5 text-white/50 text-xs font-medium"><span className="text-white/60">{icon}</span>{label}</div>
      <div className={`font-bold mt-1.5 text-xl ${valueColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-1">{sub}</div>}
    </div>
  )
}