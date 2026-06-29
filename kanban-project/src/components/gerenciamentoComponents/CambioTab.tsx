'use client'

// src/components/gerenciamentoComponents/CambioTab.tsx
// Cadastro de Câmbio (tabela CotacaoCambio).
// Backend: /api/gerenciamento/cambio (GET/POST) + /[id] (PUT/DELETE)
//   GET -> { cotacoes: [...] }
//   body { moedaDe, moedaPara, taxa, data, fonte, ativo }

import { useState, useEffect, useMemo, useCallback } from 'react'

type Cotacao = {
  id: number
  moedaDe: string
  moedaPara: string
  taxa: string | number
  data: string | null
  fonte: string | null
  ativo: boolean
}

const MOEDAS = ['BRL', 'EUR', 'USD']

const fmtData = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

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

export default function CambioTab() {
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Cotacao | null>(null)
  const [moedaDe, setMoedaDe] = useState('EUR')
  const [moedaPara, setMoedaPara] = useState('BRL')
  const [taxa, setTaxa] = useState('')
  const [data, setData] = useState('')
  const [fonte, setFonte] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/cambio', { cache: 'no-store' })
      setCotacoes((d as any).cotacoes || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar as cotações.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return cotacoes
    return cotacoes.filter((c) =>
      `${c.moedaDe} ${c.moedaPara} ${c.fonte || ''}`.toLowerCase().includes(q)
    )
  }, [cotacoes, busca])

  function abrirNovo() {
    setEditando(null)
    setMoedaDe('EUR'); setMoedaPara('BRL'); setTaxa(''); setData(''); setFonte(''); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(c: Cotacao) {
    setEditando(c)
    setMoedaDe(c.moedaDe); setMoedaPara(c.moedaPara); setTaxa(String(c.taxa ?? ''))
    setData(c.data ? c.data.slice(0, 10) : ''); setFonte(c.fonte || ''); setAtivo(c.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!taxa || Number(taxa) <= 0) { setErroModal('Informe uma taxa válida.'); return }
    if (moedaDe === moedaPara) { setErroModal('As moedas De e Para devem ser diferentes.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        moedaDe, moedaPara,
        taxa: Number(taxa),
        data: data || null,
        fonte: fonte.trim() || null,
        ativo,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/cambio/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/cambio', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(c: Cotacao) {
    if (!confirm(`Excluir a cotação ${c.moedaDe} → ${c.moedaPara}?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/cambio/${c.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Câmbio</h2>
          <p className="text-sm text-white/50">Cotações entre moedas.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova cotação
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar (moeda ou fonte)..."
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
          {busca ? 'Nenhuma cotação encontrada.' : 'Nenhuma cotação ainda. Crie a primeira.'}
        </div>
      )}

      {!loading && !erroLista && filtradas.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Par</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Taxa</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Data</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Fonte</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 font-medium text-white">{c.moedaDe} → {c.moedaPara}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white/80">{Number(c.taxa).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</td>
                  <td className="px-4 py-2.5 text-white/60">{fmtData(c.data)}</td>
                  <td className="px-4 py-2.5 text-white/60">{c.fonte || '—'}</td>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar cotação' : 'Nova cotação'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">De</label>
                  <select value={moedaDe} onChange={(e) => setMoedaDe(e.target.value)} className={inputCls}>
                    {MOEDAS.map((m) => <option key={m} value={m} className="bg-zinc-900">{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Para</label>
                  <select value={moedaPara} onChange={(e) => setMoedaPara(e.target.value)} className={inputCls}>
                    {MOEDAS.map((m) => <option key={m} value={m} className="bg-zinc-900">{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Taxa</label>
                <input type="number" step="0.000001" value={taxa} onChange={(e) => setTaxa(e.target.value)} placeholder="Ex.: 6.25" className={inputCls} />
                <p className="mt-1 text-[11px] text-white/40">1 {moedaDe} = {taxa || '?'} {moedaPara}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Data</label>
                  <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Fonte</label>
                  <input value={fonte} onChange={(e) => setFonte(e.target.value)} placeholder="Ex.: BCB, Wise" className={inputCls} />
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