"use client"

import { useEffect, useState, useCallback } from "react"
import DocumentCategorySelector from "./DocumentCategorySelector"

interface CatRel { id: number; code: string; name: string; ativo: boolean }
interface Tipo { id: number; code: string | null; name: string; category: string | null; nature?: string | null; categoriaDocumentalId?: number | null; categoriaDocumental?: CatRel | null; ativo: boolean }
// Sem lista fixa de categorias na UI: o nome exibido vem da relação canônica
// (categoriaDocumental). Fallback textual só para linhas ainda não migradas.

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"
const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

type Form = { id?: number; code: string; name: string; category: string; categoriaDocumentalId: number | null; currentCat?: CatRel | null; ativo: boolean }

export default function TiposDocumentoTab() {
  const [rows, setRows] = useState<Tipo[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  const [form, setForm] = useState<Form | null>(null)
  const [filtro, setFiltro] = useState<"todos" | "certidoes">("todos")

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/tipos-documento", { headers: authHeaders() })
      if (res.ok) setRows((await res.json()).tipos || [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 2600) }
  const upsert = (d: Tipo) => setRows(rs => { const i = rs.findIndex(x => x.id === d.id); if (i < 0) return [...rs, d]; const c = rs.slice(); c[i] = d; return c })

  async function save() {
    if (!form) return
    if (!form.name.trim()) { showFlash("Informe o nome."); return }
    setBusy(true)
    try {
      const url = form.id ? `/api/gerenciamento/tipos-documento/${form.id}` : "/api/gerenciamento/tipos-documento"
      const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(form) })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.tipo) { upsert(j.tipo); setForm(null); showFlash("Salvo.") }
      else showFlash(j.error || "Erro ao salvar.")
    } finally { setBusy(false) }
  }
  async function del(d: Tipo) {
    if (!confirm(`Excluir o tipo "${d.name}"?`)) return
    setRows(rs => rs.filter(x => x.id !== d.id))
    const res = await fetch(`/api/gerenciamento/tipos-documento/${d.id}`, { method: "DELETE", headers: authHeaders() })
    if (res.ok) showFlash("Excluído."); else { showFlash("Erro ao excluir."); load() }
  }

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  // Filtro "Certidões" por CLASSIFICAÇÃO ESTRUTURADA. Certidão é um SUBTIPO técnico
  // (naturezaDocumental / `nature`), eixo distinto de CategoriaDocumental — logo o
  // filtro é por `nature`, não pela categoria "Registro Civil" (que contém também
  // documentos que não são certidões). O fallback textual por nome (/certid/i) só
  // vale para linhas SEM `nature` (ainda não migradas) e é CONTABILIZADO abaixo.
  // CONDIÇÃO DE REMOÇÃO do fallback: 100% dos TipoDocumento com `nature` preenchido.
  const ehCertidaoEstruturado = (r: Tipo) => r.nature != null && /^certid/i.test(r.nature)
  const usaFallbackTextual = (r: Tipo) => r.nature == null && /certid/i.test(r.name)
  const ehCertidao = (r: Tipo) => ehCertidaoEstruturado(r) || usaFallbackTextual(r)
  const visiveis = filtro === "certidoes" ? rows.filter(ehCertidao) : rows
  const totalCertidoes = rows.filter(ehCertidao).length
  const certPorNature = rows.filter(ehCertidaoEstruturado).length   // cobertura estruturada
  const certPorTexto = rows.filter(usaFallbackTextual).length       // caíram no fallback

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Tipos de Documento</h2>
            <p className="mt-1 text-sm text-white/60">Cadastro <strong className="text-white/80">mestre</strong> de tipos documentais — inclui certidões, identidades, judiciais, etc. Certidões são criadas aqui (não há cadastro separado).</p>
          </div>
          <button onClick={() => setForm({ code: "", name: "", category: "", categoriaDocumentalId: null, currentCat: null, ativo: true })} className="flex-none rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500">+ Novo tipo de documento</button>
        </div>
        {/* Filtro rápido — consolidação de "Tipos de Certidão" */}
        <div className="mt-4 inline-flex overflow-hidden rounded-lg border border-white/10 text-xs">
          <button onClick={() => setFiltro("todos")} aria-pressed={filtro === "todos"} className={`px-3 py-1.5 ${filtro === "todos" ? "bg-white/15 font-medium text-white" : "text-white/60 hover:bg-white/5"}`}>Todos ({rows.length})</button>
          <button onClick={() => setFiltro("certidoes")} aria-pressed={filtro === "certidoes"} className={`px-3 py-1.5 ${filtro === "certidoes" ? "bg-white/15 font-medium text-white" : "text-white/60 hover:bg-white/5"}`}>Certidões ({totalCertidoes})</button>
        </div>
        {filtro === "certidoes" && (
          <p className="mt-2 text-[11px] text-white/40">Cobertura: {certPorNature} por natureza estruturada · {certPorTexto} por fallback textual{certPorTexto > 0 ? " (migrar `nature` para eliminar)" : ""}.</p>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 text-left text-xs text-white/50">
            <tr><th className="px-4 py-3 font-medium">Código</th><th className="px-4 py-3 font-medium">Nome</th><th className="px-4 py-3 font-medium">Categoria</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Ações</th></tr>
          </thead>
          <tbody>
            {visiveis.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-white/40">{filtro === "certidoes" ? "Nenhuma certidão encontrada." : "Nenhum tipo de documento cadastrado."}</td></tr>
            ) : visiveis.map(d => (
              <tr key={d.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-2.5 text-white/70">{d.code || "—"}</td>
                <td className="px-4 py-2.5 text-white">{d.name}</td>
                <td className="px-4 py-2.5 text-white/70">{d.categoriaDocumental?.name ?? (d.category || "—")}</td>
                <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] ${d.ativo ? "bg-green-500/15 text-green-300" : "bg-white/10 text-white/50"}`}>{d.ativo ? "Ativo" : "Inativo"}</span></td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-0.5 text-white/50">
                    <button title="Editar" aria-label="Editar" onClick={() => setForm({ id: d.id, code: d.code || "", name: d.name, category: d.category || "", categoriaDocumentalId: d.categoriaDocumentalId ?? null, currentCat: d.categoriaDocumental ?? null, ativo: d.ativo })} className="rounded p-1 hover:bg-white/10 hover:text-white"><IEdit /></button>
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
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4"><h3 className="font-semibold text-white">{form.id ? "Editar" : "Novo"} tipo de documento</h3></div>
            <div className="space-y-3 px-6 py-4">
              <div><label className={labelCls}>Código</label><input value={form.code} onChange={e => setForm(f => f && { ...f, code: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Nome *</label><input value={form.name} onChange={e => setForm(f => f && { ...f, name: e.target.value })} className={inputCls} /></div>
              <div>
                <label className={labelCls}>Categoria documental</label>
                {/* LOTE A — categoria vem do cadastro mestre (API), não mais da lista fixa.
                    Grava categoriaDocumentalId. Sem criação inline. */}
                <DocumentCategorySelector
                  value={form.categoriaDocumentalId}
                  onChange={(id) => setForm(f => f && { ...f, categoriaDocumentalId: id })}
                  currentInactive={form.currentCat && !form.currentCat.ativo ? { id: form.currentCat.id, name: form.currentCat.name } : null}
                  className={inputCls}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.ativo} onChange={e => setForm(f => f && { ...f, ativo: e.target.checked })} />Ativo</label>
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