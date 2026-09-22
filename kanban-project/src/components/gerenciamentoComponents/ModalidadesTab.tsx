"use client"

// src/components/gerenciamentoComponents/ModalidadesTab.tsx
// PROCESSOS → CADASTROS → MODALIDADES.
// Tela dedicada do cadastro ModalidadePais (modalidade é sempre POR PAÍS).
// Backend: /api/gerenciamento/paises (GET) +
//          /api/gerenciamento/paises/[countryKey]/modalidades (GET/POST) +
//          .../[modalityKey] (PUT/DELETE)
//
// MODALIDADE É ENUMERAÇÃO CANÔNICA — EXCLUSIVAMENTE Administrativa e
// Judicial (mandato "Reconstrução da hierarquia", 22/09/2026). Por isso não
// existe "+ Nova modalidade" com nome livre: só é possível HABILITAR a
// canônica que este país ainda não tem, e não é possível renomear nenhuma —
// o servidor já recusa as duas coisas; esta tela só reflete o que ele permite.

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

const inputCls = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

const CANONICAS: { modalityKey: string; modalityLabel: string }[] = [
  { modalityKey: "judicial", modalityLabel: "Judicial" },
  { modalityKey: "administrativa", modalityLabel: "Administrativa" },
]

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

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3000) }

  function trocarPais(ck: string) {
    // Trocar o país já troca a chave da consulta de modalidades: nada a recarregar aqui.
    setCountryKey(ck); setErro(null)
  }

  // Faltantes = as canônicas que este país ainda não habilitou — é a ÚNICA
  // coisa que "+ Habilitar modalidade" pode criar (nunca um nome livre).
  const chavesExistentes = new Set(rows.map((m) => m.modalityKey))
  const faltantes = CANONICAS.filter((c) => !chavesExistentes.has(c.modalityKey))

  async function habilitar(modalityKey: string) {
    if (!countryKey) { setErro("Escolha o país."); return }
    setBusy(true); setErro(null)
    try {
      await jsonFetch(`/api/gerenciamento/paises/${countryKey}/modalidades`, {
        method: "POST",
        body: JSON.stringify({ modalityKey }),
      })
      showFlash("Modalidade habilitada.")
      await carregarMods()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível habilitar a modalidade.")
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

  if (loading) return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando…</div>

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-green-800">{flash}</div>}
      {erro && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-red-700">
          {erro} <button onClick={() => { setErro(null); void carregarMods() }} className="ml-2 underline hover:text-white">Recarregar</button>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Modalidades</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--text-secondary)]">
              A via de tramitação de cada país — só existem duas: Judicial e Administrativa. Elas alimentam o
              cadastro de Tipos de Processo — inativar tira do seletor sem apagar nada.
            </p>
          </div>
          <div className="flex flex-none flex-wrap gap-2">
            {faltantes.map((c) => (
              <button
                key={c.modalityKey}
                onClick={() => habilitar(c.modalityKey)}
                disabled={!countryKey || busy}
                className="rounded-lg bg-[var(--action-primary)] px-3 py-2 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-40"
                title={countryKey ? "" : "Cadastre um país primeiro (Processos › Cadastros › Países e Regiões)."}
              >
                + Habilitar {c.modalityLabel}
              </button>
            ))}
            {countryKey && faltantes.length === 0 && (
              <span className="self-center text-xs text-[var(--text-muted)]">Este país já tem as duas modalidades.</span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--border-default)] pt-4">
          <label className="text-sm text-[var(--text-secondary)]">País:</label>
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
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-8 text-center text-sm text-[var(--text-secondary)] backdrop-blur-sm">
          Nenhum país cadastrado ainda. Cadastre em <span className="text-white/80">Processos › Cadastros › Países e Regiões</span> para criar modalidades.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
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
                <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">Carregando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">Nenhuma modalidade neste país. Crie em “+ Nova modalidade”.</td></tr>
              ) : rows.map(m => (
                <tr key={m.modalityKey} className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{m.ordem}</td>
                  <td className="px-4 py-2.5 text-white">{m.modalityLabel}</td>
                  <td className="px-4 py-2.5"><code className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[11px] text-white/70">{m.modalityKey}</code></td>
                  <td className="px-4 py-2.5 text-white/70">{m.codeSuffix || "—"}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{m.tiposCount ?? 0}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => toggleAtivo(m)}
                      title={(m.ativo ?? true) ? "Inativar (some do seletor de Tipos de Processo, sem apagar)" : "Ativar"}
                      className={`rounded-full px-2 py-0.5 text-[10px] ${(m.ativo ?? true) ? "bg-[var(--surface-secondary)] text-green-800" : "bg-[var(--surface-primary)] text-[var(--text-secondary)]"}`}
                    >
                      {(m.ativo ?? true) ? "Ativa" : "Inativa"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-0.5 text-[var(--text-secondary)]">
                      <button
                        title={(m.tiposCount ?? 0) > 0 ? `Em uso por ${m.tiposCount} tipo(s) — inative em vez de excluir` : "Excluir"}
                        aria-label="Excluir"
                        disabled={(m.tiposCount ?? 0) > 0}
                        onClick={() => excluir(m)}
                        className="rounded p-1 text-red-700/70 hover:bg-[var(--surface-secondary)] hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-30"
                      ><ITrash /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
