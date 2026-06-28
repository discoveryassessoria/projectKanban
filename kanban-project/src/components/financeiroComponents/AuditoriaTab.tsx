// CRIAR EM: src/components/financeiroComponents/AuditoriaTab.tsx
//
// Aba "AUDITORIA E LOGS" — porte fiel do renderAuditoria() do mockup, glass.
// Dados REAIS: LogAuditoria. Busca /api/financas/auditoria.
// Severidade é inferida da ação (a rota faz isso); impacto não existe no schema.

"use client"

import { useEffect, useState } from "react"
import { ShieldCheck, Search, Upload, AlertTriangle, Loader2 } from "lucide-react"

function fmtDateTime(d: string): string {
  const dt = new Date(d)
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function fmtTime(d: string): string {
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}
function fmtPct(v: number): string { return `${(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}%` }
function iniciais(nome: string): string { return nome.split(" ").map(x => x[0]).join("").slice(0, 2).toUpperCase() }

interface Log { id: number; acao: string; entidade: string; descricao: string; usuario: string; criadoEm: string; severidade: string }
interface AuditoriaData {
  kpis: { eventosHoje: number; automaticosHoje: number; manuaisHoje: number; criticos: number; avisos: number; pctAutomatico: number; automaticos: number; total: number }
  logs: Log[]
}

const CHIPS = [
  { key: "todos", label: "Todos" },
  { key: "critico", label: "Críticos" },
  { key: "aviso", label: "Avisos" },
  { key: "info", label: "Info" },
] as const

function sevBadge(s: string) {
  if (s === "critico") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">Crítico</span>
  if (s === "aviso") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">Aviso</span>
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">Info</span>
}

export default function AuditoriaTab() {
  const [data, setData] = useState<AuditoriaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [chip, setChip] = useState("todos")

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    fetch("/api/financas/auditoria", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => setData(d)).catch(e => console.error(e)).finally(() => setLoading(false))
  }, [])

  if (loading || !data) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>

  const d = data
  const k = d.kpis

  const filtrados = d.logs.filter(l => chip === "todos" || l.severidade === chip)
  const contagem = {
    todos: d.logs.length,
    critico: d.logs.filter(l => l.severidade === "critico").length,
    aviso: d.logs.filter(l => l.severidade === "aviso").length,
    info: d.logs.filter(l => l.severidade === "info").length,
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Auditoria e Logs</h2>
          <div className="text-xs text-white/60 mt-1">{k.total} eventos registrados · trilha de mudanças financeiras</div>
        </div>
        <div className="flex items-center gap-2">
          <GlassBtn icon={<Search className="h-3.5 w-3.5" />}>Consulta avançada</GlassBtn>
          <GlassBtn icon={<Upload className="h-3.5 w-3.5" />}>Exportar trilha</GlassBtn>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Eventos hoje" value={`${k.eventosHoje}`} sub={`${k.automaticosHoje} automáticos · ${k.manuaisHoje} manuais`} />
        <Kpi icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Críticos" value={`${k.criticos}`} valueColor={k.criticos > 0 ? "text-red-400" : "text-white"} sub="Estornos, exclusões, cancelamentos" />
        <Kpi label="Avisos" value={`${k.avisos}`} valueColor="text-amber-400" sub="Alterações, aprovações" />
        <Kpi label="Origem automática" value={fmtPct(k.pctAutomatico)} sub={`${k.automaticos} de ${k.total} gerados pelo sistema`} />
      </div>

      {/* CHIPS */}
      <div className="flex items-center gap-2 flex-wrap">
        {CHIPS.map(c => {
          const count = (contagem as any)[c.key] ?? 0
          const active = chip === c.key
          return (
            <button key={c.key} onClick={() => setChip(c.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${active ? "bg-white/15 border-white/30 text-white" : "bg-white/5 border-white/10 text-white/60 hover:text-white"}`}>
              {c.label}<span className="text-[10px] bg-white/10 px-1.5 rounded-full">{count}</span>
            </button>
          )
        })}
      </div>

      {/* TABELA */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 overflow-x-auto">
        {filtrados.length === 0 ? (
          <p className="text-sm text-white/40 py-10 text-center">Nenhum evento de auditoria registrado ainda.</p>
        ) : (
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-white/40 text-xs border-b border-white/10">
                <th className="text-left font-medium py-1.5">Data / Hora</th>
                <th className="text-left font-medium py-1.5">Usuário</th>
                <th className="text-left font-medium py-1.5">Ação</th>
                <th className="text-left font-medium py-1.5">Entidade</th>
                <th className="text-left font-medium py-1.5">Descrição</th>
                <th className="text-center font-medium py-1.5">Sev.</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(l => (
                <tr key={l.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                  <td className="py-2 tabular-nums">
                    <div className="text-white/80 font-medium">{fmtDateTime(l.criadoEm)}</div>
                    <div className="text-[10px] text-white/40">{fmtTime(l.criadoEm)}</div>
                  </td>
                  <td className="py-2">
                    {l.usuario === "Sistema" ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-white/60 border border-white/20">Sistema</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-200 text-[9px] font-bold flex items-center justify-center">{iniciais(l.usuario)}</span>
                        <span className="text-white/80">{l.usuario}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-white/90 font-medium">{l.acao}</td>
                  <td className="py-2 text-white/60">{l.entidade}</td>
                  <td className="py-2 text-white/50 max-w-[260px] truncate" title={l.descricao}>{l.descricao || "—"}</td>
                  <td className="py-2 text-center">{sevBadge(l.severidade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// SUBCOMPONENTES
function GlassBtn({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-transparent border border-white/30 text-white hover:bg-white/10">{icon}{children}</button>
}
function Kpi({ icon, label, value, sub, valueColor = "text-white" }: { icon?: React.ReactNode; label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4">
      <div className="flex items-center gap-1.5 text-white/50 text-xs font-medium">{icon && <span className="text-white/60">{icon}</span>}{label}</div>
      <div className={`font-bold mt-1.5 text-xl ${valueColor}`}>{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-1">{sub}</div>}
    </div>
  )
}