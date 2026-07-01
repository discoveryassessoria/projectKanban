"use client"

import { useEffect, useState, useCallback } from "react"

// ============================================================
// Tipos
// ============================================================
interface Fase { phaseKey: string; label: string; ordem: number }
interface TipoProcesso { id: number; name: string; fases: Fase[] }
interface FinRow { name: string; amount: number; currency: string; source: string; condicional?: boolean; condicaoNota?: string | null; origem?: string }
interface OpRow { name: string; kind: string; acao?: string | null; condicional?: boolean; condicaoNota?: string | null }
interface AlertRow { name: string; condicional?: boolean; condicaoNota?: string | null }
interface SkipRow { name: string; reason: string }
interface Report {
  context: { tipoProcessoId: number; phaseKey: string; event: string }
  receitas: FinRow[]; custos: FinRow[]; operacional: OpRow[]; alertas: AlertRow[]; ignoradas: SkipRow[]; duplicidades: string[]
  totalCriaria: number
}

const EVENT_LABELS: Record<string, string> = {
  entered: "Ao entrar na fase", completed: "Ao concluir a fase", reopened: "Ao reabrir a fase", blocked: "Ao bloquear a fase",
}
const KIND_LABELS: Record<string, string> = {
  task: "Tarefa", document: "Documento", event: "Evento / Agenda", protocol: "Protocolo", phase_advance: "Avanço de fase", alert: "Alerta",
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"
const opt = "bg-zinc-900"

function money(v: number, ccy: string) {
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: ccy || "EUR" }).format(v) }
  catch { return `${ccy} ${v.toFixed(2)}` }
}

// selo "condicional"
function CondBadge({ nota }: { nota?: string | null }) {
  return <span className="ml-1.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300" title={nota || "Condição avaliada na execução"}>condicional</span>
}

// ============================================================
// Componente
// ============================================================
export default function SimulacaoFaseTab() {
  const [tipos, setTipos] = useState<TipoProcesso[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [ptId, setPtId] = useState<number | null>(null)
  const [phaseKey, setPhaseKey] = useState<string>("")
  const [event, setEvent] = useState<string>("entered")
  const [report, setReport] = useState<Report | null>(null)
  const [erro, setErro] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/simulacao-fase", { headers: authHeaders() })
      if (res.ok) {
        const d = await res.json()
        setTipos(d.tiposProcesso || [])
        const first = d.tiposProcesso?.[0]
        if (first) { setPtId(first.id); setPhaseKey(first.fases?.[0]?.phaseKey || "") }
      }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const proc = tipos.find(t => t.id === ptId) || null

  function onPickProc(id: number) {
    setPtId(id); setReport(null)
    const p = tipos.find(t => t.id === id)
    setPhaseKey(p?.fases?.[0]?.phaseKey || "")
  }

  async function run() {
    if (!ptId || !phaseKey) { setErro("Escolha o processo e a fase."); return }
    setRunning(true); setErro("")
    try {
      const res = await fetch("/api/gerenciamento/simulacao-fase", { method: "POST", headers: authHeaders(), body: JSON.stringify({ tipoProcessoId: ptId, phaseKey, event }) })
      const j = await res.json().catch(() => ({}))
      if (res.ok) setReport(j)
      else { setErro(j.error || "Erro ao simular."); setReport(null) }
    } finally { setRunning(false) }
  }

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  return (
    <div className="space-y-5">
      {/* cabeçalho + seletores */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">Simulação de Fase</h2>
        <p className="mt-1 text-sm text-white/60">Mostra <b>o que o motor faria</b> quando um processo deste tipo dispara o evento da fase — tarefas, lançamentos, alertas. <span className="text-green-300/80">É só uma prévia: nada é criado.</span></p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Processo de Nacionalidade</label>
            <select value={ptId ?? ""} onChange={e => onPickProc(Number(e.target.value))} className={inputCls}>
              {tipos.length === 0 && <option value="" className={opt}>Nenhum processo cadastrado</option>}
              {tipos.map(t => <option key={t.id} value={t.id} className={opt}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Fase</label>
            <select value={phaseKey} onChange={e => { setPhaseKey(e.target.value); setReport(null) }} className={inputCls}>
              {(proc?.fases || []).length === 0 && <option value="" className={opt}>—</option>}
              {proc?.fases.map(f => <option key={f.phaseKey} value={f.phaseKey} className={opt}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Evento</label>
            <select value={event} onChange={e => { setEvent(e.target.value); setReport(null) }} className={inputCls}>
              {Object.entries(EVENT_LABELS).map(([v, l]) => <option key={v} value={v} className={opt}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button disabled={running || !ptId || !phaseKey} onClick={run} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">{running ? "Simulando…" : "Executar simulação"}</button>
          {erro && <span className="text-sm text-red-300">{erro}</span>}
        </div>
      </div>

      {/* resultado */}
      {report && (
        <div className="space-y-3">
          <div className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
            <b>{report.totalCriaria}</b> ação(ões) seriam criadas nesta fase{report.ignoradas.length > 0 && <> · {report.ignoradas.length} ignorada(s)</>}.
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Secao titulo="Receitas" count={report.receitas.length} tone="green">
              {report.receitas.map((a, i) => (
                <Linha key={i}>
                  <span className="text-white">{a.name}</span>
                  <span className="text-green-300">{money(a.amount, a.currency)}</span>
                  <span className="text-white/40">({a.source})</span>{a.condicional && <CondBadge nota={a.condicaoNota} />}
                </Linha>
              ))}
            </Secao>

            <Secao titulo="Custos" count={report.custos.length} tone="amber">
              {report.custos.map((a, i) => (
                <Linha key={i}>
                  <span className="text-white">{a.name}</span>
                  <span className="text-amber-300">{money(a.amount, a.currency)}</span>
                  <span className="text-white/40">({a.source})</span>{a.condicional && <CondBadge nota={a.condicaoNota} />}
                </Linha>
              ))}
            </Secao>

            <Secao titulo="Operacional" count={report.operacional.length} tone="sky">
              {report.operacional.map((a, i) => (
                <Linha key={i}>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">{KIND_LABELS[a.kind] || a.kind}</span>
                  <span className="text-white">{a.name}</span>
                  {a.acao && <span className="text-white/40">· {a.acao}</span>}{a.condicional && <CondBadge nota={a.condicaoNota} />}
                </Linha>
              ))}
            </Secao>

            <Secao titulo="Alertas" count={report.alertas.length} tone="red">
              {report.alertas.map((a, i) => (
                <Linha key={i}><span className="text-red-300">⚠</span><span className="text-white">{a.name}</span>{a.condicional && <CondBadge nota={a.condicaoNota} />}</Linha>
              ))}
            </Secao>

            <Secao titulo="Ignoradas" count={report.ignoradas.length} tone="neutral">
              {report.ignoradas.map((a, i) => (
                <Linha key={i}><span className="text-white/70">{a.name}</span><span className="text-amber-300/80">— {a.reason}</span></Linha>
              ))}
            </Secao>

            <Secao titulo="Duplicidades evitadas" count={report.duplicidades.length} tone="neutral">
              <div className="text-[11px] text-white/40">A idempotência é verificada na execução real (Fase 4.2), contra o que o processo já tem.</div>
            </Secao>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Blocos visuais
// ============================================================
function Secao({ titulo, count, tone, children }: { titulo: string; count: number; tone: string; children: React.ReactNode }) {
  const dot: Record<string, string> = { green: "bg-green-400", amber: "bg-amber-400", sky: "bg-sky-400", red: "bg-red-400", neutral: "bg-white/30" }
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot[tone] || dot.neutral}`} />
        <span className="text-xs font-bold uppercase tracking-wider text-white/50">{titulo}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">{count}</span>
      </div>
      <div className="space-y-1">{count === 0 ? <div className="text-xs text-white/30">—</div> : children}</div>
    </div>
  )
}
function Linha({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5 text-sm">{children}</div>
}