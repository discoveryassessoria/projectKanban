"use client"

import { useEffect, useState, useCallback } from "react"

// ============================================================
// Tipos
// ============================================================
interface Fase { phaseKey: string; label: string; ordem: number }
interface Tipo { id: number; name: string; fases: Fase[] }
interface Processo { id: number; nome: string; tipoProcessoMotorId: number | null }
interface Artefato {
  id: number; phaseKey: string; event: string; ruleKind: string; ruleSource: string
  targetTable: string; targetId: number | null; status: string; descricao: string; criadoEm: string
}
interface CreatedItem { kind: string; targetTable: string; targetId: number; name: string; amount?: number; currency?: string; condicional?: boolean }
interface RunResult {
  created: CreatedItem[]
  skipped: { name: string; reason: string }[]
  errors: string[]
  totalCriado: number
}

const EVENT_LABELS: Record<string, string> = {
  entered: "Ao entrar na fase", completed: "Ao concluir a fase", reopened: "Ao reabrir a fase", blocked: "Ao bloquear a fase",
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-[var(--text-secondary)]"
const opt = "bg-zinc-900"

function fmtData(iso: string) {
  try { return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) }
  catch { return iso }
}
function money(v: number, ccy: string) {
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: ccy || "EUR" }).format(v) }
  catch { return `${ccy} ${v.toFixed(2)}` }
}
const TABLE_LABEL: Record<string, string> = { Tarefa: "Tarefa", Receita: "Receita", Custo: "Custo", Evento: "Evento", Protocolo: "Protocolo" }

// ============================================================
// Componente
// ============================================================
export default function ExecutorMotorTab() {
  const [processos, setProcessos] = useState<Processo[]>([])
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [loading, setLoading] = useState(true)
  const [autoExecutar, setAutoExecutar] = useState(false)

  const [procId, setProcId] = useState<number | null>(null)
  const [assignTipoId, setAssignTipoId] = useState<number | "">("")
  const [phaseKey, setPhaseKey] = useState("")
  const [event, setEvent] = useState("entered")

  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [artefatos, setArtefatos] = useState<Artefato[]>([])
  const [erro, setErro] = useState("")
  const [flash, setFlash] = useState("")

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3500) }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/executor-motor", { headers: authHeaders() })
      if (res.ok) {
        const d = await res.json()
        setProcessos(d.processos || [])
        setTipos(d.tipos || [])
        setAutoExecutar(d.autoExecutar ?? false)
      }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const proc = processos.find(p => p.id === procId) || null
  const tipoAtual = proc?.tipoProcessoMotorId ? tipos.find(t => t.id === proc.tipoProcessoMotorId) || null : null
  const fases = tipoAtual?.fases || []

  const listarArtefatos = useCallback(async (pid: number) => {
    const res = await fetch("/api/gerenciamento/executor-motor", { method: "POST", headers: authHeaders(), body: JSON.stringify({ action: "list", processoId: pid }) })
    if (res.ok) { const d = await res.json(); setArtefatos(d.artefatos || []) }
  }, [])

  function onPickProc(id: number) {
    setProcId(id); setResult(null); setErro(""); setConfirming(false)
    const p = processos.find(x => x.id === id)
    const t = p?.tipoProcessoMotorId ? tipos.find(x => x.id === p.tipoProcessoMotorId) : null
    setPhaseKey(t?.fases?.[0]?.phaseKey || "")
    setAssignTipoId("")
    if (id) listarArtefatos(id)
  }

  async function conectar(tipoId: number | null) {
    if (!procId) return
    setErro("")
    const res = await fetch("/api/gerenciamento/executor-motor", { method: "POST", headers: authHeaders(), body: JSON.stringify({ action: "assign", processoId: procId, tipoProcessoId: tipoId }) })
    if (res.ok) {
      setProcessos(prev => prev.map(p => p.id === procId ? { ...p, tipoProcessoMotorId: tipoId } : p))
      const t = tipoId ? tipos.find(x => x.id === tipoId) : null
      setPhaseKey(t?.fases?.[0]?.phaseKey || "")
      showFlash(tipoId ? "Processo conectado ao tipo do motor." : "Processo desconectado.")
    } else { const j = await res.json().catch(() => ({})); setErro(j.error || "Erro ao conectar.") }
  }

  async function executar() {
    if (!procId || !phaseKey) { setErro("Escolha o processo e a fase."); return }
    setRunning(true); setErro(""); setConfirming(false)
    try {
      const res = await fetch("/api/gerenciamento/executor-motor", { method: "POST", headers: authHeaders(), body: JSON.stringify({ action: "run", processoId: procId, phaseKey, event }) })
      const j = await res.json().catch(() => ({}))
      if (res.ok) { setResult(j); showFlash(`${j.totalCriado} item(ns) criado(s).`); listarArtefatos(procId) }
      else setErro(j.error || "Erro ao executar.")
    } finally { setRunning(false) }
  }

  async function desfazer(artefatoId: number) {
    setErro("")
    const res = await fetch("/api/gerenciamento/executor-motor", { method: "POST", headers: authHeaders(), body: JSON.stringify({ action: "undo", artefatoId }) })
    if (res.ok) { showFlash("Artefato desfeito."); if (procId) listarArtefatos(procId) }
    else { const j = await res.json().catch(() => ({})); setErro(j.error || "Erro ao desfazer.") }
  }

  async function toggleAuto() {
    const novo = !autoExecutar
    setAutoExecutar(novo)
    const res = await fetch("/api/gerenciamento/executor-motor", { method: "POST", headers: authHeaders(), body: JSON.stringify({ action: "config", value: novo }) })
    if (res.ok) showFlash(novo ? "Gatilho automático LIGADO — o motor roda ao avançar a fase." : "Gatilho automático desligado — só pelo botão.")
    else { setAutoExecutar(!novo); setErro("Não consegui mudar a chave.") }
  }

  if (loading) return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando…</div>

  const ativos = artefatos.filter(a => a.status === "active")

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-2.5 text-sm text-green-700">{flash}</div>}

      {/* chave liga/desliga do gatilho automático */}
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            Gatilho automático
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${autoExecutar ? "bg-[var(--surface-secondary)] text-green-700" : "bg-[var(--surface-primary)] text-[var(--text-secondary)]"}`}>{autoExecutar ? "LIGADO" : "desligado"}</span>
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-secondary)]">Ligado: o motor roda sozinho ao <b>avançar a fase</b> de um processo conectado. Desligado: só pelo botão abaixo. {autoExecutar && <span className="text-amber-700/80">Cuidado — cria artefatos automaticamente.</span>}</div>
        </div>
        <button onClick={toggleAuto} role="switch" aria-checked={autoExecutar} aria-label="Gatilho automático" className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors ${autoExecutar ? "bg-green-700" : "bg-[var(--surface-secondary)]"}`}>
          <span className={`inline-block h-4 w-4 rounded-full bg-[var(--surface-primary)] shadow transition-transform ${autoExecutar ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">Executor do Motor</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Roda as automações de uma fase e <b className="text-amber-700/90">cria os artefatos de verdade</b> no processo: <b>tarefas</b>, <b>lançamentos financeiros</b>, <b>eventos</b> e <b>protocolos</b>. Tudo dá pra desfazer.</p>

        <div className="mt-4">
          <label className={labelCls}>Processo (do operacional)</label>
          <select value={procId ?? ""} onChange={e => onPickProc(Number(e.target.value))} className={inputCls}>
            <option value="" className={opt}>— escolha um processo —</option>
            {processos.map(p => <option key={p.id} value={p.id} className={opt}>{p.nome}{p.tipoProcessoMotorId ? "  ✓ conectado" : ""}</option>)}
          </select>
        </div>

        {proc && !tipoAtual && (
          <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4">
            <div className="text-sm text-[var(--text-secondary)]">Este processo <b>ainda não está conectado</b> a um Tipo do motor. Conecte para poder executar:</div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[240px] flex-1">
                <label className={labelCls}>Tipo de Processo do motor</label>
                <select value={assignTipoId} onChange={e => setAssignTipoId(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
                  <option value="" className={opt}>— escolha —</option>
                  {tipos.map(t => <option key={t.id} value={t.id} className={opt}>{t.name}</option>)}
                </select>
              </div>
              <button disabled={assignTipoId === ""} onClick={() => conectar(Number(assignTipoId))} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-50">Conectar</button>
            </div>
          </div>
        )}

        {proc && tipoAtual && (
          <>
            <div className="mt-4 flex items-center gap-2 text-sm text-white/70">
              <span className="rounded-full bg-[var(--surface-secondary)] px-2.5 py-0.5 text-xs text-green-700">✓ conectado</span>
              <span>Tipo: <b className="text-white">{tipoAtual.name}</b></span>
              <button onClick={() => conectar(null)} className="ml-2 text-xs text-[var(--text-muted)] underline hover:text-white/70">desconectar</button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Fase</label>
                <select value={phaseKey} onChange={e => { setPhaseKey(e.target.value); setResult(null); setConfirming(false) }} className={inputCls}>
                  {fases.length === 0 && <option value="" className={opt}>—</option>}
                  {fases.map(f => <option key={f.phaseKey} value={f.phaseKey} className={opt}>{f.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Evento</label>
                <select value={event} onChange={e => { setEvent(e.target.value); setResult(null); setConfirming(false) }} className={inputCls}>
                  {Object.entries(EVENT_LABELS).map(([v, l]) => <option key={v} value={v} className={opt}>{l}</option>)}
                </select>
              </div>
            </div>

            {!confirming ? (
              <button disabled={running || !phaseKey} onClick={() => setConfirming(true)} className="mt-4 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-amber-600 disabled:opacity-50">Executar automações da fase</button>
            ) : (
              <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4">
                <div className="text-sm text-amber-100">Isso vai <b>criar tarefas e lançamentos reais</b> no processo <b>{proc.nome}</b>. Pode desfazer depois. Confirma?</div>
                <div className="mt-3 flex gap-2">
                  <button disabled={running} onClick={executar} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-amber-600 disabled:opacity-50">{running ? "Executando…" : "Sim, executar"}</button>
                  <button disabled={running} onClick={() => setConfirming(false)} className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm text-white/70 hover:bg-[var(--surface-hover)]">Cancelar</button>
                </div>
              </div>
            )}

            {erro && <div className="mt-3 text-sm text-red-700">{erro}</div>}
          </>
        )}
      </div>

      {/* resultado da última execução */}
      {result && (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 backdrop-blur-sm">
          <div className="mb-2 text-sm text-white/80"><b>{result.totalCriado}</b> item(ns) criado(s){result.skipped.length > 0 && <> · {result.skipped.length} pulado(s)</>}{result.errors.length > 0 && <> · <span className="text-red-700">{result.errors.length} erro(s)</span></>}.</div>
          {result.created.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 text-sm text-green-700">
              <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{TABLE_LABEL[c.targetTable] || c.targetTable}</span>
              <span>+ {c.name}</span>
              {c.amount != null && <span className="text-[var(--text-secondary)]">— {money(c.amount, c.currency || "EUR")}</span>}
              {c.condicional && <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]" title="Era condicional (ex.: exige contrato). Confira e desfaça se não se aplica.">condicional</span>}
            </div>
          ))}
          {result.skipped.map((s, i) => <div key={i} className="text-sm text-[var(--text-secondary)]">• {s.name} — {s.reason}</div>)}
          {result.errors.map((e, i) => <div key={i} className="text-sm text-red-700">⚠ {e}</div>)}
        </div>
      )}

      {/* histórico do que o motor criou nesse processo */}
      {proc && (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 backdrop-blur-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Criado pelo motor neste processo</span>
            <span className="rounded-full bg-[var(--surface-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">{ativos.length} ativo(s)</span>
          </div>
          {artefatos.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)]">Nada criado ainda.</div>
          ) : (
            <div className="space-y-1.5">
              {artefatos.map(a => (
                <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-3 py-2 text-sm">
                  <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{a.targetTable}</span>
                  <span className={a.status === "active" ? "text-white" : "text-[var(--text-muted)] line-through"}>{a.descricao}</span>
                  <span className="text-[var(--text-muted)] text-xs">fase &quot;{a.phaseKey}&quot; · {fmtData(a.criadoEm)}</span>
                  <span className="flex-1" />
                  {a.status === "active"
                    ? <button onClick={() => desfazer(a.id)} className="rounded-lg border border-[var(--border-default)] px-2.5 py-1 text-xs text-white/70 hover:bg-[var(--surface-hover)] hover:text-white">Desfazer</button>
                    : <span className="rounded bg-[var(--surface-primary)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">desfeito</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}