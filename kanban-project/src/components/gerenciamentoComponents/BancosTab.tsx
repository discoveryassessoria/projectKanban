'use client'

// src/components/gerenciamentoComponents/BancosTab.tsx
// Cadastro REAL de Bancos (tabela Banco).
// Backend: /api/gerenciamento/bancos (GET/POST) + /[id] (PUT/DELETE)
//   GET -> { bancos: [...] } (cada um com _count.contas)
//   body { codigo, nome, sigla, pais, website, ativo }

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useApi } from "@/src/lib/dados"

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

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function BancosTab() {
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

  // Consulta em cache pela camada oficial (src/lib/dados): loading, erro,
  // deduplicação e revalidação vêm dela. Some o par useState + useEffect de
  // montagem, que era a origem do setState-em-efeito.
  const { dados, carregando: loading, erro, recarregar: carregar } = useApi<{ bancos?: Banco[] }>('/api/gerenciamento/bancos')
  const bancos: Banco[] = dados?.bancos ?? SEM_ITENS
  const erroLista = erro ? (erro.message || 'Não foi possível carregar os bancos.') : null

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

  const inputCls = 'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Bancos</h2>
          <p className="text-sm text-[var(--text-secondary)]">Bancos usados nas contas e nos recebimentos.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)]">
          + Novo banco
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar banco..."
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
          {busca ? 'Nenhum banco encontrado.' : 'Nenhum banco ainda. Crie o primeiro.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[var(--surface-primary)]">
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Banco</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">País</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Status</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((b) => (
                <tr key={b.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-primary)]">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{b.nome}</div>
                    {(b.codigo || b.sigla) && (
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {b.codigo ? `Cód. ${b.codigo}` : ''}{b.codigo && b.sigla ? ' · ' : ''}{b.sigla || ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{b.pais || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${b.ativo ? 'bg-green-50 text-green-700' : 'bg-[var(--surface-primary)] text-[var(--text-secondary)]'}`}>
                      {b.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(b)} className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-white/70 transition hover:bg-[var(--surface-hover)] hover:text-white">Editar</button>
                      <button onClick={() => excluir(b)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-700/80 transition hover:bg-red-50 hover:text-red-700">Excluir</button>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar banco' : 'Novo banco'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
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
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erroModal}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
              <button onClick={() => setModalAberto(false)} className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white">Cancelar</button>
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