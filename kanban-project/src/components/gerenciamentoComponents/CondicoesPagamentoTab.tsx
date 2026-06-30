'use client'

// src/components/gerenciamentoComponents/CondicoesPagamentoTab.tsx
// Cadastro de Condicoes de Pagamento (tabela CondicaoPagamento).
// Backend: /api/gerenciamento/condicoes-pagamento (GET/POST) + /[id] (PUT/DELETE)
// Campos do mockup fin_paycond: name(req), currency, paymentMethodId,
//   receivingWalletId(->Carteira), entryEnabled, entryPercent,
//   installments, dueDay, applyPaymentFees.
// OBS: 'Forma de pagamento' usa o enum FormaPagamento existente (stand-in
//   do catalogo paymentMethods do mockup). O GET ja traz { condicoes, carteiras }.

import { useState, useEffect, useMemo, useCallback } from 'react'

type CarteiraRef = { id: number; nome: string }
type Condicao = {
  id: number
  name: string
  moeda: string
  formaPagamento: string | null
  carteiraId: number | null
  temEntrada: boolean
  percentEntrada: string | number | null
  parcelas: number
  diaVencimento: number | null
  aplicarTaxas: boolean
  ativo: boolean
  carteira?: CarteiraRef | null
}

const MOEDAS: [string, string][] = [['BRL', 'Real (BRL)'], ['EUR', 'Euro (EUR)'], ['USD', 'Dólar (USD)']]
const FORMAS: [string, string][] = [
  ['PIX', 'Pix'], ['CARTAO_CREDITO', 'Cartão de crédito'], ['CARTAO_DEBITO', 'Cartão de débito'],
  ['BOLETO', 'Boleto'], ['TRANSFERENCIA', 'Transferência'], ['DINHEIRO', 'Dinheiro'],
  ['CHEQUE', 'Cheque'], ['OUTRO', 'Outro'],
]
const formaLabel = (v: string | null) => FORMAS.find(([k]) => k === v)?.[1] || '—'

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

export default function CondicoesPagamentoTab() {
  const [condicoes, setCondicoes] = useState<Condicao[]>([])
  const [carteiras, setCarteiras] = useState<CarteiraRef[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Condicao | null>(null)
  const [name, setName] = useState('')
  const [moeda, setMoeda] = useState('BRL')
  const [formaPagamento, setFormaPagamento] = useState('')
  const [carteiraId, setCarteiraId] = useState('')
  const [temEntrada, setTemEntrada] = useState(false)
  const [percentEntrada, setPercentEntrada] = useState('')
  const [parcelas, setParcelas] = useState('1')
  const [diaVencimento, setDiaVencimento] = useState('')
  const [aplicarTaxas, setAplicarTaxas] = useState(false)
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/condicoes-pagamento', { cache: 'no-store' })
      setCondicoes((d as any).condicoes || [])
      setCarteiras((d as any).carteiras || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar as condições.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return condicoes
    return condicoes.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.carteira?.nome || '').toLowerCase().includes(q)
    )
  }, [condicoes, busca])

  function abrirNovo() {
    setEditando(null)
    setName(''); setMoeda('BRL'); setFormaPagamento(''); setCarteiraId('')
    setTemEntrada(false); setPercentEntrada(''); setParcelas('1'); setDiaVencimento('')
    setAplicarTaxas(false); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(c: Condicao) {
    setEditando(c)
    setName(c.name); setMoeda(c.moeda || 'BRL'); setFormaPagamento(c.formaPagamento || '')
    setCarteiraId(c.carteiraId ? String(c.carteiraId) : '')
    setTemEntrada(c.temEntrada); setPercentEntrada(c.percentEntrada != null ? String(c.percentEntrada) : '')
    setParcelas(c.parcelas != null ? String(c.parcelas) : '1')
    setDiaVencimento(c.diaVencimento != null ? String(c.diaVencimento) : '')
    setAplicarTaxas(c.aplicarTaxas); setAtivo(c.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!name.trim()) { setErroModal('Dê um nome à condição.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        name: name.trim(),
        moeda,
        formaPagamento: formaPagamento || null,
        carteiraId: carteiraId ? Number(carteiraId) : null,
        temEntrada,
        percentEntrada: percentEntrada === '' ? null : Number(percentEntrada),
        parcelas: parcelas === '' ? 1 : Number(parcelas),
        diaVencimento: diaVencimento === '' ? null : Number(diaVencimento),
        aplicarTaxas,
        ativo,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/condicoes-pagamento/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/condicoes-pagamento', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(c: Condicao) {
    if (!confirm(`Excluir a condição "${c.name}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/condicoes-pagamento/${c.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Condições de Pagamento</h2>
          <p className="text-sm text-white/50">Entrada, parcelas, vencimento e carteira de recebimento.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova condição
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar condição..."
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
          {busca ? 'Nenhuma condição encontrada.' : 'Nenhuma condição ainda. Crie a primeira.'}
        </div>
      )}

      {!loading && !erroLista && filtradas.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Condição</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Moeda</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Forma</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Carteira</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Parcelas</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{c.name}</div>
                    <div className="text-[11px] text-white/40">
                      {c.temEntrada ? `Entrada${c.percentEntrada != null ? ` ${Number(c.percentEntrada)}%` : ''}` : 'Sem entrada'}
                      {c.aplicarTaxas ? ' · aplica taxas' : ''}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{c.moeda}</td>
                  <td className="px-4 py-2.5 text-white/70">{formaLabel(c.formaPagamento)}</td>
                  <td className="px-4 py-2.5 text-white/70">{c.carteira?.nome || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{c.parcelas}x</td>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar condição' : 'Nova condição'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-white/60">Nome</label>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Ex.: À vista, 3x sem juros, 50% entrada" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Moeda</label>
                  <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className={inputCls}>
                    {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Forma de pagamento</label>
                  <select value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">—</option>
                    {FORMAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Carteira de recebimento</label>
                <select value={carteiraId} onChange={(e) => setCarteiraId(e.target.value)} className={inputCls}>
                  <option value="" className="bg-zinc-900">— Nenhuma —</option>
                  {carteiras.map((c) => <option key={c.id} value={c.id} className="bg-zinc-900">{c.nome}</option>)}
                </select>
                {carteiras.length === 0 && <p className="mt-1 text-[11px] text-amber-300/70">Cadastre Carteiras primeiro para vincular.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Parcelas</label>
                  <input type="number" min="1" step="1" value={parcelas} onChange={(e) => setParcelas(e.target.value)} placeholder="1" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Dia de vencimento</label>
                  <input type="number" min="1" max="31" step="1" value={diaVencimento} onChange={(e) => setDiaVencimento(e.target.value)} placeholder="—" className={inputCls} />
                </div>
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 text-sm text-white/80 pb-2">
                  <input type="checkbox" checked={temEntrada} onChange={(e) => setTemEntrada(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                  Tem entrada
                </label>
                {temEntrada && (
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-white/60">% entrada</label>
                    <input type="number" min="0" max="100" step="0.01" value={percentEntrada} onChange={(e) => setPercentEntrada(e.target.value)} placeholder="0" className={inputCls} />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={aplicarTaxas} onChange={(e) => setAplicarTaxas(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                  Aplicar taxas de pagamento
                </label>
                <label className="flex items-center gap-2 text-sm text-white/80">
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