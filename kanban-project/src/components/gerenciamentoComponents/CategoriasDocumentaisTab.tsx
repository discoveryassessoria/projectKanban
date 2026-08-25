"use client"

// LOTE A — Tela do cadastro mestre Categorias Documentais. SÓ classifica o Tipo de
// Documento (sem processo/fase/workflow/financeiro/aplicabilidade). CRUD + filtros.

import { useEffect, useState, useCallback } from "react"
import { useApi } from "@/src/lib/dados"

interface Cat { id: number; code: string; name: string; description?: string | null; ordem: number; ativo: boolean; sistema?: boolean; tiposCount: number; tiposCountFk?: number; tiposCountLegado?: number }
type Form = { id?: number; code: string; name: string; description: string; ordem: number; ativo: boolean }

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-[var(--text-secondary)]"

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function CategoriasDocumentaisTab() {

  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  const [status, setStatus] = useState<"ativas" | "inativas" | "todas">("todas")
  const [q, setQ] = useState("")
  const [form, setForm] = useState<Form | null>(null)

  // A chave da consulta INCLUI os filtros, então trocar status/busca refaz a
  // consulta e cacheia cada combinação — antes era um efeito redisparando por
  // mudança de dependência. `erro` continua string ("" = sem erro), como a tela espera.
  const { dados, carregando: loading, erro: erroApi, recarregar: load } = useApi<{ categorias?: Cat[] }>(
    `/api/gerenciamento/categorias-documentais?status=${status}&q=${encodeURIComponent(q)}`,
  )
  const rows: Cat[] = dados?.categorias ?? SEM_ITENS
  const erro = erroApi ? "Falha ao carregar categorias." : ""

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 2800) }

  async function save() {
    if (!form) return
    if (!form.name.trim()) { showFlash("Informe o nome."); return }
    setBusy(true)
    try {
      const url = form.id ? `/api/gerenciamento/categorias-documentais/${form.id}` : "/api/gerenciamento/categorias-documentais"
      // Chave técnica interna gerada/mantida no backend — o frontend nunca envia `code`.
      const { code: _code, ...payload } = form
      const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(payload) })
      const j = await res.json().catch(() => ({}))
      if (res.ok) { setForm(null); showFlash("Salvo."); load() }
      else showFlash(j.error || "Erro ao salvar.")
    } finally { setBusy(false) }
  }
  async function toggleAtivo(c: Cat) {
    const res = await fetch(`/api/gerenciamento/categorias-documentais/${c.id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ ativo: !c.ativo }) })
    if (res.ok) { showFlash(c.ativo ? "Inativada." : "Reativada."); load() } else showFlash("Erro ao alterar status.")
  }
  async function del(c: Cat) {
    if (!confirm(`Excluir a categoria "${c.name}"?`)) return
    const res = await fetch(`/api/gerenciamento/categorias-documentais/${c.id}`, { method: "DELETE", headers: authHeaders() })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { showFlash("Excluída."); load() } else showFlash(j.error || "Não foi possível excluir.")
  }

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{flash}</div>}

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Categorias Documentais</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Cadastro mestre que <strong className="text-white/80">apenas classifica</strong> os Tipos de Documento. Não configura processo, fase, workflow, financeiro nem aplicabilidade.</p>
          </div>
          <button onClick={() => setForm({ code: "", name: "", description: "", ordem: 0, ativo: true })} className="flex-none rounded-lg bg-[var(--action-primary)] px-3 py-2 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]">+ Nova categoria</button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código ou nome…" className="w-56 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-xs text-white placeholder-white/40 outline-none focus:border-white/20" />
          <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border-default)] text-xs">
            {(["ativas", "inativas", "todas"] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} className={`px-3 py-1.5 capitalize ${status === s ? "bg-[var(--surface-secondary)] font-medium text-white" : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      {erro && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}

      <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Ordem</th><th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Docs vinculados</th><th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">Carregando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">Nenhuma categoria.</td></tr>
            ) : rows.map((c) => (
              <tr key={c.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5 text-white">{c.name}{c.sistema && <span className="ml-1.5 rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[9px] uppercase text-[var(--text-secondary)]">sistema</span>}</td>
                <td className="px-4 py-2.5 text-white/70">{c.ordem}</td>
                <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] ${c.ativo ? "bg-green-50 text-green-700" : "bg-[var(--surface-primary)] text-[var(--text-secondary)]"}`}>{c.ativo ? "Ativa" : "Inativa"}</span></td>
                <td className="px-4 py-2.5 text-white/70">{c.tiposCount}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1 text-xs text-[var(--text-secondary)]">
                    <button onClick={() => setForm({ id: c.id, code: c.code, name: c.name, description: c.description || "", ordem: c.ordem, ativo: c.ativo })} className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-hover)] hover:text-white">Editar</button>
                    <button onClick={() => toggleAtivo(c)} className="rounded px-1.5 py-0.5 hover:bg-[var(--surface-hover)] hover:text-white">{c.ativo ? "Inativar" : "Reativar"}</button>
                    {c.sistema || c.tiposCount > 0 ? (
                      <span title={c.sistema ? "Categoria de sistema — não pode ser excluída" : `Em uso por ${c.tiposCount} tipo(s)`} className="cursor-not-allowed rounded px-1.5 py-0.5 text-[var(--text-muted)]">Excluir</span>
                    ) : (
                      <button onClick={() => del(c)} className="rounded px-1.5 py-0.5 text-red-700/70 hover:bg-red-50 hover:text-red-700">Excluir</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-[var(--border-default)] px-6 py-4"><h3 className="font-semibold text-white">{form.id ? "Editar" : "Nova"} categoria documental</h3></div>
            <div className="space-y-3 px-6 py-4">
              <div><label className={labelCls}>Nome *</label><input value={form.name} onChange={(e) => setForm((f) => f && { ...f, name: e.target.value })} autoFocus className={inputCls} /></div>
              <div><label className={labelCls}>Descrição</label><input value={form.description} onChange={(e) => setForm((f) => f && { ...f, description: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Ordem</label><input type="number" value={form.ordem} onChange={(e) => setForm((f) => f && { ...f, ordem: Number(e.target.value) || 0 })} className={inputCls} /></div>
              <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm((f) => f && { ...f, ativo: e.target.checked })} />Ativa</label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
              <button onClick={() => setForm(null)} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white/80 hover:bg-[var(--surface-hover)]">Cancelar</button>
              <button disabled={busy} onClick={save} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
