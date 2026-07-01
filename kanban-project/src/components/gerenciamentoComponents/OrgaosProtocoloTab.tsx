"use client"

import { useEffect, useState, useCallback } from "react"

interface Orgao { id: number; name: string; type: string | null; country: string | null; state: string | null; city: string | null; queueRule: string | null; ativo: boolean }

const TYPES: [string, string][] = [
  ["consulado", "Consulado"], ["comune", "Comune"], ["tribunal", "Tribunal"], ["conservatoria", "Conservatória"],
  ["cartorio", "Cartório"], ["ministerio", "Ministério"], ["prefeitura", "Prefeitura"], ["tradutor", "Tradutor"],
  ["apostilamento", "Apostilamento"], ["outro", "Outro"],
]
const typeLabel = (t: string | null) => (t ? TYPES.find(x => x[0] === t)?.[1] || t : "—")

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"
const opt = "bg-zinc-900"
const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

type Form = { id?: number; name: string; type: string; country: string; state: string; city: string; queueRule: string; ativo: boolean }
const blank = (): Form => ({ name: "", type: "", country: "", state: "", city: "", queueRule: "", ativo: true })

export default function OrgaosProtocoloTab() {
  const [rows, setRows] = useState<Orgao[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  const [form, setForm] = useState<Form | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/orgaos-protocolo", { headers: authHeaders() })
      if (res.ok) setRows((await res.json()).orgaos || [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 2600) }
  const upsert = (d: Orgao) => setRows(rs => { const i = rs.findIndex(x => x.id === d.id); if (i < 0) return [...rs, d]; const c = rs.slice(); c[i] = d; return c })

  async function save() {
    if (!form) return
    if (!form.name.trim()) { showFlash("Informe o nome."); return }
    setBusy(true)
    try {
      const url = form.id ? `/api/gerenciamento/orgaos-protocolo/${form.id}` : "/api/gerenciamento/orgaos-protocolo"
      const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(form) })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.orgao) { upsert(j.orgao); setForm(null); showFlash("Salvo.") }
      else showFlash(j.error || "Erro ao salvar.")
    } finally { setBusy(false) }
  }
  async function del(d: Orgao) {
    if (!confirm(`Excluir o órgão "${d.name}"?`)) return
    setRows(rs => rs.filter(x => x.id !== d.id))
    const res = await fetch(`/api/gerenciamento/orgaos-protocolo/${d.id}`, { method: "DELETE", headers: authHeaders() })
    if (res.ok) showFlash("Excluído."); else { showFlash("Erro ao excluir."); load() }
  }

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Órgãos de Protocolo</h2>
            <p className="mt-1 text-sm text-white/60">Consulados, comunes, tribunais, conservatórias, cartórios.</p>
          </div>
          <button onClick={() => setForm(blank())} className="flex-none rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500">+ Novo órgão</button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 text-left text-xs text-white/50">
            <tr><th className="px-4 py-3 font-medium">Nome</th><th className="px-4 py-3 font-medium">Tipo</th><th className="px-4 py-3 font-medium">País</th><th className="px-4 py-3 font-medium">Cidade</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Ações</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-white/40">Nenhum órgão cadastrado.</td></tr>
            ) : rows.map(d => (
              <tr key={d.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-2.5 text-white">{d.name}</td>
                <td className="px-4 py-2.5"><span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">{typeLabel(d.type)}</span></td>
                <td className="px-4 py-2.5 text-white/70">{d.country || "—"}</td>
                <td className="px-4 py-2.5 text-white/70">{d.city || "—"}</td>
                <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] ${d.ativo ? "bg-green-500/15 text-green-300" : "bg-white/10 text-white/50"}`}>{d.ativo ? "Ativo" : "Inativo"}</span></td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-0.5 text-white/50">
                    <button title="Editar" aria-label="Editar" onClick={() => setForm({ id: d.id, name: d.name, type: d.type || "", country: d.country || "", state: d.state || "", city: d.city || "", queueRule: d.queueRule || "", ativo: d.ativo })} className="rounded p-1 hover:bg-white/10 hover:text-white"><IEdit /></button>
                    <button title="Excluir" aria-label="Excluir" onClick={() => del(d)} className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300"><ITrash /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4"><h3 className="font-semibold text-white">{form.id ? "Editar" : "Novo"} órgão</h3></div>
            <div className="grid grid-cols-2 gap-3 px-6 py-4">
              <div className="col-span-2"><label className={labelCls}>Nome *</label><input value={form.name} onChange={e => setForm(f => f && { ...f, name: e.target.value })} className={inputCls} /></div>
              <div>
                <label className={labelCls}>Tipo</label>
                <select value={form.type} onChange={e => setForm(f => f && { ...f, type: e.target.value })} className={inputCls}>
                  <option value="" className={opt}>—</option>
                  {TYPES.map(([v, l]) => <option key={v} value={v} className={opt}>{l}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>País</label><input value={form.country} onChange={e => setForm(f => f && { ...f, country: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Estado</label><input value={form.state} onChange={e => setForm(f => f && { ...f, state: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Cidade</label><input value={form.city} onChange={e => setForm(f => f && { ...f, city: e.target.value })} className={inputCls} /></div>
              <div className="col-span-2"><label className={labelCls}>Regra de fila</label><input value={form.queueRule} onChange={e => setForm(f => f && { ...f, queueRule: e.target.value })} className={inputCls} /></div>
              <label className="col-span-2 flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.ativo} onChange={e => setForm(f => f && { ...f, ativo: e.target.checked })} />Ativo</label>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setForm(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button disabled={busy} onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}