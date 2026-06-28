// CRIAR EM: src/components/financeiroComponents/CcTab.tsx
//
// Aba "CENTROS DE CUSTO" — porte fiel do renderCC() do mockup, estilo glass.
// Busca /api/financas/cc. Centros reais (nome/cor) quando existem; orçado/
// executado é sempre "prévia" (schema não liga despesas a centro de custo).

"use client"

import { useEffect, useState, useRef } from "react"
import { Target, Plus, BarChart3, Loader2 } from "lucide-react"

function fmtBRL(v: number): string { return `R$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtBRLshort(v: number): string {
  const n = Math.abs(v ?? 0)
  if (n >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}k`
  return fmtBRL(v)
}
function fmtPct(v: number): string { return `${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` }

interface Centro {
  id: number; nome: string; cor: string; orcado: number; executado: number; mock: boolean
  disponivel: number; pctExecucao: number; pctDoTotal: number; status: string
}
interface CcData {
  temReais: boolean
  centros: Centro[]
  kpis: {
    totalExecutado: number; totalOrcado: number; disponivel: number; pctExecucaoTotal: number
    maiorCC: { nome: string; executado: number; pct: number } | null
    qtdEstouros: number; nomesEstouros: string[]; qtdCentros: number
  }
}

export default function CcTab() {
  const [data, setData] = useState<CcData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    fetch("/api/financas/cc", { headers: { Authorization: `Bearer ${token}` } })
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
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Target className="h-5 w-5" /> Centros de Custo</h2>
          <div className="text-xs text-white/60 mt-1">{k.qtdCentros} centros · {fmtBRLshort(k.totalExecutado)} executado de {fmtBRLshort(k.totalOrcado)} orçado <span className="text-white/30">·prévia</span></div>
        </div>
        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white"><Plus className="h-3.5 w-3.5" /> Novo CC</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 relative">
          <span className="absolute top-2 right-2 text-[9px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded">prévia</span>
          <div className="text-white/50 text-xs font-medium">Total Executado</div>
          <div className="text-xl font-bold text-white mt-1.5">{fmtBRL(k.totalExecutado)}</div>
          <div className="text-[11px] text-white/40 mt-1">{fmtPct(k.pctExecucaoTotal)} do orçamento</div>
          <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${k.pctExecucaoTotal > 90 ? "bg-red-500" : k.pctExecucaoTotal > 75 ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${Math.min(k.pctExecucaoTotal, 100)}%` }} />
          </div>
        </div>
        <Kpi label="Orçamento Disponível" value={fmtBRL(k.disponivel)} valueColor="text-green-400" sub="Saldo restante" mock />
        <Kpi label="Maior CC" value={k.maiorCC?.nome ?? "—"} sub={k.maiorCC ? `${fmtBRLshort(k.maiorCC.executado)} · ${fmtPct(k.maiorCC.pct)}` : ""} mock />
        <Kpi label="Estouros (orçamento)" value={`${k.qtdEstouros}`} valueColor={k.qtdEstouros > 0 ? "text-red-400" : "text-white"} sub={k.nomesEstouros.join(", ") || "Nenhum estouro"} mock />
      </div>

      {/* DISTRIBUIÇÃO + EXECUÇÃO */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
          <div className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><BarChart3 className="h-4 w-4" /> Distribuição por Centro <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">prévia</span></div>
          <DonutCC centros={d.centros} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4 text-xs">
            {d.centros.map(c => (
              <div key={c.id} className="flex justify-between">
                <span className="text-white/70 inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c.cor }} />{c.nome}</span>
                <strong className="text-white">{fmtPct(c.pctDoTotal)}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Execução vs Orçamento <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">prévia</span></div>
          </div>
          <div className="space-y-2.5">
            {d.centros.map(c => {
              const over = c.pctExecucao > 100
              const barColor = over ? "#ef4444" : c.pctExecucao > 85 ? "#f59e0b" : c.cor
              return (
                <div key={c.id}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-white/80">{c.nome}</span>
                    <span className="text-white/60">{fmtBRLshort(c.executado)} <span className="text-white/30">de {fmtBRLshort(c.orcado)}</span> · <strong className={over ? "text-red-400" : c.pctExecucao > 85 ? "text-amber-400" : "text-white/80"}>{fmtPct(c.pctExecucao)}</strong></span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(c.pctExecucao, 100)}%`, background: barColor }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* TABELA */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-white/40 text-xs border-b border-white/10">
              <th className="text-left font-medium py-1.5">Centro de Custo</th>
              <th className="text-right font-medium py-1.5">Orçado</th>
              <th className="text-right font-medium py-1.5">Executado</th>
              <th className="text-right font-medium py-1.5">Disponível</th>
              <th className="text-right font-medium py-1.5">% Execução</th>
              <th className="text-center font-medium py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {d.centros.map(c => {
              const over = c.pctExecucao > 100
              return (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                  <td className="py-2"><span className="inline-flex items-center gap-2 text-white/90 font-medium"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c.cor }} />{c.nome}</span></td>
                  <td className="py-2 text-right text-white/70 tabular-nums">{fmtBRL(c.orcado)}</td>
                  <td className="py-2 text-right text-white font-medium tabular-nums">{fmtBRL(c.executado)}</td>
                  <td className={`py-2 text-right tabular-nums ${over ? "text-red-400" : "text-white/70"}`}>{fmtBRL(c.disponivel)}</td>
                  <td className={`py-2 text-right tabular-nums font-medium ${over ? "text-red-400" : c.pctExecucao > 85 ? "text-amber-400" : "text-green-400"}`}>{fmtPct(c.pctExecucao)}</td>
                  <td className="py-2 text-center">
                    {c.status === "estourou" ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">Estourou</span>
                      : c.status === "atencao" ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">Atenção</span>
                      : <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">OK</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================================
// DONUT (Chart.js)
// ============================================================
function DonutCC({ centros }: { centros: Centro[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)
  useEffect(() => {
    let cancelled = false
    async function draw() {
      const Chart = (await import("chart.js/auto")).default
      if (cancelled || !ref.current) return
      if (chartRef.current) chartRef.current.destroy()
      chartRef.current = new Chart(ref.current, {
        type: "doughnut",
        data: { labels: centros.map(c => c.nome), datasets: [{ data: centros.map(c => c.executado), backgroundColor: centros.map(c => c.cor), borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { display: false } } },
      })
    }
    draw()
    return () => { cancelled = true; if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [centros])
  return <div className="h-48"><canvas ref={ref} /></div>
}

// ============================================================
// SUBCOMPONENTES
// ============================================================
function Kpi({ label, value, sub, valueColor = "text-white", mock }: {
  label: string; value: string; sub?: string; valueColor?: string; mock?: boolean
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 relative">
      {mock && <span className="absolute top-2 right-2 text-[9px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded">prévia</span>}
      <div className="text-white/50 text-xs font-medium">{label}</div>
      <div className={`font-bold mt-1.5 text-xl ${valueColor} truncate`}>{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-1 truncate">{sub}</div>}
    </div>
  )
}