'use client'

// src/components/gerenciamentoComponents/HonorariosTab.tsx
// Cadastro de Honorarios (tabela Honorario).
// Backend: /api/gerenciamento/honorarios (GET/POST) + /[id] (PUT/DELETE)
// Campos do mockup fin_honorariums: code(req), name(req), honorariumType,
//   serviceId(->Servicos), defaultCurrency, defaultAmount, billingMoment.
// OBS: 'Servico' e texto livre por ora (catalogo de Servicos ainda nao
//   existe; no mockup e select de operational.services -> vira select).

import { useState, useEffect, useMemo, useCallback } from 'react'

type Honorario = {
  id: number
  code: string
  name: string
  tipo: string
  servico: string | null
  moeda: string
  valorPadrao: string | number | null
  momentoCobranca: string
  ativo: boolean
}

const TIPOS: [string, string][] = [
  ['main', 'Principal'], ['rectification', 'Retificação'], ['judicial', 'Judicial'],
  ['administrative', 'Administrativo'], ['extra_requirement', 'Exigência extra'],
  ['success_fee', 'Êxito'], ['protocol', 'Protocolo'], ['consulting', 'Consultoria'],
  ['urgent', 'Urgente'], ['addendum', 'Aditivo'], ['other', 'Outro'],
]
const MOMENTOS: [string, string][] = [
  ['contract_signed', 'Contrato assinado'], ['phase_entered', 'Entrada na fase'],
  ['protocol_created', 'Protocolo criado'], ['process_finalized', 'Processo finalizado'],
  ['manual', 'Manual'],
]
const MOEDAS: [string, string][] = [['EUR', 'Euro (EUR)'], ['BRL', 'Real (BRL)'], ['USD', 'Dólar (USD)']]

const tipoLabel = (v: string) => TIPOS.find(([k]) => k === v)?.[1] || v
const momentoLabel = (v: string) => MOMENTOS.find(([k]) => k === v)?.[1] || v

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

const fmtMoeda = (v: any, moeda: string) => {
  if (v === null || v === undefined || v === '') return '—'
  const simbolo = moeda === 'EUR' ? '€' : moeda === 'USD' ? 'US$' : 'R$'
  return `${simbolo} ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function HonorariosTab() {
  const [honorarios, setHonorarios] = useState<Honorario[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Honorario | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [tipo, setTipo] = useState('main')
  const [servico, setServico] = useState('')
  const [moeda, setMoeda] = useState('EUR')
  const [valorPadrao, setValorPadrao] = useState('')
  const [momentoCobranca, setMomentoCobranca] = useState('contract_signed')
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/honorarios', { cache: 'no-store' })
      setHonorarios((d as any).honorarios || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar os honorários.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return honorarios
    return honorarios.filter((h) =>
      h.code.toLowerCase().includes(q) ||
      h.name.toLowerCase().includes(q) ||
      tipoLabel(h.tipo).toLowerCase().includes(q)
    )
  }, [honorarios, busca])

  function abrirNovo() {
    setEditando(null)
    setCode(''); setName(''); setTipo('main'); setServico(''); setMoeda('EUR')
    setValorPadrao(''); setMomentoCobranca('contract_signed'); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(h: Honorario) {
    setEditando(h)
    setCode(h.code); setName(h.name); setTipo(h.tipo || 'main'); setServico(h.servico || '')
    setMoeda(h.moeda || 'EUR'); setValorPadrao(h.valorPadrao != null ? String(h.valorPadrao) : '')
    setMomentoCobranca(h.momentoCobranca || 'contract_signed'); setAtivo(h.ativo)
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
        tipo,
        servico: servico.trim() || null,
        moeda,
        valorPadrao: valorPadrao === '' ? null : Number(valorPadrao),
        momentoCobranca,
        ativo,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/honorarios/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/honorarios', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(h: Honorario) {
    if (!confirm(`Excluir o honorário "${h.name}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/honorarios/${h.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Honorários</h2>
          <p className="text-sm text-white/50">Honorários principais, retificação, jurídicos e extras.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Novo honorário
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por código, nome ou tipo..."
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
          {busca ? 'Nenhum honorário encontrado.' : 'Nenhum honorário ainda. Crie o primeiro.'}
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
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Valor padrão</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((h) => (
                <tr key={h.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-white/80">{h.code}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{h.name}</div>
                    <div className="text-[11px] text-white/40">{momentoLabel(h.momentoCobranca)}{h.servico ? ` · ${h.servico}` : ''}</div>
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{tipoLabel(h.tipo)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{fmtMoeda(h.valorPadrao, h.moeda)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${h.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                      {h.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(h)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(h)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar honorário' : 'Novo honorário'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Código</label>
                  <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus placeholder="HON-PRINCIPAL" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Tipo</label>
                  <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
                    {TIPOS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Nome</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Honorários principais" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Serviço</label>
                <input value={servico} onChange={(e) => setServico(e.target.value)} placeholder="Ex.: SERV-ITALIA" className={inputCls} />
                <p className="mt-1 text-[11px] text-amber-300/70">Vira seleção quando o catálogo de Serviços for portado.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Moeda</label>
                  <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className={inputCls}>
                    {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Valor padrão</label>
                  <input type="number" min="0" step="0.01" value={valorPadrao} onChange={(e) => setValorPadrao(e.target.value)} placeholder="0,00" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Momento da cobrança</label>
                <select value={momentoCobranca} onChange={(e) => setMomentoCobranca(e.target.value)} className={inputCls}>
                  {MOMENTOS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                </select>
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