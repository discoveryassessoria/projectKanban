'use client'

// src/components/gerenciamentoComponents/TipoProcessoTab.tsx
// FASE 1A do Motor — Tipos de Processo (Processos de Nacionalidade configuráveis).
// País e Modalidade puxam de CatalogoPais / ModalidadePais (seletores em cascata).
// Código e Nome são auto-sugeridos (prefixo do país + sufixo da modalidade), editáveis.
// Backend: /api/gerenciamento/tipos-processo (GET/POST) + /[id] (PUT/DELETE)
// ⚠ Fase 1B liga o Workflow Macro + Fases variáveis a cada tipo.

import { useState, useEffect, useMemo, useCallback } from 'react'

type Pais = { id: number; countryKey: string; countryLabel: string; nationalityKey: string; nationalityLabel: string; flag: string | null; codePrefix: string | null }
type Modalidade = { id: number; countryKey: string; modalityKey: string; modalityLabel: string; codeSuffix: string | null; ordem: number }
type Tipo = {
  id: number; code: string; name: string
  countryKey: string; countryLabel: string; nationalityLabel: string
  modalityKey: string; modalityLabel: string
  ativo: boolean
}

async function jsonFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}

export default function TipoProcessoTab() {
  const [itens, setItens] = useState<Tipo[]>([])
  const [paises, setPaises] = useState<Pais[]>([])
  const [modalidades, setModalidades] = useState<Modalidade[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Tipo | null>(null)
  const [countryKey, setCountryKey] = useState('')
  const [modalityKey, setModalityKey] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [codeTouched, setCodeTouched] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/tipos-processo', { cache: 'no-store' })
      setItens((d as any).tipos || [])
      setPaises((d as any).paises || [])
      setModalidades((d as any).modalidades || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar os tipos de processo.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const paisSel = useMemo(() => paises.find((p) => p.countryKey === countryKey) || null, [paises, countryKey])
  const modsDoPais = useMemo(() => modalidades.filter((m) => m.countryKey === countryKey), [modalidades, countryKey])
  const modSel = useMemo(() => modsDoPais.find((m) => m.modalityKey === modalityKey) || null, [modsDoPais, modalityKey])

  // sugestões automáticas de código e nome
  const sugCode = useMemo(() => {
    if (!paisSel || !modSel) return ''
    const pre = paisSel.codePrefix || paisSel.countryKey.slice(0, 3).toUpperCase()
    const suf = modSel.codeSuffix || modSel.modalityKey.slice(0, 4).toUpperCase()
    return `${pre}-${suf}`
  }, [paisSel, modSel])
  const sugName = useMemo(() => {
    if (!paisSel || !modSel) return ''
    return `Nacionalidade ${paisSel.nationalityLabel} · ${modSel.modalityLabel}`
  }, [paisSel, modSel])

  // ao trocar país/modalidade, preenche código/nome se o usuário ainda não os editou
  useEffect(() => {
    if (!codeTouched) setCode(sugCode)
  }, [sugCode, codeTouched])
  useEffect(() => {
    if (!nameTouched) setName(sugName)
  }, [sugName, nameTouched])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return itens
    return itens.filter((t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || t.countryLabel.toLowerCase().includes(q))
  }, [itens, busca])

  function abrirNovo() {
    setEditando(null)
    setCountryKey(''); setModalityKey(''); setCode(''); setName(''); setAtivo(true)
    setCodeTouched(false); setNameTouched(false)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(t: Tipo) {
    setEditando(t)
    setCountryKey(t.countryKey); setModalityKey(t.modalityKey)
    setCode(t.code); setName(t.name); setAtivo(t.ativo)
    setCodeTouched(true); setNameTouched(true) // ao editar, não sobrescreve o que já existe
    setErroModal(null); setModalAberto(true)
  }

  function trocarPais(v: string) {
    setCountryKey(v)
    setModalityKey('') // zera modalidade ao trocar país
  }

  async function salvar() {
    if (!countryKey || !modalityKey) { setErroModal('Escolha país e modalidade.'); return }
    if (!code.trim()) { setErroModal('Informe o código.'); return }
    if (!name.trim()) { setErroModal('Informe o nome.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({ code: code.trim(), name: name.trim(), countryKey, modalityKey, ativo })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/tipos-processo/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/tipos-processo', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally { setSalvando(false) }
  }

  async function excluir(t: Tipo) {
    if (!confirm(`Excluir o tipo de processo "${t.name}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/tipos-processo/${t.id}`, { method: 'DELETE' })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Processos de Nacionalidade</h2>
          <p className="text-sm text-white/50">Tipos de processo configuráveis — país, modalidade, código e nome.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Novo processo
        </button>
      </div>

      {!loading && !erroLista && paises.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Nenhum país no catálogo. Rode o seed <span className="font-mono text-amber-100">prisma/seed-motor-1a.ts</span> antes de criar processos.
        </div>
      )}

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar processo..."
        className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
      />

      {loading && <div className="py-12 text-center text-sm text-white/40">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroLista}<button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtrados.length === 0 && paises.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca ? 'Nenhum processo encontrado.' : 'Nenhum tipo de processo ainda. Crie o primeiro.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Código</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Processo</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">País</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Modalidade</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((t) => {
                const flag = paises.find((p) => p.countryKey === t.countryKey)?.flag || ''
                return (
                  <tr key={t.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-2.5 font-mono text-[12px] text-white/80">{t.code}</td>
                    <td className="px-4 py-2.5 font-medium text-white">{t.name}</td>
                    <td className="px-4 py-2.5 text-white/70">{flag} {t.countryLabel}</td>
                    <td className="px-4 py-2.5 text-white/70">{t.modalityLabel}</td>
                    <td className="px-4 py-2.5">
                      {t.ativo
                        ? <span className="rounded-md bg-green-500/15 px-2 py-0.5 text-[11px] font-medium text-green-300">ativo</span>
                        : <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/50">inativo</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => abrirEditar(t)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                        <button onClick={() => excluir(t)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar processo' : 'Novo processo de nacionalidade'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">País *</label>
                  <select value={countryKey} onChange={(e) => trocarPais(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— selecione —</option>
                    {paises.map((p) => <option key={p.countryKey} value={p.countryKey} className="bg-zinc-900">{p.flag ? p.flag + ' ' : ''}{p.countryLabel}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Modalidade *</label>
                  <select value={modalityKey} onChange={(e) => setModalityKey(e.target.value)} disabled={!countryKey} className={inputCls + (!countryKey ? ' opacity-50' : '')}>
                    <option value="" className="bg-zinc-900">{countryKey ? '— selecione —' : 'escolha o país primeiro'}</option>
                    {modsDoPais.map((m) => <option key={m.modalityKey} value={m.modalityKey} className="bg-zinc-900">{m.modalityLabel}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Código *</label>
                  <input value={code} onChange={(e) => { setCode(e.target.value); setCodeTouched(true) }} placeholder="ITA-JUD" className={inputCls + ' font-mono'} />
                  {!codeTouched && sugCode && <p className="mt-1 text-[11px] text-white/40">Sugerido automaticamente — pode editar.</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Nome *</label>
                  <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true) }} placeholder="Nacionalidade Italiana · Judicial" className={inputCls} />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                Ativo
              </label>

              {erroModal && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erroModal}</div>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setModalAberto(false)} className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}