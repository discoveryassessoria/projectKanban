'use client'

// src/components/gerenciamentoComponents/TabelaValoresTab.tsx
// Tabela de Valores = REGRAS DE PREÇO (tabela TabelaValor, forma pricingRules do mockup).
// Backend: /api/gerenciamento/tabela-valores (GET/POST) + /[id] (PUT/DELETE)
// Campos do mockup (renderManagementPricingTable / prcModal):
//   name(req), processoTipoId, faseKey, produtoServicoId, fornecedorId(->Fornecedor),
//   moeda, valor, modoCalculo, condicao, vigenciaInicio, vigenciaFim, arquivado.
// O GET ja traz { tabelaValores, fornecedores } (select de fornecedor).
// Processo/Fase/Produto-Servico ficam soltos: viram select quando o motor / catalogo
// de Servicos existir (hoje aparecem vazios, igual ao mockup quando esses cadastros
// estao vazios).

import { useState, useEffect, useMemo, useCallback } from 'react'

type FornecedorRef = { id: number; nome: string }
type Item = {
  id: number
  name: string
  processoTipoId: string | null
  faseKey: string | null
  produtoServicoId: string | null
  fornecedorId: number | null
  moeda: string
  valor: string | number | null
  modoCalculo: string
  condicao: string | null
  vigenciaInicio: string | null
  vigenciaFim: string | null
  arquivado: boolean
  fornecedor?: FornecedorRef | null
}

// Modos de calculo — iguais ao mockup (PRICING_CALC_MODES)
const MODOS_CALCULO: [string, string][] = [
  ['fixed', 'Valor fixo'], ['per_person', 'Por pessoa'], ['per_document', 'Por documento'],
  ['per_applicant', 'Por requerente'], ['per_generation', 'Por geração'], ['per_package', 'Por pacote'],
  ['per_vendor', 'Por fornecedor'], ['manual', 'Composição manual'],
]
const MOEDAS: [string, string][] = [['EUR', 'EUR'], ['BRL', 'BRL'], ['USD', 'USD']]

const modoLabel = (v: string) => MODOS_CALCULO.find(([k]) => k === v)?.[1] || v || '—'

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
  const n = v === null || v === undefined || v === '' ? 0 : Number(v)
  const simbolo = moeda === 'EUR' ? '€' : moeda === 'USD' ? 'US$' : 'R$'
  return `${simbolo} ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function TabelaValoresTab() {
  const [itens, setItens] = useState<Item[]>([])
  const [fornecedores, setFornecedores] = useState<FornecedorRef[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Item | null>(null)
  const [name, setName] = useState('')
  const [processoTipoId, setProcessoTipoId] = useState('')
  const [faseKey, setFaseKey] = useState('')
  const [produtoServicoId, setProdutoServicoId] = useState('')
  const [fornecedorId, setFornecedorId] = useState('')
  const [moeda, setMoeda] = useState('EUR')
  const [valor, setValor] = useState('0')
  const [modoCalculo, setModoCalculo] = useState('fixed')
  const [condicao, setCondicao] = useState('')
  const [vigenciaInicio, setVigenciaInicio] = useState('')
  const [vigenciaFim, setVigenciaFim] = useState('')
  const [arquivado, setArquivado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/tabela-valores', { cache: 'no-store' })
      setItens((d as any).tabelaValores || [])
      setFornecedores((d as any).fornecedores || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar a tabela de valores.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return itens
    return itens.filter((i) =>
      i.name.toLowerCase().includes(q) ||
      (i.fornecedor?.nome || '').toLowerCase().includes(q)
    )
  }, [itens, busca])

  function abrirNovo() {
    setEditando(null)
    setName(''); setProcessoTipoId(''); setFaseKey(''); setProdutoServicoId(''); setFornecedorId('')
    setMoeda('EUR'); setValor('0'); setModoCalculo('fixed'); setCondicao('')
    setVigenciaInicio(''); setVigenciaFim(''); setArquivado(false)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(i: Item) {
    setEditando(i)
    setName(i.name)
    setProcessoTipoId(i.processoTipoId || '')
    setFaseKey(i.faseKey || '')
    setProdutoServicoId(i.produtoServicoId || '')
    setFornecedorId(i.fornecedorId ? String(i.fornecedorId) : '')
    setMoeda(i.moeda || 'EUR')
    setValor(i.valor != null ? String(i.valor) : '0')
    setModoCalculo(i.modoCalculo || 'fixed')
    setCondicao(i.condicao || '')
    setVigenciaInicio(i.vigenciaInicio || '')
    setVigenciaFim(i.vigenciaFim || '')
    setArquivado(i.arquivado)
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!name.trim()) { setErroModal('Dê um nome à regra.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        name: name.trim(),
        processoTipoId: processoTipoId || null,
        faseKey: faseKey || null,
        produtoServicoId: produtoServicoId || null,
        fornecedorId: fornecedorId ? Number(fornecedorId) : null,
        moeda,
        valor: valor === '' ? 0 : Number(valor),
        modoCalculo,
        condicao: condicao.trim() || null,
        vigenciaInicio: vigenciaInicio || null,
        vigenciaFim: vigenciaFim || null,
        arquivado,
      })
      if (editando) {
        await jsonFetch(`/api/gerenciamento/tabela-valores/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/gerenciamento/tabela-valores', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(i: Item) {
    if (!confirm(`Excluir a regra "${i.name}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/tabela-valores/${i.id}`, { method: 'DELETE' })
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
          <h2 className="text-xl font-semibold text-white">Tabela de Valores</h2>
          <p className="text-sm text-white/50">Parametrize valores por Processo de Nacionalidade, fase, produto/serviço, país, modalidade e fornecedor. As automações financeiras puxam o valor daqui em vez de usar número fixo.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Novo valor
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

      {!loading && !erroLista && filtrados.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca ? 'Nenhuma regra encontrada.' : 'Nenhuma regra de valor. Clique em "+ Novo valor".'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Regra de valor</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Produto/Serviço</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Fase</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Valor</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/50">Status</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-white/50">Usado em</th>
                <th className="border-b border-white/10 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-white/50">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((i) => (
                <tr key={i.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{i.name}</div>
                    <div className="text-[11px] text-white/40">
                      {modoLabel(i.modoCalculo)}{i.condicao ? ` · ${i.condicao}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{i.produtoServicoId || '—'}</td>
                  <td className="px-4 py-2.5 text-white/70">{i.faseKey || 'todas'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white/70">{fmtMoeda(i.valor, i.moeda)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${i.arquivado ? 'bg-white/10 text-white/50' : 'bg-green-500/15 text-green-300'}`}>
                      {i.arquivado ? 'Arquivado' : 'Ativo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center tabular-nums text-white/50">0</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(i)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(i)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
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
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar valor' : 'Novo valor'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-white/60">Nome da regra *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="ex: Pasta Documental · Genealogia" className={inputCls} />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Processo de Nacionalidade</label>
                  <select value={processoTipoId} onChange={(e) => { setProcessoTipoId(e.target.value); setFaseKey('') }} className={inputCls}>
                    <option value="" className="bg-zinc-900">— qualquer —</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Fase</label>
                  <select value={faseKey} onChange={(e) => setFaseKey(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— qualquer fase —</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Produto/Serviço</label>
                  <select value={produtoServicoId} onChange={(e) => setProdutoServicoId(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— selecione —</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Fornecedor</label>
                  <select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— nenhum —</option>
                    {fornecedores.map((f) => <option key={f.id} value={f.id} className="bg-zinc-900">{f.nome}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Moeda</label>
                  <select value={moeda} onChange={(e) => setMoeda(e.target.value)} className={inputCls}>
                    {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Valor</label>
                  <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Modo de cálculo</label>
                  <select value={modoCalculo} onChange={(e) => setModoCalculo(e.target.value)} className={inputCls}>
                    {MODOS_CALCULO.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Condição (opcional)</label>
                  <input value={condicao} onChange={(e) => setCondicao(e.target.value)} placeholder="ex: acima de 5 requerentes" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Vigência início</label>
                  <input type="date" value={vigenciaInicio} onChange={(e) => setVigenciaInicio(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Vigência fim</label>
                  <input type="date" value={vigenciaFim} onChange={(e) => setVigenciaFim(e.target.value)} className={inputCls} />
                </div>
              </div>

              <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-300/80">
                <b>Processo de Nacionalidade</b>, <b>Fase</b> e <b>Produto/Serviço</b> ficam disponíveis quando o motor operacional e o catálogo de Serviços forem cadastrados. Por ora, deixe em "qualquer" — a regra vale de forma geral. <b>Fornecedor</b> já funciona.
              </p>

              {editando && (
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input type="checkbox" checked={arquivado} onChange={(e) => setArquivado(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                  Arquivado
                </label>
              )}

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