'use client'

// src/components/gerenciamentoComponents/PlanoContasTab.tsx
// Cadastro do Plano de Contas (tabela PlanoConta).
// Backend: /api/gerenciamento/plano-contas (GET/POST) + /[id] (PUT/DELETE)
//   GET -> { contas: [...] }
//   body { codigo, nome, tipo, natureza, ativo }

import { useState, useEffect, useMemo, useCallback } from 'react'

type PlanoConta = {
  id: number
  codigo: string
  nome: string
  tipo: string | null
  natureza: string | null
  ativo: boolean
}

const TIPOS: [string, string][] = [
  ['asset', 'Ativo'],
  ['liability', 'Passivo'],
  ['revenue', 'Receita'],
  ['expense', 'Despesa'],
  ['cost', 'Custo'],
  ['tax', 'Tributo'],
  ['transfer', 'Transferência'],
  ['equity', 'Patrimônio líquido'],
]
const NATUREZAS: [string, string][] = [['debit', 'Débito'], ['credit', 'Crédito']]

const lbl = (arr: [string, string][], v: string | null) => arr.find(([k]) => k === v)?.[1] || v || '—'

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

export default function PlanoContasTab() {
  const [contas, setContas] = useState<PlanoConta[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<PlanoConta | null>(null)
  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('')
  const [natureza, setNatureza] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/plano-contas', { cache: 'no-store' })
      setContas((d as any).contas || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar o plano de contas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return contas
    return contas.filter((c) =>
      c.codigo.toLowerCase().includes(q) ||
      c.nome.toLowerCase().includes(q) ||
      lbl(TIPOS, c.tipo).toLowerCase().includes(q)
    )
  }, [contas, busca])

  function abrirNovo() {
    setEditando(null)
    setCodigo(''); setNome(''); setTipo(''); setNatureza(''); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(c: PlanoConta) {
    setEditando(c)
    setCodigo(c.codigo); setNome(c.nome); setTipo(c.tipo || ''); setNatureza(c.natureza || ''); setAtivo(c.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!codigo.trim()) { setErroModal('Informe o código.'); return }
    if (!nome.trim()) { setErroModal('Dê um nome à conta.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        codigo: codigo.trim(),
        nome: nome.trim(),
        tipo: tipo || null,
        natureza: natureza || null,
        ativo,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/plano-contas/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/plano-contas', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(c: PlanoConta) {
    if (!confirm(`Excluir a conta "${c.codigo} — ${c.nome}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/plano-contas/${c.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Plano de Contas</h2>
          <p className="text-sm text-white/50">Contas contábeis para classificar lançamentos.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova conta
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar (código, nome ou tipo)..."
        className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
      />

      {loading && <div className="py-12 text-center text-sm text-white/40">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroLista}
          <button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtradas.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca ? 'Nenhuma conta encontrada.' : 'Nenhuma conta ainda. Crie a primeira.'}
        </div>
      )}

      {!loading && !erroLista && filtradas.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Código</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Nome</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Tipo</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Natureza</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 font-mono text-white/80">{c.codigo}</td>
                  <td className="px-4 py-2.5 font-medium text-white">{c.nome}</td>
                  <td className="px-4 py-2.5 text-white/70">{lbl(TIPOS, c.tipo)}</td>
                  <td className="px-4 py-2.5 text-white/70">{lbl(NATUREZAS, c.natureza)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${c.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                      {c.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(c)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(c)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar conta' : 'Nova conta'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="mb-1 block text-xs text-white/60">Código</label>
                  <input value={codigo} onChange={(e) => setCodigo(e.target.value)} autoFocus placeholder="1.1.01" className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-white/60">Nome</label>
                  <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Tipo</label>
                  <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">—</option>
                    {TIPOS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Natureza</label>
                  <select value={natureza} onChange={(e) => setNatureza(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">—</option>
                    {NATUREZAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
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