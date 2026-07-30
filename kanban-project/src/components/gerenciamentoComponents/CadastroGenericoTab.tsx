"use client"

// src/components/gerenciamentoComponents/CadastroGenericoTab.tsx
//
// TELA GENÉRICA dos cadastros simples do Gerenciamento. A forma (colunas, campos,
// obrigatoriedade, opções) vem do REGISTRO ÚNICO no backend — esta tela só
// renderiza e chama a API. CRUD REAL: lista, cria, edita, ativa/inativa e exclui.
// Backend: /api/gerenciamento/cadastros/<entidade> (+ /[id])

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApi } from "@/src/lib/dados"

type Registro = Record<string, unknown>
interface CampoSpec {
  key: string; label: string
  tipo: "text" | "textarea" | "number" | "bool" | "select" | "multiselect"
  obrigatorio?: boolean
  opcoes?: { valor: string; label: string }[]
  fonte?: string
  ajuda?: string
  imutavel?: boolean
  largura?: "meia" | "cheia"
}
interface Spec {
  entidade: string
  titulo: string
  descricao: string
  novoLabel: string
  colunas: { key: string; label: string }[]
  campos: CampoSpec[]
  relacao?: { campoForm: string }
}
type Fontes = Record<string, { valor: string; label: string }[]>

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"
const CARD = "rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"
const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

const SEM_REGISTROS: Registro[] = []
const SEM_FONTES: Fontes = {}

export default function CadastroGenericoTab({ entidade }: { entidade: string }) {
  const [busy, setBusy] = useState(false)
  // Erro de ESCRITA em estado; o de LEITURA vem da consulta.
  const [erroEscrita, setErroEscrita] = useState<string | null>(null)
  const [flash, setFlash] = useState("")
  const [busca, setBusca] = useState("")
  const [form, setForm] = useState<Registro | null>(null)

  // A chave inclui a entidade, então trocar de cadastro troca de cache — e voltar
  // para um já visitado não pisca a tela.
  const consulta = useApi<{ spec?: Spec; registros?: Registro[]; fontes?: Fontes }>(`/api/gerenciamento/cadastros/${entidade}`)
  const spec = consulta.dados?.spec ?? null
  // Constantes, não literais: alimentam dependências de `useMemo`/`useCallback` abaixo,
  // e um objeto novo por render faria os dois recalcularem sempre.
  const rows = consulta.dados?.registros ?? SEM_REGISTROS
  const fontes: Fontes = consulta.dados?.fontes ?? SEM_FONTES
  const loading = consulta.carregando
  const erro = erroEscrita ?? (consulta.erro ? consulta.erro.message : null)
  const setErro = setErroEscrita
  const load = consulta.recarregar

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3000) }

  const opcoesDe = useCallback((c: CampoSpec) => c.opcoes ?? (c.fonte ? fontes[c.fonte] ?? [] : []), [fontes])
  const rotuloOpcao = useCallback((c: CampoSpec, v: unknown) => {
    if (v === null || v === undefined || v === "") return "—"
    return opcoesDe(c).find((o) => o.valor === String(v))?.label ?? String(v)
  }, [opcoesDe])

  const campoPorKey = useMemo(() => {
    const m = new Map<string, CampoSpec>()
    for (const c of spec?.campos ?? []) m.set(c.key, c)
    return m
  }, [spec])

  function novo() {
    if (!spec) return
    const base: Registro = {}
    for (const c of spec.campos) base[c.key] = c.tipo === "bool" ? true : c.tipo === "multiselect" ? [] : c.tipo === "number" ? 0 : ""
    setErro(null); setForm(base)
  }
  function editar(r: Registro) {
    if (!spec) return
    const base: Registro = { id: r.id }
    for (const c of spec.campos) {
      const v = r[c.key]
      base[c.key] = c.tipo === "bool" ? !!v : c.tipo === "multiselect" ? (Array.isArray(v) ? v : []) : v ?? ""
    }
    setErro(null); setForm(base)
  }

  async function salvar() {
    if (!form || !spec) return
    for (const c of spec.campos) {
      if (c.obrigatorio && !String(form[c.key] ?? "").trim()) { setErro(`Informe ${c.label.toLowerCase()}.`); return }
    }
    setBusy(true); setErro(null)
    try {
      const id = form.id as number | undefined
      const res = await fetch(
        id ? `/api/gerenciamento/cadastros/${entidade}/${id}` : `/api/gerenciamento/cadastros/${entidade}`,
        { method: id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(form) },
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(j.error || "Erro ao salvar."); return }
      setForm(null); showFlash("Registro salvo.")
      await load()
    } finally { setBusy(false) }
  }

  async function alternarAtivo(r: Registro) {
    const res = await fetch(`/api/gerenciamento/cadastros/${entidade}/${r.id}`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ ativo: !r.ativo }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { showFlash(r.ativo ? "Registro inativado." : "Registro ativado."); await load() }
    else setErro(j.error || "Erro ao alterar.")
  }

  async function excluir(r: Registro) {
    const nome = String(r.nome ?? r.id)
    if (!confirm(`Excluir "${nome}"? Se estiver em uso, prefira inativar.`)) return
    const res = await fetch(`/api/gerenciamento/cadastros/${entidade}/${r.id}`, { method: "DELETE", headers: authHeaders() })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { showFlash("Registro excluído."); await load() }
    else setErro(j.error || "Erro ao excluir.")
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)))
  }, [rows, busca])

  function celula(r: Registro, col: { key: string; label: string }) {
    if (col.key === "_membros") return String((r[spec?.relacao?.campoForm ?? "membros"] as unknown[] | undefined)?.length ?? 0)
    const c = campoPorKey.get(col.key)
    const v = r[col.key]
    if (!c) return v === null || v === undefined || v === "" ? "—" : String(v)
    if (c.tipo === "bool") return v ? "sim" : "não"
    if (c.tipo === "select") return rotuloOpcao(c, v)
    if (v === null || v === undefined || v === "") return "—"
    const s = String(v)
    return s.length > 70 ? `${s.slice(0, 70)}…` : s
  }

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>
  if (!spec) {
    return (
      <div className={`${CARD} p-8 text-center text-sm text-white/60`}>
        {erro || "Cadastro não encontrado."}
        <button onClick={() => { void load() }} className="ml-2 underline hover:text-white">Tentar de novo</button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>}
      {erro && !form && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {erro} <button onClick={() => { setErro(null); load() }} className="ml-2 underline hover:text-white">Recarregar</button>
        </div>
      )}

      <div className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{spec.titulo}</h2>
            <p className="mt-1 max-w-3xl text-sm text-white/60">{spec.descricao}</p>
          </div>
          <button onClick={novo} className="flex-none rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500">
            {spec.novoLabel}
          </button>
        </div>
        {rows.length > 6 && (
          <div className="mt-4 border-t border-white/10 pt-4">
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" className={`${inputCls} max-w-sm`} />
          </div>
        )}
      </div>

      <div className={`overflow-x-auto ${CARD}`}>
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 text-left text-xs text-white/50">
            <tr>
              {spec.colunas.map((c) => <th key={c.key} className="px-4 py-3 font-medium">{c.label}</th>)}
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 ? (
              <tr>
                <td colSpan={spec.colunas.length + 2} className="px-4 py-10 text-center text-xs text-white/40">
                  {rows.length === 0 ? `Nenhum registro. Comece em “${spec.novoLabel}”.` : "Nada encontrado para esta busca."}
                </td>
              </tr>
            ) : filtradas.map((r) => (
              <tr key={String(r.id)} className="border-b border-white/5 last:border-0">
                {spec.colunas.map((c, i) => (
                  <td key={c.key} className={`px-4 py-2.5 ${i === 1 || spec.colunas.length === 1 ? "text-white" : "text-white/70"}`}>
                    {celula(r, c)}
                  </td>
                ))}
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => alternarAtivo(r)}
                    title={r.ativo ? "Inativar (some dos seletores, sem apagar)" : "Ativar"}
                    className={`rounded-full px-2 py-0.5 text-[10px] ${r.ativo ? "bg-green-500/15 text-green-300" : "bg-white/10 text-white/50"}`}
                  >
                    {r.ativo ? "Ativo" : "Inativo"}
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-0.5 text-white/50">
                    <button title="Editar" aria-label="Editar" onClick={() => editar(r)} className="rounded p-1 hover:bg-white/10 hover:text-white"><IEdit /></button>
                    <button title="Excluir" aria-label="Excluir" onClick={() => excluir(r)} className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300"><ITrash /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="font-semibold text-white">{form.id ? "Editar" : "Novo"} · {spec.titulo}</h3>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {erro && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{erro}</div>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {spec.campos.map((c) => {
                  const desabilitado = !!c.imutavel && !!form.id
                  const classe = c.largura === "cheia" ? "sm:col-span-2" : ""
                  const v = form[c.key]
                  return (
                    <div key={c.key} className={classe}>
                      <label className={labelCls}>{c.label}{c.obrigatorio ? " *" : ""}</label>
                      {c.tipo === "textarea" ? (
                        <textarea rows={4} value={String(v ?? "")} disabled={desabilitado}
                          onChange={(e) => setForm((f) => f && { ...f, [c.key]: e.target.value })}
                          className={`${inputCls} disabled:opacity-50`} />
                      ) : c.tipo === "bool" ? (
                        <label className="flex items-center gap-2 py-2 text-sm text-white/70">
                          <input type="checkbox" checked={!!v} onChange={(e) => setForm((f) => f && { ...f, [c.key]: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                          {c.label}
                        </label>
                      ) : c.tipo === "number" ? (
                        <input type="number" value={String(v ?? "")} disabled={desabilitado}
                          onChange={(e) => setForm((f) => f && { ...f, [c.key]: e.target.value === "" ? "" : Number(e.target.value) })}
                          className={`${inputCls} disabled:opacity-50`} />
                      ) : c.tipo === "select" ? (
                        <select value={String(v ?? "")} disabled={desabilitado}
                          onChange={(e) => setForm((f) => f && { ...f, [c.key]: e.target.value })}
                          className={`${inputCls} disabled:opacity-50`}>
                          <option value="" className="bg-zinc-900">—</option>
                          {opcoesDe(c).map((o) => <option key={o.valor} value={o.valor} className="bg-zinc-900">{o.label}</option>)}
                        </select>
                      ) : c.tipo === "multiselect" ? (
                        <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-2">
                          {opcoesDe(c).length === 0 && <div className="px-1 py-2 text-xs text-white/40">Nenhuma opção disponível.</div>}
                          {opcoesDe(c).map((o) => {
                            const sel = Array.isArray(v) && (v as unknown[]).map(String).includes(o.valor)
                            return (
                              <label key={o.valor} className="flex items-center gap-2 px-1 py-0.5 text-sm text-white/75">
                                <input
                                  type="checkbox" checked={sel} className="h-3.5 w-3.5 accent-blue-500"
                                  onChange={(e) => setForm((f) => {
                                    if (!f) return f
                                    const atual = Array.isArray(f[c.key]) ? (f[c.key] as unknown[]).map(String) : []
                                    return { ...f, [c.key]: e.target.checked ? [...atual, o.valor] : atual.filter((x) => x !== o.valor) }
                                  })}
                                />
                                {o.label}
                              </label>
                            )
                          })}
                        </div>
                      ) : (
                        <input value={String(v ?? "")} disabled={desabilitado}
                          onChange={(e) => setForm((f) => f && { ...f, [c.key]: e.target.value })}
                          className={`${inputCls} disabled:opacity-50`} />
                      )}
                      {c.ajuda && <p className="mt-1 text-[11px] text-white/40">{c.ajuda}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setForm(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button disabled={busy} onClick={salvar} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
