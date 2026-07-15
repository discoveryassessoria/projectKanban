'use client'

// src/components/gerenciamentoComponents/ProdutosServicosTab.tsx
// CADASTRO MESTRE de Serviços (ServicoProduto) — o que a empresa vende/executa.
// Operacional puro: código, nome, categoria, descrição, nacionalidade/modalidade,
// unidade padrão (opcional), status. SEM financeiro (preço/custo/receita/momento/
// itens financeiros vivem no Financeiro, que só REFERENCIA este mestre por FK).
// Cada serviço é espelhado no ItemCatalogo (natureza SERVICO) via dual-write —
// é isso que aparece no select de "Serviço" em Configurações Financeiras.
// Backend: /api/gerenciamento/produtos-servicos (GET/POST) + /[id] (PUT/DELETE)

import { useState, useEffect, useMemo, useCallback } from 'react'

type Servico = {
  id: number
  code: string
  name: string
  category: string | null
  descricao: string | null
  unidadePadrao: string | null
  nationality: string
  ativo: boolean
}

// Nacionalidades/modalidades aplicáveis (conjunto operacional fixo).
const NACIONALIDADES: [string, string][] = [
  ['all', 'Todas'], ['italiano', 'Italiana'], ['espanhol', 'Espanhola'],
  ['portugues', 'Portuguesa'], ['alemao', 'Alemã'],
]
const nacLabel = (v: string) => NACIONALIDADES.find(([k]) => k === v)?.[1] || v || '—'

// Unidade padrão (UnidadeItem) — opcional.
const UNIDADES: [string, string][] = [
  ['', '— (nenhuma)'], ['UNIDADE', 'Unidade'], ['DOCUMENTO', 'Documento'], ['PESSOA', 'Pessoa'],
  ['REQUERENTE', 'Requerente'], ['PAGINA', 'Página'], ['PACOTE', 'Pacote'], ['PROCESSO', 'Processo'],
  ['FASE', 'Fase'], ['HORA', 'Hora'], ['DIA', 'Dia'], ['MES', 'Mês'], ['PERCENTUAL', 'Percentual'], ['CUSTOM', 'Custom'],
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

export default function ProdutosServicosTab() {
  const [servicos, setServicos] = useState<Servico[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Servico | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [descricao, setDescricao] = useState('')
  const [unidadePadrao, setUnidadePadrao] = useState('')
  const [nationality, setNationality] = useState('all')
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/produtos-servicos', { cache: 'no-store' })
      setServicos((d as any).servicos || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar os serviços.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return servicos
    return servicos.filter((s) =>
      s.code.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q)
    )
  }, [servicos, busca])

  function abrirNovo() {
    setEditando(null)
    setCode(''); setName(''); setCategory(''); setDescricao(''); setUnidadePadrao(''); setNationality('all'); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(s: Servico) {
    setEditando(s)
    setCode(s.code); setName(s.name); setCategory(s.category || '')
    setDescricao(s.descricao || ''); setUnidadePadrao(s.unidadePadrao || '')
    setNationality(s.nationality || 'all'); setAtivo(s.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!code.trim()) { setErroModal('Informe o código.'); return }
    if (!name.trim()) { setErroModal('Informe o nome.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        code: code.trim(),
        name: name.trim(),
        category: category.trim() || null,
        descricao: descricao.trim() || null,
        unidadePadrao: unidadePadrao || null,
        nationality,
        ativo,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/produtos-servicos/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/produtos-servicos', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(s: Servico) {
    if (!confirm(`Excluir o serviço "${s.name}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/produtos-servicos/${s.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Serviços</h2>
          <p className="text-sm text-white/50">Cadastro mestre operacional do que a empresa vende/executa (assessoria, tradução, apostilamento, retificação, busca genealógica, logística…). O preço e a configuração financeira vivem no Financeiro, que apenas referencia este serviço.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Novo serviço
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por código, nome ou categoria..."
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
          {busca ? 'Nenhum serviço encontrado.' : 'Nenhum serviço ainda. Crie o primeiro.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Código</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Nome</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Categoria</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Nacionalidade</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((s) => (
                <tr key={s.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-white/80">{s.code}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{s.name}</div>
                    {s.descricao && <div className="text-[11px] text-white/40">{s.descricao}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{s.category || '—'}</td>
                  <td className="px-4 py-2.5 text-white/70">{nacLabel(s.nationality)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${s.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                      {s.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(s)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(s)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
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
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar serviço' : 'Novo serviço'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Código</label>
                  <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus placeholder="TRAD_JURAMENTADA" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Nome</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tradução Juramentada" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Categoria</label>
                  <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="cidadania, traducao, apostilamento..." className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Nacionalidade / modalidade</label>
                  <select value={nationality} onChange={(e) => setNationality(e.target.value)} className={inputCls}>
                    {NACIONALIDADES.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Descrição</label>
                <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} placeholder="O que o serviço entrega..." className={inputCls} />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Unidade padrão (opcional)</label>
                  <select value={unidadePadrao} onChange={(e) => setUnidadePadrao(e.target.value)} className={inputCls}>
                    {UNIDADES.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <label className="mt-6 flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                  Ativo
                </label>
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
