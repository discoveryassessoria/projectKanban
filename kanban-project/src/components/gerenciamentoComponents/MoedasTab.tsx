'use client'

// src/components/gerenciamentoComponents/MoedasTab.tsx
// Moedas (tabela MoedaCadastro = fin_currencies do mockup).
// CADASTRO DE REFERÊNCIA (código/nome/símbolo) — standalone.
// ⚠ NÃO substitui o enum Moeda (BRL/EUR/USD) usado em Receita/Custo/Fatura/etc.
//   Aqueles continuam usando o enum; esta tela é só o registro de moedas.
// Backend: /api/gerenciamento/moedas (GET/POST) + /[id] (PUT/DELETE)

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useApi } from "@/src/lib/dados"

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

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function MoedasTab() {
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Moeda | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  // Consulta em cache pela camada oficial (src/lib/dados): loading, erro,
  // deduplicação e revalidação vêm dela. Some o par useState + useEffect de
  // montagem, que era a origem do setState-em-efeito.
  const { dados, carregando: loading, erro, recarregar: carregar } = useApi<{ moedas?: Moeda[] }>('/api/gerenciamento/moedas')
  const itens: Moeda[] = dados?.moedas ?? SEM_ITENS
  const erroLista = erro ? (erro.message || 'Não foi possível carregar as moedas.') : null

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

  const inputCls = 'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Moedas</h2>
          <p className="text-sm text-[var(--text-secondary)]">Moedas usadas no sistema (código, nome e símbolo).</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)]">
          + Nova moeda
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar moeda..."
        className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
      />

      {loading && <div className="py-12 text-center text-sm text-[var(--text-muted)]">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {erroLista}
          <button onClick={() => void carregar()} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtrados.length === 0 && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] py-12 text-center text-sm text-[var(--text-muted)] backdrop-blur">
          {busca ? 'Nenhuma moeda encontrada.' : 'Nenhuma moeda ainda. Crie a primeira.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[var(--surface-primary)]">
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Código</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Nome</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Símbolo</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((m) => (
                <tr key={m.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-primary)]">
                  <td className="px-4 py-2.5 font-mono text-[12px] font-semibold text-white/90">{m.code}</td>
                  <td className="px-4 py-2.5 text-white/70">{m.name || '—'}</td>
                  <td className="px-4 py-2.5 text-white/70">{m.symbol || '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(m)} className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-white/70 transition hover:bg-[var(--surface-hover)] hover:text-white">Editar</button>
                      <button onClick={() => excluir(m)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-700/80 transition hover:bg-red-50 hover:text-red-700">Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar moeda' : 'Nova moeda'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Código *</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus placeholder="EUR" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Nome</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Euro" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Símbolo</label>
                <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="€" className={inputCls} />
              </div>

              {erroModal && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erroModal}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
              <button onClick={() => setModalAberto(false)} className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)] disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}