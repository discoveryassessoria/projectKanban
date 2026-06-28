// CRIAR/SUBSTITUIR EM: src/components/financeiroComponents/TesourariaTab.tsx
//
// Aba TESOURARIA — porte fiel do renderTesouraria() do mockup, estilo glass.
// Autossuficiente: busca /api/financas/tesouraria.
// Quando o banco tem contas reais, mostra reais; senão, mostra as 6 do mockup
// como "prévia". Tabela de conciliação, quick chips, doughnut de moeda,
// cards com agência/tag/projeção, transferências em moeda nativa, projeção 45d.

"use client"

import { useEffect, useState, useRef } from "react"
import {
  Landmark, Briefcase, ArrowRightLeft, RefreshCw, BarChart3, Plus,
  TrendingUp, Loader2, Scale,
} from "lucide-react"

function fmtBRL(v: number): string { return `R$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtBRLshort(v: number): string {
  const n = Math.abs(v ?? 0)
  if (n >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}k`
  return fmtBRL(v)
}
function fmtEUR(v: number): string { return `€ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtUSD(v: number): string { return `US$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtPct(v: number): string { return `${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` }
function fmtMoeda(v: number, moeda: string): string {
  if (moeda === "EUR") return fmtEUR(v)
  if (moeda === "USD") return fmtUSD(v)
  return fmtBRL(v)
}

interface Conta {
  id: number; nome: string; banco: string | null; tipo: string; moeda: string
  saldoNativo: number; saldoBRL: number; projetadoNativo: number; projetadoBRL: number
  cor: string | null; principal: boolean; mock: boolean
}
interface TesourariaData {
  temReais: boolean
  contas: Conta[]
  totalBRL: number; projetadoBRL: number; brlBRL: number; eurNativo: number; usdNativo: number
  contagem: { todas: number; BRL: number; EUR: number; USD: number; conta_corrente: number; reserva: number }
  saldoPorTipo: Record<string, number>
  conciliacao: { nome: string; saldoSistema: number; saldoBanco: number; diferenca: number; pendencias: number }[]
  fx: { EUR: number; USD: number; BRL: number }
  ultimaConciliacao: string
  mock: {
    transferencias: { data: string; hora: string; de: string; para: string; moeda: string; valor: number; taxa: number | null; obs: string; por: string }[]
    projecao45: { dia: number; saldo: number }[]
    cotacoes: { eurBrl: number; usdBrl: number; atualizado: string }
  }
}

const FILTROS = [
  { key: "todas", label: "Todas" },
  { key: "BRL", label: "🇧🇷 BRL" },
  { key: "EUR", label: "🇪🇺 EUR" },
  { key: "USD", label: "🇺🇸 USD" },
  { key: "conta_corrente", label: "Conta corrente" },
  { key: "reserva", label: "Reserva" },
] as const

export default function TesourariaTab() {
  const [data, setData] = useState<TesourariaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<string>("todas")

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    fetch("/api/financas/tesouraria", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [])

  if (loading || !data) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>
  }

  const d = data
  const m = d.mock
  const eurBRL = d.eurNativo * d.fx.EUR
  const usdBRL = d.usdNativo * d.fx.USD
  const previa = !d.temReais // todo o conjunto é mock?

  const contasFiltradas = d.contas.filter(c => {
    if (filtro === "todas") return true
    if (filtro === "BRL" || filtro === "EUR" || filtro === "USD") return c.moeda === filtro
    return c.tipo === filtro
  })

  return (
    <div className="space-y-4">
      {/* Header do módulo */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Landmark className="h-5 w-5" /> Tesouraria</h2>
          <div className="text-xs text-white/60 mt-1 flex items-center gap-2 flex-wrap">
            <span><strong className="text-white">{d.contagem.todas}</strong> contas ativas</span>
            <span className="text-white/30">·</span>
            <span><strong className="text-white">3</strong> moedas (BRL · EUR · USD)</span>
            <span className="text-white/30">·</span>
            <span>Última conciliação: <strong className="text-white">{d.ultimaConciliacao}</strong></span>
            <span className="text-white/30">·</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Todas conciliadas</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <GlassBtn icon={<BarChart3 className="h-3.5 w-3.5" />}>Extrato consolidado</GlassBtn>
          <GlassBtn icon={<RefreshCw className="h-3.5 w-3.5" />}>Conciliar agora</GlassBtn>
          <GlassBtn icon={<ArrowRightLeft className="h-3.5 w-3.5" />}>Transferência</GlassBtn>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="h-3.5 w-3.5" /> Cadastrar conta
          </button>
        </div>
      </div>

      {/* TABELA DE CONCILIAÇÃO */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
        <div className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><Scale className="h-4 w-4" /> Conciliação Bancária {previa && <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">prévia</span>}</div>
        {d.conciliacao.length === 0 ? (
          <p className="text-sm text-white/40 py-4 text-center">Nenhuma conta para conciliar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-white/40 text-xs border-b border-white/10">
                  <th className="text-left font-medium py-1.5">Conta</th>
                  <th className="text-right font-medium py-1.5">Saldo Sistema</th>
                  <th className="text-right font-medium py-1.5">Saldo Banco</th>
                  <th className="text-right font-medium py-1.5">Diferença</th>
                  <th className="text-center font-medium py-1.5">Pendências</th>
                  <th className="text-right font-medium py-1.5">Ação</th>
                </tr>
              </thead>
              <tbody>
                {d.conciliacao.map((c, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="py-2 text-white/90">{c.nome}</td>
                    <td className="py-2 text-right text-white/90 tabular-nums">{fmtBRL(c.saldoSistema)}</td>
                    <td className="py-2 text-right text-white/90 tabular-nums">{fmtBRL(c.saldoBanco)}</td>
                    <td className={`py-2 text-right tabular-nums ${c.diferenca === 0 ? "text-green-400" : "text-amber-400"}`}>{fmtBRL(c.diferenca)}</td>
                    <td className="py-2 text-center text-white/70">{c.pendencias}</td>
                    <td className="py-2 text-right"><button className="text-[11px] px-2.5 py-1 rounded-md border border-white/20 text-white/80 hover:bg-white/10">Importar extrato</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* KPIs: Total / BRL / EUR / USD */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<Briefcase className="h-3.5 w-3.5" />} label="Total Consolidado"
          value={fmtBRL(d.totalBRL)} sub={`${d.contagem.todas} contas · 3 moedas`}
          extra={<span className="text-green-400">↗ Projeção 30d: {fmtBRLshort(d.projetadoBRL)}</span>} mock={previa} />
        <Kpi label="🇧🇷 BRL" value={fmtBRL(d.brlBRL)}
          sub={`${d.totalBRL > 0 ? fmtPct(d.brlBRL / d.totalBRL * 100) : "—"} do total · ${d.contagem.BRL} contas`}
          bar={{ pct: d.totalBRL > 0 ? (d.brlBRL / d.totalBRL) * 100 : 0, color: "#3b82f6" }} mock={previa} />
        <Kpi label="🇪🇺 EUR" value={fmtEUR(d.eurNativo)}
          sub={`≈ ${fmtBRLshort(eurBRL)} · @ R$ ${d.fx.EUR.toFixed(2)}`}
          bar={{ pct: d.totalBRL > 0 ? (eurBRL / d.totalBRL) * 100 : 0, color: "#f59e0b" }} mock={previa} />
        <Kpi label="🇺🇸 USD" value={fmtUSD(d.usdNativo)}
          sub={`≈ ${fmtBRLshort(usdBRL)} · @ R$ ${d.fx.USD.toFixed(2)}`}
          bar={{ pct: d.totalBRL > 0 ? (usdBRL / d.totalBRL) * 100 : 0, color: "#10b981" }} mock={previa} />
      </div>

      {/* QUICK CHIPS */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-white/40 uppercase tracking-wide mr-1">Filtrar contas:</span>
        {FILTROS.map(f => {
          const count = f.key === "todas" ? d.contagem.todas : (d.contagem as any)[f.key] ?? 0
          const active = filtro === f.key
          return (
            <button key={f.key} onClick={() => setFiltro(f.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${active ? "bg-white/15 border-white/30 text-white" : "bg-white/5 border-white/10 text-white/60 hover:text-white"}`}>
              {f.label}<span className="text-[10px] bg-white/10 px-1.5 rounded-full">{count}</span>
            </button>
          )
        })}
      </div>

      {/* CARDS DAS CONTAS */}
      <div>
        <h3 className="text-[11px] text-white/50 font-bold uppercase tracking-wider mb-2">Contas Bancárias · {contasFiltradas.length}</h3>
        {contasFiltradas.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-10 text-center text-white/40 text-sm">Nenhuma conta neste filtro.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {contasFiltradas.map(c => {
              const variacao = c.saldoNativo > 0 ? ((c.projetadoNativo - c.saldoNativo) / c.saldoNativo) * 100 : 0
              const seta = variacao > 0 ? "↗" : variacao < 0 ? "↘" : "→"
              const setaCor = variacao > 0 ? "text-green-400" : variacao < 0 ? "text-red-400" : "text-white/40"
              return (
                <div key={c.id} className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 relative overflow-hidden" style={{ borderTop: `2px solid ${c.cor || "#64748b"}` }}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-white font-semibold">{c.nome}</div>
                      <div className="text-xs text-white/40">{c.banco || "—"}</div>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide text-white/50 bg-white/5 border border-white/10 px-2 py-0.5 rounded whitespace-nowrap">{c.tipo.replace(/_/g, " ")}</span>
                  </div>
                  <div className="text-xl font-bold text-white mt-3">{fmtMoeda(c.saldoNativo, c.moeda)}</div>
                  <div className="text-[11px] text-white/40">{c.moeda} · saldo atual</div>
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10 text-[11px]">
                    <span className="text-white/50">Projetado 30d: <strong className="text-white/80">{fmtMoeda(c.projetadoNativo, c.moeda)}</strong></span>
                    <span className={setaCor}>{seta} {fmtPct(variacao)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* TRANSFERÊNCIAS + PAINÉIS LATERAIS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" /> Transferências Recentes · Maio/2026 <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">prévia</span></div>
            <button className="text-xs text-white/60 hover:text-white">Ver histórico completo →</button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs border-b border-white/10">
                <th className="text-left font-medium py-1.5">Data</th>
                <th className="text-left font-medium py-1.5">De → Para</th>
                <th className="text-left font-medium py-1.5">Observação</th>
                <th className="text-right font-medium py-1.5">Valor</th>
                <th className="text-center font-medium py-1.5">Por</th>
              </tr>
            </thead>
            <tbody>
              {m.transferencias.map((t, i) => (
                <tr key={i} className="border-b border-white/5 last:border-0">
                  <td className="py-2 tabular-nums"><div className="text-white/90 font-medium">{t.data}</div><div className="text-[10px] text-white/40">{t.hora}</div></td>
                  <td className="py-2"><div className="text-white/90">{t.de}</div><div className="text-[11px] text-white/40">→ {t.para}</div></td>
                  <td className="py-2 text-white/50 text-xs">{t.obs}</td>
                  <td className="py-2 text-right text-white font-medium tabular-nums">
                    {fmtMoeda(t.valor, t.moeda)}
                    {t.taxa != null && <div className="text-[10px] text-white/40">@ {t.taxa.toFixed(2)}</div>}
                  </td>
                  <td className="py-2 text-center">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-[10px] font-bold text-white">{t.por}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          <SidePanel title="Distribuição por moeda" mock>
            <DoughnutMoeda brl={d.brlBRL} eur={eurBRL} usd={usdBRL} />
            <Row label={<><Dot c="#3b82f6" /> BRL</>} value={d.totalBRL > 0 ? fmtPct(d.brlBRL / d.totalBRL * 100) : "—"} />
            <Row label={<><Dot c="#f59e0b" /> EUR</>} value={d.totalBRL > 0 ? fmtPct(eurBRL / d.totalBRL * 100) : "—"} />
            <Row label={<><Dot c="#10b981" /> USD</>} value={d.totalBRL > 0 ? fmtPct(usdBRL / d.totalBRL * 100) : "—"} />
          </SidePanel>
          <SidePanel title="Saldo por tipo" mock={previa}>
            {Object.entries(d.saldoPorTipo).map(([k, v]) => <Row key={k} label={k} value={fmtBRLshort(v)} />)}
          </SidePanel>
          <SidePanel title="Cotações em tempo real" mock>
            <Row label="EUR / BRL" value={`R$ ${m.cotacoes.eurBrl.toFixed(2)}`} />
            <Row label="USD / BRL" value={`R$ ${m.cotacoes.usdBrl.toFixed(2)}`} />
            <Row label="Atualizado" value={m.cotacoes.atualizado} muted />
          </SidePanel>
        </div>
      </div>

      {/* PROJEÇÃO 45 DIAS */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Projeção de Saldo Consolidado · Próximos 45 dias <span className="text-[10px] text-white/40 bg-white/5 px-1.5 py-0.5 rounded">prévia</span></div>
          <span className="text-[11px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full">+{fmtBRLshort(d.projetadoBRL - d.totalBRL)}</span>
        </div>
        <ProjecaoChart pontos={m.projecao45} />
      </div>
    </div>
  )
}

// ============================================================
// GRÁFICO doughnut de moeda (Chart.js)
// ============================================================
function DoughnutMoeda({ brl, eur, usd }: { brl: number; eur: number; usd: number }) {
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
        data: { labels: ["BRL", "EUR", "USD"], datasets: [{ data: [brl, eur, usd], backgroundColor: ["#3b82f6", "#f59e0b", "#10b981"], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "72%", plugins: { legend: { display: false } } },
      })
    }
    draw()
    return () => { cancelled = true; if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [brl, eur, usd])
  return <div className="h-32 mb-3"><canvas ref={ref} /></div>
}

// ============================================================
// GRÁFICO de projeção (Chart.js)
// ============================================================
function ProjecaoChart({ pontos }: { pontos: { dia: number; saldo: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)
  useEffect(() => {
    let cancelled = false
    async function draw() {
      const Chart = (await import("chart.js/auto")).default
      if (cancelled || !ref.current) return
      if (chartRef.current) chartRef.current.destroy()
      chartRef.current = new Chart(ref.current, {
        type: "line",
        data: {
          labels: pontos.map(p => `+${p.dia}d`),
          datasets: [{ label: "Saldo projetado", data: pontos.map(p => p.saldo), borderColor: "#7dd3fc", backgroundColor: "rgba(125,211,252,0.10)", fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => fmtBRL(c.parsed.y) } } },
          scales: {
            y: { ticks: { callback: (v: any) => "R$ " + (v / 1000).toFixed(0) + "k", color: "rgba(255,255,255,0.5)", font: { size: 10.5 } }, grid: { color: "rgba(255,255,255,0.08)" } },
            x: { ticks: { color: "rgba(255,255,255,0.5)", font: { size: 10 }, maxTicksLimit: 10 }, grid: { display: false } },
          },
        },
      })
    }
    draw()
    return () => { cancelled = true; if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [pontos])
  return <div className="h-56"><canvas ref={ref} /></div>
}

// ============================================================
// SUBCOMPONENTES
// ============================================================
function GlassBtn({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-transparent border border-white/30 text-white hover:bg-white/10">{icon}{children}</button>
}
function Dot({ c }: { c: string }) { return <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: c }} /> }

function Kpi({ icon, label, value, sub, extra, bar, mock }: {
  icon?: React.ReactNode; label: string; value: string; sub?: string; extra?: React.ReactNode
  bar?: { pct: number; color: string }; mock?: boolean
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 relative">
      {mock && <span className="absolute top-2 right-2 text-[9px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded">prévia</span>}
      <div className="flex items-center gap-1.5 text-white/50 text-xs font-medium">{icon && <span className="text-white/60">{icon}</span>}{label}</div>
      <div className="font-bold mt-1.5 text-xl text-white">{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-1">{sub}</div>}
      {extra && <div className="text-[11px] mt-1">{extra}</div>}
      {bar && <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(bar.pct, 100)}%`, background: bar.color }} /></div>}
    </div>
  )
}

function SidePanel({ title, children, mock }: { title: string; children: React.ReactNode; mock?: boolean }) {
  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
      <div className="text-[11px] text-white/50 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">{title}{mock && <span className="text-white/25 normal-case font-medium">·prévia</span>}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}
function Row({ label, value, muted }: { label: React.ReactNode; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-white/70 flex items-center">{label}</span>
      <span className={muted ? "text-white/40 text-xs" : "text-white font-medium"}>{value}</span>
    </div>
  )
}