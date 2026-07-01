"use client"

import { useEffect, useState, useCallback } from "react"

// ============================================================
// Tipos
// ============================================================
interface Rule {
  id: number
  templateId: number | null
  tipoProcessoId: number
  phaseKey: string
  name: string
  description?: string | null
  kind: string
  scope: string
  trigger: string
  action?: string | null
  conditions?: { field: string; op: string; value: string }[] | null
  params?: Record<string, unknown> | null
  financialType?: string | null
  idempotent: boolean
  active: boolean
  arquivado: boolean
  runCount: number
}
interface Fase { phaseKey: string; label: string; order: number }
interface TipoProcesso { id: number; name: string; fases: Fase[] }
interface Modelo {
  id: number; name: string; description?: string | null
  type: string; recommendedPhases?: string[] | null
}
interface Data { tiposProcesso: TipoProcesso[]; regras: Rule[]; modelosAutomacao: Modelo[] }

// ============================================================
// Rótulos (PT)
// ============================================================
const KIND_LABELS: Record<string, string> = {
  task: "Tarefa", financial: "Financeiro", document: "Documento",
  event: "Evento", protocol: "Protocolo", phase_advance: "Avanço de fase", alert: "Alerta",
}
const KIND_TABS: [string, string][] = [
  ["task", "Tarefas"], ["financial", "Financeiro"], ["document", "Documentos"],
  ["event", "Eventos"], ["protocol", "Protocolo"], ["phase_advance", "Avanço de fase"],
]
const TRIGGER_LABELS: Record<string, string> = {
  phase_entered: "Quando a fase começa", phase_exited: "Quando a fase termina",
  step_completed: "Quando um passo é concluído", document_validated: "Quando um documento é validado",
  divergence_detected: "Quando uma divergência é detectada", rectification_marked: "Quando é marcada retificação",
  protocol_created: "Quando um protocolo é criado", deadline_due: "Quando um prazo vence",
  person_added: "Quando uma pessoa é adicionada", manual: "Manual",
}
const SCOPE_LABELS: Record<string, string> = {
  process: "Processo", phase: "Fase", person: "Pessoa", document: "Documento", financial: "Financeiro", protocol: "Protocolo",
}
const TRIGGERS = Object.keys(TRIGGER_LABELS)
const SCOPES = Object.keys(SCOPE_LABELS)
const trigLabel = (t?: string) => (t && TRIGGER_LABELS[t]) || t || ""
const kindLabel = (k?: string) => (k && KIND_LABELS[k]) || k || ""

function amtTypeToKind(t?: string) { return t === "phase_transition" ? "phase_advance" : (t || "task") }
function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"
const opt = "bg-zinc-900"

// ícones
const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ICopy = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>)
const IPower = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>)
const IArch = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" /></svg>)
const IUnarch = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

type Form = {
  id?: number; kind: string; name: string; description: string; scope: string; trigger: string; action: string
  condField: string; condOp: string; condVal: string; idempotent: boolean; active: boolean
  owner: string; priority: string; slaDays: number; checklist: string
  financialType: string; amount: number; currency: string; financialItemCode: string
  targetPhaseKey: string; autoAdvance: boolean; alertSeverity: string; documentRequired: boolean
  eventType: string; eventOffsetDays: number
}
function blankForm(kind: string): Form {
  return {
    kind, name: "", description: "", scope: "phase", trigger: "phase_entered", action: "",
    condField: "", condOp: "eq", condVal: "", idempotent: true, active: true,
    owner: "", priority: "medium", slaDays: 0, checklist: "",
    financialType: "cost", amount: 0, currency: "EUR", financialItemCode: "",
    targetPhaseKey: "", autoAdvance: false, alertSeverity: "info", documentRequired: true,
    eventType: "", eventOffsetDays: 0,
  }
}

// ============================================================
// Componente
// ============================================================
export default function PhaseAutomationsFasesTab() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")

  const [ptId, setPtId] = useState<string>("")
  const [phase, setPhase] = useState<string>("all") // 'all' ou phaseKey
  const [tab, setTab] = useState<string>("task")
  const [showArchived, setShowArchived] = useState(false)

  const [applyOpen, setApplyOpen] = useState(false)
  const [applySel, setApplySel] = useState<number | null>(null)
  const [form, setForm] = useState<Form | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/automacoes-fase", { headers: authHeaders() })
      if (res.ok) setData(await res.json())
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 2800) }
  const upsertRuleLocal = (r: Rule) => setData(d => {
    if (!d) return d
    const i = d.regras.findIndex(x => x.id === r.id); const regras = d.regras.slice()
    if (i < 0) regras.push(r); else regras[i] = r
    return { ...d, regras }
  })
  const removeRuleLocal = (id: number) => setData(d => d ? { ...d, regras: d.regras.filter(x => x.id !== id) } : d)

  const proc = data?.tiposProcesso.find(t => String(t.id) === ptId) || null
  const ptNum = ptId ? Number(ptId) : null
  const fases = proc ? proc.fases.slice().sort((a, b) => a.order - b.order) : []
  const faseAtual = fases.find(f => f.phaseKey === phase) || null

  const rulesOf = (phaseKey: string, kind?: string, includeArchived = false) =>
    (data?.regras || []).filter(r => r.tipoProcessoId === ptNum && r.phaseKey === phaseKey && (!kind || r.kind === kind) && (includeArchived || !r.arquivado))

  // ---------- ações ----------
  async function aplicar() {
    if (!applySel || !faseAtual) return
    setBusy(true)
    try {
      const res = await fetch("/api/gerenciamento/automacoes-fase", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ aplicar: true, templateId: applySel, tipoProcessoId: ptNum, phaseKey: faseAtual.phaseKey }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.rule) { upsertRuleLocal(j.rule); setApplyOpen(false); setApplySel(null); showFlash("Modelo aplicado.") }
      else showFlash(j.error || "Erro ao aplicar.")
    } finally { setBusy(false) }
  }

  function openNew() { if (!faseAtual) return; setForm(blankForm(tab)) }
  function openEdit(r: Rule) {
    const p = (r.params || {}) as Record<string, unknown>
    const c0 = (r.conditions && r.conditions[0]) || { field: "", op: "eq", value: "" }
    setForm({
      id: r.id, kind: r.kind, name: r.name, description: r.description || "", scope: r.scope, trigger: r.trigger, action: r.action || "",
      condField: c0.field || "", condOp: c0.op || "eq", condVal: (c0.value ?? "") + "", idempotent: r.idempotent, active: r.active,
      owner: (p.owner as string) || "", priority: (p.priority as string) || "medium", slaDays: Number(p.slaDays) || 0,
      checklist: Array.isArray(p.checklist) ? (p.checklist as string[]).join("\n") : "",
      financialType: r.financialType || (p.financialType as string) || "cost", amount: Number(p.amount) || 0,
      currency: (p.currency as string) || "EUR", financialItemCode: (p.financialItemCode as string) || "",
      targetPhaseKey: (p.targetPhaseKey as string) || "", autoAdvance: p.autoAdvance === true,
      alertSeverity: (p.alertSeverity as string) || "info", documentRequired: p.documentRequired !== false,
      eventType: (p.eventType as string) || "", eventOffsetDays: Number(p.eventOffsetDays) || 0,
    })
  }

  function buildParams(f: Form): Record<string, unknown> {
    if (f.kind === "task") return { owner: f.owner, priority: f.priority, slaDays: f.slaDays, checklist: f.checklist ? f.checklist.split("\n").map(s => s.trim()).filter(Boolean) : [] }
    if (f.kind === "financial") return { financialType: f.financialType, amount: f.amount, currency: f.currency, financialItemCode: f.financialItemCode }
    if (f.kind === "phase_advance") return { targetPhaseKey: f.targetPhaseKey, autoAdvance: f.autoAdvance }
    if (f.kind === "alert") return { alertSeverity: f.alertSeverity }
    if (f.kind === "document") return { documentRequired: f.documentRequired }
    if (f.kind === "event") return { eventType: f.eventType, eventOffsetDays: f.eventOffsetDays }
    return {}
  }

  async function saveForm() {
    if (!form || !faseAtual) return
    if (!form.name.trim()) { showFlash("Dê um nome à automação."); return }
    const conditions = form.condField && form.condOp ? [{ field: form.condField, op: form.condOp, value: form.condVal }] : []
    const payload = {
      tipoProcessoId: ptNum, phaseKey: faseAtual.phaseKey, kind: form.kind, name: form.name,
      description: form.description, scope: form.scope, trigger: form.trigger, action: form.action,
      conditions, params: buildParams(form),
      financialType: form.kind === "financial" ? form.financialType : null,
      idempotent: form.idempotent, active: form.active,
    }
    setBusy(true)
    try {
      const url = form.id ? `/api/gerenciamento/automacoes-fase/${form.id}` : "/api/gerenciamento/automacoes-fase"
      const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(payload) })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.rule) { upsertRuleLocal(j.rule); setForm(null); showFlash(form.id ? "Automação salva." : "Automação criada.") }
      else showFlash(j.error || "Erro ao salvar.")
    } finally { setBusy(false) }
  }

  async function toggleRule(r: Rule) {
    upsertRuleLocal({ ...r, active: !r.active }) // otimista
    const res = await fetch(`/api/gerenciamento/automacoes-fase/${r.id}`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ active: !r.active }),
    })
    if (res.ok) { const j = await res.json().catch(() => ({})); if (j.rule) upsertRuleLocal(j.rule) } else { showFlash("Erro."); load() }
  }
  async function dupRule(r: Rule) {
    setBusy(true)
    try {
      const payload = {
        tipoProcessoId: r.tipoProcessoId, phaseKey: r.phaseKey, kind: r.kind, name: r.name + " (cópia)",
        description: r.description, scope: r.scope, trigger: r.trigger, action: r.action,
        conditions: r.conditions || [], params: r.params || {}, financialType: r.financialType,
        idempotent: r.idempotent, active: r.active,
      }
      const res = await fetch("/api/gerenciamento/automacoes-fase", { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.rule) { upsertRuleLocal(j.rule); showFlash("Automação duplicada.") } else showFlash(j.error || "Erro.")
    } finally { setBusy(false) }
  }
  async function archiveRule(r: Rule) {
    if (!confirm(`Arquivar a automação "${r.name}"? Ela sai da lista de ativas, mas pode ser reativada depois.`)) return
    upsertRuleLocal({ ...r, arquivado: true, active: false }) // otimista — some da lista de ativas, mas fica no banco
    const res = await fetch(`/api/gerenciamento/automacoes-fase/${r.id}`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ arquivado: true, active: false }),
    })
    if (res.ok) { const j = await res.json().catch(() => ({})); if (j.rule) upsertRuleLocal(j.rule); showFlash("Automação arquivada. Use “Mostrar arquivadas” para revê-la.") } else { showFlash("Erro."); load() }
  }
  async function unarchiveRule(r: Rule) {
    upsertRuleLocal({ ...r, arquivado: false, active: true })
    const res = await fetch(`/api/gerenciamento/automacoes-fase/${r.id}`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ arquivado: false, active: true }),
    })
    if (res.ok) { const j = await res.json().catch(() => ({})); if (j.rule) upsertRuleLocal(j.rule); showFlash("Automação reativada.") } else { showFlash("Erro."); load() }
  }
  async function deleteRule(r: Rule) {
    if (!confirm(`Excluir a automação "${r.name}"?`)) return
    const res = await fetch(`/api/gerenciamento/automacoes-fase/${r.id}`, { method: "DELETE", headers: authHeaders() })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { removeRuleLocal(r.id); showFlash("Automação excluída.") }
    else showFlash(j.error || "Erro ao excluir.")
  }

  // ---------- render ----------
  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  const modelosDoKind = (data?.modelosAutomacao || [])
    .filter(m => amtTypeToKind(m.type) === tab)
    .slice()
    .sort((a, b) => {
      if (!faseAtual) return a.name.localeCompare(b.name)
      const ra = (a.recommendedPhases || []).includes(faseAtual.phaseKey) ? 0 : 1
      const rb = (b.recommendedPhases || []).includes(faseAtual.phaseKey) ? 0 : 1
      return ra - rb || a.name.localeCompare(b.name)
    })

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>}

      {/* cabeçalho */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">Automações por Fase</h2>
        <p className="mt-1 text-sm text-white/60">
          Aplica os Modelos de Automação (2C) às fases do processo. Cada regra tem um gatilho, uma condição e uma ação. Para os modelos reutilizáveis, use a biblioteca <span className="text-blue-300">“Modelos de Automação”</span>. <span className="text-white/40">A execução real das regras vem na Fase 4.</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <div className="min-w-[240px] flex-1">
            <label className={labelCls}>Processo de Nacionalidade</label>
            <select value={ptId} onChange={e => { setPtId(e.target.value); setPhase("all") }} className={inputCls}>
              <option value="" className={opt}>— Selecione um processo —</option>
              {data?.tiposProcesso.map(t => <option key={t.id} value={t.id} className={opt}>{t.name}</option>)}
            </select>
          </div>
          {proc && (
            <div className="min-w-[220px] flex-1">
              <label className={labelCls}>Fase</label>
              <select value={phase} onChange={e => setPhase(e.target.value)} className={inputCls}>
                <option value="all" className={opt}>Todas as fases (resumo)</option>
                {fases.map(f => <option key={f.phaseKey} value={f.phaseKey} className={opt}>[{f.order}] {f.label}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {!proc && <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/50">Escolha um Processo de Nacionalidade para ver as automações das fases.</div>}

      {/* RESUMO — todas as fases */}
      {proc && phase === "all" && (
        <div className="space-y-3">
          {fases.length === 0 && <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/50">Este processo ainda não possui fases no Workflow Macro.</div>}
          {fases.map(f => {
            const all = rulesOf(f.phaseKey)
            const byKind = KIND_TABS.map(([k, lbl]) => [lbl, all.filter(r => r.kind === k).length] as [string, number]).filter(([, n]) => n > 0)
            return (
              <div key={f.phaseKey} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">[{f.order}] {f.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${all.length ? "bg-green-500/15 text-green-300" : "bg-white/10 text-white/50"}`}>{all.length ? "configurada" : "vazia"}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-white/50">{byKind.length ? byKind.map(([l, n]) => `${n} ${l.toLowerCase()}`).join(" · ") : "nenhuma automação aplicada"}</div>
                  </div>
                  <button onClick={() => { setPhase(f.phaseKey); setTab("task") }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">Gerenciar</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* DETALHE — fase específica */}
      {proc && faseAtual && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
          <div className="mb-3 text-sm text-white/60"><b className="text-white">{proc.name}</b> · [{faseAtual.order}] {faseAtual.label}</div>

          {/* abas por tipo */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {KIND_TABS.map(([k, lbl]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`rounded-full px-3 py-1 text-[11px] transition-colors ${tab === k ? "bg-blue-600 text-white" : "bg-white/5 text-white/60 hover:bg-white/10"}`}>
                {lbl}<span className="ml-1 opacity-60">{rulesOf(faseAtual.phaseKey, k).length}</span>
              </button>
            ))}
          </div>

          {/* toolbar */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button onClick={() => { setApplySel(null); setApplyOpen(true) }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">+ Aplicar modelo de automação</button>
            <button onClick={openNew} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">+ Nova regra ({kindLabel(tab).toLowerCase()})</button>
            {(() => {
              const arq = rulesOf(faseAtual.phaseKey, tab, true).filter(r => r.arquivado).length
              return arq > 0 ? (
                <button onClick={() => setShowArchived(v => !v)} className={`ml-auto rounded-lg border px-3 py-1.5 text-xs ${showArchived ? "border-blue-400/40 bg-blue-500/10 text-blue-200" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"}`}>
                  {showArchived ? "Ocultar arquivadas" : `Mostrar arquivadas (${arq})`}
                </button>
              ) : null
            })()}
          </div>

          {/* lista de regras */}
          {(() => {
            const rules = rulesOf(faseAtual.phaseKey, tab, showArchived)
            if (!rules.length) return <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-6 text-center text-xs text-white/40">Nenhuma automação de {kindLabel(tab).toLowerCase()} {showArchived ? "arquivada " : ""}nesta fase. Aplique um modelo ou crie uma regra.</div>
            return (
              <div className="space-y-2">
                {rules.map(r => {
                  const p = (r.params || {}) as Record<string, unknown>
                  const cond = r.conditions && r.conditions[0]
                  return (
                    <div key={r.id} className={`rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 ${r.arquivado ? "opacity-60" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white">{r.name}</span>
                            {r.arquivado
                              ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/50">arquivada</span>
                              : <span className={`rounded-full px-2 py-0.5 text-[10px] ${r.active ? "bg-green-500/15 text-green-300" : "bg-white/10 text-white/50"}`}>{r.active ? "Ativa" : "Inativa"}</span>}
                            {r.templateId != null && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-300">de modelo</span>}
                          </div>
                          {r.description && <div className="mt-0.5 text-xs text-white/50">{r.description}</div>}
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-white/50">
                            <span className="rounded bg-white/10 px-1.5 py-0.5">{kindLabel(r.kind)}</span>
                            <span className="rounded bg-white/10 px-1.5 py-0.5">{trigLabel(r.trigger)}</span>
                            {r.kind === "financial" && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">{r.financialType === "revenue" || r.financialType === "honorarium" ? "receita" : "custo"} {(Number(p.amount) || 0)} {(p.currency as string) || "EUR"}</span>}
                            {r.kind === "task" && !!p.priority && <span className="rounded bg-white/10 px-1.5 py-0.5">prio: {String(p.priority)}</span>}
                            {cond && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">se {cond.field} {cond.op === "eq" ? "=" : cond.op} {cond.value}</span>}
                            <span className="rounded bg-white/10 px-1.5 py-0.5">{r.idempotent ? "evita duplicar" : "permite repetir"}</span>
                          </div>
                        </div>
                        <div className="flex flex-none items-center gap-0.5 text-white/50">
                          {r.arquivado ? (
                            <>
                              <button title="Reativar" aria-label="Reativar" onClick={() => unarchiveRule(r)} className="rounded p-1 text-green-300/80 hover:bg-white/10 hover:text-green-300"><IUnarch /></button>
                              <button title="Excluir" aria-label="Excluir" onClick={() => deleteRule(r)} className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300"><ITrash /></button>
                            </>
                          ) : (
                            <>
                              <button title="Editar" aria-label="Editar" onClick={() => openEdit(r)} className="rounded p-1 hover:bg-white/10 hover:text-white"><IEdit /></button>
                              <button title="Duplicar" aria-label="Duplicar" onClick={() => dupRule(r)} className="rounded p-1 hover:bg-white/10 hover:text-white"><ICopy /></button>
                              <button title={r.active ? "Desativar" : "Ativar"} aria-label="Ativar/Desativar" onClick={() => toggleRule(r)} className="rounded p-1 hover:bg-white/10 hover:text-white"><IPower /></button>
                              <button title="Arquivar" aria-label="Arquivar" onClick={() => archiveRule(r)} className="rounded p-1 hover:bg-white/10 hover:text-white"><IArch /></button>
                              <button title="Excluir" aria-label="Excluir" onClick={() => deleteRule(r)} className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300"><ITrash /></button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}

      {/* MODAL — aplicar modelo 2C */}
      {applyOpen && faseAtual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setApplyOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="font-semibold text-white">Aplicar modelo de automação</h3>
              <p className="mt-0.5 text-xs text-white/50">Fase: {faseAtual.label} · tipo: {kindLabel(tab)} · a configuração do modelo será copiada para a fase.</p>
            </div>
            <div className="space-y-1.5 px-6 py-4">
              {modelosDoKind.length === 0 && <div className="text-sm text-white/50">Nenhum modelo de {kindLabel(tab).toLowerCase()} na biblioteca.</div>}
              {modelosDoKind.map(m => {
                const rec = (m.recommendedPhases || []).includes(faseAtual.phaseKey)
                return (
                  <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${applySel === m.id ? "border-blue-400/50 bg-blue-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                    <input type="radio" name="modelo" checked={applySel === m.id} onChange={() => setApplySel(m.id)} className="mt-1" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{m.name}</span>
                        {rec && <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] text-green-300">recomendado</span>}
                      </div>
                      {m.description && <div className="mt-0.5 text-xs text-white/50">{m.description}</div>}
                    </div>
                  </label>
                )
              })}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setApplyOpen(false)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button disabled={!applySel || busy} onClick={aplicar} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">Aplicar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL — editor de regra */}
      {form && faseAtual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="font-semibold text-white">{form.id ? "Editar automação" : "Nova automação"} · {kindLabel(form.kind)}</h3>
              <p className="mt-0.5 text-xs text-white/50">Fase: {faseAtual.label}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 px-6 py-4">
              <div className="col-span-2">
                <label className={labelCls}>Nome *</label>
                <input value={form.name} onChange={e => setForm(f => f && { ...f, name: e.target.value })} className={inputCls} placeholder="Ex.: Criar tarefa de conferência" />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Descrição</label>
                <input value={form.description} onChange={e => setForm(f => f && { ...f, description: e.target.value })} className={inputCls} placeholder="opcional" />
              </div>
              <div>
                <label className={labelCls}>Quando (gatilho)</label>
                <select value={form.trigger} onChange={e => setForm(f => f && { ...f, trigger: e.target.value })} className={inputCls}>
                  {TRIGGERS.map(t => <option key={t} value={t} className={opt}>{TRIGGER_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Escopo</label>
                <select value={form.scope} onChange={e => setForm(f => f && { ...f, scope: e.target.value })} className={inputCls}>
                  {SCOPES.map(s => <option key={s} value={s} className={opt}>{SCOPE_LABELS[s]}</option>)}
                </select>
              </div>

              {/* campos por tipo */}
              {form.kind === "task" && (<>
                <div><label className={labelCls}>Responsável padrão</label><input value={form.owner} onChange={e => setForm(f => f && { ...f, owner: e.target.value })} className={inputCls} placeholder="opcional" /></div>
                <div><label className={labelCls}>Prioridade</label><select value={form.priority} onChange={e => setForm(f => f && { ...f, priority: e.target.value })} className={inputCls}><option value="low" className={opt}>baixa</option><option value="medium" className={opt}>média</option><option value="high" className={opt}>alta</option></select></div>
                <div><label className={labelCls}>SLA (dias)</label><input type="number" value={form.slaDays} onChange={e => setForm(f => f && { ...f, slaDays: Number(e.target.value) || 0 })} className={inputCls} /></div>
                <div className="col-span-2"><label className={labelCls}>Checklist (um item por linha)</label><textarea value={form.checklist} onChange={e => setForm(f => f && { ...f, checklist: e.target.value })} className={`${inputCls} min-h-[60px]`} /></div>
              </>)}
              {form.kind === "financial" && (<>
                <div><label className={labelCls}>Tipo financeiro</label><select value={form.financialType} onChange={e => setForm(f => f && { ...f, financialType: e.target.value })} className={inputCls}><option value="cost" className={opt}>Custo</option><option value="revenue" className={opt}>Receita</option><option value="honorarium" className={opt}>Honorário</option><option value="fee" className={opt}>Taxa</option><option value="tax" className={opt}>Imposto</option></select></div>
                <div><label className={labelCls}>Item financeiro (código)</label><input value={form.financialItemCode} onChange={e => setForm(f => f && { ...f, financialItemCode: e.target.value })} className={inputCls} placeholder="opcional (senão valor fixo)" /></div>
                <div><label className={labelCls}>Valor (se sem item)</label><input type="number" value={form.amount} onChange={e => setForm(f => f && { ...f, amount: Number(e.target.value) || 0 })} className={inputCls} /></div>
                <div><label className={labelCls}>Moeda</label><select value={form.currency} onChange={e => setForm(f => f && { ...f, currency: e.target.value })} className={inputCls}><option value="EUR" className={opt}>EUR</option><option value="BRL" className={opt}>BRL</option><option value="USD" className={opt}>USD</option></select></div>
              </>)}
              {form.kind === "phase_advance" && (<>
                <div className="col-span-2"><label className={labelCls}>Liberar/ir para a fase</label><select value={form.targetPhaseKey} onChange={e => setForm(f => f && { ...f, targetPhaseKey: e.target.value })} className={inputCls}><option value="" className={opt}>—</option>{fases.map(p => <option key={p.phaseKey} value={p.phaseKey} className={opt}>[{p.order}] {p.label}</option>)}</select></div>
                <div><label className={labelCls}>Efetivar automaticamente</label><select value={form.autoAdvance ? "1" : "0"} onChange={e => setForm(f => f && { ...f, autoAdvance: e.target.value === "1" })} className={inputCls}><option value="0" className={opt}>não (só sugerir)</option><option value="1" className={opt}>sim</option></select></div>
              </>)}
              {form.kind === "alert" && (
                <div><label className={labelCls}>Severidade</label><select value={form.alertSeverity} onChange={e => setForm(f => f && { ...f, alertSeverity: e.target.value })} className={inputCls}><option value="info" className={opt}>info</option><option value="warning" className={opt}>atenção</option><option value="critical" className={opt}>crítico</option></select></div>
              )}
              {form.kind === "document" && (
                <div><label className={labelCls}>Necessidade</label><select value={form.documentRequired ? "1" : "0"} onChange={e => setForm(f => f && { ...f, documentRequired: e.target.value === "1" })} className={inputCls}><option value="1" className={opt}>tornar necessário</option><option value="0" className={opt}>marcar desnecessário</option></select></div>
              )}
              {form.kind === "event" && (<>
                <div><label className={labelCls}>Tipo de evento</label><input value={form.eventType} onChange={e => setForm(f => f && { ...f, eventType: e.target.value })} className={inputCls} placeholder="ex.: reuniao" /></div>
                <div><label className={labelCls}>Prazo (dias)</label><input type="number" value={form.eventOffsetDays} onChange={e => setForm(f => f && { ...f, eventOffsetDays: Number(e.target.value) || 0 })} className={inputCls} /></div>
              </>)}

              {/* condição + avançado */}
              <div className="col-span-2 mt-1 rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="mb-2 text-xs font-semibold text-white/60">Condição (opcional)</div>
                <div className="grid grid-cols-3 gap-2">
                  <input value={form.condField} onChange={e => setForm(f => f && { ...f, condField: e.target.value })} className={inputCls} placeholder="campo" />
                  <select value={form.condOp} onChange={e => setForm(f => f && { ...f, condOp: e.target.value })} className={inputCls}><option value="eq" className={opt}>igual a</option><option value="neq" className={opt}>diferente de</option><option value="exists" className={opt}>existe</option><option value="truthy" className={opt}>é verdadeiro</option></select>
                  <input value={form.condVal} onChange={e => setForm(f => f && { ...f, condVal: e.target.value })} className={inputCls} placeholder="valor" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Idempotência</label>
                <select value={form.idempotent ? "1" : "0"} onChange={e => setForm(f => f && { ...f, idempotent: e.target.value === "1" })} className={inputCls}><option value="1" className={opt}>evita duplicidade</option><option value="0" className={opt}>permite repetir</option></select>
              </div>
              <div>
                <label className={labelCls}>Situação</label>
                <select value={form.active ? "1" : "0"} onChange={e => setForm(f => f && { ...f, active: e.target.value === "1" })} className={inputCls}><option value="1" className={opt}>Ativa</option><option value="0" className={opt}>Inativa</option></select>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setForm(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button disabled={busy} onClick={saveForm} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}