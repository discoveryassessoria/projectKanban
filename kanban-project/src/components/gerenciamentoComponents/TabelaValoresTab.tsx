'use client'

// src/components/gerenciamentoComponents/TabelaValoresTab.tsx
// TABELA DE PREÇOS — responde só "quanto vale esta Configuração Financeira neste contexto?".
// CHAVE: configuracaoFinanceiraItemId (FK). Sem Fase, sem Produto/Serviço legado, sem código/nome solto.
// Backend: /api/gerenciamento/tabela-valores (GET/POST) + /[id] (PUT/DELETE)

import { useState, useEffect, useMemo, useCallback } from 'react'

type ConfigRef = { id: number; possuiCusto: boolean; possuiReceita: boolean; origem: string; mestre: string; label: string; moedaPadrao: string }
type FornecedorRef = { id: number; nome: string }
type ProcRef = { id: number; name: string }
type ModRef = { id: number; modalityLabel: string }
type CfgEmbed = {
  id: number; possuiCusto: boolean; possuiReceita: boolean
  tipoDocumento?: { name: string } | null; honorario?: { name: string } | null
  tipoProcesso?: { name: string } | null; itemCatalogo?: { name: string; natureza: string } | null
}
type Item = {
  id: number; name: string
  // O papel (CUSTO/RECEITA) vive no PRÓPRIO preço, não na config.
  natureza: string | null
  configuracaoFinanceiraItemId: number | null
  configuracaoFinanceiraItem?: CfgEmbed | null
  processoTipoId: string | null
  modalidadeId: number | null
  fornecedorId: number | null
  moeda: string
  valor: string | number | null
  modoCalculo: string
  unidade: string | null
  quantidadeMinima: string | number | null
  quantidadeMaxima: string | number | null
  vigenciaInicio: string | null
  vigenciaFim: string | null
  prioridade: number
  arquivado: boolean
  fornecedor?: FornecedorRef | null
  modalidade?: { id: number; modalityLabel: string } | null
}

const MODOS_CALCULO: [string, string][] = [
  ['fixed', 'Valor fixo'], ['per_person', 'Por pessoa'], ['per_document', 'Por documento'],
  ['per_applicant', 'Por requerente'], ['per_generation', 'Por geração'], ['per_package', 'Por pacote'],
  ['per_vendor', 'Por fornecedor'],
]
const MOEDAS: [string, string][] = [['EUR', 'EUR'], ['BRL', 'BRL'], ['USD', 'USD']]
const modoLabel = (v: string) => MODOS_CALCULO.find(([k]) => k === v)?.[1] || v || '—'

function origemMestre(cfg?: CfgEmbed | null): { origem: string; mestre: string } {
  if (!cfg) return { origem: '—', mestre: '—' }
  const origem = cfg.tipoDocumento ? 'Documento' : cfg.honorario ? 'Honorário' : cfg.tipoProcesso ? 'Processo' : (cfg.itemCatalogo?.natureza === 'SERVICO' ? 'Serviço' : 'Item')
  const mestre = cfg.tipoDocumento?.name ?? cfg.honorario?.name ?? cfg.tipoProcesso?.name ?? cfg.itemCatalogo?.name ?? '—'
  return { origem, mestre }
}

async function jsonFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}
const fmtMoeda = (v: any, moeda: string) => {
  const n = v === null || v === undefined || v === '' ? 0 : Number(v)
  try { return n.toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL' }) } catch { return `${moeda} ${n.toFixed(2)}` }
}

const EMPTY = {
  configuracaoFinanceiraItemId: '', natureza: '', processoTipoId: '', modalidadeId: '', fornecedorId: '',
  moeda: '', valor: '', modoCalculo: 'fixed', unidade: '', quantidadeMinima: '', quantidadeMaxima: '',
  vigenciaInicio: '', vigenciaFim: '', prioridade: '0', arquivado: false,
}
type FormState = typeof EMPTY

export default function TabelaValoresTab() {
  const [itens, setItens] = useState<Item[]>([])
  const [configs, setConfigs] = useState<ConfigRef[]>([])
  const [fornecedores, setFornecedores] = useState<FornecedorRef[]>([])
  const [tiposProcesso, setTiposProcesso] = useState<ProcRef[]>([])
  const [modalidades, setModalidades] = useState<ModRef[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Item | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [cfgBusca, setCfgBusca] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)
  const set = (k: keyof FormState, v: any) => setForm((f) => ({ ...f, [k]: v }))

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jsonFetch('/api/gerenciamento/tabela-valores', { cache: 'no-store' })
      setItens((d as any).tabelaValores || [])
      setConfigs((d as any).configs || [])
      setFornecedores((d as any).fornecedores || [])
      setTiposProcesso((d as any).tiposProcesso || [])
      setModalidades((d as any).modalidades || [])
    } catch (e: any) { setErroLista(e.message || 'Não foi possível carregar os preços.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return itens
    return itens.filter((i) => {
      const om = origemMestre(i.configuracaoFinanceiraItem)
      return `${om.mestre} ${om.origem} ${i.natureza ?? ''} ${i.name}`.toLowerCase().includes(q)
    })
  }, [itens, busca])

  const cfgSelecionada = configs.find((c) => String(c.id) === form.configuracaoFinanceiraItemId) || null
  const cfgFiltradas = useMemo(() => {
    const q = cfgBusca.trim().toLowerCase()
    const arr = q ? configs.filter((c) => c.label.toLowerCase().includes(q)) : configs
    return arr.slice(0, 60)
  }, [configs, cfgBusca])

  function abrirNovo() { setEditando(null); setForm(EMPTY); setCfgBusca(''); setErroModal(null); setModalAberto(true) }
  function abrirEditar(i: Item) {
    setEditando(i)
    setForm({
      configuracaoFinanceiraItemId: i.configuracaoFinanceiraItemId ? String(i.configuracaoFinanceiraItemId) : '',
      natureza: i.natureza === 'RECEITA' ? 'VENDA' : (i.natureza || ''), // RECEITA legado ≡ VENDA

      processoTipoId: i.processoTipoId || '', modalidadeId: i.modalidadeId ? String(i.modalidadeId) : '',
      fornecedorId: i.fornecedorId ? String(i.fornecedorId) : '', moeda: i.moeda || '',
      valor: i.valor != null ? String(i.valor) : '', modoCalculo: i.modoCalculo || 'fixed',
      unidade: i.unidade || '', quantidadeMinima: i.quantidadeMinima != null ? String(i.quantidadeMinima) : '',
      quantidadeMaxima: i.quantidadeMaxima != null ? String(i.quantidadeMaxima) : '',
      vigenciaInicio: i.vigenciaInicio || '', vigenciaFim: i.vigenciaFim || '',
      prioridade: String(i.prioridade ?? 0), arquivado: i.arquivado,
    })
    setCfgBusca(''); setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!form.configuracaoFinanceiraItemId) { setErroModal('Selecione a Configuração Financeira.'); return }
    if (!form.natureza) { setErroModal('Selecione a natureza do preço (Custo ou Venda).'); return }
    if (form.valor === '' || Number(form.valor) <= 0) { setErroModal('Valor deve ser maior que zero.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify({
        ...form,
        configuracaoFinanceiraItemId: Number(form.configuracaoFinanceiraItemId),
        modalidadeId: form.modalidadeId || null,
        fornecedorId: form.fornecedorId || null,
        processoTipoId: form.processoTipoId || null,
        valor: Number(form.valor),
        prioridade: Number(form.prioridade) || 0,
      })
      if (editando) await jsonFetch(`/api/gerenciamento/tabela-valores/${editando.id}`, { method: 'PUT', body })
      else await jsonFetch('/api/gerenciamento/tabela-valores', { method: 'POST', body })
      setModalAberto(false); await carregar()
    } catch (e: any) { setErroModal(e.message || 'Não foi possível salvar.') }
    finally { setSalvando(false) }
  }

  async function excluir(i: Item) {
    if (!confirm(`Excluir este preço?`)) return
    try { await jsonFetch(`/api/gerenciamento/tabela-valores/${i.id}`, { method: 'DELETE' }); await carregar() }
    catch (e: any) { alert(e.message || 'Não foi possível excluir.') }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Tabelas de Preços</h2>
          <p className="text-sm text-white/50">Quanto vale cada Configuração Financeira em cada contexto. Custo/venda por fornecedor, nacionalidade e modalidade.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">+ Novo valor</button>
      </div>

      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por cadastro mestre, papel ou contexto..." className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20" />

      {loading && <div className="py-12 text-center text-sm text-white/40">Carregando...</div>}
      {!loading && erroLista && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{erroLista}<button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button></div>}
      {!loading && !erroLista && filtrados.length === 0 && <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">{busca ? 'Nenhum preço encontrado.' : 'Nenhum preço ainda. Crie o primeiro em “Novo valor”.'}</div>}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead><tr className="bg-white/5">
              {['Cadastro mestre', 'Origem', 'Papel', 'Processo / Modalidade', 'Fornecedor', 'Modo', 'Valor', 'Vigência', 'Prio.', 'Status', ''].map((h, idx) => (
                <th key={idx} className={`border-b border-white/10 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white/50 ${idx === 6 || idx === 10 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtrados.map((i) => {
                const om = origemMestre(i.configuracaoFinanceiraItem)
                const proc = tiposProcesso.find((t) => String(t.id) === i.processoTipoId)?.name || i.processoTipoId || '—'
                const mod = i.modalidade?.modalityLabel
                return (
                  <tr key={i.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-3 py-2.5 font-medium text-white">{om.mestre}</td>
                    <td className="px-3 py-2.5 text-white/60">{om.origem}</td>
                    <td className="px-3 py-2.5"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${i.natureza === 'CUSTO' ? 'bg-amber-500/15 text-amber-300' : (i.natureza === 'RECEITA' || i.natureza === 'VENDA') ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white/50'}`}>{i.natureza === 'CUSTO' ? 'Custo' : (i.natureza === 'RECEITA' || i.natureza === 'VENDA') ? 'Venda' : '—'}</span></td>
                    <td className="px-3 py-2.5 text-white/70">{proc}{mod ? ` · ${mod}` : ''}</td>
                    <td className="px-3 py-2.5 text-white/70">{i.fornecedor?.nome || '—'}</td>
                    <td className="px-3 py-2.5 text-white/60">{modoLabel(i.modoCalculo)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-white/90">{fmtMoeda(i.valor, i.moeda)}</td>
                    <td className="px-3 py-2.5 text-[11px] text-white/50">{i.vigenciaInicio || '—'}{i.vigenciaFim ? ` → ${i.vigenciaFim}` : ''}</td>
                    <td className="px-3 py-2.5 text-white/60">{i.prioridade}</td>
                    <td className="px-3 py-2.5"><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${!i.arquivado ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>{!i.arquivado ? 'Ativo' : 'Inativo'}</span></td>
                    <td className="px-3 py-2.5"><div className="flex items-center justify-end gap-2">
                      <button onClick={() => abrirEditar(i)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                      <button onClick={() => excluir(i)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar preço' : 'Novo valor'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>
            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-white/60">Configuração Financeira *</label>
                {editando && cfgSelecionada ? (
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white opacity-70">{cfgSelecionada.label}</div>
                ) : cfgSelecionada ? (
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
                    <span className="text-white">{cfgSelecionada.label}</span>
                    <button onClick={() => set('configuracaoFinanceiraItemId', '')} className="text-xs text-white/50 hover:text-white">trocar</button>
                  </div>
                ) : (
                  <>
                    <input value={cfgBusca} onChange={(e) => setCfgBusca(e.target.value)} autoFocus placeholder="Buscar: Origem · Cadastro mestre..." className={inputCls} />
                    {cfgBusca && (
                      <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-zinc-900">
                        {cfgFiltradas.length === 0 && <div className="px-3 py-2 text-xs text-white/40">Nenhuma configuração. Cadastre em Configurações Financeiras.</div>}
                        {cfgFiltradas.map((c) => (
                          <button key={c.id} onClick={() => {
                            setForm((f) => ({
                              ...f,
                              configuracaoFinanceiraItemId: String(c.id),
                              moeda: f.moeda || c.moedaPadrao,
                              // natureza padrão quando a config só habilita uma
                              natureza: c.possuiCusto && !c.possuiReceita ? 'CUSTO' : c.possuiReceita && !c.possuiCusto ? 'VENDA' : '',
                            }))
                            setCfgBusca('')
                          }} className="block w-full px-3 py-1.5 text-left text-sm text-white/80 hover:bg-white/10">
                            {c.label}
                            <span className="text-white/40">{c.possuiCusto ? ' · custo' : ''}{c.possuiReceita ? ' · venda' : ''}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* §11 — natureza do PREÇO: Custo ou Venda, dentre as que a config habilita. */}
              <div>
                <label className="mb-1 block text-xs text-white/60">Natureza do preço *</label>
                <div className="flex gap-2">
                  {(['CUSTO', 'VENDA'] as const).map((nat) => {
                    const habilitada = !cfgSelecionada || (nat === 'CUSTO' ? cfgSelecionada.possuiCusto : cfgSelecionada.possuiReceita)
                    const ativo = form.natureza === nat
                    return (
                      <button key={nat} type="button" disabled={!habilitada} onClick={() => set('natureza', nat)}
                        className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${ativo ? (nat === 'CUSTO' ? 'border-amber-400/40 bg-amber-500/15 text-amber-200' : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200') : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'} ${habilitada ? '' : 'cursor-not-allowed opacity-40'}`}>
                        {nat === 'CUSTO' ? 'Preço de Custo' : 'Preço de Venda'}
                      </button>
                    )
                  })}
                </div>
                {cfgSelecionada && !cfgSelecionada.possuiCusto && !cfgSelecionada.possuiReceita && (
                  <p className="mt-1 text-[11px] text-amber-300/80">Esta configuração não habilita custo nem venda. Ajuste a Natureza Financeira em Configurações Financeiras.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Processo / Nacionalidade</label>
                  <select value={form.processoTipoId} onChange={(e) => set('processoTipoId', e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— Qualquer —</option>
                    {tiposProcesso.map((t) => <option key={t.id} value={t.id} className="bg-zinc-900">{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Modalidade</label>
                  <select value={form.modalidadeId} onChange={(e) => set('modalidadeId', e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— Qualquer —</option>
                    {modalidades.map((m) => <option key={m.id} value={m.id} className="bg-zinc-900">{m.modalityLabel}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Fornecedor</label>
                  <select value={form.fornecedorId} onChange={(e) => set('fornecedorId', e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">— Nenhum —</option>
                    {fornecedores.map((f) => <option key={f.id} value={f.id} className="bg-zinc-900">{f.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Modo de cálculo *</label>
                  <select value={form.modoCalculo} onChange={(e) => set('modoCalculo', e.target.value)} className={inputCls}>
                    {MODOS_CALCULO.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Moeda *</label>
                  <select value={form.moeda} onChange={(e) => set('moeda', e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">—</option>
                    {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Valor *</label>
                  <input type="number" step="0.01" value={form.valor} onChange={(e) => set('valor', e.target.value)} placeholder="0,00" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Unidade</label>
                  <input value={form.unidade} onChange={(e) => set('unidade', e.target.value)} placeholder="un, pág..." className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div><label className="mb-1 block text-xs text-white/60">Qtd mín.</label><input type="number" value={form.quantidadeMinima} onChange={(e) => set('quantidadeMinima', e.target.value)} className={inputCls} /></div>
                <div><label className="mb-1 block text-xs text-white/60">Qtd máx.</label><input type="number" value={form.quantidadeMaxima} onChange={(e) => set('quantidadeMaxima', e.target.value)} className={inputCls} /></div>
                <div><label className="mb-1 block text-xs text-white/60">Vig. início</label><input type="date" value={form.vigenciaInicio} onChange={(e) => set('vigenciaInicio', e.target.value)} className={inputCls} /></div>
                <div><label className="mb-1 block text-xs text-white/60">Vig. fim</label><input type="date" value={form.vigenciaFim} onChange={(e) => set('vigenciaFim', e.target.value)} className={inputCls} /></div>
              </div>

              <div className="flex items-center gap-6">
                <div className="w-28"><label className="mb-1 block text-xs text-white/60">Prioridade</label><input type="number" value={form.prioridade} onChange={(e) => set('prioridade', e.target.value)} className={inputCls} /></div>
                <label className="mt-5 flex items-center gap-2 text-sm text-white/80"><input type="checkbox" checked={!form.arquivado} onChange={(e) => set('arquivado', !e.target.checked)} className="h-4 w-4 accent-blue-500" />Ativo</label>
              </div>

              {erroModal && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erroModal}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setModalAberto(false)} className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50">{salvando ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
