"use client"

// src/components/gerenciamentoComponents/PaisesRegioesTab.tsx
// PROCESSOS → CADASTROS → PAÍSES E REGIÕES.
// Tela dedicada do cadastro CatalogoPais. REUSA exatamente as mesmas rotas e o
// mesmo contrato já usados pelo modal "Gerenciar países" de Tipos de Processo —
// nenhuma API nova, nenhuma regra nova, nenhuma segunda fonte de verdade.
// Backend: /api/gerenciamento/paises (GET/POST) + /[countryKey] (PUT/DELETE)

import { useEffect, useState, useCallback } from "react"
import { useApi } from "@/src/lib/dados"

interface Pais {
  id: number
  countryKey: string
  countryLabel: string
  nationalityKey: string
  nationalityLabel: string
  flag: string | null
  codePrefix: string | null
  defaultCurrency?: string
  ativo?: boolean
  tiposCount?: number
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
async function jsonFetch(url: string, options: RequestInit = {}) {
  const res = await fetch(url, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string })?.error || `Erro ${res.status}`)
  return data
}

const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"
const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

type Form = {
  editando: Pais | null
  countryLabel: string
  nationalityLabel: string
  flag: string
  codePrefix: string
  defaultCurrency: string
  // só na criação: o país nasce com as modalidades escolhidas (mesmo contrato do modal legado)
  judicial: boolean
  administrativa: boolean
}

const vazio = (): Form => ({
  editando: null, countryLabel: "", nationalityLabel: "", flag: "", codePrefix: "",
  defaultCurrency: "EUR", judicial: true, administrativa: true,
})

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function PaisesRegioesTab() {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  const [form, setForm] = useState<Form | null>(null)

  // Consulta em cache (src/lib/dados): loading e erro derivam da camada.
  const { dados, carregando: loading, erro: erroCarregar, recarregar: load } =
    useApi<{ paises?: Pais[] }>("/api/gerenciamento/paises")
  const rows = dados?.paises ?? SEM_ITENS
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const erro = erroSalvar ?? erroCarregar?.message ?? null

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3000) }

  async function salvar() {
    if (!form) return
    const label = form.countryLabel.trim()
    const nat = form.nationalityLabel.trim()
    if (!label) { setErroSalvar("Informe o nome do país."); return }
    if (!nat) { setErroSalvar("Informe a nacionalidade."); return }
    if (!form.editando && !form.judicial && !form.administrativa) { setErroSalvar("Selecione ao menos uma modalidade."); return }

    setBusy(true); setErroSalvar(null)
    try {
      if (form.editando) {
        await jsonFetch(`/api/gerenciamento/paises/${form.editando.countryKey}`, {
          method: "PUT",
          body: JSON.stringify({
            countryLabel: label,
            flag: form.flag.trim() || null,
            nationalityLabel: nat,
            codePrefix: form.codePrefix.trim() || null,
            defaultCurrency: form.defaultCurrency,
          }),
        })
      } else {
        const modalidades: { modalityKey: string; modalityLabel: string; codeSuffix: string; ordem: number }[] = []
        if (form.judicial) modalidades.push({ modalityKey: "judicial", modalityLabel: "Judicial", codeSuffix: "JUD", ordem: 0 })
        if (form.administrativa) modalidades.push({ modalityKey: "administrativa", modalityLabel: "Administrativa", codeSuffix: "ADM", ordem: 1 })
        await jsonFetch("/api/gerenciamento/paises", {
          method: "POST",
          body: JSON.stringify({
            countryLabel: label,
            flag: form.flag.trim() || null,
            nationalityLabel: nat,
            codePrefix: form.codePrefix.trim() || null,
            defaultCurrency: form.defaultCurrency,
            modalidades,
          }),
        })
      }
      setForm(null); showFlash("País salvo.")
      await load()
    } catch (e) {
      setErroSalvar(e instanceof Error ? e.message : "Não foi possível salvar o país.")
    } finally { setBusy(false) }
  }

  async function toggleAtivo(p: Pais) {
    try {
      await jsonFetch(`/api/gerenciamento/paises/${p.countryKey}`, { method: "PUT", body: JSON.stringify({ ativo: !(p.ativo ?? true) }) })
      await load()
    } catch (e) { setErroSalvar(e instanceof Error ? e.message : "Não foi possível alterar o país.") }
  }

  async function excluir(p: Pais) {
    if (!confirm(`Excluir o país "${p.countryLabel}"? Só é possível se ele não tiver tipos nem processos.`)) return
    setErroSalvar(null)
    try {
      await jsonFetch(`/api/gerenciamento/paises/${p.countryKey}`, { method: "DELETE" })
      showFlash("País excluído.")
      await load()
    } catch (e) { setErroSalvar(e instanceof Error ? e.message : "Não foi possível excluir o país.") }
  }

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>}
      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {erro} <button onClick={() => { setErroSalvar(null); load() }} className="ml-2 underline hover:text-white">Recarregar</button>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Países e Regiões</h2>
            <p className="mt-1 max-w-3xl text-sm text-white/60">
              Países/nacionalidades atendidos, com bandeira, prefixo de código e moeda padrão. As modalidades de
              cada país são geridas em <span className="text-white/80">Processos › Cadastros › Modalidades</span>.
            </p>
          </div>
          <button onClick={() => { setErroSalvar(null); setForm(vazio()) }} className="flex-none rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-[#fff] hover:bg-blue-500">
            + Novo país
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 text-left text-xs text-white/50">
            <tr>
              <th className="px-4 py-3 font-medium">País</th>
              <th className="px-4 py-3 font-medium">Nacionalidade</th>
              <th className="px-4 py-3 font-medium">Chave</th>
              <th className="px-4 py-3 font-medium">Prefixo</th>
              <th className="px-4 py-3 font-medium">Moeda</th>
              <th className="px-4 py-3 font-medium">Tipos</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-xs text-white/40">Nenhum país cadastrado. Comece em “+ Novo país”.</td></tr>
            ) : rows.map(p => (
              <tr key={p.countryKey} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-2.5 text-white">{p.flag ? `${p.flag} ` : ""}{p.countryLabel}</td>
                <td className="px-4 py-2.5 text-white/70">{p.nationalityLabel}</td>
                <td className="px-4 py-2.5"><code className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">{p.countryKey}</code></td>
                <td className="px-4 py-2.5 text-white/70">{p.codePrefix || "—"}</td>
                <td className="px-4 py-2.5 text-white/70">{p.defaultCurrency || "—"}</td>
                <td className="px-4 py-2.5 text-white/60">{p.tiposCount ?? 0}</td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => toggleAtivo(p)}
                    title={(p.ativo ?? true) ? "Inativar (some dos seletores, sem apagar)" : "Ativar"}
                    className={`rounded-full px-2 py-0.5 text-[10px] ${(p.ativo ?? true) ? "bg-green-500/15 text-green-300" : "bg-white/10 text-white/50"}`}
                  >
                    {(p.ativo ?? true) ? "Ativo" : "Inativo"}
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-0.5 text-white/50">
                    <button
                      title="Editar" aria-label="Editar"
                      onClick={() => setForm({
                        editando: p, countryLabel: p.countryLabel, nationalityLabel: p.nationalityLabel,
                        flag: p.flag || "", codePrefix: p.codePrefix || "", defaultCurrency: p.defaultCurrency || "EUR",
                        judicial: false, administrativa: false,
                      })}
                      className="rounded p-1 hover:bg-white/10 hover:text-white"
                    ><IEdit /></button>
                    <button
                      title={(p.tiposCount ?? 0) > 0 ? `Em uso por ${p.tiposCount} tipo(s) — inative em vez de excluir` : "Excluir"}
                      aria-label="Excluir"
                      disabled={(p.tiposCount ?? 0) > 0}
                      onClick={() => excluir(p)}
                      className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
                    ><ITrash /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="font-semibold text-white">{form.editando ? "Editar país" : "Novo país"}</h3>
            </div>
            <div className="space-y-3 px-6 py-4">
              <div className="grid grid-cols-[1fr_90px] gap-3">
                <div>
                  <label className={labelCls}>País *</label>
                  <input value={form.countryLabel} onChange={e => setForm(f => f && { ...f, countryLabel: e.target.value })} className={inputCls} placeholder="Itália" />
                </div>
                <div>
                  <label className={labelCls}>Bandeira</label>
                  <input value={form.flag} onChange={e => setForm(f => f && { ...f, flag: e.target.value })} className={inputCls} placeholder="🇮🇹" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Nacionalidade *</label>
                <input value={form.nationalityLabel} onChange={e => setForm(f => f && { ...f, nationalityLabel: e.target.value })} className={inputCls} placeholder="Italiana" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Prefixo de código</label>
                  <input value={form.codePrefix} onChange={e => setForm(f => f && { ...f, codePrefix: e.target.value })} className={inputCls} placeholder="IT" />
                </div>
                <div>
                  <label className={labelCls}>Moeda padrão</label>
                  <select value={form.defaultCurrency} onChange={e => setForm(f => f && { ...f, defaultCurrency: e.target.value })} className={inputCls}>
                    {["EUR", "BRL", "USD", "GBP", "CHF"].map(m => <option key={m} value={m} className="bg-zinc-900">{m}</option>)}
                  </select>
                </div>
              </div>
              {!form.editando && (
                <div className="border-t border-white/10 pt-3">
                  <div className={labelCls}>Modalidades iniciais</div>
                  <label className="flex items-center gap-2 py-0.5 text-sm text-white/70">
                    <input type="checkbox" checked={form.judicial} onChange={e => setForm(f => f && { ...f, judicial: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                    Judicial
                  </label>
                  <label className="flex items-center gap-2 py-0.5 text-sm text-white/70">
                    <input type="checkbox" checked={form.administrativa} onChange={e => setForm(f => f && { ...f, administrativa: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                    Administrativa
                  </label>
                  <p className="mt-1 text-[11px] text-white/40">Outras modalidades podem ser criadas depois em Processos › Cadastros › Modalidades.</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setForm(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button disabled={busy} onClick={salvar} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-[#fff] hover:bg-blue-500 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
