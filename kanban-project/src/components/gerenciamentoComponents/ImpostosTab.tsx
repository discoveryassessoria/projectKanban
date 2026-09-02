'use client'

// src/components/gerenciamentoComponents/ImpostosTab.tsx
// Cadastro de Impostos (tabela Imposto).
// Backend: /api/gerenciamento/impostos (GET/POST) + /[id] (PUT/DELETE)
//   GET -> { impostos: [...] }
//   body { codigo, nome, tipo, modoCalculo, percentual, valorFixo, aplicaA, ativo }

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useApi } from "@/src/lib/dados"

type Imposto = {
  id: number
  codigo: string | null
  nome: string
  tipo: string | null
  modoCalculo: string | null
  percentual: string | number | null
  valorFixo: string | number | null
  aplicaA: string | null
  ativo: boolean
}

const TIPOS: [string, string][] = [
  ['municipal', 'Municipal'],
  ['federal', 'Federal'],
  ['state', 'Estadual'],
  ['international', 'Internacional'],
  ['service_tax', 'ISS / Serviço'],
  ['withholding', 'Retenção'],
  ['other', 'Outro'],
]
const MODOS: [string, string][] = [['percentage', 'Percentual'], ['fixed', 'Valor fixo']]
const APLICA: [string, string][] = [['revenue', 'Receita'], ['cost', 'Custo'], ['service', 'Serviço']]

const lbl = (arr: [string, string][], v: string | null) => arr.find(([k]) => k === v)?.[1] || v || '—'
const brl = (v: any) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

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

export default function ImpostosTab() {
  const [impostos, setImpostos] = useState<Imposto[]>([])
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Imposto | null>(null)
  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('')
  const [modoCalculo, setModoCalculo] = useState('percentage')
  const [percentual, setPercentual] = useState('')
  const [valorFixo, setValorFixo] = useState('')
  const [aplicaA, setAplicaA] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  // Consulta em cache pela camada oficial (src/lib/dados): loading, erro,
  // deduplicação e revalidação vêm dela. Some o par useState + useEffect de
  // montagem, que era a origem do setState-em-efeito.
  const { dados, carregando: loading, erro, recarregar: carregar } = useApi<{ impostos?: Imposto[] }>('/api/gerenciamento/impostos')
  const itens: Imposto[] = dados?.impostos ?? SEM_ITENS
  const erroLista = erro ? (erro.message || 'Não foi possível carregar os impostos.') : null

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return impostos
    return impostos.filter((i) =>
      i.nome.toLowerCase().includes(q) ||
      (i.codigo || '').toLowerCase().includes(q) ||
      lbl(TIPOS, i.tipo).toLowerCase().includes(q)
    )
  }, [impostos, busca])

  function abrirNovo() {
    setEditando(null)
    setCodigo(''); setNome(''); setTipo(''); setModoCalculo('percentage')
    setPercentual(''); setValorFixo(''); setAplicaA(''); setAtivo(true)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(i: Imposto) {
    setEditando(i)
    setCodigo(i.codigo || ''); setNome(i.nome); setTipo(i.tipo || '')
    setModoCalculo(i.modoCalculo || 'percentage')
    setPercentual(i.percentual != null ? String(i.percentual) : '')
    setValorFixo(i.valorFixo != null ? String(i.valorFixo) : '')
    setAplicaA(i.aplicaA || ''); setAtivo(i.ativo)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!nome.trim()) { setErroModal('Dê um nome ao imposto.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        codigo: codigo.trim() || null,
        nome: nome.trim(),
        tipo: tipo || null,
        modoCalculo,
        percentual: percentual === '' ? null : Number(percentual),
        valorFixo: valorFixo === '' ? null : Number(valorFixo),
        aplicaA: aplicaA || null,
        ativo,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/impostos/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/impostos', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(i: Imposto) {
    if (!confirm(`Excluir o imposto "${i.nome}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/impostos/${i.id}`, { method: 'DELETE' })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  const valorImposto = (i: Imposto) => {
    const partes: string[] = []
    if (i.percentual != null) partes.push(`${Number(i.percentual).toLocaleString('pt-BR')}%`)
    if (i.valorFixo != null) partes.push(brl(i.valorFixo))
    return partes.length ? partes.join(' + ') : '—'
  }

  const inputCls = 'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Impostos</h2>
          <p className="text-sm text-[var(--text-secondary)]">ISS, IRPJ, retenções e tributos.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)]">
          + Novo imposto
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar imposto..."
        className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
      />

      {loading && <div className="py-12 text-center text-sm text-[var(--text-muted)]">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 text-sm text-red-700">
          {erroLista}
          <button onClick={() => void carregar()} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtrados.length === 0 && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] py-12 text-center text-sm text-[var(--text-muted)] backdrop-blur">
          {busca ? 'Nenhum imposto encontrado.' : 'Nenhum imposto ainda. Crie o primeiro.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[var(--surface-primary)]">
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Imposto</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Tipo</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">% / Valor</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Aplica a</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Status</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((i) => (
                <tr key={i.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-primary)]">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{i.nome}</div>
                    {i.codigo && <div className="text-[11px] text-[var(--text-muted)]">Cód. {i.codigo}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{lbl(TIPOS, i.tipo)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white/80">{valorImposto(i)}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{lbl(APLICA, i.aplicaA)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${i.ativo ? 'bg-[var(--surface-secondary)] text-green-800' : 'bg-[var(--surface-primary)] text-[var(--text-secondary)]'}`}>
                      {i.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(i)} className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-white/70 transition hover:bg-[var(--surface-hover)] hover:text-white">Editar</button>
                      <button onClick={() => excluir(i)} className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-red-700/80 transition hover:bg-[var(--surface-secondary)] hover:text-red-700">Excluir</button>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar imposto' : 'Novo imposto'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Código</label>
                  <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="ISS" className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Nome</label>
                  <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Tipo</label>
                  <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">—</option>
                    {TIPOS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Cálculo</label>
                  <select value={modoCalculo} onChange={(e) => setModoCalculo(e.target.value)} className={inputCls}>
                    {MODOS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Percentual (%)</label>
                  <input type="number" step="0.0001" value={percentual} onChange={(e) => setPercentual(e.target.value)} placeholder="Ex.: 5" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Valor fixo (R$)</label>
                  <input type="number" step="0.01" value={valorFixo} onChange={(e) => setValorFixo(e.target.value)} placeholder="0,00" className={inputCls} />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Aplica a</label>
                <select value={aplicaA} onChange={(e) => setAplicaA(e.target.value)} className={`${inputCls} max-w-[240px]`}>
                  <option value="" className="bg-zinc-900">—</option>
                  {APLICA.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                </select>
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