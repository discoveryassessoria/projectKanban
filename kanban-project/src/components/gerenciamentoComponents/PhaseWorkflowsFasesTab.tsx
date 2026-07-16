"use client"

import { useEffect, useState, useCallback } from "react"

// ============================================================
// Tipos
// ============================================================
interface Step {
  id?: number
  key: string
  label: string
  description?: string | null
  ordem: number
  createsTask: boolean
  required: boolean
  owner?: string | null
  priority?: string
  slaDays?: number
  completionRule?: string | null
  checklist?: unknown
}
interface Workflow {
  id: number
  wfUid: string
  templateId: number | null
  tipoProcessoId: number | null
  phaseKey: string
  name: string
  active: boolean
  passos: Step[]
}
interface Fase { phaseKey: string; label: string; order: number }
interface TipoProcesso { id: number; name: string; fases: Fase[] }
interface ModeloPasso { name: string }
interface Modelo {
  id: number
  name: string
  description?: string | null
  category?: string | null
  recommendedPhases?: string[] | null
  usedByCount: number
  passos: ModeloPasso[]
}
interface Data {
  tiposProcesso: TipoProcesso[]
  workflows: Workflow[]
  modelosWorkflow: Modelo[]
}

// ============================================================
// Helpers
// ============================================================
function slug(s: string) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}
function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` }
           : { "Content-Type": "application/json" }
}

const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"

// ícones compactos
const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ICopy = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>)
const IUp = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>)
const IDown = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

// ============================================================
// Componente
// ============================================================
export default function PhaseWorkflowsFasesTab() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)         // apply/criar/excluir (bloqueia botões)
  const [savingId, setSavingId] = useState<number | null>(null)  // passo gravando em 2º plano
  const [flash, setFlash] = useState("")

  const [ptId, setPtId] = useState<string>("")
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]) // vazio = todas

  const [applyFor, setApplyFor] = useState<{ phaseKey: string; label: string } | null>(null)
  const [applySel, setApplySel] = useState<number | null>(null)
  const [replaceAsk, setReplaceAsk] = useState<{ templateId: number; phaseKey: string; label: string } | null>(null)

  const [stepModal, setStepModal] = useState<{ wf: Workflow; editKey?: string } | null>(null)
  const [stepForm, setStepForm] = useState({ label: "", createsTask: true, required: true, owner: "", slaDays: 0, completionRule: "" })

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/workflows-fase", { headers: authHeaders() })
      if (res.ok) setData(await res.json())
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 2500) }

  // patch local (sem recarregar tudo)
  const upsertWorkflowLocal = (w: Workflow) => setData(d => {
    if (!d) return d
    const i = d.workflows.findIndex(x => x.id === w.id)
    const workflows = d.workflows.slice()
    if (i < 0) workflows.push(w); else workflows[i] = w
    return { ...d, workflows }
  })
  const removeWorkflowLocal = (id: number) => setData(d =>
    d ? { ...d, workflows: d.workflows.filter(x => x.id !== id) } : d)

  const proc = data?.tiposProcesso.find(t => String(t.id) === ptId) || null
  const ptNum = ptId ? Number(ptId) : null
  const fasesOrdenadas = proc ? proc.fases.slice().sort((a, b) => a.order - b.order) : []

  // resolução: específico do processo → senão global (tipoProcessoId null)
  function workflowForPhase(phaseKey: string): Workflow | null {
    const list = data?.workflows || []
    return list.find(w => w.phaseKey === phaseKey && w.tipoProcessoId === ptNum)
        || list.find(w => w.phaseKey === phaseKey && w.tipoProcessoId === null)
        || null
  }

  const togglePhase = (pk: string) =>
    setPhaseFilter(f => f.includes(pk) ? f.filter(x => x !== pk) : [...f, pk])

  const fasesVisiveis = phaseFilter.length === 0 ? fasesOrdenadas : fasesOrdenadas.filter(p => phaseFilter.includes(p.phaseKey))

  // ---------- ações de workflow ----------
  async function criarVazio(phaseKey: string, label: string) {
    setBusy(true)
    try {
      const res = await fetch("/api/gerenciamento/workflows-fase", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ criar: true, phaseKey, phaseLabel: label, tipoProcessoId: ptNum }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.workflow) { upsertWorkflowLocal(j.workflow); showFlash("Workflow interno criado.") }
      else showFlash(j.error || "Erro ao criar.")
    } finally { setBusy(false) }
  }

  async function aplicar(templateId: number, phaseKey: string, label: string, mode?: "replace") {
    setBusy(true)
    try {
      const res = await fetch("/api/gerenciamento/workflows-fase", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ aplicar: true, templateId, phaseKey, tipoProcessoId: ptNum, mode }),
      })
      const j = await res.json().catch(() => ({}))
      if (j.needsChoice) { setApplyFor(null); setReplaceAsk({ templateId, phaseKey, label }); return }
      if (res.ok && j.workflow) { upsertWorkflowLocal(j.workflow); setApplyFor(null); setReplaceAsk(null); showFlash("Modelo aplicado.") }
      else showFlash(j.error || "Erro ao aplicar.")
    } finally { setBusy(false) }
  }

  async function excluirWorkflow(wf: Workflow) {
    const aviso = wf.tipoProcessoId === null
      ? "Este é o workflow GLOBAL (padrão de todos os processos). Excluir?"
      : "Excluir este Workflow Interno?"
    if (!confirm(aviso)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/gerenciamento/workflows-fase/${wf.id}`, { method: "DELETE", headers: authHeaders() })
      if (res.ok) { removeWorkflowLocal(wf.id); showFlash("Workflow excluído.") }
      else showFlash("Erro ao excluir.")
    } finally { setBusy(false) }
  }

  // ---------- passos (OTIMISTA: muda na hora, grava em 2º plano) ----------
  async function putSteps(wf: Workflow, steps: Step[]) {
    const otimista: Workflow = { ...wf, passos: steps.map((s, i) => ({ ...s, ordem: i + 1 })) }
    upsertWorkflowLocal(otimista)          // UI atualiza imediatamente
    setSavingId(wf.id)
    try {
      const res = await fetch(`/api/gerenciamento/workflows-fase/${wf.id}`, {
        method: "PUT", headers: authHeaders(), body: JSON.stringify({ steps }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.workflow) upsertWorkflowLocal(j.workflow)   // troca pelo real (ids/ordem)
      else { showFlash(j.error || "Erro ao salvar — recarregando."); await load() }
    } catch {
      showFlash("Erro de conexão — recarregando."); await load()
    } finally { setSavingId(null) }
  }

  function openAddStep(wf: Workflow) {
    setStepForm({ label: "", createsTask: true, required: true, owner: "", slaDays: 0, completionRule: "" })
    setStepModal({ wf })
  }
  function openEditStep(wf: Workflow, st: Step) {
    setStepForm({ label: st.label, createsTask: st.createsTask, required: st.required, owner: st.owner || "", slaDays: st.slaDays || 0, completionRule: st.completionRule || "" })
    setStepModal({ wf, editKey: st.key })
  }
  async function saveStep() {
    if (!stepModal) return
    const { wf, editKey } = stepModal
    if (!stepForm.label.trim()) { showFlash("Informe o nome do passo."); return }
    let steps: Step[]
    if (editKey) {
      steps = wf.passos.map(s => s.key === editKey ? { ...s, label: stepForm.label, createsTask: stepForm.createsTask, required: stepForm.required, owner: stepForm.owner, slaDays: stepForm.slaDays, completionRule: stepForm.completionRule } : s)
    } else {
      let k = slug(stepForm.label) || "passo"; let n = 2
      while (wf.passos.some(s => s.key === k)) { k = slug(stepForm.label) + "_" + n; n++ }
      steps = [...wf.passos, { key: k, label: stepForm.label, ordem: wf.passos.length + 1, createsTask: stepForm.createsTask, required: stepForm.required, owner: stepForm.owner, slaDays: stepForm.slaDays, completionRule: stepForm.completionRule, priority: "medium" }]
    }
    setStepModal(null)
    await putSteps(wf, steps)
  }
  function dupStep(wf: Workflow, st: Step) {
    let k = st.key + "_copia"; let n = 2
    while (wf.passos.some(s => s.key === k)) { k = st.key + "_copia_" + n; n++ }
    const copy: Step = { ...st, id: undefined, key: k, label: st.label + " (cópia)" }
    const idx = wf.passos.findIndex(s => s.key === st.key)
    const steps = [...wf.passos]; steps.splice(idx + 1, 0, copy)
    putSteps(wf, steps)
  }
  function moveStep(wf: Workflow, st: Step, dir: -1 | 1) {
    const arr = wf.passos.slice().sort((a, b) => a.ordem - b.ordem)
    const i = arr.findIndex(s => s.key === st.key); const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    putSteps(wf, arr)
  }
  function removeStep(wf: Workflow, st: Step) {
    if (!confirm(`Remover o passo "${st.label}"?`)) return
    putSteps(wf, wf.passos.filter(s => s.key !== st.key))
  }

  // ---------- render ----------
  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  const modelos = data?.modelosWorkflow || []
  const modelosOrdenados = applyFor
    ? modelos.slice().sort((a, b) => {
        const ra = (a.recommendedPhases || []).includes(applyFor.phaseKey) ? 0 : 1
        const rb = (b.recommendedPhases || []).includes(applyFor.phaseKey) ? 0 : 1
        return ra - rb || a.name.localeCompare(b.name)
      })
    : []

  return (
    <div className="space-y-5">
      {/* aviso — escopo desta área */}
      <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        Aqui você define os <strong>PASSOS</strong> e a <strong>CONDIÇÃO DE CONCLUSÃO</strong> da fase. Quando todos os requisitos obrigatórios forem atendidos e não houver bloqueios, o sistema conclui a fase e segue a <strong>ORDEM</strong> do Workflow Macro. Esta área <strong>NÃO</strong> escolhe a próxima fase.
      </div>

      {flash && (
        <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>
      )}

      {/* cabeçalho */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">Workflows Internos das Fases</h2>
        <p className="mt-1 text-sm text-white/60">
          Os workflows internos definem os passos <strong>dentro</strong> de cada fase. Escolha o Processo para ver os workflows aplicados por fase. Para criar ou editar modelos reutilizáveis, use a biblioteca <span className="text-blue-300">“Modelos de Workflow Interno”</span>.
        </p>

        <div className="mt-4 max-w-md">
          <label className={labelCls}>Processo de Nacionalidade</label>
          <select value={ptId} onChange={e => { setPtId(e.target.value); setPhaseFilter([]) }} className={inputCls}>
            <option value="" className="bg-zinc-900">— Selecione um processo —</option>
            {data?.tiposProcesso.map(t => (
              <option key={t.id} value={t.id} className="bg-zinc-900">{t.name}</option>
            ))}
          </select>
        </div>

        {/* filtro multi-fase */}
        {proc && fasesOrdenadas.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button onClick={() => setPhaseFilter([])}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${phaseFilter.length === 0 ? "bg-blue-600 text-white" : "bg-white/5 text-white/60 hover:bg-white/10"}`}>
              Todas as fases
            </button>
            <span className="text-white/20">|</span>
            {fasesOrdenadas.map(p => {
              const on = phaseFilter.includes(p.phaseKey)
              return (
                <button key={p.phaseKey} onClick={() => togglePhase(p.phaseKey)}
                  className={`rounded-full px-3 py-1 text-[11px] transition-colors ${on ? "bg-blue-600 text-white" : "bg-white/5 text-white/60 hover:bg-white/10"}`}>
                  {on ? "✓ " : ""}{p.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* corpo */}
      {!proc && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/50">
          Escolha um Processo de Nacionalidade para ver os workflows internos de cada fase.
        </div>
      )}
      {proc && fasesOrdenadas.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/50">
          Este processo ainda não possui fases no Workflow Macro.
        </div>
      )}

      {proc && fasesVisiveis.map(p => {
        const wf = workflowForPhase(p.phaseKey)
        return (
          <div key={p.phaseKey} className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            {/* header do card */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">[{p.order}] {p.label}</span>
                  {wf && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${wf.tipoProcessoId === null ? "bg-white/10 text-white/60" : "bg-sky-500/15 text-sky-300"}`}>
                      {wf.tipoProcessoId === null ? "global (compartilhado)" : "deste processo"}
                    </span>
                  )}
                  {wf?.templateId != null && (
                    <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-300">de modelo</span>
                  )}
                  {wf && savingId === wf.id && (
                    <span className="text-[10px] text-white/40">· salvando…</span>
                  )}
                </div>
                {wf
                  ? <div className="mt-0.5 text-xs text-green-300/80">{wf.passos.length} passo(s) · {wf.passos.filter(s => s.createsTask).length} gera(m) tarefa</div>
                  : <div className="mt-0.5 text-xs text-white/40">Sem workflow interno configurado.</div>}
              </div>
              {wf && (
                <div className="flex flex-none flex-wrap justify-end gap-1.5">
                  <button onClick={() => openAddStep(wf)} className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500">+ Passo</button>
                  <button onClick={() => { setApplySel(null); setApplyFor({ phaseKey: p.phaseKey, label: p.label }) }} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10">Aplicar modelo</button>
                  <button onClick={() => excluirWorkflow(wf)} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10">Excluir</button>
                </div>
              )}
            </div>

            {/* passos ou vazio */}
            {!wf ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => criarVazio(p.phaseKey, p.label)} disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">+ Criar workflow interno</button>
                <button onClick={() => { setApplySel(null); setApplyFor({ phaseKey: p.phaseKey, label: p.label }) }} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">+ Aplicar modelo</button>
              </div>
            ) : wf.passos.length === 0 ? (
              <div className="mt-3 text-xs text-white/40">Nenhum passo ainda. Use “+ Passo” ou aplique um modelo.</div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {wf.passos.slice().sort((a, b) => a.ordem - b.ordem).map((st, idx, arr) => (
                  <div key={st.key} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white">{idx + 1}. {st.label}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {st.createsTask && <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-green-300">gera tarefa</span>}
                        {st.required && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">obrigatório</span>}
                        {st.owner && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/60">{st.owner}</span>}
                        {!!st.slaDays && st.slaDays > 0 && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/60">SLA {st.slaDays}d</span>}
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-0.5 text-white/50">
                      <button title="Editar" aria-label="Editar" onClick={() => openEditStep(wf, st)} className="rounded p-1 hover:bg-white/10 hover:text-white"><IEdit /></button>
                      <button title="Duplicar" aria-label="Duplicar" onClick={() => dupStep(wf, st)} className="rounded p-1 hover:bg-white/10 hover:text-white"><ICopy /></button>
                      <button title="Subir" aria-label="Subir" disabled={idx === 0} onClick={() => moveStep(wf, st, -1)} className="rounded p-1 hover:bg-white/10 hover:text-white disabled:opacity-30"><IUp /></button>
                      <button title="Descer" aria-label="Descer" disabled={idx === arr.length - 1} onClick={() => moveStep(wf, st, 1)} className="rounded p-1 hover:bg-white/10 hover:text-white disabled:opacity-30"><IDown /></button>
                      <button title="Remover" aria-label="Remover" onClick={() => removeStep(wf, st)} className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300"><ITrash /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* MODAL — aplicar modelo */}
      {applyFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setApplyFor(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="font-semibold text-white">Aplicar modelo de workflow</h3>
              <p className="mt-0.5 text-xs text-white/50">Fase: {applyFor.label} · os passos do modelo serão copiados para esta fase.</p>
            </div>
            <div className="space-y-1.5 px-6 py-4">
              {modelosOrdenados.length === 0 && <div className="text-sm text-white/50">Nenhum modelo na biblioteca.</div>}
              {modelosOrdenados.map(m => {
                const rec = (m.recommendedPhases || []).includes(applyFor.phaseKey)
                return (
                  <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${applySel === m.id ? "border-blue-400/50 bg-blue-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                    <input type="radio" name="modelo" checked={applySel === m.id} onChange={() => setApplySel(m.id)} className="mt-1" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{m.name}</span>
                        {rec && <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] text-green-300">recomendado</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-white/50">{m.passos.length} passo(s){m.description ? " · " + m.description : ""}</div>
                    </div>
                  </label>
                )
              })}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setApplyFor(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button disabled={!applySel || busy} onClick={() => applySel && aplicar(applySel, applyFor.phaseKey, applyFor.label)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">Aplicar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL — confirmar substituição */}
      {replaceAsk && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setReplaceAsk(null)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/95 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-white">Substituir os passos?</h3>
            <p className="mt-2 text-sm text-white/60">A fase <strong>{replaceAsk.label}</strong> já tem um workflow interno neste processo. Aplicar o modelo vai <strong>substituir os passos atuais</strong> pelos do modelo.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setReplaceAsk(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button disabled={busy} onClick={() => aplicar(replaceAsk.templateId, replaceAsk.phaseKey, replaceAsk.label, "replace")} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">Substituir passos</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL — passo (add/editar) */}
      {stepModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setStepModal(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="font-semibold text-white">{stepModal.editKey ? "Editar passo" : "Adicionar passo"}</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 px-6 py-4">
              <div className="col-span-2">
                <label className={labelCls}>Nome do passo *</label>
                <input value={stepForm.label} onChange={e => setStepForm(f => ({ ...f, label: e.target.value }))} className={inputCls} placeholder="Ex.: Conferir certidão" />
              </div>
              <div>
                <label className={labelCls}>Gera tarefa</label>
                <select value={stepForm.createsTask ? "1" : "0"} onChange={e => setStepForm(f => ({ ...f, createsTask: e.target.value === "1" }))} className={inputCls}>
                  <option value="1" className="bg-zinc-900">Sim</option>
                  <option value="0" className="bg-zinc-900">Não</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Obrigatório</label>
                <select value={stepForm.required ? "1" : "0"} onChange={e => setStepForm(f => ({ ...f, required: e.target.value === "1" }))} className={inputCls}>
                  <option value="1" className="bg-zinc-900">Sim</option>
                  <option value="0" className="bg-zinc-900">Não</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Responsável padrão</label>
                <input value={stepForm.owner} onChange={e => setStepForm(f => ({ ...f, owner: e.target.value }))} className={inputCls} placeholder="opcional" />
              </div>
              <div>
                <label className={labelCls}>SLA (dias)</label>
                <input type="number" value={stepForm.slaDays} onChange={e => setStepForm(f => ({ ...f, slaDays: Number(e.target.value) || 0 }))} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Condição de conclusão</label>
                <input value={stepForm.completionRule} onChange={e => setStepForm(f => ({ ...f, completionRule: e.target.value }))} className={inputCls} placeholder="opcional" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setStepModal(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button onClick={saveStep} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}