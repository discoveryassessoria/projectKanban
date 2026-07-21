'use client'

// src/components/gerenciamentoComponents/FormasPagamentoTab.tsx
// Formas de Pagamento (tabela FormaPagamentoCadastro = fin_methods do mockup).
// CADASTRO DE REFERÊNCIA (métodos aceitos para cobrança) — standalone.
// ⚠ NÃO substitui o enum FormaPagamento usado em Fatura/Pagamento/ContaPagar.
//   Aqueles continuam usando o enum; esta tela é só o registro de métodos.
// O seletor "Moeda" puxa da tabela MoedaCadastro (Moedas).
// Backend: /api/gerenciamento/formas-pagamento (GET/POST) + /[id] (PUT/DELETE)

import { useState, useEffect, useMemo, useCallback } from 'react'

type MoedaRef = { id: number; code: string; name: string | null }
type Forma = {
  id: number
  code: string | null
  name: string
  type: string | null
  moeda: string | null
  permiteParcelas: boolean
  maxParcelas: number | null
  ativo: boolean
  ordem: number
  icone: string | null
  aceitaEntrada: boolean
  aceitaRecorrencia: boolean
  aceitaMoedaEstrangeira: boolean
  observacoes: string | null
}

// Tipos do mockup (fin_methods.type) com rótulos amigáveis
const TIPOS: [string, string][] = [
  ['pix', 'PIX'], ['bank_transfer', 'Transferência bancária'], ['boleto', 'Boleto'],
  ['credit_card', 'Cartão de crédito'], ['debit_card', 'Cartão de débito'], ['cash', 'Dinheiro'],
  ['international_transfer', 'Transferência internacional'], ['payment_link', 'Link de pagamento'],
  ['paypal', 'PayPal'], ['wise', 'Wise'], ['other', 'Outro'],
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

export default function FormasPagamentoTab() {
  const [itens, setItens] = useState<Forma[]>([])
  const [moedas, setMoedas] = useState<MoedaRef[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Forma | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [moeda, setMoeda] = useState('')
  const [permiteParcelas, setPermiteParcelas] = useState(false)
  const [maxParcelas, setMaxParcelas] = useState('')
  // capacidades do MEIO — sem regra de parcelamento (isso é da Condição)
  const [ativo, setAtivo] = useState(true)
  const [ordem, setOrdem] = useState('0')
  const [icone, setIcone] = useState('')
  const [aceitaEntrada, setAceitaEntrada] = useState(false)
  const [aceitaRecorrencia, setAceitaRecorrencia] = useState(false)
  const [aceitaMoedaEstrangeira, setAceitaMoedaEstrangeira] = useState(false)
  const [observacoes, setObservacoes] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/formas-pagamento', { cache: 'no-store' })
      setItens((d as any).formasPagamento || [])
      setMoedas((d as any).moedas || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar as formas de pagamento.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return itens
    return itens.filter((f) =>
      f.name.toLowerCase().includes(q) || (f.code || '').toLowerCase().includes(q)
    )
  }, [itens, busca])

  function abrirNovo() {
    setEditando(null)
    setCode(''); setName(''); setType(''); setMoeda(''); setPermiteParcelas(false); setMaxParcelas('')
    setAtivo(true); setOrdem('0'); setIcone(''); setAceitaEntrada(false)
    setAceitaRecorrencia(false); setAceitaMoedaEstrangeira(false); setObservacoes('')
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(f: Forma) {
    setEditando(f)
    setCode(f.code || ''); setName(f.name); setType(f.type || ''); setMoeda(f.moeda || '')
    setPermiteParcelas(f.permiteParcelas); setMaxParcelas(f.maxParcelas != null ? String(f.maxParcelas) : '')
    setAtivo(f.ativo ?? true); setOrdem(String(f.ordem ?? 0)); setIcone(f.icone || '')
    setAceitaEntrada(!!f.aceitaEntrada); setAceitaRecorrencia(!!f.aceitaRecorrencia)
    setAceitaMoedaEstrangeira(!!f.aceitaMoedaEstrangeira); setObservacoes(f.observacoes || '')
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!name.trim()) { setErroModal('Informe o nome.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        code: code.trim() || null,
        name: name.trim(),
        type: type || null,
        moeda: moeda || null,
        permiteParcelas,
        maxParcelas: permiteParcelas ? (maxParcelas === '' ? null : Number(maxParcelas)) : null,
        ativo,
        ordem: ordem === '' ? 0 : Number(ordem),
        icone: icone.trim() || null,
        aceitaEntrada,
        aceitaRecorrencia,
        aceitaMoedaEstrangeira,
        observacoes: observacoes.trim() || null,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/formas-pagamento/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/formas-pagamento', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(f: Forma) {
    if (!confirm(`Excluir a forma de pagamento "${f.name}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/formas-pagamento/${f.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Formas de Pagamento</h2>
          <p className="text-sm text-white/50">Métodos aceitos para cobrança.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova forma
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar forma de pagamento..."
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
          {busca ? 'Nenhuma forma encontrada.' : 'Nenhuma forma de pagamento ainda. Crie a primeira.'}
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
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Moeda</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Parcela</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((f) => (
                <tr key={f.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-white/80">{f.code || '—'}</td>
                  <td className="px-4 py-2.5 font-medium text-white">{f.name}</td>
                  <td className="px-4 py-2.5 text-white/70">{tipoLabel(f.type)}</td>
                  <td className="px-4 py-2.5 text-white/70">{f.moeda || '—'}</td>
                  <td className="px-4 py-2.5 text-white/70">
                    {f.permiteParcelas ? (f.maxParcelas ? `até ${f.maxParcelas}×` : 'Sim') : '—'}
                    <div className="text-[11px] text-white/40">
                      {[f.aceitaEntrada ? 'entrada' : null, f.aceitaRecorrencia ? 'recorrência' : null, f.aceitaMoedaEstrangeira ? 'moeda estrangeira' : null].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(f)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(f)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar forma de pagamento' : 'Nova forma de pagamento'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Código</label>
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PIX-BR" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Nome *</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Pix" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Tipo</label>
                  <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— selecione —</option>
                    {TIPOS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Moeda</label>
                  <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— selecione —</option>
                    {moedas.map((m) => <option key={m.id} value={m.code} className="bg-zinc-900">{m.code}{m.name ? ` — ${m.name}` : ''}</option>)}
                  </select>
                  {moedas.length === 0 && <p className="mt-1 text-[11px] text-amber-300/70">Cadastre moedas em "Moedas" para escolher aqui.</p>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={permiteParcelas} onChange={(e) => { setPermiteParcelas(e.target.checked); if (!e.target.checked) setMaxParcelas('') }} className="h-4 w-4 accent-blue-500" />
                  Permite parcelas
                </label>
                {permiteParcelas && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-white/60">Máx. parcelas</label>
                    <input type="number" min="1" value={maxParcelas} onChange={(e) => setMaxParcelas(e.target.value)} placeholder="12" className="w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20" />
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 pt-4">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/40">Capacidades do meio</div>
                <div className="mb-3 text-[11px] text-white/30">
                  Só o que o MEIO suporta. Entrada, quantidade de parcelas e cronograma pertencem à Condição de Pagamento.
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Ícone</label>
                    <input value={icone} onChange={(e) => setIcone(e.target.value)} placeholder="💳" maxLength={8} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Ordem de exibição</label>
                    <input type="number" value={ordem} onChange={(e) => setOrdem(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20" />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={aceitaEntrada} onChange={(e) => setAceitaEntrada(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Aceita entrada
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={aceitaRecorrencia} onChange={(e) => setAceitaRecorrencia(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Aceita recorrência
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={aceitaMoedaEstrangeira} onChange={(e) => setAceitaMoedaEstrangeira(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Aceita moeda estrangeira
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Ativo
                  </label>
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-xs text-white/60">Observações</label>
                  <textarea rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20" />
                </div>
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