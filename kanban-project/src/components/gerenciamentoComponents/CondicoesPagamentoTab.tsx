'use client'

// src/components/gerenciamentoComponents/CondicoesPagamentoTab.tsx
// ============================================================================
// CONDIÇÕES DE PAGAMENTO — cadastro oficial das regras de cobrança.
//
// É aqui que vivem entrada, parcelamento, cronograma, distribuição, encargos,
// câmbio e restrições. O FinanceRuleEngine consome estas regras
// (lib/financeiro/condicao-pagamento.ts) — nenhuma tela monta cronograma.
//
// VERSIONAMENTO: condição já usada não tem o cronograma alterado. O PUT devolve
// 409 EXIGE_NOVA_VERSAO e a tela oferece criar a versão seguinte, preservando a
// anterior para os lançamentos históricos.
//
// Backend: /api/gerenciamento/condicoes-pagamento (GET/POST) + /[id] (PUT/DELETE)
// ============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'

type Ref = { id: number; name?: string; code?: string | null; icone?: string | null }
type Condicao = {
  id: number
  name: string
  codigo: string | null
  descricao: string | null
  versao: number
  moeda: string
  formaPagamento: string | null
  carteiraId: number | null
  ativo: boolean
  vigenciaInicio: string | null
  vigenciaFim: string | null
  tipoPagamento: string
  temEntrada: boolean
  entradaObrigatoria: boolean
  percentEntrada: string | number | null
  valorEntradaFixo: string | number | null
  parcelas: number
  parcelasMin: number | null
  parcelasMax: number | null
  parcelasPadrao: number | null
  permiteParcelasPersonalizadas: boolean
  permiteEdicaoManual: boolean
  inicioCronograma: string
  primeiraParcelaDias: number | null
  primeiraParcelaData: string | null
  periodicidade: string
  periodicidadeDias: number | null
  diaFixo: number | null
  diaVencimento: number | null
  ajusteDiaUtil: string
  ajustarFimDeSemana: boolean
  ajustarFeriados: boolean
  distribuicao: string
  primeiraParcelaPercent: string | number | null
  multaPercent: string | number | null
  jurosMesPercent: string | number | null
  descontoPercent: string | number | null
  descontoAntecipacaoPercent: string | number | null
  descontoAVistaPercent: string | number | null
  politicaCambio: string
  travaCambial: boolean
  aplicarTaxas: boolean
  aplicaA: string
  moedasPermitidas: string[]
  valorMinimo: string | number | null
  valorMaximo: string | number | null
  paises: string[]
  modalidades: string[]
  tiposProcesso: string[]
  observacoes: string | null
  carteira?: { id: number; nome: string } | null
  formasPermitidas?: { formaId: number }[]
  taxasVinculadas?: { taxaId: number }[]
  _count?: { configuracoes: number; receitas: number; custos: number }
}

const MOEDAS: [string, string][] = [['BRL', 'Real (BRL)'], ['EUR', 'Euro (EUR)'], ['USD', 'Dólar (USD)']]
const FORMAS_ENUM: [string, string][] = [
  ['PIX', 'Pix'], ['CARTAO_CREDITO', 'Cartão de crédito'], ['CARTAO_DEBITO', 'Cartão de débito'],
  ['BOLETO', 'Boleto'], ['TRANSFERENCIA', 'Transferência'], ['DINHEIRO', 'Dinheiro'],
  ['CHEQUE', 'Cheque'], ['OUTRO', 'Outro'],
]
const TIPOS_PAGAMENTO: [string, string][] = [['PARCELADO', 'Parcelado'], ['AVISTA', 'À vista']]
const PERIODICIDADES: [string, string][] = [
  ['SEMANAL', 'Semanal'], ['QUINZENAL', 'Quinzenal'], ['MENSAL', 'Mensal'], ['BIMESTRAL', 'Bimestral'],
  ['TRIMESTRAL', 'Trimestral'], ['SEMESTRAL', 'Semestral'], ['ANUAL', 'Anual'], ['PERSONALIZADA', 'Personalizada'],
]
const INICIOS: [string, string][] = [['IMEDIATA', 'Imediata'], ['DIAS', 'Em X dias'], ['DATA_ESPECIFICA', 'Data específica']]
const AJUSTES: [string, string][] = [['NENHUM', 'Nenhum'], ['PROXIMO_DIA_UTIL', 'Próximo dia útil'], ['ULTIMO_DIA_UTIL', 'Último dia útil']]
const DISTRIBUICOES: [string, string][] = [
  ['ULTIMA_AJUSTA', 'Iguais (última ajusta centavos)'], ['IGUAIS', 'Iguais'],
  ['PRIMEIRA_DIFERENCIADA', 'Primeira diferenciada'], ['ENTRADA_SALDO', 'Entrada + saldo'], ['PERSONALIZADO', 'Personalizado'],
]
const CAMBIOS: [string, string][] = [
  ['VARIAVEL', 'Variável'], ['FIXO', 'Fixo'], ['CONTRATACAO', 'Da contratação'], ['RECEBIMENTO', 'Do recebimento'],
]
const APLICA_A: [string, string][] = [['AMBOS', 'Receita e custo'], ['RECEITA', 'Somente receita'], ['CUSTO', 'Somente custo']]

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
  if (!res.ok) {
    const err = new Error((data as Record<string, string>)?.error || `Erro ${res.status}`) as Error & { codigo?: string }
    err.codigo = (data as Record<string, string>)?.codigo
    throw err
  }
  return data
}

/** Bloco de seção do formulário — mesmo padrão de ContasTab/ProdutosTab. */
function Secao({ titulo, hint, children, primeira }: { titulo: string; hint?: string; children: React.ReactNode; primeira?: boolean }) {
  return (
    <div className={primeira ? '' : 'border-t border-white/10 pt-4'}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{titulo}</div>
      <div className={hint ? 'mb-3 mt-1 text-[11px] text-white/30' : 'mb-3'}>{hint ?? ''}</div>
      {children}
    </div>
  )
}

type Form = Record<string, unknown>

const VAZIO: Form = {
  name: '', codigo: '', descricao: '', moeda: 'BRL', formaPagamento: '', carteiraId: '', ativo: true,
  vigenciaInicio: '', vigenciaFim: '',
  tipoPagamento: 'PARCELADO', temEntrada: false, entradaObrigatoria: false, percentEntrada: '', valorEntradaFixo: '',
  parcelasMin: '', parcelasMax: '', parcelasPadrao: '', permiteParcelasPersonalizadas: false, permiteEdicaoManual: false,
  inicioCronograma: 'IMEDIATA', primeiraParcelaDias: '', primeiraParcelaData: '',
  periodicidade: 'MENSAL', periodicidadeDias: '', diaFixo: '', ajusteDiaUtil: 'NENHUM',
  ajustarFimDeSemana: false, ajustarFeriados: false,
  distribuicao: 'ULTIMA_AJUSTA', primeiraParcelaPercent: '',
  multaPercent: '', jurosMesPercent: '', descontoPercent: '', descontoAntecipacaoPercent: '', descontoAVistaPercent: '',
  politicaCambio: 'VARIAVEL', travaCambial: false, aplicarTaxas: false,
  aplicaA: 'AMBOS', moedasPermitidas: '', valorMinimo: '', valorMaximo: '', paises: '', modalidades: '', tiposProcesso: '',
  observacoes: '', formasPermitidas: [] as number[], taxasVinculadas: [] as number[],
}

export default function CondicoesPagamentoTab() {
  const [condicoes, setCondicoes] = useState<Condicao[]>([])
  const [carteiras, setCarteiras] = useState<{ id: number; nome: string }[]>([])
  const [formasCadastro, setFormasCadastro] = useState<Ref[]>([])
  const [taxas, setTaxas] = useState<Ref[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Condicao | null>(null)
  const [novaVersaoDe, setNovaVersaoDe] = useState<Condicao | null>(null)
  const [f, setF] = useState<Form>(VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)
  const [exigeNovaVersao, setExigeNovaVersao] = useState(false)

  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }))

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = (await jsonFetch('/api/gerenciamento/condicoes-pagamento', { cache: 'no-store' })) as Record<string, unknown>
      setCondicoes((d.condicoes as Condicao[]) || [])
      setCarteiras((d.carteiras as { id: number; nome: string }[]) || [])
      setFormasCadastro((d.formasPagamento as Ref[]) || [])
      setTaxas((d.taxas as Ref[]) || [])
    } catch (e) {
      setErroLista((e as Error).message || 'Não foi possível carregar as condições.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return condicoes
    return condicoes.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.codigo || '').toLowerCase().includes(q) || (c.carteira?.nome || '').toLowerCase().includes(q))
  }, [condicoes, busca])

  const emUso = (c: Condicao) => (c._count?.receitas ?? 0) + (c._count?.custos ?? 0) + (c._count?.configuracoes ?? 0)

  function abrirNovo() {
    setEditando(null); setNovaVersaoDe(null); setExigeNovaVersao(false)
    setF({ ...VAZIO }); setErroModal(null); setModalAberto(true)
  }

  function carregarNoForm(c: Condicao): Form {
    const s = (v: unknown) => (v == null ? '' : String(v))
    const d = (v: string | null) => (v ? String(v).slice(0, 10) : '')
    return {
      ...VAZIO,
      name: c.name, codigo: s(c.codigo), descricao: s(c.descricao), moeda: c.moeda || 'BRL',
      formaPagamento: s(c.formaPagamento), carteiraId: s(c.carteiraId), ativo: c.ativo,
      vigenciaInicio: d(c.vigenciaInicio), vigenciaFim: d(c.vigenciaFim),
      tipoPagamento: c.tipoPagamento || 'PARCELADO', temEntrada: c.temEntrada, entradaObrigatoria: c.entradaObrigatoria,
      percentEntrada: s(c.percentEntrada), valorEntradaFixo: s(c.valorEntradaFixo),
      parcelasMin: s(c.parcelasMin), parcelasMax: s(c.parcelasMax), parcelasPadrao: s(c.parcelasPadrao ?? c.parcelas),
      permiteParcelasPersonalizadas: c.permiteParcelasPersonalizadas, permiteEdicaoManual: c.permiteEdicaoManual,
      inicioCronograma: c.inicioCronograma || 'IMEDIATA', primeiraParcelaDias: s(c.primeiraParcelaDias),
      primeiraParcelaData: d(c.primeiraParcelaData),
      periodicidade: c.periodicidade || 'MENSAL', periodicidadeDias: s(c.periodicidadeDias),
      diaFixo: s(c.diaFixo ?? c.diaVencimento), ajusteDiaUtil: c.ajusteDiaUtil || 'NENHUM',
      ajustarFimDeSemana: c.ajustarFimDeSemana, ajustarFeriados: c.ajustarFeriados,
      distribuicao: c.distribuicao || 'ULTIMA_AJUSTA', primeiraParcelaPercent: s(c.primeiraParcelaPercent),
      multaPercent: s(c.multaPercent), jurosMesPercent: s(c.jurosMesPercent), descontoPercent: s(c.descontoPercent),
      descontoAntecipacaoPercent: s(c.descontoAntecipacaoPercent), descontoAVistaPercent: s(c.descontoAVistaPercent),
      politicaCambio: c.politicaCambio || 'VARIAVEL', travaCambial: c.travaCambial, aplicarTaxas: c.aplicarTaxas,
      aplicaA: c.aplicaA || 'AMBOS', moedasPermitidas: (c.moedasPermitidas || []).join(', '),
      valorMinimo: s(c.valorMinimo), valorMaximo: s(c.valorMaximo),
      paises: (c.paises || []).join(', '), modalidades: (c.modalidades || []).join(', '),
      tiposProcesso: (c.tiposProcesso || []).join(', '), observacoes: s(c.observacoes),
      formasPermitidas: (c.formasPermitidas || []).map((x) => x.formaId),
      taxasVinculadas: (c.taxasVinculadas || []).map((x) => x.taxaId),
    }
  }

  function abrirEditar(c: Condicao) {
    setEditando(c); setNovaVersaoDe(null); setExigeNovaVersao(false)
    setF(carregarNoForm(c)); setErroModal(null); setModalAberto(true)
  }

  function abrirNovaVersao(c: Condicao) {
    setEditando(null); setNovaVersaoDe(c); setExigeNovaVersao(false)
    setF(carregarNoForm(c)); setErroModal(null); setModalAberto(true)
  }

  function corpo() {
    const n = (k: string) => (f[k] === '' || f[k] == null ? null : Number(f[k]))
    return JSON.stringify({
      ...f,
      name: String(f.name).trim(),
      carteiraId: n('carteiraId'),
      percentEntrada: n('percentEntrada'), valorEntradaFixo: n('valorEntradaFixo'),
      parcelasMin: n('parcelasMin'), parcelasMax: n('parcelasMax'), parcelasPadrao: n('parcelasPadrao'),
      parcelas: n('parcelasPadrao') ?? 1,
      primeiraParcelaDias: n('primeiraParcelaDias'), periodicidadeDias: n('periodicidadeDias'),
      diaFixo: n('diaFixo'), diaVencimento: n('diaFixo'), primeiraParcelaPercent: n('primeiraParcelaPercent'),
      multaPercent: n('multaPercent'), jurosMesPercent: n('jurosMesPercent'), descontoPercent: n('descontoPercent'),
      descontoAntecipacaoPercent: n('descontoAntecipacaoPercent'), descontoAVistaPercent: n('descontoAVistaPercent'),
      valorMinimo: n('valorMinimo'), valorMaximo: n('valorMaximo'),
      substituiId: novaVersaoDe?.id ?? null,
    })
  }

  async function salvar() {
    if (!String(f.name).trim()) { setErroModal('Dê um nome à condição.'); return }
    setSalvando(true); setErroModal(null); setExigeNovaVersao(false)
    try {
      if (editando) {
        await jsonFetch(`/api/gerenciamento/condicoes-pagamento/${editando.id}`, { method: 'PUT', body: corpo() })
      } else {
        await jsonFetch('/api/gerenciamento/condicoes-pagamento', { method: 'POST', body: corpo() })
      }
      setModalAberto(false)
      await carregar()
    } catch (e) {
      const err = e as Error & { codigo?: string }
      setErroModal(err.message || 'Não foi possível salvar.')
      if (err.codigo === 'EXIGE_NOVA_VERSAO') setExigeNovaVersao(true)
    } finally {
      setSalvando(false)
    }
  }

  /** Converte a edição bloqueada em criação de nova versão, sem perder o form. */
  function converterEmNovaVersao() {
    if (!editando) return
    setNovaVersaoDe(editando); setEditando(null); setExigeNovaVersao(false); setErroModal(null)
  }

  async function excluir(c: Condicao) {
    if (!confirm(`Excluir a condição "${c.name}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/condicoes-pagamento/${c.id}`, { method: 'DELETE' })
      await carregar()
    } catch (e) {
      alert((e as Error).message || 'Não foi possível excluir.')
    }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'
  const labelCls = 'mb-1 block text-[11px] text-white/50'
  const check = (k: string, rotulo: string) => (
    <label className="flex items-center gap-2 text-sm text-white/80">
      <input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked)} className="h-4 w-4 accent-blue-500" />
      {rotulo}
    </label>
  )
  const campo = (k: string, rotulo: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div key={k}>
      <label className={labelCls}>{rotulo}</label>
      <input className={inputCls} value={String(f[k] ?? '')} onChange={(e) => set(k, e.target.value)} {...extra} />
    </div>
  )
  const select = (k: string, rotulo: string, opcoes: [string, string][]) => (
    <div key={k}>
      <label className={labelCls}>{rotulo}</label>
      <select className={inputCls} value={String(f[k] ?? '')} onChange={(e) => set(k, e.target.value)}>
        {opcoes.map(([v, l]) => <option key={v} value={v} className="bg-zinc-900">{l}</option>)}
      </select>
    </div>
  )
  const toggleId = (k: string, id: number) => {
    const atual = (f[k] as number[]) || []
    set(k, atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id])
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Condições de Pagamento</h2>
          <p className="text-sm text-white/50">
            Regra oficial de cobrança: entrada, parcelamento, cronograma, encargos e restrições. O motor financeiro gera as parcelas a partir daqui.
          </p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
          + Nova condição
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome, código ou carteira..."
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
          {busca ? 'Nenhuma condição encontrada.' : 'Nenhuma condição ainda. Crie a primeira.'}
        </div>
      )}

      {!loading && !erroLista && filtradas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/5 backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-white/5">
                {['Condição', 'Aplica a', 'Parcelamento', 'Cronograma', 'Encargos', 'Uso', 'Status', ''].map((h, i) => (
                  <th key={i} className={`border-b border-white/10 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white/50 ${i === 7 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => {
                const uso = emUso(c)
                const entrada = c.temEntrada
                  ? c.valorEntradaFixo ? 'entrada fixa' : c.percentEntrada ? `entrada ${Number(c.percentEntrada)}%` : 'com entrada'
                  : null
                const periodo = PERIODICIDADES.find(([k]) => k === c.periodicidade)?.[1] ?? c.periodicidade
                const encargos = [
                  c.multaPercent ? `multa ${Number(c.multaPercent)}%` : null,
                  c.jurosMesPercent ? `juros ${Number(c.jurosMesPercent)}%/mês` : null,
                  c.descontoAVistaPercent ? `à vista ${Number(c.descontoAVistaPercent)}%` : null,
                ].filter(Boolean)
                return (
                  <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-white">{c.name}</div>
                      <div className="text-[11px] text-white/40">
                        {c.codigo ? `${c.codigo} · ` : ''}v{c.versao} · {c.moeda}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-white/70">{APLICA_A.find(([k]) => k === c.aplicaA)?.[1] ?? c.aplicaA}</td>
                    <td className="px-4 py-2.5 text-white/70">
                      {c.tipoPagamento === 'AVISTA' ? 'À vista' : `${c.parcelasPadrao ?? c.parcelas}×`}
                      {entrada && <div className="text-[11px] text-white/40">{entrada}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-white/70">
                      {periodo}
                      {c.diaFixo && <div className="text-[11px] text-white/40">dia {c.diaFixo}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-white/60">{encargos.length ? encargos.join(' · ') : '—'}</td>
                    <td className="px-4 py-2.5 text-[12px] text-white/60">{uso > 0 ? `${uso} vínculo${uso > 1 ? 's' : ''}` : '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${c.ativo ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'}`}>
                        {c.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => abrirEditar(c)} className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white">Editar</button>
                        {uso > 0 && (
                          <button onClick={() => abrirNovaVersao(c)} className="rounded-md border border-blue-400/20 px-2.5 py-1 text-xs text-blue-300 transition hover:bg-blue-500/10">Nova versão</button>
                        )}
                        <button onClick={() => excluir(c)} className="rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200">Excluir</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-start justify-between border-b border-white/10 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  {novaVersaoDe ? `Nova versão de "${novaVersaoDe.name}"` : editando ? 'Editar condição' : 'Nova condição'}
                </h3>
                {novaVersaoDe && (
                  <p className="mt-1 text-[11px] text-white/40">
                    A v{novaVersaoDe.versao} é preservada e encerrada — os lançamentos históricos continuam apontando para ela.
                  </p>
                )}
              </div>
              <button onClick={() => setModalAberto(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="max-h-[72vh] space-y-5 overflow-y-auto px-6 py-5">
              <Secao titulo="Identificação" primeira>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {campo('name', 'Nome *', { placeholder: 'Ex.: Honorários — 6× com entrada', autoFocus: true })}
                  {campo('codigo', 'Código', { placeholder: 'IT-HON-6X' })}
                  {select('moeda', 'Moeda do cadastro', MOEDAS)}
                  <div>
                    <label className={labelCls}>Carteira de recebimento</label>
                    <select className={inputCls} value={String(f.carteiraId ?? '')} onChange={(e) => set('carteiraId', e.target.value)}>
                      <option value="" className="bg-zinc-900">— Nenhuma —</option>
                      {carteiras.map((c) => <option key={c.id} value={c.id} className="bg-zinc-900">{c.nome}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Descrição</label>
                    <textarea className={inputCls} rows={2} value={String(f.descricao ?? '')} onChange={(e) => set('descricao', e.target.value)} />
                  </div>
                </div>
                <div className="mt-3">{check('ativo', 'Condição ativa')}</div>
              </Secao>

              <Secao titulo="Aplicação e vigência" hint="Condição fora de vigência não é usada pelo motor.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {select('aplicaA', 'Aplica a', APLICA_A)}
                  {campo('vigenciaInicio', 'Vigência — início', { type: 'date' })}
                  {campo('vigenciaFim', 'Vigência — fim', { type: 'date' })}
                </div>
              </Secao>

              <Secao titulo="Entrada">
                <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
                  {check('temEntrada', 'Possui entrada')}
                  {check('entradaObrigatoria', 'Entrada obrigatória')}
                </div>
                {!!f.temEntrada && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {campo('percentEntrada', 'Percentual da entrada (%)', { type: 'number', min: 0, max: 100, step: '0.01' })}
                    {campo('valorEntradaFixo', 'Ou valor fixo da entrada', { type: 'number', step: '0.01' })}
                  </div>
                )}
              </Secao>

              <Secao titulo="Parcelamento">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {select('tipoPagamento', 'Tipo', TIPOS_PAGAMENTO)}
                  {campo('parcelasMin', 'Mínimo', { type: 'number', min: 1 })}
                  {campo('parcelasPadrao', 'Padrão', { type: 'number', min: 1 })}
                  {campo('parcelasMax', 'Máximo', { type: 'number', min: 1 })}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                  {check('permiteParcelasPersonalizadas', 'Permite quantidade personalizada')}
                  {check('permiteEdicaoManual', 'Permite edição manual das parcelas')}
                </div>
              </Secao>

              <Secao titulo="Cronograma">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {select('inicioCronograma', 'Primeira parcela', INICIOS)}
                  {f.inicioCronograma === 'DIAS' && campo('primeiraParcelaDias', 'Em quantos dias', { type: 'number', min: 0 })}
                  {f.inicioCronograma === 'DATA_ESPECIFICA' && campo('primeiraParcelaData', 'Data', { type: 'date' })}
                  {select('periodicidade', 'Periodicidade', PERIODICIDADES)}
                  {f.periodicidade === 'PERSONALIZADA' && campo('periodicidadeDias', 'Intervalo (dias)', { type: 'number', min: 1 })}
                  {campo('diaFixo', 'Dia fixo (1–31)', { type: 'number', min: 1, max: 31 })}
                  {select('ajusteDiaUtil', 'Regra de dia útil', AJUSTES)}
                </div>
                <div className="mt-3 space-y-2">
                  {check('ajustarFimDeSemana', 'Ajustar vencimento que cai em fim de semana')}
                  <label className="flex items-start gap-2 text-sm text-white/60">
                    <input type="checkbox" checked={!!f.ajustarFeriados} onChange={(e) => set('ajustarFeriados', e.target.checked)} className="mt-1 h-4 w-4 accent-blue-500" />
                    <span>
                      Ajustar feriados
                      <span className="block text-[11px] text-amber-300/70">
                        Sem efeito por enquanto: o sistema ainda não tem calendário oficial de feriados. Só finais de semana são ajustados.
                      </span>
                    </span>
                  </label>
                </div>
              </Secao>

              <Secao titulo="Distribuição dos valores" hint="A soma das parcelas sempre fecha exatamente o total contratado.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {select('distribuicao', 'Regra', DISTRIBUICOES)}
                  {f.distribuicao === 'PRIMEIRA_DIFERENCIADA' && campo('primeiraParcelaPercent', 'Primeira parcela (%)', { type: 'number', min: 1, max: 99, step: '0.01' })}
                </div>
              </Secao>

              <Secao titulo="Encargos e descontos" hint="Multa e juros incidem no pagamento em atraso; descontos, na geração ou na antecipação.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {campo('multaPercent', 'Multa (%)', { type: 'number', step: '0.01' })}
                  {campo('jurosMesPercent', 'Juros (% ao mês)', { type: 'number', step: '0.01' })}
                  {campo('descontoPercent', 'Desconto comercial (%)', { type: 'number', step: '0.01' })}
                  {campo('descontoAVistaPercent', 'Desconto à vista (%)', { type: 'number', step: '0.01' })}
                  {campo('descontoAntecipacaoPercent', 'Desconto antecipação (%/mês)', { type: 'number', step: '0.01' })}
                </div>
              </Secao>

              <Secao titulo="Câmbio">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {select('politicaCambio', 'Política', CAMBIOS)}
                  <div className="flex items-end pb-2">{check('travaCambial', 'Trava cambial')}</div>
                </div>
              </Secao>

              <Secao titulo="Formas de pagamento aceitas">
                {formasCadastro.length === 0 ? (
                  <p className="text-[12px] text-white/30">Nenhuma forma de pagamento ativa cadastrada.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {formasCadastro.map((fp) => {
                      const marcada = ((f.formasPermitidas as number[]) || []).includes(fp.id)
                      return (
                        <button key={fp.id} type="button" onClick={() => toggleId('formasPermitidas', fp.id)}
                          className={`rounded-full border px-3 py-1 text-[12px] transition ${marcada ? 'border-blue-400/40 bg-blue-500/20 text-blue-200' : 'border-white/10 bg-white/5 text-white/50 hover:text-white'}`}>
                          {fp.icone ? `${fp.icone} ` : ''}{fp.name}
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="mt-3 sm:w-1/2">
                  <label className={labelCls}>Forma padrão (legado)</label>
                  <select className={inputCls} value={String(f.formaPagamento ?? '')} onChange={(e) => set('formaPagamento', e.target.value)}>
                    <option value="" className="bg-zinc-900">—</option>
                    {FORMAS_ENUM.map(([v, l]) => <option key={v} value={v} className="bg-zinc-900">{l}</option>)}
                  </select>
                </div>
              </Secao>

              <Secao titulo="Taxas vinculadas" hint="As taxas são calculadas na geração do lançamento e congeladas nele.">
                <div className="mb-3">{check('aplicarTaxas', 'Aplicar taxas nesta condição')}</div>
                {taxas.length === 0 ? (
                  <p className="text-[12px] text-white/30">Nenhuma taxa ativa cadastrada.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {taxas.map((t) => {
                      const marcada = ((f.taxasVinculadas as number[]) || []).includes(t.id)
                      return (
                        <button key={t.id} type="button" onClick={() => toggleId('taxasVinculadas', t.id)}
                          className={`rounded-full border px-3 py-1 text-[12px] transition ${marcada ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200' : 'border-white/10 bg-white/5 text-white/50 hover:text-white'}`}>
                          {t.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </Secao>

              <Secao titulo="Restrições de utilização" hint="Em branco = sem restrição. Separe múltiplos valores por vírgula.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {campo('moedasPermitidas', 'Moedas permitidas', { placeholder: 'EUR, BRL' })}
                  {campo('paises', 'Países', { placeholder: 'IT, PT' })}
                  {campo('modalidades', 'Modalidades', { placeholder: 'sanguinis' })}
                  {campo('tiposProcesso', 'Tipos de processo', { placeholder: 'cidadania_italiana' })}
                  {campo('valorMinimo', 'Valor mínimo', { type: 'number', step: '0.01' })}
                  {campo('valorMaximo', 'Valor máximo', { type: 'number', step: '0.01' })}
                </div>
                <div className="mt-3">
                  <label className={labelCls}>Observações</label>
                  <textarea className={inputCls} rows={2} value={String(f.observacoes ?? '')} onChange={(e) => set('observacoes', e.target.value)} />
                </div>
              </Secao>

              {erroModal && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  {erroModal}
                  {exigeNovaVersao && (
                    <button onClick={converterEmNovaVersao} className="mt-2 block rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-500">
                      Criar nova versão com estas alterações
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setModalAberto(false)} className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50">
                {salvando ? 'Salvando...' : novaVersaoDe ? 'Criar versão' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
