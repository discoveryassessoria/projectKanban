'use client'

// src/components/gerenciamentoComponents/CategoriasTab.tsx
// Cadastro REAL de Categorias Financeiras (tabela CategoriaFinanceira).
// Backend: /api/gerenciamento/categorias (GET/POST) + /[id] (PUT/DELETE)
//   GET -> { categorias: [...] } (cada uma com categoriaPai e _count)
//   body { nome, tipo, cor, descricao, categoriaPaiId, ativo }
// tipo = ENTRADA | SAIDA. Suporta categoria pai (subcategorias).

import { useState, useEffect, useMemo, useCallback } from 'react'

type Categoria = {
  id: number
  nome: string
  tipo: 'ENTRADA' | 'SAIDA'
  cor: string | null
  descricao: string | null
  categoriaPaiId: number | null
  ativo: boolean
  categoriaPai?: { id: number; nome: string } | null
  _count?: { subcategorias: number; contasPagar: number; transacoes: number }
}

const CORES = [
  '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6',
  '#10B981', '#EC4899', '#14B8A6', '#6366F1',
]

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

export default function CategoriasTab() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<'TODOS' | 'ENTRADA' | 'SAIDA'>('TODOS')

  // modal
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Categoria | null>(null)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<'ENTRADA' | 'SAIDA'>('SAIDA')
  const [cor, setCor] = useState(CORES[2])
  const [descricao, setDescricao] = useState('')
  const [categoriaPaiId, setCategoriaPaiId] = useState<string>('')
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const data = await jsonFetch('/api/gerenciamento/categorias', { cache: 'no-store' })
      setCategorias((data as any).categorias || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar as categorias.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return categorias.filter((c) => {
      if (filtroTipo !== 'TODOS' && c.tipo !== filtroTipo) return false
      if (!q) return true
      return c.nome.toLowerCase().includes(q) || (c.descricao || '').toLowerCase().includes(q)
    })
  }, [categorias, busca, filtroTipo])

  function abrirNovo() {
    setEditando(null)
    setNome(''); setTipo('SAIDA'); setCor(CORES[2]); setDescricao(''); setCategoriaPaiId(''); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(c: Categoria) {
    setEditando(c)
    setNome(c.nome); setTipo(c.tipo); setCor(c.cor || CORES[2]); setDescricao(c.descricao || '')
    setCategoriaPaiId(c.categoriaPaiId ? String(c.categoriaPaiId) : ''); setAtivo(c.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!nome.trim()) { setErroModal('Dê um nome à categoria.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        nome: nome.trim(),
        tipo,
        cor,
        descricao: descricao.trim() || null,
        categoriaPaiId: categoriaPaiId ? Number(categoriaPaiId) : null,
        ativo,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/categorias/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/categorias', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(c: Categoria) {
    if (!confirm(`Excluir a categoria "${c.nome}"? Esta ação não pode ser desfeita.`)) return
    try {
      await jsonFetch(`/api/gerenciamento/categorias/${c.id}`, { method: 'DELETE' })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  // opções de categoria-pai: todas menos a que está sendo editada
  const opcoesPai = categorias.filter((c) => !editando || c.id !== editando.id)

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Categorias</h2>
          <p className="text-sm text-white/50">
            Classificação de entradas e saídas usada em lançamentos, contas a pagar e no DRE.
          </p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova categoria
        </button>
      </div>

      {/* Busca + filtro de tipo */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar categoria..."
          className="min-w-[200px] flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
        />
        <div className="flex overflow-hidden rounded-lg border border-white/10">
          {(['TODOS', 'ENTRADA', 'SAIDA'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFiltroTipo(t)}
              className={`px-3 py-2 text-xs transition ${filtroTipo === t ? 'bg-white/15 text-white' : 'text-white/50 hover:bg-white/5'}`}
            >
              {t === 'TODOS' ? 'Todos' : t === 'ENTRADA' ? 'Entradas' : 'Saídas'}
            </button>
          ))}
        </div>
      </div>

      {/* Estados */}
      {loading && <div className="py-12 text-center text-sm text-white/40">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroLista}
          <button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtradas.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca || filtroTipo !== 'TODOS' ? 'Nenhuma categoria encontrada.' : 'Nenhuma categoria ainda. Crie a primeira.'}
        </div>
      )}

      {/* Tabela */}
      {!loading && !erroLista && filtradas.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Nome</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Tipo</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Categoria pai</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.cor || '#64748b' }} />
                      <span className="font-medium text-white">{c.nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${c.tipo === 'ENTRADA' ? 'bg-green-500/15 text-green-300' : 'bg-amber-500/15 text-amber-300'}`}>
                      {c.tipo === 'ENTRADA' ? 'Entrada' : 'Saída'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-white/60">{c.categoriaPai?.nome || '—'}</td>
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

      {/* Modal */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar categoria' : 'Nova categoria'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-white/60">Nome</label>
                <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20" />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Tipo</label>
                <div className="flex overflow-hidden rounded-lg border border-white/10">
                  {(['ENTRADA', 'SAIDA'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTipo(t)}
                      className={`flex-1 px-3 py-2 text-sm transition ${tipo === t ? (t === 'ENTRADA' ? 'bg-green-500/20 text-green-200' : 'bg-amber-500/20 text-amber-200') : 'text-white/50 hover:bg-white/5'}`}
                    >
                      {t === 'ENTRADA' ? 'Entrada' : 'Saída'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Categoria pai (opcional)</label>
                <select value={categoriaPaiId} onChange={(e) => setCategoriaPaiId(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20">
                  <option value="" className="bg-zinc-900">— Nenhuma (categoria principal) —</option>
                  {opcoesPai.map((c) => (
                    <option key={c.id} value={c.id} className="bg-zinc-900">{c.nome} ({c.tipo === 'ENTRADA' ? 'Entrada' : 'Saída'})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Descrição</label>
                <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Opcional" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20" />
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Cor</label>
                <div className="flex items-center gap-2">
                  {CORES.map((c) => (
                    <button key={c} type="button" onClick={() => setCor(c)} className={`h-7 w-7 rounded-full transition ${cor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : ''}`} style={{ backgroundColor: c }} />
                  ))}
                  <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="h-7 w-10 cursor-pointer rounded bg-transparent" />
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