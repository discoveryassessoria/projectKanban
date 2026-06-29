'use client'

// src/components/gerenciamentoComponents/CarteirasTab.tsx
// Cadastro de Carteiras de Recebimento (tabela CarteiraRecebimento).
// Backend: /api/gerenciamento/carteiras (GET/POST) + /[id] (PUT/DELETE)
// Campos do mockup fin_wallets: nome(req), tipo, contaBancariaId(→Conta),
//   moeda, diasLiquidacao(settlementDays), isDefault.
// Contas vêm de /api/gerenciamento/contas (select da conta vinculada).

import { useState, useEffect, useMemo, useCallback } from 'react'

type ContaRef = { id: number; nome: string; moeda?: string }
type Carteira = {
  id: number
  nome: string
  tipo: string | null
  contaBancariaId: number | null
  moeda: string
  diasLiquidacao: number | null
  isDefault: boolean
  ativo: boolean
  contaBancaria?: ContaRef | null
}

const TIPOS: [string, string][] = [
  ['bank_account', 'Conta bancária'],
  ['pix', 'Pix'],
  ['card_gateway', 'Gateway de cartão'],
  ['boleto', 'Boleto'],
  ['cash', 'Dinheiro'],
  ['international_transfer', 'Transferência internacional'],
  ['wallet', 'Carteira digital'],
  ['payment_link', 'Link de pagamento'],
]
const MOEDAS: [string, string][] = [['BRL', 'Real (BRL)'], ['EUR', 'Euro (EUR)'], ['USD', 'Dólar (USD)']]

const tipoLabel = (v: string | null) => TIPOS.find(([k]) => k === v)?.[1] || v || '—'

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

export default function CarteirasTab() {
  const [carteiras, setCarteiras] = useState<Carteira[]>([])
  const [contas, setContas] = useState<ContaRef[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Carteira | null>(null)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('')
  const [contaBancariaId, setContaBancariaId] = useState('')
  const [moeda, setMoeda] = useState('BRL')
  const [diasLiquidacao, setDiasLiquidacao] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const [dCart, dContas] = await Promise.all([
        jsonFetch('/api/gerenciamento/carteiras', { cache: 'no-store' }),
        jsonFetch('/api/gerenciamento/contas', { cache: 'no-store' }).catch(() => ({ contas: [] })),
      ])
      setCarteiras((dCart as any).carteiras || [])
      setContas((dContas as any).contas || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar as carteiras.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return carteiras
    return carteiras.filter((c) =>
      c.nome.toLowerCase().includes(q) ||
      tipoLabel(c.tipo).toLowerCase().includes(q) ||
      (c.contaBancaria?.nome || '').toLowerCase().includes(q)
    )
  }, [carteiras, busca])

  function abrirNovo() {
    setEditando(null)
    setNome(''); setTipo(''); setContaBancariaId(''); setMoeda('BRL')
    setDiasLiquidacao(''); setIsDefault(false); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(c: Carteira) {
    setEditando(c)
    setNome(c.nome); setTipo(c.tipo || ''); setContaBancariaId(c.contaBancariaId ? String(c.contaBancariaId) : '')
    setMoeda(c.moeda || 'BRL'); setDiasLiquidacao(c.diasLiquidacao != null ? String(c.diasLiquidacao) : '')
    setIsDefault(c.isDefault); setAtivo(c.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!nome.trim()) { setErroModal('Dê um nome à carteira.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        nome: nome.trim(),
        tipo: tipo || null,
        contaBancariaId: contaBancariaId ? Number(contaBancariaId) : null,
        moeda,
        diasLiquidacao: diasLiquidacao === '' ? 0 : Number(diasLiquidacao),
        isDefault,
        ativo,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/carteiras/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/carteiras', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(c: Carteira) {
    if (!confirm(`Excluir a carteira "${c.nome}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/carteiras/${c.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Carteiras de Recebimento</h2>
          <p className="text-sm text-white/50">Onde o cliente paga (Pix, gateway, boleto, transferência).</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova carteira
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar carteira..."
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
          {busca ? 'Nenhuma carteira encontrada.' : 'Nenhuma carteira ainda. Crie a primeira.'}
        </div>
      )}

      {!loading && !erroLista && filtradas.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Carteira</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Conta vinculada</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Moeda</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Liquidação</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{c.nome}</div>
                    <div className="text-[11px] text-white/40">{tipoLabel(c.tipo)}</div>
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{c.contaBancaria?.nome || '—'}</td>
                  <td className="px-4 py-2.5 text-white/70">{c.moeda}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{c.diasLiquidacao != null ? `${c.diasLiquidacao}d` : '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${c.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                        {c.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      {c.isDefault && <span className="rounded px-2 py-0.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-300">Padrão</span>}
                    </div>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar carteira' : 'Nova carteira'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-white/60">Nome</label>
                <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus placeholder="Ex.: Pix Itaú, Stripe, Boleto" className={inputCls} />
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
                  <label className="mb-1 block text-xs text-white/60">Moeda</label>
                  <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className={inputCls}>
                    {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Conta vinculada</label>
                <select value={contaBancariaId} onChange={(e) => setContaBancariaId(e.target.value)} className={inputCls}>
                  <option value="" className="bg-zinc-900">— Nenhuma —</option>
                  {contas.map((c) => <option key={c.id} value={c.id} className="bg-zinc-900">{c.nome}</option>)}
                </select>
                {contas.length === 0 && <p className="mt-1 text-[11px] text-amber-300/70">Cadastre Contas primeiro para vincular.</p>}
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Dias para liquidação</label>
                <input type="number" min="0" step="1" value={diasLiquidacao} onChange={(e) => setDiasLiquidacao(e.target.value)} placeholder="0" className={`${inputCls} max-w-[160px]`} />
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                  Ativo
                </label>
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                  Padrão
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