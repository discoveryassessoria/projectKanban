'use client'

// src/components/gerenciamentoComponents/ProdutosTab.tsx
// Catálogo Financeiro / Itens Cobrados (tabela ProdutoFinanceiro).
// Backend: /api/gerenciamento/produtos (GET/POST) + /[id] (PUT/DELETE)
// Form alinhado ao operacional ("Novo · Item do Catálogo Financeiro"):
//   codigo(req), nome(req), especie, naturezaFinanceira,
//   categoriaId(→Categoria), planoContaId(→Conta contábil),
//   moedaPadrao, valorPadrao,
//   checkboxes: cobravelDoCliente, custoInterno, repasse, reembolsavel + ativo.
// Categorias vêm de /api/gerenciamento/categorias; contas de /api/gerenciamento/plano-contas.

import { useState, useEffect, useMemo, useCallback } from 'react'

type CategoriaRef = { id: number; nome: string }
type ContaRef = { id: number; codigo: string; nome: string }
type Produto = {
  id: number
  codigo: string
  nome: string
  especie: string | null
  naturezaFinanceira: string | null
  categoriaId: number | null
  planoContaId: number | null
  moedaPadrao: string
  valorPadrao: string | number | null
  cobravelDoCliente: boolean
  custoInterno: boolean
  repasse: boolean
  reembolsavel: boolean
  ativo: boolean
  categoria?: CategoriaRef | null
  planoConta?: ContaRef | null
}

const ESPECIES: [string, string][] = [
  ['fee', 'Taxa'], ['honorarium', 'Honorário'], ['tax', 'Imposto'], ['cost', 'Custo'],
  ['reimbursement', 'Reembolso'], ['service', 'Serviço'], ['discount', 'Desconto'],
  ['adjustment', 'Ajuste'], ['commission', 'Comissão'], ['penalty', 'Multa'], ['other', 'Outro'],
]
const NATUREZAS: [string, string][] = [
  ['revenue', 'Receita'], ['cost', 'Custo'], ['expense', 'Despesa'], ['transfer', 'Transferência'],
  ['discount', 'Desconto'], ['tax', 'Imposto'], ['neutral', 'Neutro'],
]
const MOEDAS: [string, string][] = [['BRL', 'Real (BRL)'], ['EUR', 'Euro (EUR)'], ['USD', 'Dólar (USD)']]

const lbl = (arr: [string, string][], v: string | null) => arr.find(([k]) => k === v)?.[1] || v || '—'
const fmtMoney = (v: any, moeda?: string) =>
  v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL' })

const EMPTY = {
  codigo: '', nome: '', especie: '', naturezaFinanceira: 'revenue',
  categoriaId: '', planoContaId: '', moedaPadrao: 'BRL', valorPadrao: '',
  cobravelDoCliente: false, custoInterno: false, repasse: false, reembolsavel: false, ativo: true,
}
type FormState = typeof EMPTY

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

function Secao({ titulo, children, primeira }: { titulo: string; children: React.ReactNode; primeira?: boolean }) {
  return (
    <div className={primeira ? '' : 'border-t border-white/10 pt-4'}>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-white/40">{titulo}</div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

export default function ProdutosTab() {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [categorias, setCategorias] = useState<CategoriaRef[]>([])
  const [contas, setContas] = useState<ContaRef[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Produto | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const set = (k: keyof FormState, v: any) => setForm((f) => ({ ...f, [k]: v }))

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const [dProd, dCat, dContas] = await Promise.all([
        jsonFetch('/api/gerenciamento/produtos', { cache: 'no-store' }),
        jsonFetch('/api/gerenciamento/categorias', { cache: 'no-store' }).catch(() => ({ categorias: [] })),
        jsonFetch('/api/gerenciamento/plano-contas', { cache: 'no-store' }).catch(() => ({ contas: [] })),
      ])
      setProdutos((dProd as any).produtos || [])
      setCategorias((dCat as any).categorias || [])
      setContas((dContas as any).contas || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar os produtos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return produtos
    return produtos.filter((p) =>
      p.codigo.toLowerCase().includes(q) ||
      p.nome.toLowerCase().includes(q) ||
      lbl(ESPECIES, p.especie).toLowerCase().includes(q)
    )
  }, [produtos, busca])

  function abrirNovo() {
    setEditando(null); setForm(EMPTY); setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(p: Produto) {
    setEditando(p)
    setForm({
      codigo: p.codigo, nome: p.nome, especie: p.especie || '',
      naturezaFinanceira: p.naturezaFinanceira || 'revenue',
      categoriaId: p.categoriaId ? String(p.categoriaId) : '', planoContaId: p.planoContaId ? String(p.planoContaId) : '',
      moedaPadrao: p.moedaPadrao || 'BRL', valorPadrao: p.valorPadrao != null ? String(p.valorPadrao) : '',
      cobravelDoCliente: p.cobravelDoCliente, custoInterno: p.custoInterno,
      repasse: p.repasse, reembolsavel: p.reembolsavel, ativo: p.ativo,
    })
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!form.codigo.trim()) { setErroModal('Informe o código.'); return }
    if (!form.nome.trim()) { setErroModal('Dê um nome ao produto.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        ...form,
        categoriaId: form.categoriaId || null,
        planoContaId: form.planoContaId || null,
        valorPadrao: form.valorPadrao === '' ? null : Number(form.valorPadrao),
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/produtos/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/produtos', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(p: Produto) {
    if (!confirm(`Excluir o produto "${p.codigo} — ${p.nome}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/produtos/${p.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Configurações Financeiras</h2>
          <p className="text-sm text-white/50">Itens financeiros mestres: honorários, taxas, custos e itens cobráveis.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Novo item
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar (código, nome ou espécie)..."
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
          {busca ? 'Nenhum item encontrado.' : 'Nenhum item ainda. Crie o primeiro.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Item</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Espécie / Natureza</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Categoria</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Valor padrão</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => (
                <tr key={p.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{p.nome}</div>
                    <div className="text-[11px] text-white/40">Cód. {p.codigo}</div>
                  </td>
                  <td className="px-4 py-2.5 text-white/70">
                    {lbl(ESPECIES, p.especie)}<span className="text-white/40"> · {lbl(NATUREZAS, p.naturezaFinanceira)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{p.categoria?.nome || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white/80">{fmtMoney(p.valorPadrao, p.moedaPadrao)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${p.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      {p.cobravelDoCliente && <span className="rounded px-2 py-0.5 text-[11px] font-medium bg-blue-500/15 text-blue-300">Cobrável</span>}
                      {p.custoInterno && <span className="rounded px-2 py-0.5 text-[11px] font-medium bg-amber-500/15 text-amber-300">Custo interno</span>}
                      {p.repasse && <span className="rounded px-2 py-0.5 text-[11px] font-medium bg-purple-500/15 text-purple-300">Repasse</span>}
                      {p.reembolsavel && <span className="rounded px-2 py-0.5 text-[11px] font-medium bg-teal-500/15 text-teal-300">Reembolsável</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(p)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(p)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
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
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar item do Catálogo Financeiro' : 'Novo item do Catálogo Financeiro'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="max-h-[72vh] space-y-5 overflow-y-auto px-6 py-5">
              {/* Identificação */}
              <Secao titulo="Identificação" primeira>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <label className="mb-1 block text-xs text-white/60">Código</label>
                    <input value={form.codigo} onChange={(e) => set('codigo', e.target.value)} autoFocus className={inputCls} />
                  </div>
                  <div className="col-span-2">
                    <label className="mb-1 block text-xs text-white/60">Nome</label>
                    <input value={form.nome} onChange={(e) => set('nome', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Espécie</label>
                    <select value={form.especie} onChange={(e) => set('especie', e.target.value)} className={inputCls}>
                      <option value="" className="bg-zinc-900">—</option>
                      {ESPECIES.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Natureza financeira</label>
                    <select value={form.naturezaFinanceira} onChange={(e) => set('naturezaFinanceira', e.target.value)} className={inputCls}>
                      {NATUREZAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                    </select>
                  </div>
                </div>
              </Secao>

              {/* Valor */}
              <Secao titulo="Valor">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Moeda padrão</label>
                    <select value={form.moedaPadrao} onChange={(e) => set('moedaPadrao', e.target.value)} className={inputCls}>
                      {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Valor padrão</label>
                    <input type="number" step="0.01" value={form.valorPadrao} onChange={(e) => set('valorPadrao', e.target.value)} placeholder="0,00" className={inputCls} />
                  </div>
                </div>
              </Secao>

              {/* Classificação */}
              <Secao titulo="Classificação">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Categoria</label>
                    <select value={form.categoriaId} onChange={(e) => set('categoriaId', e.target.value)} className={inputCls}>
                      <option value="" className="bg-zinc-900">— Nenhuma —</option>
                      {categorias.map((c) => <option key={c.id} value={c.id} className="bg-zinc-900">{c.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-white/60">Conta contábil</label>
                    <select value={form.planoContaId} onChange={(e) => set('planoContaId', e.target.value)} className={inputCls}>
                      <option value="" className="bg-zinc-900">— Nenhuma —</option>
                      {contas.map((c) => <option key={c.id} value={c.id} className="bg-zinc-900">{c.codigo} — {c.nome}</option>)}
                    </select>
                  </div>
                </div>
              </Secao>

              {/* Marcações */}
              <Secao titulo="Marcações">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={form.cobravelDoCliente} onChange={(e) => set('cobravelDoCliente', e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Cobrável do cliente
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={form.custoInterno} onChange={(e) => set('custoInterno', e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Custo interno
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={form.repasse} onChange={(e) => set('repasse', e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Repasse
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={form.reembolsavel} onChange={(e) => set('reembolsavel', e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Reembolsável
                  </label>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input type="checkbox" checked={form.ativo} onChange={(e) => set('ativo', e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    Ativo
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