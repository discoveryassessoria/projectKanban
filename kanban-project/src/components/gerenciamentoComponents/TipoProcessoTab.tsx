'use client'

// ESTE ARQUIVO SUBSTITUI: src/components/gerenciamentoComponents/TipoProcessoTab.tsx
//
// NOVO (5/jul): o link "+ Novo país" virou "Gerenciar países" — abre um modal
// com a LISTA de países do catálogo: criar, editar, ativar/inativar e excluir.
// - Excluir só funciona se o país não tiver tipos/processos (senão a API
//   devolve 409 e a UI sugere inativar).
// - Inativar tira o país do kanban e dos dropdowns, sem apagar nada.

import { useState, useEffect, useMemo, useCallback } from 'react'

type Pais = {
  id: number; countryKey: string; countryLabel: string
  nationalityKey: string; nationalityLabel: string
  flag: string | null; codePrefix: string | null
  defaultCurrency?: string; ativo?: boolean
  tiposCount?: number
}
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

  // ===== Gerenciar países =====
  const [paisesModal, setPaisesModal] = useState(false)
  const [paisesAdmin, setPaisesAdmin] = useState<Pais[]>([])
  const [carregandoPaises, setCarregandoPaises] = useState(false)
  const [visao, setVisao] = useState<'lista' | 'form'>('lista')
  const [editandoPais, setEditandoPais] = useState<Pais | null>(null) // null = criando
  const [pLabel, setPLabel] = useState('')
  const [pFlag, setPFlag] = useState('')
  const [pNat, setPNat] = useState('')
  const [pPrefix, setPPrefix] = useState('')
  const [pMoeda, setPMoeda] = useState('EUR')
  const [pJud, setPJud] = useState(true)
  const [pAdm, setPAdm] = useState(true)
  const [salvandoPais, setSalvandoPais] = useState(false)
  const [erroPais, setErroPais] = useState<string | null>(null)

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

  const carregarPaisesAdmin = useCallback(async () => {
    setCarregandoPaises(true)
    try {
      const d = await jsonFetch('/api/gerenciamento/paises', { cache: 'no-store' })
      setPaisesAdmin((d as any).paises || [])
    } catch (e: any) {
      setErroPais(e.message || 'Não foi possível carregar os países.')
    } finally { setCarregandoPaises(false) }
  }, [])

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
    setCodeTouched(true); setNameTouched(true)
    setErroModal(null); setModalAberto(true)
  }

  function trocarPais(v: string) {
    setCountryKey(v)
    setModalityKey('')
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

  // ===== Gerenciar países =====
  function abrirPaises() {
    setVisao('lista'); setErroPais(null); setPaisesModal(true)
    carregarPaisesAdmin()
  }

  function abrirNovoPais() {
    setEditandoPais(null)
    setPLabel(''); setPFlag(''); setPNat(''); setPPrefix(''); setPMoeda('EUR')
    setPJud(true); setPAdm(true)
    setErroPais(null); setVisao('form')
  }

  function abrirEditarPais(p: Pais) {
    setEditandoPais(p)
    setPLabel(p.countryLabel); setPFlag(p.flag || ''); setPNat(p.nationalityLabel)
    setPPrefix(p.codePrefix || ''); setPMoeda(p.defaultCurrency || 'EUR')
    setErroPais(null); setVisao('form')
  }

  async function salvarPais() {
    const label = pLabel.trim()
    const nat = pNat.trim()
    if (!label) { setErroPais('Informe o nome do país.'); return }
    if (!nat) { setErroPais('Informe a nacionalidade.'); return }
    if (!editandoPais && !pJud && !pAdm) { setErroPais('Selecione ao menos uma modalidade.'); return }

    setSalvandoPais(true); setErroPais(null)
    try {
      if (editandoPais) {
        // EDITAR
        await jsonFetch(`/api/gerenciamento/paises/${editandoPais.countryKey}`, {
          method: 'PUT',
          body: JSON.stringify({
            countryLabel: label,
            flag: pFlag.trim() || null,
            nationalityLabel: nat,
            codePrefix: pPrefix.trim() || null,
            defaultCurrency: pMoeda,
          }),
        })
      } else {
        // CRIAR
        const mods: { modalityKey: string; modalityLabel: string; codeSuffix: string; ordem: number }[] = []
        if (pJud) mods.push({ modalityKey: 'judicial', modalityLabel: 'Judicial', codeSuffix: 'JUD', ordem: 0 })
        if (pAdm) mods.push({ modalityKey: 'administrativa', modalityLabel: 'Administrativa', codeSuffix: 'ADM', ordem: 1 })
        await jsonFetch('/api/gerenciamento/paises', {
          method: 'POST',
          body: JSON.stringify({
            countryLabel: label,
            flag: pFlag.trim() || null,
            nationalityLabel: nat,
            codePrefix: pPrefix.trim() || null,
            defaultCurrency: pMoeda,
            modalidades: mods,
          }),
        })
      }
      await Promise.all([carregarPaisesAdmin(), carregar()])
      setVisao('lista')
    } catch (e: any) {
      setErroPais(e.message || 'Não foi possível salvar o país.')
    } finally { setSalvandoPais(false) }
  }

  async function toggleAtivoPais(p: Pais) {
    try {
      await jsonFetch(`/api/gerenciamento/paises/${p.countryKey}`, {
        method: 'PUT',
        body: JSON.stringify({ ativo: !p.ativo }),
      })
      await Promise.all([carregarPaisesAdmin(), carregar()])
    } catch (e: any) {
      setErroPais(e.message || 'Não foi possível alterar o país.')
    }
  }

  async function excluirPais(p: Pais) {
    if (!confirm(`Excluir o país "${p.countryLabel}"? Só é possível se ele não tiver tipos nem processos.`)) return
    setErroPais(null)
    try {
      await jsonFetch(`/api/gerenciamento/paises/${p.countryKey}`, { method: 'DELETE' })
      await Promise.all([carregarPaisesAdmin(), carregar()])
    } catch (e: any) {
      setErroPais(e.message || 'Não foi possível excluir o país.')
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
        <div className="flex items-center gap-2">
          <button onClick={abrirPaises} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white">
            Gerenciar países
          </button>
          <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
            + Novo processo
          </button>
        </div>
      </div>

      {!loading && !erroLista && paises.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Nenhum país ativo no catálogo. Crie ou reative um em "Gerenciar países".
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

      {/* MODAL: Novo/Editar processo */}
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

      {/* MODAL: Gerenciar países (lista + criar/editar) */}
      {paisesModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">
                {visao === 'lista' ? 'Países' : editandoPais ? `Editar país — ${editandoPais.countryLabel}` : 'Novo país'}
              </h3>
              <button onClick={() => setPaisesModal(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            {visao === 'lista' && (
              <div className="space-y-3 px-6 py-4">
                <div className="flex justify-end">
                  <button onClick={abrirNovoPais} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500">
                    + Novo país
                  </button>
                </div>

                {carregandoPaises && <div className="py-8 text-center text-sm text-white/40">Carregando...</div>}

                {!carregandoPaises && paisesAdmin.length === 0 && (
                  <div className="py-8 text-center text-sm text-white/40">Nenhum país cadastrado.</div>
                )}

                {!carregandoPaises && paisesAdmin.length > 0 && (
                  <div className="overflow-hidden rounded-xl border border-white/10">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="bg-white/5">
                          <th className="border-b border-white/10 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">País</th>
                          <th className="border-b border-white/10 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Nacionalidade</th>
                          <th className="border-b border-white/10 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Tipos</th>
                          <th className="border-b border-white/10 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                          <th className="border-b border-white/10 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paisesAdmin.map((p) => (
                          <tr key={p.countryKey} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                            <td className="px-3 py-2 font-medium text-white">{p.flag ? p.flag + ' ' : ''}{p.countryLabel}</td>
                            <td className="px-3 py-2 text-white/70">{p.nationalityLabel}</td>
                            <td className="px-3 py-2 text-white/70">{p.tiposCount ?? 0}</td>
                            <td className="px-3 py-2">
                              {p.ativo
                                ? <span className="rounded-md bg-green-500/15 px-2 py-0.5 text-[11px] font-medium text-green-300">ativo</span>
                                : <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/50">inativo</span>}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-1.5">
                                <button onClick={() => abrirEditarPais(p)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                                <button onClick={() => toggleAtivoPais(p)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">
                                  {p.ativo ? 'Inativar' : 'Ativar'}
                                </button>
                                <button onClick={() => excluirPais(p)} className="rounded-md border border-red-500/20 px-2 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className="text-[11px] text-white/40">
                  Excluir só funciona para país sem tipos e sem processos. Se já estiver em uso, use "Inativar" — ele some do kanban e dos cadastros, sem apagar nada.
                </p>

                {erroPais && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erroPais}</div>}
              </div>
            )}

            {visao === 'form' && (
              <>
                <div className="space-y-4 px-6 py-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs text-white/60">Nome do país *</label>
                      <input value={pLabel} onChange={(e) => setPLabel(e.target.value)} placeholder="França" className={inputCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-white/60">Bandeira</label>
                      <input value={pFlag} onChange={(e) => setPFlag(e.target.value)} placeholder="🇫🇷" className={inputCls} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs text-white/60">Nacionalidade *</label>
                      <input value={pNat} onChange={(e) => setPNat(e.target.value)} placeholder="Francesa" className={inputCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-white/60">Prefixo do código</label>
                      <input value={pPrefix} onChange={(e) => setPPrefix(e.target.value)} placeholder="FRA" className={inputCls + ' font-mono'} />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-white/60">Moeda padrão</label>
                    <select value={pMoeda} onChange={(e) => setPMoeda(e.target.value)} className={inputCls}>
                      <option value="EUR" className="bg-zinc-900">EUR</option>
                      <option value="USD" className="bg-zinc-900">USD</option>
                      <option value="BRL" className="bg-zinc-900">BRL</option>
                    </select>
                  </div>

                  {!editandoPais && (
                    <div>
                      <label className="mb-1 block text-xs text-white/60">Modalidades</label>
                      <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
                        <label className="flex items-center gap-2 text-sm text-white/80">
                          <input type="checkbox" checked={pJud} onChange={(e) => setPJud(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                          Judicial
                        </label>
                        <label className="flex items-center gap-2 text-sm text-white/80">
                          <input type="checkbox" checked={pAdm} onChange={(e) => setPAdm(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                          Administrativa
                        </label>
                      </div>
                      <p className="mt-1 text-[11px] text-white/40">O país precisa de pelo menos uma modalidade para ser usado.</p>
                    </div>
                  )}

                  {erroPais && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erroPais}</div>}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-white/10 px-6 py-4">
                  <button onClick={() => { setVisao('lista'); setErroPais(null) }} className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white">← Voltar</button>
                  <button onClick={salvarPais} disabled={salvandoPais} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50">
                    {salvandoPais ? 'Salvando...' : editandoPais ? 'Salvar alterações' : 'Criar país'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}