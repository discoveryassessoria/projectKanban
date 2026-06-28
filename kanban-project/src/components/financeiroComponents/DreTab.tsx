// CRIAR EM: src/components/financeiroComponents/DreTab.tsx
//
// Aba "DRE" (Demonstração de Resultado Gerencial) — porte fiel do renderDRE()
// do mockup, estilo glass. Busca /api/financas/dre. Receita/custos do mês são
// REAIS; a quebra fina (impostos/despesas detalhadas) é "prévia".

"use client"

import { useEffect, useState } from "react"
import { TrendingUp, Upload, Info, Loader2 } from "lucide-react"

function fmtBRL(v: number): string {
  const neg = v < 0
  const s = `R$ ${Math.abs(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return neg ? `−${s}` : s
}
function fmtPct(v: number): string { return `${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` }

interface Linha { valor: number; prev: number; av: number; real: boolean }
interface DreData {
  periodoAtual: string; periodoAnterior: string
  kpis: { receitaBruta: number; receitaBrutaPrev: number; ahReceita: number; lucroBruto: number; margemBruta: number; lucroOperacional: number; margemOper: number; lucroLiquido: number; margemLiq: number }
  dre: {
    receitaBruta: Linha; impostosReceita: Linha; receitaLiquida: Linha; custosVariaveis: Linha
    lucroBruto: Linha; despesasOperacionais: Linha; lucroOperacional: Linha; ajustesFinanceiros: Linha; lucroLiquido: Linha
  }
  mock: { impostosDetalhe: { label: string; valor: number }[]; despesasDetalhe: { label: string; valor: number }[] }
}

export default function DreTab() {
  const [data, setData] = useState<DreData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    fetch("/api/financas/dre", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => setData(d)).catch(e => console.error(e)).finally(() => setLoading(false))
  }, [])

  if (loading || !data) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>

  const d = data
  const k = d.kpis
  const ahColor = (v: number) => v > 0 ? "text-green-400" : v < 0 ? "text-red-400" : "text-white/40"
  const ah = (cur: number, prev: number) => prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2 capitalize"><TrendingUp className="h-5 w-5" /> DRE Gerencial</h2>
          <div className="text-xs text-white/60 mt-1 capitalize">Comparativo {d.periodoAtual} vs {d.periodoAnterior} · Análise vertical (% receita) e horizontal (variação)</div>
        </div>
        <div className="flex items-center gap-2">
          <GlassBtn icon={<Upload className="h-3.5 w-3.5" />}>Exportar PDF</GlassBtn>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Receita Bruta" value={fmtBRL(k.receitaBruta)} sub={<>vs {fmtBRL(k.receitaBrutaPrev)} · <span className={ahColor(k.ahReceita)}>{fmtPct(k.ahReceita)}</span></>} />
        <Kpi label="Lucro Bruto" value={fmtBRL(k.lucroBruto)} valueColor={k.lucroBruto >= 0 ? "text-green-400" : "text-red-400"} sub={<>Margem: <strong className="text-white">{fmtPct(k.margemBruta)}</strong></>} />
        <Kpi label="Lucro Operacional" value={fmtBRL(k.lucroOperacional)} valueColor={k.lucroOperacional >= 0 ? "text-green-400" : "text-red-400"} sub={<>Margem: <strong className="text-white">{fmtPct(k.margemOper)}</strong></>} />
        <Kpi label="Lucro Líquido" value={fmtBRL(k.lucroLiquido)} valueColor={k.lucroLiquido >= 0 ? "text-green-400" : "text-red-400"} sub={<>Margem: <strong className="text-white">{fmtPct(k.margemLiq)}</strong></>} />
      </div>

      {/* TABELA DRE */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl overflow-x-auto">
        <div className="min-w-[640px]">
          {/* cabeçalho */}
          <div className="grid grid-cols-[2fr_1.2fr_1.2fr_0.8fr_0.8fr] gap-2 px-4 py-2.5 border-b border-white/10 text-[11px] font-bold uppercase tracking-wide text-white/40">
            <div>Conta</div>
            <div className="text-right capitalize">{d.periodoAtual.split(" ")[0]}</div>
            <div className="text-right capitalize">{d.periodoAnterior.split(" ")[0]}</div>
            <div className="text-right">AH</div>
            <div className="text-right">AV</div>
          </div>

          <DreRow label="(+) RECEITA BRUTA" l={d.dre.receitaBruta} grupo />
          <DreRow label="(−) Impostos sobre Receita" l={d.dre.impostosReceita} deduct indent />
          {d.mock.impostosDetalhe.map((s, i) => <DreSub key={i} label={s.label} valor={s.valor} av={d.kpis.receitaBruta > 0 ? (s.valor / d.kpis.receitaBruta) * 100 : 0} />)}
          <DreRow label="(=) RECEITA LÍQUIDA" l={d.dre.receitaLiquida} grupo />
          <DreRow label="(−) Custos Variáveis · Processos" l={d.dre.custosVariaveis} deduct indent />
          <DreRow label="(=) LUCRO BRUTO" l={d.dre.lucroBruto} margem />
          <DreRow label="(−) DESPESAS OPERACIONAIS" l={d.dre.despesasOperacionais} deduct grupo />
          {d.mock.despesasDetalhe.map((s, i) => <DreSub key={i} label={s.label} valor={s.valor} av={d.kpis.receitaBruta > 0 ? (s.valor / d.kpis.receitaBruta) * 100 : 0} />)}
          <DreRow label="(=) LUCRO OPERACIONAL (EBIT)" l={d.dre.lucroOperacional} margem />
          <DreRow label="(±) Ajustes Financeiros" l={d.dre.ajustesFinanceiros} indent />
          <DreRow label="(=) LUCRO LÍQUIDO" l={d.dre.lucroLiquido} total />
        </div>
      </div>

      {/* nota de prévia */}
      <div className="flex items-start gap-2 text-xs text-white/50 bg-white/5 border border-white/10 rounded-lg p-3">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>Receita bruta e custos são dados reais do mês. A quebra detalhada de impostos e despesas operacionais é uma <strong className="text-white/70">prévia</strong> estimada — será ligada a um plano de contas estruturado numa próxima etapa.</span>
      </div>
    </div>
  )

  function DreRow({ label, l, grupo, deduct, margem, total, indent }: {
    label: string; l: Linha; grupo?: boolean; deduct?: boolean; margem?: boolean; total?: boolean; indent?: boolean
  }) {
    const ahVal = ah(l.valor, l.prev)
    const bg = total ? "bg-white/10" : margem ? "bg-white/[0.07]" : grupo ? "bg-white/[0.03]" : ""
    const weight = total || margem || grupo ? "font-bold" : "font-normal"
    const valColor = total ? (l.valor >= 0 ? "text-green-400" : "text-red-400") : deduct ? "text-red-300/80" : "text-white"
    return (
      <div className={`grid grid-cols-[2fr_1.2fr_1.2fr_0.8fr_0.8fr] gap-2 px-4 py-2 border-b border-white/5 text-sm ${bg}`}>
        <div className={`${weight} text-white/90 ${indent ? "pl-4" : ""} flex items-center gap-1.5`}>
          {label}{!l.real && <span className="text-[9px] text-white/30 font-normal">prévia</span>}
        </div>
        <div className={`text-right tabular-nums ${weight} ${valColor}`}>{fmtBRL(l.valor)}</div>
        <div className="text-right tabular-nums text-white/40">{l.prev !== 0 ? fmtBRL(l.prev) : "—"}</div>
        <div className={`text-right tabular-nums text-xs ${ahColor(ahVal)}`}>{l.prev !== 0 ? `${ahVal >= 0 ? "+" : ""}${fmtPct(ahVal)}` : "—"}</div>
        <div className="text-right tabular-nums text-xs text-white/40">{fmtPct(l.av)}</div>
      </div>
    )
  }

  function DreSub({ label, valor, av }: { label: string; valor: number; av: number }) {
    return (
      <div className="grid grid-cols-[2fr_1.2fr_1.2fr_0.8fr_0.8fr] gap-2 px-4 py-1.5 border-b border-white/5 text-xs">
        <div className="pl-8 text-white/50 flex items-center gap-1.5">{label}<span className="text-[9px] text-white/25">prévia</span></div>
        <div className="text-right tabular-nums text-white/60">{fmtBRL(valor)}</div>
        <div className="text-right text-white/30">—</div>
        <div className="text-right text-white/30">—</div>
        <div className="text-right tabular-nums text-white/30">{fmtPct(av)}</div>
      </div>
    )
  }
}

// ============================================================
// SUBCOMPONENTES
// ============================================================
function GlassBtn({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-transparent border border-white/30 text-white hover:bg-white/10">{icon}{children}</button>
}
function Kpi({ label, value, sub, valueColor = "text-white" }: {
  label: string; value: string; sub?: React.ReactNode; valueColor?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4">
      <div className="text-white/50 text-xs font-medium">{label}</div>
      <div className={`font-bold mt-1.5 text-xl ${valueColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-1">{sub}</div>}
    </div>
  )
}