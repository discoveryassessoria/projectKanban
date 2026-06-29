'use client'

// src/components/gerenciamentoComponents/ContasTab.tsx
// Cadastro REAL de Contas Bancárias (tabela ContaBancaria) — IGUAL ao mockup.
// Backend: /api/gerenciamento/contas (GET/POST) + /[id] (PUT/DELETE)
// Campos do mockup: nome, bankId(→Banco), tipoConta, moeda, agencia,
//   conta(número), iban, swift, chavePix, isDefaultReceiving, isDefaultPayment
//   + saldoInicial e cor (mantidos). Saldo atual é mantido pelos lançamentos.
// Bancos vêm de /api/gerenciamento/bancos (select).

import { useState, useEffect, useMemo, useCallback } from 'react'

type Banco = { id: number; nome: string; sigla: string | null }
type Conta = {
  id: number
  nome: string
  bankId: number | null
  tipoConta: string | null
  moeda: string
  agencia: string | null
  conta: string | null
  iban: string | null
  swift: string | null
  chavePix: string | null
  saldoInicial: string | number
  saldoAtual: string | number
  cor: string | null
  ativo: boolean
  isDefaultReceiving: boolean
  isDefaultPayment: boolean
  bank?: Banco | null
  _count?: { contasPagar: number; transacoes: number }
}

const CORES = ['#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6', '#10B981', '#EC4899', '#14B8A6', '#6366F1']
const TIPOS_CONTA: [string, string][] = [
  ['checking', 'Conta corrente'],
  ['savings', 'Poupança'],
  ['digital', 'Conta digital'],
  ['international', 'Conta internacional'],
  ['cash', 'Dinheiro / Caixa'],
  ['payment_gateway', 'Gateway de pagamento'],
  ['wallet', 'Carteira'],
]
const MOEDAS: [string, string][] = [['BRL', 'Real (BRL)'], ['EUR', 'Euro (EUR)'], ['USD', 'Dólar (USD)']]

const tipoLabel = (v: string | null) => TIPOS_CONTA.find(([k]) => k === v)?.[1] || v || '—'
const fmtMoney = (v: string | number, moeda?: string) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL' })

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

// Cabeçalho de seção do formulário
function Secao({ titulo, children, primeira }: { titulo: string; children: React.ReactNode; primeira?: boolean }) {
  return (
    <div className={primeira ? '' : 'border-t border-white/10 pt-4'}>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-white/40">{titulo}</div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

export default function ContasTab() {
  const [contas, setContas] = useState<Conta[]>([])
  const [bancos, setBancos] = useState<Banco[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  // modal
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Conta | null>(null)
  const [nome, setNome] = useState('')
  const [bankId, setBankId] = useState('')
  const [tipoConta, setTipoConta] = useState('')
  const [moeda, setMoeda] = useState('BRL')
  const [agencia, setAgencia] = useState('')
  const [conta, setConta] = useState('')
  const [iban, setIban] = useState('')
  const [swift, setSwift] = useState('')
  const [chavePix, setChavePix] = useState('')
  const [saldoInicial, setSaldoInicial] = useState('')
  const [cor, setCor] = useState(CORES[2])
  const [ativo, setAtivo] = useState(true)
  const [isDefaultReceiving, setIsDefaultReceiving] = useState(false)
  const [isDefaultPayment, setIsDefaultPayment] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const [dataContas, dataBancos] = await Promise.all([
        jsonFetch('/api/gerenciamento/contas', { cache: 'no-store' }),
        jsonFetch('/api/gerenciamento/bancos', { cache: 'no-store' }).catch(() => ({ bancos: [] })),
      ])
      setContas((dataContas as any).contas || [])
      setBancos((dataBancos as any).bancos || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar as contas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return contas
    return contas.filter((c) =>
      c.nome.toLowerCase().includes(q) ||
      (c.bank?.nome || '').toLowerCase().includes(q)
    )
  }, [contas, busca])

  function abrirNovo() {
    setEditando(null)
    setNome(''); setBankId(''); setTipoConta(''); setMoeda('BRL'); setAgencia(''); setConta('')
    setIban(''); setSwift(''); setChavePix(''); setSaldoInicial(''); setCor(CORES[2])
    setAtivo(true); setIsDefaultReceiving(false); setIsDefaultPayment(false)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(c: Conta) {
    setEditando(c)
    setNome(c.nome); setBankId(c.bankId ? String(c.bankId) : ''); setTipoConta(c.tipoConta || '')
    setMoeda(c.moeda || 'BRL'); setAgencia(c.agencia || ''); setConta(c.conta || '')
    setIban(c.iban || ''); setSwift(c.swift || ''); setChavePix(c.chavePix || '')
    setSaldoInicial(String(c.saldoInicial ?? '')); setCor(c.cor || CORES[2])
    setAtivo(c.ativo); setIsDefaultReceiving(c.isDefaultReceiving); setIsDefaultPayment(c.isDefaultPayment)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!nome.trim()) { setErroModal('Dê um nome à conta.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        nome: nome.trim(),
        bankId: bankId ? Number(bankId) : null,
        tipoConta: tipoConta || null,
        moeda,
        agencia: agencia.trim() || null,
        conta: conta.trim() || null,
        iban: iban.trim() || null,
        swift: swift.trim() || null,
        chavePix: chavePix.trim() || null,
        saldoInicial: saldoInicial === '' ? 0 : Number(saldoInicial),
        cor,
        ativo,
        isDefaultReceiving,
        isDefaultPayment,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/contas/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/contas', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(c: Conta) {
    if (!confirm(`Excluir a conta "${c.nome}"? Esta ação não pode ser desfeita.`)) return
    try {
      await jsonFetch(`/api/gerenciamento/contas/${c.id}`, { method: 'DELETE' })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Contas Bancárias</h2>
          <p className="text-sm text-white/50">Contas da empresa para recebimento e pagamento.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova conta
        </button>
      </div>

      {/* Busca */}
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar conta..."
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

      {!loading && !erroLista && filtradas.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca ? 'Nenhuma conta encontrada.' : 'Nenhuma conta ainda. Crie a primeira.'}
        </div>
      )}

      {/* Tabela */}
      {!loading && !erroLista && filtradas.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Conta</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Tipo / Moeda</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Saldo atual</th>
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
                      <div>
                        <div className="font-medium text-white">{c.nome}</div>
                        <div className="text-[11px] text-white/40">
                          {c.bank?.nome || 'Sem banco'}
                          {c.agencia ? ` · Ag. ${c.agencia}` : ''}{c.conta ? ` · ${c.conta}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-white/70">
                    {tipoLabel(c.tipoConta)}<span className="text-white/40"> · {c.moeda}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-white">{fmtMoney(c.saldoAtual, c.moeda)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${c.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                        {c.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      {c.isDefaultReceiving && <span className="rounded px-2 py-0.5 text-[11px] font-medium bg-emerald-500/15 text-emerald-300">Receb. padrão</span>}
                      {c.isDefaultPayment && <span className="rounded px-2 py-0.5 text-[11px] font-medium bg-blue-500/15 text-blue-300">Pgto. padrão</span>}
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

      {/* Modal */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar conta' : 'Nova conta'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="max-h-[72vh] space-y-5 overflow-y-auto px-6 py-5">
              {/* Identificação */}
              <Secao titulo="Identificação" primeira>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Nome da conta</label>
                  <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus placeholder="Ex.: Itaú PJ, Caixa, Wise EUR" className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Banco</label>
                    <select value={bankId} onChange={(e) => setBankId(e.target.value)} className={inputCls}>
                      <option value="" className="bg-zinc-900">— Nenhum —</option>
                      {bancos.map((b) => <option key={b.id} value={b.id} className="bg-zinc-900">{b.nome}{b.sigla ? ` (${b.sigla})` : ''}</option>)}
                    </select>
                    {bancos.length === 0 && <p className="mt-1 text-[11px] text-amber-300/70">Cadastre Bancos primeiro para vincular.</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Tipo</label>
                    <select value={tipoConta} onChange={(e) => setTipoConta(e.target.value)} className={inputCls}>
                      <option value="" className="bg-zinc-900">—</option>
                      {TIPOS_CONTA.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Moeda</label>
                    <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className={inputCls}>
                      {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Cor</label>
                    <div className="flex items-center gap-1.5 pt-1">
                      {CORES.map((c) => (
                        <button key={c} type="button" onClick={() => setCor(c)} className={`h-6 w-6 rounded-full transition ${cor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : ''}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                </div>
              </Secao>

              {/* Dados bancários */}
              <Secao titulo="Dados bancários">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Agência</label>
                    <input value={agencia} onChange={(e) => setAgencia(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Número da conta</label>
                    <input value={conta} onChange={(e) => setConta(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Chave Pix</label>
                  <input value={chavePix} onChange={(e) => setChavePix(e.target.value)} className={inputCls} />
                </div>
              </Secao>

              {/* Internacional */}
              <Secao titulo="Internacional">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">IBAN</label>
                    <input value={iban} onChange={(e) => setIban(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">SWIFT / BIC</label>
                    <input value={swift} onChange={(e) => setSwift(e.target.value)} className={inputCls} />
                  </div>
                </div>
              </Secao>

              {/* Configurações */}
              <Secao titulo="Configurações">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Saldo inicial</label>
                  <input type="number" step="0.01" value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} placeholder="0,00" className={`${inputCls} max-w-[200px]`} />
                  {editando && (
                    <p className="mt-1 text-[11px] text-white/40">Saldo atual ({fmtMoney(editando.saldoAtual, editando.moeda)}) é atualizado pelos lançamentos.</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Ativo
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={isDefaultReceiving} onChange={(e) => setIsDefaultReceiving(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Padrão recebimento
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={isDefaultPayment} onChange={(e) => setIsDefaultPayment(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Padrão pagamento
                  </label>
                </div>
              </Secao>

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