'use client'

// src/components/gerenciamentoComponents/TaxasPagamentoTab.tsx
// Taxas de Pagamento (tabela TaxaPagamento = fin_fees do mockup).
// Taxas de cartão, antecipação, gateway, boleto — standalone.
// Seletores: "Forma de pagamento" puxa de FormaPagamentoCadastro; "Moeda" de MoedaCadastro.
// Backend: /api/gerenciamento/taxas-pagamento (GET/POST) + /[id] (PUT/DELETE)

import { useState, useEffect, useMemo, useCallback } from 'react'

type FormaRef = { id: number; name: string }
type MoedaRef = { id: number; code: string; name: string | null }
type Taxa = {
  id: number
  code: string | null
  name: string
  formaPagamentoId: number | null
  moeda: string | null
  feeType: string | null
  feePercent: string | number | null
  fixedFee: string | number | null
  anticipationEnabled: boolean
  anticipationPercent: string | number | null
  installmentsFrom: number | null
  installmentsTo: number | null
}

// Tipos de taxa do mockup (fin_fees.feeType) com rótulos PT
const TIPOS: [string, string][] = [
  ['percentage', 'Percentual'], ['fixed', 'Fixo'], ['percentage_plus_fixed', 'Percentual + fixo'],
  ['installment_based', 'Por parcela'], ['custom', 'Personalizado'],
]
const tipoLabel = (v: string | null) => (v ? (TIPOS.find(([k]) => k === v)?.[1] || v) : '—')

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

export default function TaxasPagamentoTab() {
  const [itens, setItens] = useState<Taxa[]>([])
  const [formas, setFormas] = useState<FormaRef[]>([])
  const [moedas, setMoedas] = useState<MoedaRef[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Taxa | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [formaPagamentoId, setFormaPagamentoId] = useState('')
  const [moeda, setMoeda] = useState('')
  const [feeType, setFeeType] = useState('')
  const [feePercent, setFeePercent] = useState('')
  const [fixedFee, setFixedFee] = useState('')
  const [anticipationEnabled, setAnticipationEnabled] = useState(false)
  const [anticipationPercent, setAnticipationPercent] = useState('')
  const [installmentsFrom, setInstallmentsFrom] = useState('')
  const [installmentsTo, setInstallmentsTo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/taxas-pagamento', { cache: 'no-store' })
      setItens((d as any).taxas || [])
      setFormas((d as any).formasPagamento || [])
      setMoedas((d as any).moedas || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar as taxas de pagamento.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const formaNome = useCallback((id: number | null) => {
    if (id == null) return '—'
    return formas.find((f) => f.id === id)?.name || '—'
  }, [formas])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return itens
    return itens.filter((t) =>
      t.name.toLowerCase().includes(q) || (t.code || '').toLowerCase().includes(q)
    )
  }, [itens, busca])

  function abrirNovo() {
    setEditando(null)
    setCode(''); setName(''); setFormaPagamentoId(''); setMoeda(''); setFeeType('')
    setFeePercent(''); setFixedFee(''); setAnticipationEnabled(false); setAnticipationPercent('')
    setInstallmentsFrom(''); setInstallmentsTo('')
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(t: Taxa) {
    setEditando(t)
    setCode(t.code || ''); setName(t.name)
    setFormaPagamentoId(t.formaPagamentoId != null ? String(t.formaPagamentoId) : '')
    setMoeda(t.moeda || ''); setFeeType(t.feeType || '')
    setFeePercent(t.feePercent != null ? String(t.feePercent) : '')
    setFixedFee(t.fixedFee != null ? String(t.fixedFee) : '')
    setAnticipationEnabled(t.anticipationEnabled)
    setAnticipationPercent(t.anticipationPercent != null ? String(t.anticipationPercent) : '')
    setInstallmentsFrom(t.installmentsFrom != null ? String(t.installmentsFrom) : '')
    setInstallmentsTo(t.installmentsTo != null ? String(t.installmentsTo) : '')
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!name.trim()) { setErroModal('Informe o nome.'); return }
    setSalvando(true); setErroModal(null)
    const num = (v: string) => (v === '' ? null : Number(v))
    try {
      const body = JSON.stringify({
        code: code.trim() || null,
        name: name.trim(),
        formaPagamentoId: formaPagamentoId ? Number(formaPagamentoId) : null,
        moeda: moeda || null,
        feeType: feeType || null,
        feePercent: num(feePercent),
        fixedFee: num(fixedFee),
        anticipationEnabled,
        anticipationPercent: anticipationEnabled ? num(anticipationPercent) : null,
        installmentsFrom: num(installmentsFrom),
        installmentsTo: num(installmentsTo),
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/taxas-pagamento/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/taxas-pagamento', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(t: Taxa) {
    if (!confirm(`Excluir a taxa "${t.name}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/taxas-pagamento/${t.id}`, { method: 'DELETE' })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'
  const fmtPct = (v: any) => (v === null || v === undefined || v === '' ? '—' : `${Number(v)}%`)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Taxas de Pagamento</h2>
          <p className="text-sm text-white/50">Taxas de cartão, antecipação, gateway, boleto.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova taxa
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar taxa..."
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
          {busca ? 'Nenhuma taxa encontrada.' : 'Nenhuma taxa ainda. Crie a primeira.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Código</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Nome</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Tipo</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">%</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Moeda</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((t) => (
                <tr key={t.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-white/80">{t.code || '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{t.name}</div>
                    {t.formaPagamentoId != null && (
                      <div className="text-[11px] text-white/40">{formaNome(t.formaPagamentoId)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{tipoLabel(t.feeType)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{fmtPct(t.feePercent)}</td>
                  <td className="px-4 py-2.5 text-white/70">{t.moeda || '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(t)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(t)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar taxa' : 'Nova taxa'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Código</label>
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="TAX-CARD" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Nome *</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Taxa cartão de crédito" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Forma de pagamento</label>
                  <select value={formaPagamentoId} onChange={(e) => setFormaPagamentoId(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— nenhuma —</option>
                    {formas.map((f) => <option key={f.id} value={f.id} className="bg-zinc-900">{f.name}</option>)}
                  </select>
                  {formas.length === 0 && <p className="mt-1 text-[11px] text-amber-300/70">Cadastre Formas de Pagamento para escolher aqui.</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Moeda</label>
                  <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— selecione —</option>
                    {moedas.map((m) => <option key={m.id} value={m.code} className="bg-zinc-900">{m.code}{m.name ? ` — ${m.name}` : ''}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Tipo</label>
                  <select value={feeType} onChange={(e) => setFeeType(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— selecione —</option>
                    {TIPOS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">% taxa</label>
                  <input type="number" step="0.01" value={feePercent} onChange={(e) => setFeePercent(e.target.value)} placeholder="2,99" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Taxa fixa</label>
                  <input type="number" step="0.01" value={fixedFee} onChange={(e) => setFixedFee(e.target.value)} placeholder="0,00" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Parcela de</label>
                  <input type="number" min="1" value={installmentsFrom} onChange={(e) => setInstallmentsFrom(e.target.value)} placeholder="1" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Parcela até</label>
                  <input type="number" min="1" value={installmentsTo} onChange={(e) => setInstallmentsTo(e.target.value)} placeholder="12" className={inputCls} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={anticipationEnabled} onChange={(e) => { setAnticipationEnabled(e.target.checked); if (!e.target.checked) setAnticipationPercent('') }} className="h-4 w-4 accent-blue-500" />
                  Antecipação
                </label>
                {anticipationEnabled && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-white/60">% antecipação</label>
                    <input type="number" step="0.01" value={anticipationPercent} onChange={(e) => setAnticipationPercent(e.target.value)} placeholder="1,99" className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20" />
                  </div>
                )}
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