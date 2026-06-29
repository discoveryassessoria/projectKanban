'use client'

// src/components/gerenciamentoComponents/CentrosCustoTab.tsx
// Cadastro REAL de Centros de Custo (tabela CentroCusto).
// Backend: GET/POST /api/gerenciamento/centros-custo  +  PUT/DELETE /api/gerenciamento/centros-custo/[id]
//   GET    -> { centros: [...] }
//   POST   -> { centro }   body { nome, descricao, cor, ativo }
//   PUT    -> { centro }   mesmo body
//   DELETE -> { ok: true }
// Auth igual ao UsersTab/RolesTab: token authToken no header Authorization Bearer.
// ESTE é o TEMPLATE do padrão de cadastro — Categorias/Contas/Fornecedores seguem igual.

import { useState, useEffect, useMemo, useCallback } from 'react'

type CentroCusto = {
  id: number
  nome: string
  descricao: string | null
  cor: string | null
  ativo: boolean
}

const CORES = [
  '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6',
  '#10B981', '#EC4899', '#14B8A6', '#6366F1',
]

// fetch com auth (authToken -> Bearer) que devolve a mensagem de erro do servidor
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

export default function CentrosCustoTab() {
  const [centros, setCentros] = useState<CentroCusto[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  // modal
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<CentroCusto | null>(null) // null = criar
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [cor, setCor] = useState(CORES[2])
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErroLista(null)
    try {
      const data = await jsonFetch('/api/gerenciamento/centros-custo', { cache: 'no-store' })
      setCentros((data as any).centros || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar os centros de custo.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return centros
    return centros.filter(
      (c) => c.nome.toLowerCase().includes(q) || (c.descricao || '').toLowerCase().includes(q)
    )
  }, [centros, busca])

  function abrirNovo() {
    setEditando(null)
    setNome(''); setDescricao(''); setCor(CORES[2]); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(c: CentroCusto) {
    setEditando(c)
    setNome(c.nome); setDescricao(c.descricao || ''); setCor(c.cor || CORES[2]); setAtivo(c.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!nome.trim()) { setErroModal('Dê um nome ao centro de custo.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        cor,
        ativo,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/centros-custo/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/centros-custo', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(c: CentroCusto) {
    if (!confirm(`Excluir o centro de custo "${c.nome}"? Esta ação não pode ser desfeita.`)) return
    try {
      await jsonFetch(`/api/gerenciamento/centros-custo/${c.id}`, { method: 'DELETE' })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Centros de Custo</h2>
          <p className="text-sm text-white/50">
            Agrupadores para classificar despesas e analisar gastos por área.
          </p>
        </div>
        <button
          onClick={abrirNovo}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
        >
          + Novo centro
        </button>
      </div>

      {/* Busca */}
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar centro de custo..."
        className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
      />

      {/* Estados */}
      {loading && <div className="py-12 text-center text-sm text-white/40">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroLista}
          <button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtrados.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca ? 'Nenhum centro de custo encontrado.' : 'Nenhum centro de custo ainda. Crie o primeiro.'}
        </div>
      )}

      {/* Tabela */}
      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Nome</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Descrição</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.cor || '#64748b' }} />
                      <span className="font-medium text-white">{c.nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-white/60">{c.descricao || '—'}</td>
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
              <h3 className="text-lg font-semibold text-white">
                {editando ? 'Editar centro de custo' : 'Novo centro de custo'}
              </h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-white/60">Nome</label>
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  autoFocus
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Descrição</label>
                <input
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Opcional"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Cor</label>
                <div className="flex items-center gap-2">
                  {CORES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCor(c)}
                      className={`h-7 w-7 rounded-full transition ${cor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : ''}`}
                      style={{ backgroundColor: c }}
                    />
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