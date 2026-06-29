'use client'

// src/components/gerenciamentoComponents/BancosTab.tsx
// Cadastro REAL de Bancos (tabela Banco).
// Backend: /api/gerenciamento/bancos (GET/POST) + /[id] (PUT/DELETE)
//   GET -> { bancos: [...] } (cada um com _count.contas)
//   body { codigo, nome, sigla, pais, website, ativo }

import { useState, useEffect, useMemo, useCallback } from 'react'

type Banco = {
  id: number
  codigo: string | null
  nome: string
  sigla: string | null
  pais: string | null
  website: string | null
  ativo: boolean
  _count?: { contas: number }
}

async function jsonFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}

export default function BancosTab() {
  const [bancos, setBancos] = useState<Banco[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Banco | null>(null)
  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [sigla, setSigla] = useState('')
  const [pais, setPais] = useState('')
  const [website, setWebsite] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const data = await jsonFetch('/api/gerenciamento/bancos', { cache: 'no-store' })
      setBancos((data as any).bancos || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar os bancos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return bancos
    return bancos.filter((b) =>
      b.nome.toLowerCase().includes(q) ||
      (b.sigla || '').toLowerCase().includes(q) ||
      (b.codigo || '').toLowerCase().includes(q)
    )
  }, [bancos, busca])

  function abrirNovo() {
    setEditando(null)
    setCodigo(''); setNome(''); setSigla(''); setPais(''); setWebsite(''); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(b: Banco) {
    setEditando(b)
    setCodigo(b.codigo || ''); setNome(b.nome); setSigla(b.sigla || '')
    setPais(b.pais || ''); setWebsite(b.website || ''); setAtivo(b.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!nome.trim()) { setErroModal('Dê um nome ao banco.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        codigo: codigo.trim() || null,
        nome: nome.trim(),
        sigla: sigla.trim() || null,
        pais: pais.trim() || null,
        website: website.trim() || null,
        ativo,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/bancos/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/bancos', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(b: Banco) {
    if (!confirm(`Excluir o banco "${b.nome}"? Esta ação não pode ser desfeita.`)) return
    try {
      await jsonFetch(`/api/gerenciamento/bancos/${b.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Bancos</h2>
          <p className="text-sm text-white/50">Bancos usados nas contas e nos recebimentos.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Novo banco
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar banco..."
        className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
      />

      {loading && <div className="py-12 text-center text-sm text-white/40">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroLista}
          <button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtrados.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca ? 'Nenhum banco encontrado.' : 'Nenhum banco ainda. Crie o primeiro.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Banco</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">País</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((b) => (
                <tr key={b.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{b.nome}</div>
                    {(b.codigo || b.sigla) && (
                      <div className="text-[11px] text-white/40">
                        {b.codigo ? `Cód. ${b.codigo}` : ''}{b.codigo && b.sigla ? ' · ' : ''}{b.sigla || ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{b.pais || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${b.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                      {b.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(b)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(b)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar banco' : 'Novo banco'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="mb-1 block text-xs text-white/60">Código</label>
                  <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="341" className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-white/60">Nome</label>
                  <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Sigla</label>
                  <input value={sigla} onChange={(e) => setSigla(e.target.value)} placeholder="ITAU" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">País</label>
                  <input value={pais} onChange={(e) => setPais(e.target.value)} placeholder="Brasil" className={inputCls} />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Site</label>
                <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." className={inputCls} />
              </div>

              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                Ativo
              </label>

              {erroModal && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erroModal}</div>
              )}
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