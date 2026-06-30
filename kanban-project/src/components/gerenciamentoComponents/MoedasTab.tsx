'use client'

// src/components/gerenciamentoComponents/MoedasTab.tsx
// Moedas (tabela MoedaCadastro = fin_currencies do mockup).
// CADASTRO DE REFERÊNCIA (código/nome/símbolo) — standalone.
// ⚠ NÃO substitui o enum Moeda (BRL/EUR/USD) usado em Receita/Custo/Fatura/etc.
//   Aqueles continuam usando o enum; esta tela é só o registro de moedas.
// Backend: /api/gerenciamento/moedas (GET/POST) + /[id] (PUT/DELETE)

import { useState, useEffect, useMemo, useCallback } from 'react'

type Moeda = {
  id: number
  code: string
  name: string | null
  symbol: string | null
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

export default function MoedasTab() {
  const [itens, setItens] = useState<Moeda[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Moeda | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/moedas', { cache: 'no-store' })
      setItens((d as any).moedas || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar as moedas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return itens
    return itens.filter((m) =>
      m.code.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)
    )
  }, [itens, busca])

  function abrirNovo() {
    setEditando(null)
    setCode(''); setName(''); setSymbol('')
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(m: Moeda) {
    setEditando(m)
    setCode(m.code); setName(m.name || ''); setSymbol(m.symbol || '')
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!code.trim()) { setErroModal('Informe o código.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        code: code.trim().toUpperCase(),
        name: name.trim() || null,
        symbol: symbol.trim() || null,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/moedas/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/moedas', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(m: Moeda) {
    if (!confirm(`Excluir a moeda "${m.code}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/moedas/${m.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Moedas</h2>
          <p className="text-sm text-white/50">Moedas usadas no sistema (código, nome e símbolo).</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova moeda
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar moeda..."
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
          {busca ? 'Nenhuma moeda encontrada.' : 'Nenhuma moeda ainda. Crie a primeira.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Código</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Nome</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Símbolo</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((m) => (
                <tr key={m.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 font-mono text-[12px] font-semibold text-white/90">{m.code}</td>
                  <td className="px-4 py-2.5 text-white/70">{m.name || '—'}</td>
                  <td className="px-4 py-2.5 text-white/70">{m.symbol || '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(m)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(m)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar moeda' : 'Nova moeda'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-white/60">Código *</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus placeholder="EUR" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Nome</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Euro" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Símbolo</label>
                <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="€" className={inputCls} />
              </div>

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