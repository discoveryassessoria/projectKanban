"use client"

import { useEffect, useState, useCallback } from "react"

// ============================================================
// Tipos
// ============================================================
interface Fase { phaseKey: string; label: string; ordem: number }
interface TipoProcesso { id: number; name: string; fases: Fase[] }
interface DocType { id: number; code: string | null; name: string }
interface Regra {
  id: number; tipoProcessoId: number; phaseKey: string | null; documentTypeCode: string
  target: string; generationRule: string; required: boolean; conditional: boolean; condition: string | null
  createsTask: boolean; createsCost: boolean; createsRevenue: boolean; blocksPhaseCompletion: boolean
  usedByCount: number; arquivado: boolean
}
interface Data { tiposProcesso: TipoProcesso[]; docTypes: DocType[]; matriz: Regra[] }

// ============================================================
// Rótulos (do mockup)
// ============================================================
const TARGETS: Record<string, string> = {
  direct_line_person: "Pessoa da linha reta", non_direct_person: "Pessoa fora da linha reta", applicant: "Requerente",
  spouse: "Cônjuge", child: "Filho", ascendant: "Ascendente", whole_process: "Processo inteiro", family: "Família",
}
const GENRULES: Record<string, string> = {
  all_direct_line: "Todos da linha reta", applicant_only: "Apenas requerente", up_to_generation: "Até geração específica",
  between_generations: "Entre gerações", manual: "Manual", conditional: "Condicional",
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"
const opt = "bg-zinc-900"
const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ICopy = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>)
const IArch = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" /></svg>)
const IUnarch = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

type Form = {
  id?: number; tipoProcessoId: number; phaseKey: string; documentTypeCode: string; target: string; generationRule: string
  required: boolean; conditional: boolean; condition: string
  createsTask: boolean; createsCost: boolean; createsRevenue: boolean; blocksPhaseCompletion: boolean
}
const blankForm = (tipoProcessoId: number): Form => ({
  tipoProcessoId, phaseKey: "", documentTypeCode: "", target: "direct_line_person", generationRule: "all_direct_line",
  required: true, conditional: false, condition: "", createsTask: true, createsCost: false, createsRevenue: false, blocksPhaseCompletion: false,
})

// ============================================================
// Componente
// ============================================================
export default function MatrizDocumentalTab() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  const [ptId, setPtId] = useState<number | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [form, setForm] = useState<Form | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/matriz-documental", { headers: authHeaders() })
      if (res.ok) {
        const d: Data = await res.json()
        setData(d)
        setPtId(prev => prev ?? (d.tiposProcesso[0]?.id ?? null))
      }
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 2800) }
  const upsert = (r: Regra) => setData(d => {
    if (!d) return d
    const i = d.matriz.findIndex(x => x.id === r.id); const matriz = d.matriz.slice()
    if (i < 0) matriz.push(r); else matriz[i] = r
    return { ...d, matriz }
  })
  const remove = (id: number) => setData(d => d ? { ...d, matriz: d.matriz.filter(x => x.id !== id) } : d)

  const proc = data?.tiposProcesso.find(t => t.id === ptId) || null
  const docName = (code: string) => data?.docTypes.find(d => (d.code || String(d.id)) === code)?.name || code
  const phaseName = (pk: string | null) => (pk ? proc?.fases.find(f => f.phaseKey === pk)?.label || pk : "qualquer fase")
  const regrasDoProc = (data?.matriz || []).filter(m => m.tipoProcessoId === ptId && (showArchived || !m.arquivado))
  const arquivadasCount = (data?.matriz || []).filter(m => m.tipoProcessoId === ptId && m.arquivado).length

  async function saveForm() {
    if (!form) return
    if (!form.documentTypeCode) { showFlash("Escolha o tipo de documento."); return }
    setBusy(true)
    try {
      const url = form.id ? `/api/gerenciamento/matriz-documental/${form.id}` : "/api/gerenciamento/matriz-documental"
      const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(form) })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.regra) { upsert(j.regra); setForm(null); showFlash(form.id ? "Regra salva." : "Regra criada.") }
      else showFlash(j.error || "Erro ao salvar.")
    } finally { setBusy(false) }
  }
  async function dup(r: Regra) {
    const { tipoProcessoId, phaseKey, documentTypeCode, target, generationRule, required, conditional, condition, createsTask, createsCost, createsRevenue, blocksPhaseCompletion } = r
    const res = await fetch("/api/gerenciamento/matriz-documental", { method: "POST", headers: authHeaders(), body: JSON.stringify({ tipoProcessoId, phaseKey, documentTypeCode, target, generationRule, required, conditional, condition, createsTask, createsCost, createsRevenue, blocksPhaseCompletion }) })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.regra) { upsert(j.regra); showFlash("Regra duplicada.") } else showFlash(j.error || "Erro.")
  }
  async function setArquivado(r: Regra, arquivado: boolean) {
    if (arquivado && !confirm(`Arquivar a regra de "${docName(r.documentTypeCode)}"?`)) return
    upsert({ ...r, arquivado })
    const res = await fetch(`/api/gerenciamento/matriz-documental/${r.id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ arquivado }) })
    if (res.ok) { const j = await res.json().catch(() => ({})); if (j.regra) upsert(j.regra); showFlash(arquivado ? "Regra arquivada." : "Regra reativada.") } else { showFlash("Erro."); load() }
  }
  async function del(r: Regra) {
    if (!confirm(`Excluir a regra de "${docName(r.documentTypeCode)}"?`)) return
    remove(r.id)
    const res = await fetch(`/api/gerenciamento/matriz-documental/${r.id}`, { method: "DELETE", headers: authHeaders() })
    if (res.ok) showFlash("Regra excluída.")
    else { const j = await res.json().catch(() => ({})); showFlash(j.error || "Erro ao excluir."); load() }
  }

  function openEdit(r: Regra) {
    setForm({ id: r.id, tipoProcessoId: r.tipoProcessoId, phaseKey: r.phaseKey || "", documentTypeCode: r.documentTypeCode, target: r.target, generationRule: r.generationRule, required: r.required, conditional: r.conditional, condition: r.condition || "", createsTask: r.createsTask, createsCost: r.createsCost, createsRevenue: r.createsRevenue, blocksPhaseCompletion: r.blocksPhaseCompletion })
  }

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>}

      {/* cabeçalho + seletor */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">Matriz Documental</h2>
        <p className="mt-1 text-sm text-white/60">Quais documentos são exigidos por processo, fase, alvo e regra de geração. Define se cria tarefa/custo/receita e se bloqueia a conclusão da fase. <span className="text-white/40">A execução real vem na Fase 4.</span></p>
        <div className="mt-4 max-w-md">
          <label className={labelCls}>Processo de Nacionalidade</label>
          <select value={ptId ?? ""} onChange={e => { setPtId(Number(e.target.value)); setShowArchived(false) }} className={inputCls}>
            {(data?.tiposProcesso || []).length === 0 && <option value="" className={opt}>Nenhum processo cadastrado</option>}
            {data?.tiposProcesso.map(t => <option key={t.id} value={t.id} className={opt}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {proc && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button onClick={() => setForm(blankForm(proc.id))} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">+ Nova regra documental</button>
            {arquivadasCount > 0 && (
              <button onClick={() => setShowArchived(v => !v)} className={`ml-auto rounded-lg border px-3 py-1.5 text-xs ${showArchived ? "border-blue-400/40 bg-blue-500/10 text-blue-200" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"}`}>
                {showArchived ? "Ocultar arquivadas" : `Mostrar arquivadas (${arquivadasCount})`}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 text-left text-xs text-white/50">
                <tr><th className="px-3 py-2 font-medium">Fase</th><th className="px-3 py-2 font-medium">Documento</th><th className="px-3 py-2 font-medium">Alvo</th><th className="px-3 py-2 font-medium">Regra de geração</th><th className="px-3 py-2 font-medium">Exigência</th><th className="px-3 py-2 font-medium">Gera</th><th className="px-3 py-2 text-right font-medium">Ações</th></tr>
              </thead>
              <tbody>
                {regrasDoProc.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-white/40">Nenhuma regra documental para este processo.</td></tr>
                ) : regrasDoProc.map(m => (
                  <tr key={m.id} className={`border-b border-white/5 last:border-0 ${m.arquivado ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2 text-xs text-white/70">{phaseName(m.phaseKey)}</td>
                    <td className="px-3 py-2 font-medium text-white">{docName(m.documentTypeCode)}{m.arquivado && <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] text-white/50">arquivada</span>}</td>
                    <td className="px-3 py-2 text-xs text-white/70">{TARGETS[m.target] || m.target}</td>
                    <td className="px-3 py-2 text-[11px] text-white/50">{GENRULES[m.generationRule] || m.generationRule}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${m.required ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-white/50"}`}>{m.required ? "obrigatório" : "opcional"}</span>
                      {m.blocksPhaseCompletion && <span className="ml-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300">bloqueia fase</span>}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-white/50">{[m.createsTask && "tarefa", m.createsCost && "custo", m.createsRevenue && "receita"].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5 text-white/50">
                        {m.arquivado ? (
                          <>
                            <button title="Reativar" aria-label="Reativar" onClick={() => setArquivado(m, false)} className="rounded p-1 text-green-300/80 hover:bg-white/10 hover:text-green-300"><IUnarch /></button>
                            {(m.usedByCount || 0) === 0 && <button title="Excluir" aria-label="Excluir" onClick={() => del(m)} className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300"><ITrash /></button>}
                          </>
                        ) : (
                          <>
                            <button title="Editar" aria-label="Editar" onClick={() => openEdit(m)} className="rounded p-1 hover:bg-white/10 hover:text-white"><IEdit /></button>
                            <button title="Duplicar" aria-label="Duplicar" onClick={() => dup(m)} className="rounded p-1 hover:bg-white/10 hover:text-white"><ICopy /></button>
                            <button title="Arquivar" aria-label="Arquivar" onClick={() => setArquivado(m, true)} className="rounded p-1 hover:bg-white/10 hover:text-white"><IArch /></button>
                            {(m.usedByCount || 0) === 0 && <button title="Excluir" aria-label="Excluir" onClick={() => del(m)} className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300"><ITrash /></button>}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4"><h3 className="font-semibold text-white">{form.id ? "Editar" : "Nova"} regra documental</h3></div>
            <div className="grid grid-cols-2 gap-3 px-6 py-4">
              <div>
                <label className={labelCls}>Fase</label>
                <select value={form.phaseKey} onChange={e => setForm(f => f && { ...f, phaseKey: e.target.value })} className={inputCls}>
                  <option value="" className={opt}>— qualquer fase —</option>
                  {proc?.fases.map(fa => <option key={fa.phaseKey} value={fa.phaseKey} className={opt}>{fa.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Tipo de documento *</label>
                <select value={form.documentTypeCode} onChange={e => setForm(f => f && { ...f, documentTypeCode: e.target.value })} className={inputCls}>
                  <option value="" className={opt}>— selecione —</option>
                  {data?.docTypes.map(d => <option key={d.id} value={d.code || String(d.id)} className={opt}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Alvo</label>
                <select value={form.target} onChange={e => setForm(f => f && { ...f, target: e.target.value })} className={inputCls}>
                  {Object.entries(TARGETS).map(([v, l]) => <option key={v} value={v} className={opt}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Regra de geração</label>
                <select value={form.generationRule} onChange={e => setForm(f => f && { ...f, generationRule: e.target.value })} className={inputCls}>
                  {Object.entries(GENRULES).map(([v, l]) => <option key={v} value={v} className={opt}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Obrigatório?</label>
                <select value={form.required ? "1" : "0"} onChange={e => setForm(f => f && { ...f, required: e.target.value === "1" })} className={inputCls}><option value="1" className={opt}>Sim</option><option value="0" className={opt}>Não</option></select>
              </div>
              <div>
                <label className={labelCls}>Condicional?</label>
                <select value={form.conditional ? "1" : "0"} onChange={e => setForm(f => f && { ...f, conditional: e.target.value === "1" })} className={inputCls}><option value="0" className={opt}>Não</option><option value="1" className={opt}>Sim</option></select>
              </div>
              <div className="col-span-2"><label className={labelCls}>Condição (se condicional)</label><input value={form.condition} onChange={e => setForm(f => f && { ...f, condition: e.target.value })} className={inputCls} /></div>
              <div className="col-span-2 flex flex-wrap gap-x-5 gap-y-2 pt-1 text-xs text-white/70">
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.createsTask} onChange={e => setForm(f => f && { ...f, createsTask: e.target.checked })} />Cria tarefa</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.createsCost} onChange={e => setForm(f => f && { ...f, createsCost: e.target.checked })} />Cria custo</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.createsRevenue} onChange={e => setForm(f => f && { ...f, createsRevenue: e.target.checked })} />Cria receita</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.blocksPhaseCompletion} onChange={e => setForm(f => f && { ...f, blocksPhaseCompletion: e.target.checked })} />Bloqueia conclusão da fase</label>
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