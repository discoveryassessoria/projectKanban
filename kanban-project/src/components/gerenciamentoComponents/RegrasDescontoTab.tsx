'use client'

// src/components/gerenciamentoComponents/RegrasDescontoTab.tsx
// Cadastro de Regras de Desconto (tabela RegraDesconto).
// Backend: /api/gerenciamento/regras-desconto (GET/POST) + /[id] (PUT/DELETE)
// Campos do mockup fin_disc: name(req), maxPercentWithoutApproval,
//   maxAmountWithoutApproval, requiresApprovalAboveLimit.

import { useState, useEffect, useMemo, useCallback } from 'react'

type Regra = {
  id: number
  name: string
  maxPercentSemAprovacao: string | number | null
  maxValorSemAprovacao: string | number | null
  exigeAprovacaoAcima: boolean
  ativo: boolean
}

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

const fmtPct = (v: any) => (v === null || v === undefined || v === '' ? '—' : `${Number(v)}%`)
const fmtNum = (v: any) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export default function RegrasDescontoTab() {
  const [regras, setRegras] = useState<Regra[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Regra | null>(null)
  const [name, setName] = useState('')
  const [maxPercent, setMaxPercent] = useState('')
  const [maxValor, setMaxValor] = useState('')
  const [exige, setExige] = useState(true)
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/regras-desconto', { cache: 'no-store' })
      setRegras((d as any).regras || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar as regras.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return regras
    return regras.filter((r) => r.name.toLowerCase().includes(q))
  }, [regras, busca])

  function abrirNovo() {
    setEditando(null)
    setName(''); setMaxPercent(''); setMaxValor(''); setExige(true); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(r: Regra) {
    setEditando(r)
    setName(r.name)
    setMaxPercent(r.maxPercentSemAprovacao != null ? String(r.maxPercentSemAprovacao) : '')
    setMaxValor(r.maxValorSemAprovacao != null ? String(r.maxValorSemAprovacao) : '')
    setExige(r.exigeAprovacaoAcima); setAtivo(r.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!name.trim()) { setErroModal('Dê um nome à regra.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        name: name.trim(),
        maxPercentSemAprovacao: maxPercent === '' ? null : Number(maxPercent),
        maxValorSemAprovacao: maxValor === '' ? null : Number(maxValor),
        exigeAprovacaoAcima: exige,
        ativo,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/regras-desconto/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/regras-desconto', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(r: Regra) {
    if (!confirm(`Excluir a regra "${r.name}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/regras-desconto/${r.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Regras de Desconto</h2>
          <p className="text-sm text-white/50">Limites de desconto e quando exigir aprovação.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova regra
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar regra..."
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
          {busca ? 'Nenhuma regra encontrada.' : 'Nenhuma regra ainda. Crie a primeira.'}
        </div>
      )}

      {!loading && !erroLista && filtradas.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Regra</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">% máx s/ aprovação</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Valor máx s/ aprovação</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((r) => (
                <tr key={r.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{r.name}</div>
                    <div className="text-[11px] text-white/40">{r.exigeAprovacaoAcima ? 'Exige aprovação acima do limite' : 'Sem aprovação obrigatória'}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{fmtPct(r.maxPercentSemAprovacao)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{fmtNum(r.maxValorSemAprovacao)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${r.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                      {r.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(r)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(r)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar regra' : 'Nova regra'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-white/60">Nome</label>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Ex.: Desconto comercial padrão" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">% máx s/ aprovação</label>
                  <input type="number" min="0" step="0.01" value={maxPercent} onChange={(e) => setMaxPercent(e.target.value)} placeholder="0" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Valor máx s/ aprovação</label>
                  <input type="number" min="0" step="0.01" value={maxValor} onChange={(e) => setMaxValor(e.target.value)} placeholder="0,00" className={inputCls} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={exige} onChange={(e) => setExige(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                  Exige aprovação acima do limite
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