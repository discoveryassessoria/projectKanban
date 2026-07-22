'use client'

// src/components/gerenciamentoComponents/TabelaValoresTab.tsx
// TABELA DE PREÇOS — responde só "quanto vale esta Configuração Financeira neste contexto?".
// CHAVE: configuracaoFinanceiraItemId (FK). Sem Fase, sem Produto/Serviço legado, sem código/nome solto.
// Backend: /api/gerenciamento/tabela-valores (GET/POST) + /[id] (PUT/DELETE)

import { useState, useEffect, useMemo, useCallback } from 'react'
// FONTE ÚNICA do mapeamento modo → unidade (compartilhada com a API).
import { MODOS_CALCULO, rotuloModo, rotuloUnidadeCobranca, modoUsaQuantidade } from '@/lib/financeiro/modo-calculo'

type ConfigRef = { id: number; publicCode: string | null; possuiCusto: boolean; possuiReceita: boolean; origem: string; mestre: string; label: string; moedaPadrao: string }
type FornecedorRef = { id: number; nome: string; publicCode?: string | null }
type CfgEmbed = {
  id: number; publicCode?: string | null; possuiCusto: boolean; possuiReceita: boolean
  tipoDocumento?: { name: string } | null; honorario?: { name: string } | null
  tipoProcesso?: { name: string } | null; itemCatalogo?: { name: string; natureza: string } | null
}
type Item = {
  id: number; name: string
  // O papel (CUSTO/RECEITA) vive no PRÓPRIO preço, não na config.
  natureza: string | null
  configuracaoFinanceiraItemId: number | null
  configuracaoFinanceiraItem?: CfgEmbed | null
  fornecedorId: number | null
  moeda: string
  valor: string | number | null
  // PRIMEIRO + ADICIONAL (estratégia base+adicional; ex.: honorários por requerente).
  valorBase: string | number | null
  valorAdicional: string | number | null
  modoCalculo: string
  unidade: string | null
  quantidadeMinima: string | number | null
  quantidadeMaxima: string | number | null
  vigenciaInicio: string | null
  vigenciaFim: string | null
  prioridade: number
  arquivado: boolean
  fornecedor?: FornecedorRef | null
}

const MOEDAS: [string, string][] = [['EUR', 'EUR'], ['BRL', 'BRL'], ['USD', 'USD']]

// CATEGORIA = origem ESTRUTURAL da Configuração Financeira (config.origem, derivada da FK
// tipoDocumento/honorario/tipoProcesso/itemCatalogo no backend). NUNCA inferida por texto do nome.
// É só um filtro de navegação da UI — não é gravada na Tabela de Preços.
const CATEGORIA_LABEL: Record<string, string> = {
  Documento: 'Documentos', 'Serviço': 'Serviços', 'Honorário': 'Honorários', Processo: 'Processos', Item: 'Itens',
}
const categoriaLabel = (origem: string) => CATEGORIA_LABEL[origem] ?? origem
const ORDEM_CATEGORIA = ['Documento', 'Serviço'] // as demais origens vêm depois, em ordem alfabética

function origemMestre(cfg?: CfgEmbed | null): { origem: string; mestre: string; publicCode: string | null } {
  if (!cfg) return { origem: '—', mestre: '—', publicCode: null }
  const origem = cfg.tipoDocumento ? 'Documento' : cfg.honorario ? 'Honorário' : cfg.tipoProcesso ? 'Processo' : (cfg.itemCatalogo?.natureza === 'SERVICO' ? 'Serviço' : 'Item')
  const mestre = cfg.tipoDocumento?.name ?? cfg.honorario?.name ?? cfg.tipoProcesso?.name ?? cfg.itemCatalogo?.name ?? '—'
  return { origem, mestre, publicCode: cfg.publicCode ?? null }
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
  categoria: '', // filtro de navegação (origem estrutural) — NÃO enviado no payload
  configuracaoFinanceiraItemId: '',
  // Naturezas do domínio (apenas duas). Cada uma marcada = 1 registro; ambas = 2 registros.
  precoCusto: false, precoVenda: false,
  // Custo: fornecedor + moeda + valor. Venda: moeda + valor (registros independentes).
  fornecedorId: '', moeda: '', valor: '',
  moedaVenda: '', valorVenda: '',
  // PRIMEIRO (base) + ADICIONAL — só em modo que multiplica por quantidade (ex.: por requerente).
  valorBase: '', valorAdicional: '', valorBaseVenda: '', valorAdicionalVenda: '',
  modoCalculo: 'fixed', quantidadeMinima: '', quantidadeMaxima: '',
  vigenciaInicio: '', vigenciaFim: '', prioridade: '0', arquivado: false,
}
type FormState = typeof EMPTY

export default function TabelaValoresTab() {
  const [itens, setItens] = useState<Item[]>([])
  const [configs, setConfigs] = useState<ConfigRef[]>([])
  const [fornecedores, setFornecedores] = useState<FornecedorRef[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Item | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
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
  // Categorias = origens ESTRUTURAIS distintas presentes nas configs (dinâmico, sem categorias fictícias).
  // Documentos/Serviços primeiro; demais origens reais depois, em ordem alfabética.
  const categorias = useMemo(() => {
    const origens = Array.from(new Set(configs.map((c) => c.origem)))
    return origens.sort((a, b) => {
      const ia = ORDEM_CATEGORIA.indexOf(a), ib = ORDEM_CATEGORIA.indexOf(b)
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      return categoriaLabel(a).localeCompare(categoriaLabel(b))
    })
  }, [configs])
  // Itens da categoria selecionada (ordenados pelo nome do cadastro mestre).
  const itensDaCategoria = useMemo(() => {
    if (!form.categoria) return []
    return configs.filter((c) => c.origem === form.categoria).sort((a, b) => a.mestre.localeCompare(b.mestre))
  }, [configs, form.categoria])

  function abrirNovo() { setEditando(null); setForm(EMPTY); setErroModal(null); setModalAberto(true) }
  function abrirEditar(i: Item) {
    setEditando(i)
    // Categoria derivada da ORIGEM estrutural da config vinculada (nunca por texto).
    const categoria = configs.find((c) => c.id === i.configuracaoFinanceiraItemId)?.origem ?? ''
    // Edição é sempre de UM registro individual: exatamente uma natureza (RECEITA legado ≡ VENDA).
    const ehVenda = i.natureza === 'VENDA' || i.natureza === 'RECEITA'
    const valorStr = i.valor != null ? String(i.valor) : ''
    const baseStr = i.valorBase != null ? String(i.valorBase) : ''
    const adicStr = i.valorAdicional != null ? String(i.valorAdicional) : ''
    setForm({
      categoria,
      configuracaoFinanceiraItemId: i.configuracaoFinanceiraItemId ? String(i.configuracaoFinanceiraItemId) : '',
      precoCusto: i.natureza === 'CUSTO', precoVenda: ehVenda,
      // Custo usa fornecedor/moeda/valor; Venda usa moedaVenda/valorVenda.
      fornecedorId: i.fornecedorId ? String(i.fornecedorId) : '',
      moeda: ehVenda ? '' : (i.moeda || ''), valor: ehVenda ? '' : valorStr,
      moedaVenda: ehVenda ? (i.moeda || '') : '', valorVenda: ehVenda ? valorStr : '',
      // Primeiro/adicional pertencem ao registro em edição (uma natureza por vez).
      valorBase: ehVenda ? '' : baseStr, valorAdicional: ehVenda ? '' : adicStr,
      valorBaseVenda: ehVenda ? baseStr : '', valorAdicionalVenda: ehVenda ? adicStr : '',
      modoCalculo: i.modoCalculo || 'fixed',
      // unidade é DERIVADA do modo (não editável); qtd só faz sentido em modos != fixed.
      quantidadeMinima: i.modoCalculo && i.modoCalculo !== 'fixed' && i.quantidadeMinima != null ? String(i.quantidadeMinima) : '',
      quantidadeMaxima: i.modoCalculo && i.modoCalculo !== 'fixed' && i.quantidadeMaxima != null ? String(i.quantidadeMaxima) : '',
      vigenciaInicio: i.vigenciaInicio || '', vigenciaFim: i.vigenciaFim || '',
      prioridade: String(i.prioridade ?? 0), arquivado: i.arquivado,
    })
    setErroModal(null); setModalAberto(true)
  }

  async function salvar() {
    if (!form.categoria) { setErroModal('Selecione a categoria.'); return }
    if (!form.configuracaoFinanceiraItemId) { setErroModal('Selecione o item.'); return }
    if (!form.precoCusto && !form.precoVenda) { setErroModal('Marque pelo menos uma natureza: Preço de Custo e/ou Preço de Venda.'); return }
    // Modo que multiplica por quantidade (ex.: por requerente) → cobra PRIMEIRO + ADICIONAL.
    const porQtd = modoUsaQuantidade(form.modoCalculo)
    if (form.precoCusto) {
      if (!form.moeda) { setErroModal('Selecione a moeda do custo.'); return }
      if (porQtd) {
        if (form.valorBase === '' || Number(form.valorBase) <= 0) { setErroModal('Primeiro requerente (custo) deve ser maior que zero.'); return }
        if (form.valorAdicional === '' || Number(form.valorAdicional) < 0) { setErroModal('Requerente adicional (custo) não pode ser vazio ou negativo.'); return }
      } else if (form.valor === '' || Number(form.valor) <= 0) { setErroModal('Valor de custo deve ser maior que zero.'); return }
    }
    if (form.precoVenda) {
      if (!form.moedaVenda) { setErroModal('Selecione a moeda da venda.'); return }
      if (porQtd) {
        if (form.valorBaseVenda === '' || Number(form.valorBaseVenda) <= 0) { setErroModal('Primeiro requerente (venda) deve ser maior que zero.'); return }
        if (form.valorAdicionalVenda === '' || Number(form.valorAdicionalVenda) < 0) { setErroModal('Requerente adicional (venda) não pode ser vazio ou negativo.'); return }
      } else if (form.valorVenda === '' || Number(form.valorVenda) <= 0) { setErroModal('Valor de venda deve ser maior que zero.'); return }
    }
    setSalvando(true); setErroModal(null)
    try {
      // NOVO CONTRATO: envia os CHECKBOXES + blocos custo/venda. A natureza é derivada no
      // backend (fonte única `naturezasDeSelecao`) — o componente NÃO decide natureza nem
      // envia o campo legado `natureza` no cadastro novo.
      const { categoria: _c, precoCusto: _pc, precoVenda: _pv, moeda: _m, valor: _v, fornecedorId: _f, moedaVenda: _mv, valorVenda: _vv, valorBase: _vb, valorAdicional: _va, valorBaseVenda: _vbv, valorAdicionalVenda: _vav, ...compartilhados } = form
      const num = (v: string) => (v === '' ? undefined : Number(v))
      // Bloco de preço: em modo por-quantidade envia valorBase/valorAdicional (o backend usa
      // valorBase como `valor` de compat); em modo fixo envia só `valor`.
      const blocoCusto = porQtd
        ? { moeda: form.moeda, valorBase: num(form.valorBase), valorAdicional: num(form.valorAdicional), fornecedorId: form.fornecedorId ? Number(form.fornecedorId) : null }
        : { moeda: form.moeda, valor: Number(form.valor), fornecedorId: form.fornecedorId ? Number(form.fornecedorId) : null }
      const blocoVenda = porQtd
        ? { moeda: form.moedaVenda, valorBase: num(form.valorBaseVenda), valorAdicional: num(form.valorAdicionalVenda) }
        : { moeda: form.moedaVenda, valor: Number(form.valorVenda) }
      // Edição = UM registro individual já existente (natureza imutável): payload single.
      const editPayload = form.precoCusto
        ? { natureza: 'CUSTO', ...blocoCusto }
        : { natureza: 'VENDA', ...blocoVenda, fornecedorId: null }
      const body = JSON.stringify({
        ...compartilhados,
        configuracaoFinanceiraItemId: Number(form.configuracaoFinanceiraItemId),
        prioridade: Number(form.prioridade) || 0,
        ...(editando
          ? editPayload
          : {
              precoCusto: form.precoCusto,
              precoVenda: form.precoVenda,
              custo: form.precoCusto ? blocoCusto : undefined,
              venda: form.precoVenda ? blocoVenda : undefined,
            }),
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
          <p className="text-sm text-white/50">Repositório de valores: quanto vale cada Configuração Financeira. Custo/venda por fornecedor e vigência — a decisão de onde aplicar cada preço é da Regra Financeira.</p>
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
              {['Cadastro mestre', 'Origem', 'Papel', 'Fornecedor', 'Modo', 'Valor', 'Vigência', 'Prio.', 'Status', ''].map((h, idx) => (
                <th key={idx} className={`border-b border-white/10 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white/50 ${idx === 5 || idx === 9 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtrados.map((i) => {
                const om = origemMestre(i.configuracaoFinanceiraItem)
                return (
                  <tr key={i.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-3 py-2.5 font-medium text-white">{om.mestre}</td>
                    <td className="px-3 py-2.5 text-white/60">{om.origem}</td>
                    <td className="px-3 py-2.5"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${i.natureza === 'CUSTO' ? 'bg-amber-500/15 text-amber-300' : (i.natureza === 'RECEITA' || i.natureza === 'VENDA') ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white/50'}`}>{i.natureza === 'CUSTO' ? 'Custo' : (i.natureza === 'RECEITA' || i.natureza === 'VENDA') ? 'Venda' : '—'}</span></td>
                    <td className="px-3 py-2.5 text-white/70">{i.fornecedor ? `${i.fornecedor.publicCode ? i.fornecedor.publicCode + ' — ' : ''}${i.fornecedor.nome}` : '—'}</td>
                    <td className="px-3 py-2.5 text-white/60">{rotuloModo(i.modoCalculo)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-white/90">
                      {i.valorBase != null && i.valorAdicional != null ? (
                        <span className="inline-flex flex-col items-end leading-tight">
                          <span>{fmtMoeda(i.valorBase, i.moeda)}<span className="text-white/40"> · 1º</span></span>
                          <span className="text-[11px] text-white/60">+ {fmtMoeda(i.valorAdicional, i.moeda)} / adic.</span>
                        </span>
                      ) : fmtMoeda(i.valor, i.moeda)}
                    </td>
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
              {/* Configuração Financeira via dois selects DEPENDENTES (sem digitação livre).
                  Categoria = origem estrutural (filtro de navegação); Item = a config em si. */}
              <div className="grid grid-cols-[35fr_65fr] gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Categoria *</label>
                  <select
                    value={form.categoria}
                    disabled={!!editando}
                    onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value, configuracaoFinanceiraItemId: '', precoCusto: false, precoVenda: false, moeda: '', valor: '', moedaVenda: '', valorVenda: '', valorBase: '', valorAdicional: '', valorBaseVenda: '', valorAdicionalVenda: '', fornecedorId: '' }))}
                    className={inputCls + (editando ? ' cursor-not-allowed opacity-60' : '')}
                  >
                    <option value="" className="bg-zinc-900">Selecione uma categoria</option>
                    {categorias.map((o) => <option key={o} value={o} className="bg-zinc-900">{categoriaLabel(o)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Item *</label>
                  <select
                    value={form.configuracaoFinanceiraItemId}
                    disabled={!form.categoria || !!editando}
                    onChange={(e) => {
                      const id = e.target.value
                      const c = configs.find((x) => String(x.id) === id)
                      setForm((f) => ({
                        ...f,
                        configuracaoFinanceiraItemId: id,
                        moeda: f.moeda || (c?.moedaPadrao ?? ''),
                        moedaVenda: f.moedaVenda || (c?.moedaPadrao ?? ''),
                        // marca por padrão as naturezas que a config habilita quando só uma;
                        // ambas habilitadas → deixa o usuário escolher os checkboxes.
                        precoCusto: c ? (c.possuiCusto && !c.possuiReceita) : f.precoCusto,
                        precoVenda: c ? (c.possuiReceita && !c.possuiCusto) : f.precoVenda,
                      }))
                    }}
                    className={inputCls + ((!form.categoria || editando) ? ' cursor-not-allowed opacity-60' : '')}
                  >
                    <option value="" className="bg-zinc-900">{form.categoria ? 'Selecione um item' : 'Selecione uma categoria primeiro'}</option>
                    {itensDaCategoria.map((c) => (
                      <option key={c.id} value={c.id} className="bg-zinc-900">
                        {c.mestre}{c.possuiCusto ? ' · custo' : ''}{c.possuiReceita ? ' · venda' : ''}
                      </option>
                    ))}
                  </select>
                  {form.categoria && itensDaCategoria.length === 0 && (
                    <p className="mt-1 text-[11px] text-white/40">Nenhum item nesta categoria. Cadastre a Configuração Financeira do mestre.</p>
                  )}
                </div>
              </div>

              {/* Naturezas do preço — DUAS independentes (não existe "AMBOS"). Marcar as duas
                  apenas cria dois registros (CUSTO e VENDA) na mesma transação atômica. */}
              <div>
                <label className="mb-1 block text-xs text-white/60">Natureza do preço *</label>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <label className={`flex items-center gap-2 text-sm ${(!cfgSelecionada || editando || (cfgSelecionada && !cfgSelecionada.possuiCusto)) ? 'cursor-not-allowed text-white/30' : 'text-white/80'}`}>
                    <input type="checkbox" checked={form.precoCusto}
                      disabled={!cfgSelecionada || !!editando || (!!cfgSelecionada && !cfgSelecionada.possuiCusto)}
                      onChange={(e) => set('precoCusto', e.target.checked)} className="h-4 w-4 accent-amber-500" />
                    Preço de Custo
                  </label>
                  <label className={`flex items-center gap-2 text-sm ${(!cfgSelecionada || editando || (cfgSelecionada && !cfgSelecionada.possuiReceita)) ? 'cursor-not-allowed text-white/30' : 'text-white/80'}`}>
                    <input type="checkbox" checked={form.precoVenda}
                      disabled={!cfgSelecionada || !!editando || (!!cfgSelecionada && !cfgSelecionada.possuiReceita)}
                      onChange={(e) => set('precoVenda', e.target.checked)} className="h-4 w-4 accent-emerald-500" />
                    Preço de Venda
                  </label>
                </div>
                {!cfgSelecionada && <p className="mt-1 text-[11px] text-white/40">Selecione um item para escolher as naturezas.</p>}
                {cfgSelecionada && !cfgSelecionada.possuiCusto && !cfgSelecionada.possuiReceita && (
                  <p className="mt-1 text-[11px] text-amber-300/80">Esta configuração não habilita custo nem venda. Ajuste a Natureza Financeira em Configurações Financeiras.</p>
                )}
              </div>

              {/* Bloco PREÇO DE CUSTO — Fornecedor + Moeda + Valor */}
              {form.precoCusto && (
                <div className="rounded-lg border border-amber-400/20 bg-amber-500/[0.04] p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300/80">Preço de Custo</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-white/60">Fornecedor</label>
                      <select value={form.fornecedorId} onChange={(e) => set('fornecedorId', e.target.value)} className={inputCls}>
                        <option value="" className="bg-zinc-900">— Nenhum —</option>
                        {fornecedores.map((f) => <option key={f.id} value={f.id} className="bg-zinc-900">{f.publicCode ? f.publicCode + ' — ' : ''}{f.nome}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-white/60">Moeda do custo *</label>
                      <select value={form.moeda} onChange={(e) => set('moeda', e.target.value)} className={inputCls}>
                        <option value="" className="bg-zinc-900">—</option>
                        {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                      </select>
                    </div>
                    {modoUsaQuantidade(form.modoCalculo) ? (
                      <div className="col-span-3 grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-white/60">Primeiro requerente *</label>
                          <input type="number" min="0" step="0.01" value={form.valorBase} onChange={(e) => set('valorBase', e.target.value)} placeholder="0,00" className={inputCls} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-white/60">Requerente adicional *</label>
                          <input type="number" min="0" step="0.01" value={form.valorAdicional} onChange={(e) => set('valorAdicional', e.target.value)} placeholder="0,00" className={inputCls} />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="mb-1 block text-xs text-white/60">Valor do custo *</label>
                        <input type="number" min="0" step="0.01" value={form.valor} onChange={(e) => set('valor', e.target.value)} placeholder="0,00" className={inputCls} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bloco PREÇO DE VENDA — Moeda + Valor (sem fornecedor) */}
              {form.precoVenda && (
                <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/[0.04] p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300/80">Preço de Venda</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-white/60">Moeda da venda *</label>
                      <select value={form.moedaVenda} onChange={(e) => set('moedaVenda', e.target.value)} className={inputCls}>
                        <option value="" className="bg-zinc-900">—</option>
                        {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                      </select>
                    </div>
                    {modoUsaQuantidade(form.modoCalculo) ? (
                      <div className="col-span-2 grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-white/60">Primeiro requerente *</label>
                          <input type="number" min="0" step="0.01" value={form.valorBaseVenda} onChange={(e) => set('valorBaseVenda', e.target.value)} placeholder="0,00" className={inputCls} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-white/60">Requerente adicional *</label>
                          <input type="number" min="0" step="0.01" value={form.valorAdicionalVenda} onChange={(e) => set('valorAdicionalVenda', e.target.value)} placeholder="0,00" className={inputCls} />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="mb-1 block text-xs text-white/60">Valor da venda *</label>
                        <input type="number" min="0" step="0.01" value={form.valorVenda} onChange={(e) => set('valorVenda', e.target.value)} placeholder="0,00" className={inputCls} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Parâmetros COMPARTILHADOS (uma vez só) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Modo de cálculo *</label>
                  <select value={form.modoCalculo} onChange={(e) => {
                    const modo = e.target.value
                    // Modo sem quantidade (Valor fixo) → limpa a faixa de quantidade.
                    setForm((f) => modoUsaQuantidade(modo) ? { ...f, modoCalculo: modo } : { ...f, modoCalculo: modo, quantidadeMinima: '', quantidadeMaxima: '' })
                  }} className={inputCls}>
                    {MODOS_CALCULO.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Unidade de cobrança</label>
                  {/* SOMENTE LEITURA — derivada do modo (fonte única). Nunca editável. */}
                  <div className={inputCls + ' flex items-center text-white/60'}>{rotuloUnidadeCobranca(form.modoCalculo)}</div>
                  <p className="mt-1 text-[11px] text-white/40">Derivada do modo de cálculo — não editável.</p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Qtd mín.</label>
                  <input type="number" min="0" value={form.quantidadeMinima} disabled={!modoUsaQuantidade(form.modoCalculo)} onChange={(e) => set('quantidadeMinima', e.target.value)} className={inputCls + (!modoUsaQuantidade(form.modoCalculo) ? ' cursor-not-allowed opacity-50' : '')} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-white/60">Qtd máx.</label>
                  <input type="number" min="0" value={form.quantidadeMaxima} disabled={!modoUsaQuantidade(form.modoCalculo)} onChange={(e) => set('quantidadeMaxima', e.target.value)} className={inputCls + (!modoUsaQuantidade(form.modoCalculo) ? ' cursor-not-allowed opacity-50' : '')} />
                </div>
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
