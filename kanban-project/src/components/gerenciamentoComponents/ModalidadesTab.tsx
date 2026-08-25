"use client"

// src/components/gerenciamentoComponents/ModalidadesTab.tsx
// PROCESSOS → CADASTROS → MODALIDADES.
// Tela dedicada do cadastro ModalidadePais (modalidade é sempre POR PAÍS).
// REUSA exatamente as mesmas rotas e o mesmo contrato do modal "Gerenciar
// modalidades" de Tipos de Processo — nenhuma API nova, nenhuma regra nova.
// Backend: /api/gerenciamento/paises (GET) +
//          /api/gerenciamento/paises/[countryKey]/modalidades (GET/POST) +
//          .../[modalityKey] (PUT/DELETE)

import { useEffect, useState, useCallback } from "react"
import { useApi } from "@/src/lib/dados"

interface Pais { countryKey: string; countryLabel: string; flag: string | null; ativo?: boolean }
interface Modalidade {
  id: number
  countryKey: string
  modalityKey: string
  modalityLabel: string
  codeSuffix: string | null
  ordem: number
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

type Form = { editando: Modalidade | null; modalityLabel: string; codeSuffix: string }

const SEM_PAISES: Pais[] = []
const SEM_MODALIDADES: Modalidade[] = []

export default function ModalidadesTab() {
  // Países e, DEPENDENTE do país escolhido, as suas modalidades. Antes isso era uma
  // cadeia dentro de um efeito: carrega países → escolhe o primeiro → chama o segundo
  // carregador. Aqui a dependência é a CHAVE da segunda consulta, então ela dispara
  // sozinha quando o país muda — e trocar de país e voltar usa o cache em vez de
  // refazer a requisição.
  const paisesReq = useApi<{ paises?: Pais[] }>("/api/gerenciamento/paises")
  const paises = paisesReq.dados?.paises ?? SEM_PAISES
  // O primeiro país vem pré-selecionado, como antes — agora DERIVADO em vez de escrito
  // por efeito, então não existe o render em que a tela já tem países e nenhum escolhido.
  const [paisEscolhido, setCountryKey] = useState("")
  const countryKey = paisEscolhido || paises[0]?.countryKey || ""
  const modsReq = useApi<{ modalidades?: Modalidade[] }>(
    countryKey ? `/api/gerenciamento/paises/${countryKey}/modalidades` : null,
  )
  const rows = modsReq.dados?.modalidades ?? SEM_MODALIDADES
  const loading = paisesReq.carregando
  const carregandoMods = modsReq.carregando
  const carregarMods = modsReq.recarregar
  const [busy, setBusy] = useState(false)
  // Erro de validação/escrita fica em estado; o de LEITURA vem das consultas — as duas
  // apareciam neste mesmo banner antes e continuam aparecendo.
  const [erroLocal, setErro] = useState<string | null>(null)
  const erro = erroLocal ?? (paisesReq.erro?.message ?? modsReq.erro?.message ?? null)
  const [flash, setFlash] = useState("")
  const [form, setForm] = useState<Form | null>(null)

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3000) }

  function trocarPais(ck: string) {
    // Trocar o país já troca a chave da consulta de modalidades: nada a recarregar aqui.
    setCountryKey(ck); setErro(null); setForm(null)
  }

  async function salvar() {
    if (!form) return
    const label = form.modalityLabel.trim()
    if (!label) { setErro("Informe o nome da modalidade."); return }
    if (!countryKey) { setErro("Escolha o país."); return }
    setBusy(true); setErro(null)
    try {
      if (form.editando) {
        await jsonFetch(`/api/gerenciamento/paises/${countryKey}/modalidades/${form.editando.modalityKey}`, {
          method: "PUT",
          body: JSON.stringify({ modalityLabel: label, codeSuffix: form.codeSuffix.trim() || null }),
        })
      } else {
        await jsonFetch(`/api/gerenciamento/paises/${countryKey}/modalidades`, {
          method: "POST",
          body: JSON.stringify({ modalityLabel: label, codeSuffix: form.codeSuffix.trim() || null }),
        })
      }
      setForm(null); showFlash("Modalidade salva.")
      await carregarMods()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar a modalidade.")
    } finally { setBusy(false) }
  }

  async function toggleAtivo(m: Modalidade) {
    try {
      await jsonFetch(`/api/gerenciamento/paises/${countryKey}/modalidades/${m.modalityKey}`, {
        method: "PUT", body: JSON.stringify({ ativo: !(m.ativo ?? true) }),
      })
      await carregarMods()
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível alterar a modalidade.") }
  }

  async function excluir(m: Modalidade) {
    if (!confirm(`Excluir a modalidade "${m.modalityLabel}"? Só é possível se nenhum tipo de processo usar.`)) return
    setErro(null)
    try {
      await jsonFetch(`/api/gerenciamento/paises/${countryKey}/modalidades/${m.modalityKey}`, { method: "DELETE" })
      showFlash("Modalidade excluída.")
      await carregarMods()
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível excluir a modalidade.") }
  }

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>}
      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {erro} <button onClick={() => { setErro(null); void carregarMods() }} className="ml-2 underline hover:text-white">Recarregar</button>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Modalidades</h2>
            <p className="mt-1 max-w-3xl text-sm text-white/60">
              Modalidades (via judicial, administrativa, recurso…) de cada país. Elas alimentam o cadastro de
              Tipos de Processo — inativar tira do seletor sem apagar nada.
            </p>
          </div>
          <button
            onClick={() => { setErro(null); setForm({ editando: null, modalityLabel: "", codeSuffix: "" }) }}
            disabled={!countryKey}
            className="flex-none rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-[#fff] hover:bg-blue-500 disabled:opacity-40"
            title={countryKey ? "" : "Cadastre um país primeiro (Processos › Cadastros › Países e Regiões)."}
          >
            + Nova modalidade
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
          <label className="text-sm text-white/60">País:</label>
          <select value={countryKey} onChange={e => trocarPais(e.target.value)} className={`${inputCls} max-w-xs`}>
            {paises.length === 0 && <option value="" className="bg-zinc-900">— nenhum país cadastrado —</option>}
            {paises.map(p => (
              <option key={p.countryKey} value={p.countryKey} className="bg-zinc-900">
                {p.flag ? `${p.flag} ` : ""}{p.countryLabel}
              </option>
            ))}
          </select>
        </div>
      </div>

      {paises.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/50 backdrop-blur-sm">
          Nenhum país cadastrado ainda. Cadastre em <span className="text-white/80">Processos › Cadastros › Países e Regiões</span> para criar modalidades.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 text-left text-xs text-white/50">
              <tr>
                <th className="px-4 py-3 font-medium">Ordem</th>
                <th className="px-4 py-3 font-medium">Modalidade</th>
                <th className="px-4 py-3 font-medium">Chave</th>
                <th className="px-4 py-3 font-medium">Sufixo</th>
                <th className="px-4 py-3 font-medium">Tipos</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {carregandoMods ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-white/40">Carregando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-white/40">Nenhuma modalidade neste país. Crie em “+ Nova modalidade”.</td></tr>
              ) : rows.map(m => (
                <tr key={m.modalityKey} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2.5 text-white/60">{m.ordem}</td>
                  <td className="px-4 py-2.5 text-white">{m.modalityLabel}</td>
                  <td className="px-4 py-2.5"><code className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">{m.modalityKey}</code></td>
                  <td className="px-4 py-2.5 text-white/70">{m.codeSuffix || "—"}</td>
                  <td className="px-4 py-2.5 text-white/60">{m.tiposCount ?? 0}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => toggleAtivo(m)}
                      title={(m.ativo ?? true) ? "Inativar (some do seletor de Tipos de Processo, sem apagar)" : "Ativar"}
                      className={`rounded-full px-2 py-0.5 text-[10px] ${(m.ativo ?? true) ? "bg-green-500/15 text-green-300" : "bg-white/10 text-white/50"}`}
                    >
                      {(m.ativo ?? true) ? "Ativa" : "Inativa"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-0.5 text-white/50">
                      <button
                        title="Editar" aria-label="Editar"
                        onClick={() => setForm({ editando: m, modalityLabel: m.modalityLabel, codeSuffix: m.codeSuffix || "" })}
                        className="rounded p-1 hover:bg-white/10 hover:text-white"
                      ><IEdit /></button>
                      <button
                        title={(m.tiposCount ?? 0) > 0 ? `Em uso por ${m.tiposCount} tipo(s) — inative em vez de excluir` : "Excluir"}
                        aria-label="Excluir"
                        disabled={(m.tiposCount ?? 0) > 0}
                        onClick={() => excluir(m)}
                        className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
                      ><ITrash /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="font-semibold text-white">{form.editando ? "Editar modalidade" : "Nova modalidade"}</h3>
              <p className="mt-0.5 text-xs text-white/50">{paises.find(p => p.countryKey === countryKey)?.countryLabel}</p>
            </div>
            <div className="space-y-3 px-6 py-4">
              <div>
                <label className={labelCls}>Nome da modalidade *</label>
                <input value={form.modalityLabel} onChange={e => setForm(f => f && { ...f, modalityLabel: e.target.value })} className={inputCls} placeholder="Judicial" />
              </div>
              <div>
                <label className={labelCls}>Sufixo de código</label>
                <input value={form.codeSuffix} onChange={e => setForm(f => f && { ...f, codeSuffix: e.target.value })} className={inputCls} placeholder="JUD" />
              </div>
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
