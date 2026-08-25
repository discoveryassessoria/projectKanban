// CRIAR EM: src/components/financeiroComponents/ComissoesTab.tsx
//
// Aba "COMISSÕES" — porte fiel do renderComissoes() do mockup, estilo glass.
// ⚠ Aba inteira é "prévia": o schema não tem tabela de comissões/regras.
// Busca /api/financas/comissoes (dados de exemplo).

"use client"

import { useEffect, useState } from "react"
import { Briefcase, FileText, Plus, Check, BarChart3, Loader2 } from "lucide-react"

function fmtBRL(v: number): string { return `R$ ${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtDate(d: string | null): string {
  if (!d) return "—"
  return new Date(d + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function dueText(d: string | null): string {
  if (!d) return ""
  const dias = Math.ceil((new Date(d + "T00:00:00").getTime() - Date.now()) / 86_400_000)
  if (dias < 0) return `há ${Math.abs(dias)}d`
  if (dias === 0) return "hoje"
  return `em ${dias}d`
}

interface Comissao {
  id: string; beneficiario: string; papel: string; processo: string; processoId: string
  base: number; pct: number; valor: number; status: string; vencimento: string; pagoEm?: string
}
interface Regra { id: string; nome: string; tipo: string; base: string; valor: string; aplicacao: string; ativa: boolean }
interface ComissoesData {
  previa: boolean
  kpis: { aPagar: number; qtdAPagar: number; previstas: number; qtdPrevistas: number; pagas: number; qtdPagas: number; destaque: string; totalDestaque: number; qtdDestaque: number }
  regras: Regra[]
  comissoes: Comissao[]
  contagem: { todos: number; a_pagar: number; previstas: number; pagas: number }
}

const CHIPS = [
  { key: "todos", label: "Todas" },
  { key: "a_pagar", label: "A pagar" },
  { key: "previstas", label: "Previstas" },
  { key: "pagas", label: "✓ Pagas" },
] as const

function statusBadge(status: string) {
  if (status === "paga") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">Paga</span>
  if (status === "prevista") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-primary)] text-white/60 border border-[var(--border-strong)]">Prevista</span>
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">A pagar</span>
}

export default function ComissoesTab() {
  const [data, setData] = useState<ComissoesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [chip, setChip] = useState("todos")

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    fetch("/api/financas/comissoes", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => setData(d)).catch(e => console.error(e)).finally(() => setLoading(false))
  }, [])

  if (loading || !data) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-[var(--text-secondary)]" /></div>

  const d = data
  const k = d.kpis

  const filtradas = d.comissoes.filter(c => {
    if (chip === "todos") return true
    if (chip === "a_pagar") return c.status === "a_pagar"
    if (chip === "previstas") return c.status === "prevista"
    if (chip === "pagas") return c.status === "paga"
    return true
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Briefcase className="h-5 w-5" /> Comissões <span className="text-[10px] text-[var(--text-muted)] bg-[var(--surface-primary)] px-1.5 py-0.5 rounded font-normal">prévia</span></h2>
          <div className="text-xs text-white/60 mt-1">{d.contagem.todos} comissões · {d.regras.length} regras ativas</div>
        </div>
        <div className="flex items-center gap-2">
          <GlassBtn icon={<FileText className="h-3.5 w-3.5" />}>Gerenciar regras</GlassBtn>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] text-[var(--action-primary-ink)]"><Plus className="h-3.5 w-3.5" /> Nova comissão</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="A Pagar (este mês)" value={fmtBRL(k.aPagar)} valueColor="text-amber-700" sub={`${k.qtdAPagar} comissões liberadas`} />
        <Kpi label="Previstas (futuro)" value={fmtBRL(k.previstas)} sub={`${k.qtdPrevistas} aguardando triggers`} />
        <Kpi label="Pagas (YTD)" value={fmtBRL(k.pagas)} valueColor="text-green-700" sub={`${k.qtdPagas} liquidadas`} />
        <Kpi label="Vendedor Destaque" value={k.destaque} valueSize="text-base" sub={`${fmtBRL(k.totalDestaque)} · ${k.qtdDestaque} comissões`} />
      </div>

      {/* REGRAS */}
      <div className="bg-[var(--surface-primary)] backdrop-blur-sm border border-[var(--border-default)] rounded-xl p-4 overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-white flex items-center gap-2"><FileText className="h-4 w-4" /> Regras de Comissão Ativas</div>
          <button className="text-xs px-2.5 py-1 rounded border border-[var(--border-strong)] text-white/70 hover:bg-[var(--surface-hover)]">+ Nova regra</button>
        </div>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border-default)]">
              <th className="text-left font-medium py-1.5">Beneficiário</th>
              <th className="text-left font-medium py-1.5">Tipo</th>
              <th className="text-left font-medium py-1.5">Base de cálculo</th>
              <th className="text-right font-medium py-1.5">% / Valor</th>
              <th className="text-left font-medium py-1.5">Aplicação</th>
              <th className="text-center font-medium py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {d.regras.map(r => (
              <tr key={r.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="py-2 text-white/90 font-medium">{r.nome}</td>
                <td className="py-2">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${r.tipo === "Vendedor" ? "bg-blue-50 text-blue-700 border-blue-200" : r.tipo === "Parceiro" ? "bg-sky-50 text-sky-700 border-sky-200" : "bg-[var(--surface-primary)] text-white/60 border-[var(--border-strong)]"}`}>{r.tipo}</span>
                </td>
                <td className="py-2 text-white/70">{r.base}</td>
                <td className="py-2 text-right text-white font-medium">{r.valor}</td>
                <td className="py-2 text-[var(--text-secondary)]">{r.aplicacao}</td>
                <td className="py-2 text-center">{r.ativa ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">Ativa</span> : <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-primary)] text-[var(--text-secondary)]">Inativa</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* QUICK CHIPS */}
      <div className="flex items-center gap-2 flex-wrap">
        {CHIPS.map(c => {
          const count = (d.contagem as any)[c.key] ?? 0
          const active = chip === c.key
          return (
            <button key={c.key} onClick={() => setChip(c.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${active ? "bg-[var(--surface-secondary)] border-[var(--border-strong)] text-white" : "bg-[var(--surface-primary)] border-[var(--border-default)] text-white/60 hover:text-white"}`}>
              {c.label}<span className="text-[10px] bg-[var(--surface-primary)] px-1.5 rounded-full">{count}</span>
            </button>
          )
        })}
      </div>

      {/* TABELA DE COMISSÕES */}
      <div className="bg-[var(--surface-primary)] backdrop-blur-sm border border-[var(--border-default)] rounded-xl p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border-default)]">
              <th className="text-left font-medium py-1.5">Beneficiário</th>
              <th className="text-left font-medium py-1.5">Processo</th>
              <th className="text-right font-medium py-1.5">Base</th>
              <th className="text-right font-medium py-1.5">% / Valor</th>
              <th className="text-right font-medium py-1.5">Vencimento</th>
              <th className="text-center font-medium py-1.5">Status</th>
              <th className="text-center font-medium py-1.5">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map(c => (
              <tr key={c.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-hover)]">
                <td className="py-2">
                  <div className="text-white/90 font-medium">{c.beneficiario}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{c.papel}</div>
                </td>
                <td className="py-2">
                  <div className="text-white/80">{c.processo}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{c.processoId}</div>
                </td>
                <td className="py-2 text-right text-white/70 tabular-nums">{fmtBRL(c.base)}</td>
                <td className="py-2 text-right text-white font-medium tabular-nums">{c.pct}% = {fmtBRL(c.valor)}</td>
                <td className="py-2 text-right tabular-nums">
                  <div className="text-white/80">{fmtDate(c.vencimento)}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{c.status === "paga" ? "paga em " + fmtDate(c.pagoEm ?? null) : dueText(c.vencimento)}</div>
                </td>
                <td className="py-2 text-center">{statusBadge(c.status)}</td>
                <td className="py-2 text-center">
                  {c.status === "a_pagar" ? (
                    <button className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-green-600/80 hover:bg-green-600 text-[#fff]"><Check className="h-3 w-3" /> Pagar</button>
                  ) : c.status === "paga" ? (
                    <span className="text-[11px] text-green-700">✓ Paga</span>
                  ) : (
                    <span className="text-[11px] text-[var(--text-muted)]">prevista</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* nota de prévia */}
      <div className="flex items-start gap-2 text-xs text-[var(--text-secondary)] bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-lg p-3">
        <BarChart3 className="h-4 w-4 mt-0.5 shrink-0" />
        <span>Esta aba é uma <strong className="text-white/70">prévia</strong> com dados de exemplo. O módulo de comissões (regras + cálculo automático sobre parcelas pagas) será ligado a uma estrutura própria numa próxima etapa.</span>
      </div>
    </div>
  )
}

// ============================================================
// SUBCOMPONENTES
// ============================================================
function GlassBtn({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-transparent border border-[var(--border-strong)] text-white hover:bg-[var(--surface-hover)]">{icon}{children}</button>
}
function Kpi({ label, value, sub, valueColor = "text-white", valueSize = "text-xl" }: {
  label: string; value: string; sub?: string; valueColor?: string; valueSize?: string
}) {
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm p-4 relative">
      <span className="absolute top-2 right-2 text-[9px] text-[var(--text-muted)] bg-[var(--surface-primary)] px-1.5 py-0.5 rounded">prévia</span>
      <div className="text-[var(--text-secondary)] text-xs font-medium">{label}</div>
      <div className={`font-bold mt-1.5 ${valueSize} ${valueColor} truncate`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-muted)] mt-1 truncate">{sub}</div>}
    </div>
  )
}