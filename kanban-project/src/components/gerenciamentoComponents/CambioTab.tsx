'use client'

// src/components/gerenciamentoComponents/CambioTab.tsx
// Cadastro de Câmbio (tabela CotacaoCambio).
// Backend: /api/gerenciamento/cambio (GET/POST) + /[id] (PUT/DELETE)
//   GET -> { cotacoes: [...] }
//   body { moedaDe, moedaPara, taxa, data, fonte, ativo }

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useApi } from "@/src/lib/dados"

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

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function CambioTab() {
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

  // Consulta em cache pela camada oficial (src/lib/dados): loading, erro,
  // deduplicação e revalidação vêm dela. Some o par useState + useEffect de
  // montagem, que era a origem do setState-em-efeito.
  const { dados, carregando: loading, erro, recarregar: carregar } = useApi<{ cotacoes?: Cotacao[] }>('/api/gerenciamento/cambio')
  const cotacoes: Cotacao[] = dados?.cotacoes ?? SEM_ITENS
  const erroLista = erro ? (erro.message || 'Não foi possível carregar as cotações.') : null

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

  const inputCls = 'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Câmbio</h2>
          <p className="text-sm text-[var(--text-secondary)]">Cotações entre moedas.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)]">
          + Nova cotação
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar (moeda ou fonte)..."
        className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
      />

      {loading && <div className="py-12 text-center text-sm text-[var(--text-muted)]">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 text-sm text-red-700">
          {erroLista}
          <button onClick={() => void carregar()} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtradas.length === 0 && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] py-12 text-center text-sm text-[var(--text-muted)] backdrop-blur">
          {busca ? 'Nenhuma cotação encontrada.' : 'Nenhuma cotação ainda. Crie a primeira.'}
        </div>
      )}

      {!loading && !erroLista && filtradas.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[var(--surface-primary)]">
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Par</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Taxa</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Data</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Fonte</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Status</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-primary)]">
                  <td className="px-4 py-2.5 font-medium text-white">{c.moedaDe} → {c.moedaPara}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white/80">{Number(c.taxa).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtData(c.data)}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{c.fonte || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${c.ativo ? 'bg-[var(--surface-secondary)] text-green-800' : 'bg-[var(--surface-primary)] text-[var(--text-secondary)]'}`}>
                      {c.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(c)} className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-white/70 transition hover:bg-[var(--surface-hover)] hover:text-white">Editar</button>
                      <button onClick={() => excluir(c)} className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-red-700/80 transition hover:bg-[var(--surface-secondary)] hover:text-red-700">Excluir</button>
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
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar cotação' : 'Nova cotação'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">De</label>
                  <select value={moedaDe} onChange={(e) => setMoedaDe(e.target.value)} className={inputCls}>
                    {MOEDAS.map((m) => <option key={m} value={m} className="bg-zinc-900">{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Para</label>
                  <select value={moedaPara} onChange={(e) => setMoedaPara(e.target.value)} className={inputCls}>
                    {MOEDAS.map((m) => <option key={m} value={m} className="bg-zinc-900">{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Taxa</label>
                <input type="number" step="0.000001" value={taxa} onChange={(e) => setTaxa(e.target.value)} placeholder="Ex.: 6.25" className={inputCls} />
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">1 {moedaDe} = {taxa || '?'} {moedaPara}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Data</label>
                  <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Fonte</label>
                  <input value={fonte} onChange={(e) => setFonte(e.target.value)} placeholder="Ex.: BCB, Wise" className={inputCls} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                Ativo
              </label>

              {erroModal && (
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-red-700">{erroModal}</div>
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