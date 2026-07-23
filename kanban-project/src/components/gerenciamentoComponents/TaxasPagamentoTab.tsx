'use client'

// src/components/gerenciamentoComponents/TaxasPagamentoTab.tsx
// ============================================================================
// TAXAS DE PAGAMENTO — uma linha por TABELA LÓGICA (a Taxa é a tabela inteira;
// cartão de crédito carrega a grade 1x–12x internamente). Identificação
// ESTRUTURADA: forma/adquirente/bandeira/finalidade vêm dos cadastros — o admin
// NUNCA digita nome nem código (ambos automáticos, gerados no backend). O passo
// "Cálculo" se adapta à forma: grade editável no crédito, percentual único no
// débito/PIX/transferência/dinheiro/Wise, valor fixo/percentual no boleto.
//   Backend: /api/gerenciamento/taxas-pagamento (GET/POST) + /[id] (PUT/DELETE)
// ============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Percent, Search, Plus, X, Check, ArrowRight, ArrowLeft, Loader2, Pencil, Trash2,
  Tag, Calculator, Scale, Sparkles, Cpu, Lock, CreditCard, Landmark,
} from 'lucide-react'
import { OURO, GLASS, INPUT, jf, toggleArr, Secao, Campo, Select, Toggle, MultiSelect, ModalWizard, Stepper, fecharTodosMultiSelects } from './pagamentoUI'
import { QUEM_ABSORVE, QUEM_ABSORVE_LABEL, BASE_INCIDENCIA, BASE_INCIDENCIA_LABEL } from '@/lib/financeiro/taxa-constants'
import {
  perfilForma, nomeTaxaAuto, resumoTaxa, FINALIDADES_BOLETO, FINALIDADE_LABEL, calculoFinalidade,
} from '@/lib/financeiro/taxa-identidade'

type FormaRef = { id: number; name: string; type: string | null }
type AdqRef = { id: number; nome: string; slug: string; formasSuportadas: number[] }
type BandRef = { id: number; nome: string; slug: string }
type MoedaRef = { id: number; code: string; name: string | null }
type PaisRef = { id: number; countryKey: string; countryLabel: string; flag?: string | null }
type ServRef = { id: number; name: string; code?: string | null }

type LinhaTabela = { parcelasDe: number; parcelasAte: number; feePercent: number | null; fixedFee: number | null; antecipacao: boolean }
type Resumo = ReturnType<typeof resumoTaxa>

type Taxa = {
  id: number; code: string | null; name: string; descricao: string | null; ativo: boolean; prioridade: number
  formaPagamentoId: number | null; formasAplicaveis: number[]; formaPrincipalId: number | null
  formaNome: string | null; formaTipo: string | null
  adquirenteId: number | null; adquirenteNome: string | null
  bandeiraId: number | null; bandeiraNome: string | null; finalidade: string | null
  feeType: string | null; feePercent: number | null; fixedFee: number | null; moeda: string | null
  baseIncidencia: string; quemAbsorve: string; absorcaoPercentEmpresa: number | null
  parcelamento?: LinhaTabela[]; resumo: Resumo; emUso: number
  servicos: number[]; moedasVinculadas?: { moedaId: number }[]; paisesPermitidos?: { paisId: number }[]
  vigenciaInicio: string | null; vigenciaFim: string | null
}

// ── Resumo textual da taxa (uma linha na listagem) ──────────────────────────
function textoResumo(r: Resumo, moeda: string | null): string {
  const pct = (n: number | null) => (n == null ? '—' : `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`)
  const brl = (n: number | null) => (n == null ? '—' : `${moeda || 'R$'} ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  if (r.tipoCalculo === 'GRADE') {
    if (r.taxaMinPercent === r.taxaMaxPercent) return `${pct(r.taxaMinPercent)} · ${r.parcelaMax}x`
    return `${pct(r.taxaMinPercent)} → ${pct(r.taxaMaxPercent)} · ${r.parcelaMin}x–${r.parcelaMax}x`
  }
  if (r.tipoCalculo === 'FIXO') return brl(r.valorFixo)
  return pct(r.taxaMinPercent)
}

export default function TaxasPagamentoTab() {
  const [itens, setItens] = useState<Taxa[]>([])
  const [formas, setFormas] = useState<FormaRef[]>([])
  const [adquirentes, setAdquirentes] = useState<AdqRef[]>([])
  const [bandeiras, setBandeiras] = useState<BandRef[]>([])
  const [moedas, setMoedas] = useState<MoedaRef[]>([])
  const [paises, setPaises] = useState<PaisRef[]>([])
  const [servicos, setServicos] = useState<ServRef[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)

  const [busca, setBusca] = useState('')
  const [fForma, setFForma] = useState('')
  const [fAdq, setFAdq] = useState('')
  const [fBand, setFBand] = useState('')
  const [fStatus, setFStatus] = useState('')

  const [aberto, setAberto] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jf('/api/gerenciamento/taxas-pagamento', { cache: 'no-store' })
      setItens(d.taxas || []); setFormas(d.formasPagamento || []); setAdquirentes(d.adquirentes || [])
      setBandeiras(d.bandeiras || []); setMoedas(d.moedas || []); setPaises(d.paises || []); setServicos(d.servicos || [])
    } catch (e: any) { setErroLista(e.message || 'Não foi possível carregar.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return itens.filter((x) => {
      if (q && !(x.name.toLowerCase().includes(q) || (x.code || '').toLowerCase().includes(q))) return false
      if (fForma && String(x.formaPrincipalId) !== fForma) return false
      if (fAdq && String(x.adquirenteId) !== fAdq) return false
      if (fBand && String(x.bandeiraId) !== fBand) return false
      if (fStatus === 'ativas' && !x.ativo) return false
      if (fStatus === 'inativas' && x.ativo) return false
      return true
    })
  }, [itens, busca, fForma, fAdq, fBand, fStatus])

  const editando = editId != null ? itens.find((x) => x.id === editId) ?? null : null

  async function excluir(x: Taxa) {
    if (!confirm(`Excluir a tabela de taxa "${x.name}"?`)) return
    try { await jf(`/api/gerenciamento/taxas-pagamento/${x.id}`, { method: 'DELETE' }); await carregar() }
    catch (e: any) { alert(e.message || 'Não foi possível excluir.') }
  }

  const selFiltro = 'rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/25'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${OURO}22`, color: OURO }}><Percent className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-semibold text-white">Taxas de Pagamento</h2>
            <p className="text-sm text-white/50">Uma tabela por forma/bandeira. Nome e código são automáticos; a Cobrança congela a taxa.</p>
          </div>
        </div>
        <button onClick={() => { setEditId(null); setAberto(true) }} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition" style={{ background: OURO }}>
          <Plus className="h-4 w-4" /> Nova tabela
        </button>
      </div>

      {/* Filtros: forma / adquirente / bandeira / status + busca */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou código…" className="w-full rounded-lg border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25" />
        </div>
        <select value={fForma} onChange={(e) => setFForma(e.target.value)} className={selFiltro}>
          <option value="">Todas as formas</option>
          {formas.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={fAdq} onChange={(e) => setFAdq(e.target.value)} className={selFiltro}>
          <option value="">Todos adquirentes</option>
          {adquirentes.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
        </select>
        <select value={fBand} onChange={(e) => setFBand(e.target.value)} className={selFiltro}>
          <option value="">Todas bandeiras</option>
          {bandeiras.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selFiltro}>
          <option value="">Todos status</option>
          <option value="ativas">Ativas</option>
          <option value="inativas">Inativas</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>
      ) : erroLista ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{erroLista}<button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button></div>
      ) : filtrados.length === 0 ? (
        <div className={`${GLASS} flex flex-col items-center gap-2 py-16 text-center`}>
          <Percent className="h-10 w-10 text-white/20" />
          <p className="text-white/60">{itens.length ? 'Nenhuma tabela encontrada com esses filtros.' : 'Nenhuma tabela de taxa cadastrada.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((x) => (
            <div key={x.id} className={`${GLASS} flex items-center gap-4 p-4 transition hover:border-white/20`}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${OURO}18`, color: OURO }}>
                {x.formaTipo?.startsWith('CARTAO') ? <CreditCard className="h-5 w-5" /> : <Landmark className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-white">{x.name}</span>
                  {x.resumo.nLinhas > 0 && <span className="shrink-0 rounded-md border border-white/15 px-2 py-0.5 text-[11px] text-white/60">grade {x.resumo.nLinhas} parcela(s)</span>}
                  {x.emUso > 0 && <span className="shrink-0 rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-200">em uso · {x.emUso}</span>}
                  {!x.ativo && <span className="shrink-0 rounded-md border border-white/15 px-2 py-0.5 text-[11px] text-white/40">inativa</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
                  {x.code && <span className="font-mono">{x.code}</span>}
                  {x.formaNome && <span>{x.formaNome}</span>}
                  {x.bandeiraNome && <span>· {x.bandeiraNome}</span>}
                  {x.adquirenteNome && <span>· {x.adquirenteNome}</span>}
                  <span className="font-medium text-white/70">{textoResumo(x.resumo, x.moeda)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => { setEditId(x.id); setAberto(true) }} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"><Pencil className="h-3 w-3" /> Editar</button>
                <button onClick={() => excluir(x)} className="inline-flex items-center gap-1 rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10"><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {aberto && (
        <TaxaEditor
          editando={editando} formas={formas} adquirentes={adquirentes} bandeiras={bandeiras}
          moedas={moedas} paises={paises} servicos={servicos}
          onClose={() => setAberto(false)} onSalvo={() => { setAberto(false); carregar() }}
        />
      )}
    </div>
  )
}

// ── Editor (4 seções: Identificação · Cálculo · Regras · Revisão) ───────────
const PASSOS = ['Identificação', 'Cálculo', 'Regras', 'Revisão']

type Form = {
  formaId: number | null; adquirenteId: number | null; bandeiraId: number | null; finalidade: string | null
  descricao: string; ativo: boolean; prioridade: number
  feePercent: number | null; fixedFee: number | null; moeda: string | null
  grade: { n: number; pct: number | null }[]
  quemAbsorve: string; absorcaoPercentEmpresa: number | null; baseIncidencia: string
  moedasIds: number[]; paisesIds: number[]; servicosIds: number[]
  vigenciaInicio: string | null; vigenciaFim: string | null
}

function formInicial(t: Taxa | null): Form {
  if (!t) return {
    formaId: null, adquirenteId: null, bandeiraId: null, finalidade: null,
    descricao: '', ativo: true, prioridade: 0,
    feePercent: null, fixedFee: null, moeda: null, grade: [{ n: 1, pct: null }],
    quemAbsorve: 'EMPRESA', absorcaoPercentEmpresa: null, baseIncidencia: 'TOTAL',
    moedasIds: [], paisesIds: [], servicosIds: [], vigenciaInicio: null, vigenciaFim: null,
  }
  const grade = (t.parcelamento ?? []).length
    ? [...(t.parcelamento ?? [])].sort((a, b) => a.parcelasDe - b.parcelasDe).map((l) => ({ n: Number(l.parcelasDe), pct: l.feePercent == null ? null : Number(l.feePercent) }))
    : [{ n: 1, pct: t.feePercent == null ? null : Number(t.feePercent) }]
  return {
    formaId: t.formaPrincipalId, adquirenteId: t.adquirenteId, bandeiraId: t.bandeiraId, finalidade: t.finalidade,
    descricao: t.descricao ?? '', ativo: t.ativo, prioridade: t.prioridade ?? 0,
    feePercent: t.feePercent == null ? null : Number(t.feePercent), fixedFee: t.fixedFee == null ? null : Number(t.fixedFee), moeda: t.moeda,
    grade,
    quemAbsorve: t.quemAbsorve ?? 'EMPRESA', absorcaoPercentEmpresa: t.absorcaoPercentEmpresa, baseIncidencia: t.baseIncidencia ?? 'TOTAL',
    moedasIds: (t.moedasVinculadas ?? []).map((m) => m.moedaId), paisesIds: (t.paisesPermitidos ?? []).map((p) => p.paisId), servicosIds: t.servicos ?? [],
    vigenciaInicio: t.vigenciaInicio ?? null, vigenciaFim: t.vigenciaFim ?? null,
  }
}

function TaxaEditor({ editando, formas, adquirentes, bandeiras, moedas, paises, servicos, onClose, onSalvo }: {
  editando: Taxa | null; formas: FormaRef[]; adquirentes: AdqRef[]; bandeiras: BandRef[]
  moedas: MoedaRef[]; paises: PaisRef[]; servicos: ServRef[]; onClose: () => void; onSalvo: () => void
}) {
  const [step, setStep] = useState(1)
  const [f, setF] = useState<Form>(() => formInicial(editando))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  const forma = formas.find((x) => x.id === f.formaId) ?? null
  const perfil = perfilForma(forma?.type)
  const bandeira = bandeiras.find((b) => b.id === f.bandeiraId) ?? null
  const calcBoleto = perfil.calculo === 'BOLETO' ? calculoFinalidade(f.finalidade) : null
  // adquirentes que suportam a forma escolhida (vazio = todos)
  const adqOpcoes = useMemo(() => {
    if (!f.formaId) return adquirentes
    const compat = adquirentes.filter((a) => (a.formasSuportadas ?? []).includes(f.formaId!))
    return compat.length ? compat : adquirentes
  }, [adquirentes, f.formaId])

  const nomeAuto = f.formaId
    ? nomeTaxaAuto({ formaType: forma?.type, formaNome: forma?.name, bandeiraNome: bandeira?.nome ?? null, finalidade: f.finalidade })
    : ''

  function validarId(): string | null {
    if (!f.formaId) return 'Selecione a forma de pagamento.'
    if (perfil.mostraBandeira && !f.bandeiraId) return 'Selecione a bandeira.'
    if (perfil.mostraFinalidade && !f.finalidade) return 'Selecione a finalidade do encargo.'
    return null
  }

  function montarBody() {
    const usaGrade = perfil.mostraGrade
    const percentualUnico = calcBoleto === 'PERCENTUAL' || (perfil.calculo === 'PERCENTUAL')
    const valorFixo = calcBoleto === 'FIXO'
    return {
      formaPagamentoId: f.formaId, formasAplicaveis: f.formaId ? [f.formaId] : [],
      adquirenteId: perfil.mostraAdquirente ? f.adquirenteId : null,
      bandeiraId: perfil.mostraBandeira ? f.bandeiraId : null,
      finalidade: perfil.mostraFinalidade ? f.finalidade : null,
      categoria: forma?.type?.startsWith('CARTAO') ? 'TAXA_CARTAO' : perfil.calculo === 'BOLETO' ? 'TARIFA_BANCARIA' : 'GATEWAY',
      descricao: f.descricao || null, ativo: f.ativo, prioridade: f.prioridade,
      feeType: valorFixo ? 'fixed' : 'percentage',
      feePercent: usaGrade ? (f.grade[0]?.pct ?? null) : (percentualUnico ? f.feePercent : null),
      fixedFee: valorFixo ? f.fixedFee : null,
      moeda: valorFixo ? (f.moeda || 'BRL') : null,
      aplicaParcela: 'TODAS',
      // grade 1x–12x — salva TODA a tabela numa operação transacional
      parcelamento: usaGrade
        ? f.grade.filter((g) => g.n >= 1).map((g) => ({ parcelasDe: g.n, parcelasAte: g.n, feePercent: g.pct, fixedFee: null, antecipacao: false }))
        : [],
      quemAbsorve: f.quemAbsorve, absorcaoPercentEmpresa: f.quemAbsorve === 'COMPARTILHADA' ? f.absorcaoPercentEmpresa : null,
      baseIncidencia: f.baseIncidencia,
      moedasIds: f.moedasIds, paisesIds: f.paisesIds, servicosIds: f.servicosIds,
      vigenciaInicio: f.vigenciaInicio, vigenciaFim: f.vigenciaFim,
    }
  }

  async function salvar() {
    const e = validarId(); if (e) { setStep(1); setErro(e); return }
    setSalvando(true); setErro(null)
    try {
      const body = JSON.stringify(montarBody())
      if (editando) await jf(`/api/gerenciamento/taxas-pagamento/${editando.id}`, { method: 'PUT', body })
      else await jf('/api/gerenciamento/taxas-pagamento', { method: 'POST', body })
      onSalvo()
    } catch (e: any) { setErro(e.message || 'Não foi possível salvar.') }
    finally { setSalvando(false) }
  }

  const irPara = (n: number) => { fecharTodosMultiSelects(); setStep(n) }
  const proximo = () => {
    fecharTodosMultiSelects()
    if (step === 1) { const e = validarId(); if (e) { setErro(e); return } }
    setErro(null); setStep(step + 1)
  }

  return (
    <ModalWizard
      onClose={onClose}
      header={<>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" style={{ color: OURO }} /><h3 className="text-base font-semibold">{editando ? 'Editar tabela de taxa' : 'Nova tabela de taxa'}</h3></div>
          <button onClick={() => { fecharTodosMultiSelects(); onClose() }} className="text-white/40 transition hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3"><Stepper passos={PASSOS} atual={step} /></div>
      </>}
      footer={
        <div className="flex items-center justify-between">
          <button onClick={() => (step > 1 ? irPara(step - 1) : (fecharTodosMultiSelects(), onClose()))} className="inline-flex items-center gap-1 text-sm text-white/60 transition hover:text-white"><ArrowLeft className="h-4 w-4" /> {step > 1 ? 'Voltar' : 'Cancelar'}</button>
          {step < PASSOS.length ? (
            <button onClick={proximo} className="inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition" style={{ background: OURO }}>Próximo <ArrowRight className="h-4 w-4" /></button>
          ) : (
            <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition disabled:opacity-50" style={{ background: OURO }}>{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{salvando ? 'Salvando…' : 'Salvar'}</button>
          )}
        </div>
      }
    >
      <>
        {erro && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erro}</div>}
        {editando && editando.emUso > 0 && step === 1 && (
          <div className="rounded-lg border border-sky-400/30 bg-sky-400/10 p-3 text-[12px] text-sky-100">
            Em uso em <b>{editando.emUso}</b> cobrança(s). Editar aqui <b>não altera</b> cobranças já emitidas — cada uma congela sua própria taxa. Para uma nova política, altere a vigência (cria uma nova versão).
          </div>
        )}

        {/* ── 1. Identificação (estruturada; nome/código automáticos) ── */}
        {step === 1 && (
          <Secao icon={Tag} titulo="Identificação" dica="Tudo vem dos cadastros. O nome e o código são gerados automaticamente.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="Forma de pagamento *">
                <Select value={f.formaId != null ? String(f.formaId) : ''} onChange={(v) => { const id = v ? Number(v) : null; setF((p) => ({ ...p, formaId: id, adquirenteId: null, bandeiraId: null, finalidade: null })) }}
                  options={[['', '— selecione —'], ...formas.map((x) => [String(x.id), x.name] as [string, string])]} />
              </Campo>
              {perfil.mostraAdquirente && (
                <Campo label="Adquirente / Gateway">
                  <Select value={f.adquirenteId != null ? String(f.adquirenteId) : ''} onChange={(v) => set('adquirenteId', v ? Number(v) : null)}
                    options={[['', '— opcional —'], ...adqOpcoes.map((a) => [String(a.id), a.nome] as [string, string])]} />
                </Campo>
              )}
              {perfil.mostraBandeira && (
                <Campo label="Bandeira *">
                  <Select value={f.bandeiraId != null ? String(f.bandeiraId) : ''} onChange={(v) => set('bandeiraId', v ? Number(v) : null)}
                    options={[['', '— selecione —'], ...bandeiras.map((b) => [String(b.id), b.nome] as [string, string])]} />
                </Campo>
              )}
              {perfil.mostraFinalidade && (
                <Campo label="Finalidade do encargo *">
                  <Select value={f.finalidade ?? ''} onChange={(v) => set('finalidade', v || null)}
                    options={[['', '— selecione —'], ...FINALIDADES_BOLETO.map((x) => [x, FINALIDADE_LABEL[x]] as [string, string])]} />
                </Campo>
              )}
            </div>

            {/* Nome e código — somente leitura, gerados pelo sistema */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="Nome (automático)">
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/80">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-white/30" /><span className="truncate">{nomeAuto || '— selecione a forma —'}</span>
                </div>
              </Campo>
              <Campo label="Código (automático)">
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/60">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-white/30" /><span className="font-mono">{editando?.code ?? 'gerado ao salvar'}</span>
                </div>
              </Campo>
              <Campo label="Descrição (opcional)" wide><input className={INPUT} value={f.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="Observação interna" /></Campo>
            </div>
            <div className="mt-3"><Toggle label="Tabela ativa" on={f.ativo} onChange={(v) => set('ativo', v)} /></div>
          </Secao>
        )}

        {/* ── 2. Cálculo (adaptativo por forma) ── */}
        {step === 2 && (
          <Secao icon={Calculator} titulo="Cálculo" dica="A tela se adapta à forma escolhida.">
            {!f.formaId ? (
              <p className="text-sm text-white/50">Selecione a forma na etapa anterior.</p>
            ) : perfil.mostraGrade ? (
              <GradeCredito grade={f.grade} onChange={(g) => set('grade', g)} bandeira={bandeira?.nome ?? null} />
            ) : calcBoleto === 'FIXO' || calcBoleto === null && perfil.calculo === 'PERCENTUAL' ? (
              // débito / PIX / transferência / dinheiro / Wise → percentual único;
              // boleto emissão/pagamento → valor fixo.
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {calcBoleto === 'FIXO' ? (
                  <>
                    <Campo label="Valor fixo *"><input type="number" step="0.01" min={0} className={INPUT} value={f.fixedFee ?? ''} onChange={(e) => set('fixedFee', e.target.value === '' ? null : Number(e.target.value))} placeholder="5.00" /></Campo>
                    <Campo label="Moeda"><Select value={f.moeda ?? 'BRL'} onChange={(v) => set('moeda', v || 'BRL')} options={[['BRL', 'BRL'], ...moedas.map((m) => [m.code, m.code] as [string, string])]} /></Campo>
                  </>
                ) : (
                  <Campo label="Percentual (%)"><input type="number" step="0.0001" min={0} className={INPUT} value={f.feePercent ?? ''} onChange={(e) => set('feePercent', e.target.value === '' ? null : Number(e.target.value))} placeholder="0.86" /></Campo>
                )}
              </div>
            ) : (
              // boleto multa / juros → percentual
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Campo label="Percentual (%) *"><input type="number" step="0.0001" min={0} className={INPUT} value={f.feePercent ?? ''} onChange={(e) => set('feePercent', e.target.value === '' ? null : Number(e.target.value))} placeholder={f.finalidade === 'MULTA' ? '2' : '1'} /></Campo>
                </div>
                <p className="text-[12px] text-white/45">
                  {f.finalidade === 'MULTA' ? 'Multa aplicada uma vez após o vencimento (padrão 2% a partir do 3º dia de atraso — a carência vem da condição de pagamento).' : 'Juros de mora simples, ao mês, pro-rata (padrão 1% a.m.). Aplicados no momento do pagamento em atraso.'}
                </p>
              </div>
            )}
          </Secao>
        )}

        {/* ── 3. Regras (absorção · aplicabilidade · vigência) ── */}
        {step === 3 && (
          <div className="space-y-4">
            <Secao icon={Scale} titulo="Absorção e incidência" dica="Quem paga a taxa e sobre o que ela incide.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Quem absorve"><Select value={f.quemAbsorve} onChange={(v) => set('quemAbsorve', v)} options={QUEM_ABSORVE.map((q) => [q, QUEM_ABSORVE_LABEL[q]] as [string, string])} /></Campo>
                {f.quemAbsorve === 'COMPARTILHADA' && <Campo label="% que a empresa absorve"><input type="number" step="0.01" min={0} max={100} className={INPUT} value={f.absorcaoPercentEmpresa ?? ''} onChange={(e) => set('absorcaoPercentEmpresa', e.target.value === '' ? null : Number(e.target.value))} /></Campo>}
                <Campo label="Base de incidência"><Select value={f.baseIncidencia} onChange={(v) => set('baseIncidencia', v)} options={BASE_INCIDENCIA.map((b) => [b, BASE_INCIDENCIA_LABEL[b]] as [string, string])} /></Campo>
                <Campo label="Prioridade"><input type="number" className={INPUT} value={f.prioridade} onChange={(e) => set('prioridade', Number(e.target.value) || 0)} /></Campo>
              </div>
            </Secao>
            <Secao icon={Cpu} titulo="Onde se aplica (opcional)" dica="Vazio = qualquer moeda, país e serviço.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Campo label="Moedas"><MultiSelect opcoes={moedas.map((m) => ({ id: m.id, label: m.code, hint: m.name || undefined }))} selecionados={f.moedasIds} onChange={(ids) => set('moedasIds', ids)} placeholder="Todas as moedas" dicaVazio="Todas as moedas." vazioMsg="Nenhuma moeda." busca acoes buscaPlaceholder="Filtrar moeda…" /></Campo>
                <Campo label="Países"><MultiSelect opcoes={paises.map((p) => ({ id: p.id, label: `${p.flag ? `${p.flag} ` : ''}${p.countryLabel}`, hint: p.countryKey }))} selecionados={f.paisesIds} onChange={(ids) => set('paisesIds', ids)} placeholder="Todos os países" dicaVazio="Todos os países." vazioMsg="Nenhum país." busca acoes buscaPlaceholder="Filtrar país…" /></Campo>
                <Campo label="Serviços"><MultiSelect opcoes={servicos.map((s) => ({ id: s.id, label: s.name, hint: s.code || undefined }))} selecionados={f.servicosIds} onChange={(ids) => set('servicosIds', ids)} placeholder="Todos os serviços" dicaVazio="Todos os serviços." vazioMsg="Nenhum serviço." busca acoes buscaPlaceholder="Filtrar serviço…" /></Campo>
              </div>
            </Secao>
            <Secao icon={Tag} titulo="Vigência">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Válida a partir de"><input type="date" className={INPUT} value={f.vigenciaInicio?.slice(0, 10) ?? ''} onChange={(e) => set('vigenciaInicio', e.target.value || null)} /></Campo>
                <Campo label="Válida até"><input type="date" className={INPUT} value={f.vigenciaFim?.slice(0, 10) ?? ''} onChange={(e) => set('vigenciaFim', e.target.value || null)} /></Campo>
              </div>
            </Secao>
          </div>
        )}

        {/* ── 4. Revisão ── */}
        {step === 4 && (
          <div className="space-y-3">
            <Secao icon={Check} titulo="Revisão">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                {[
                  ['Nome', nomeAuto || '—'],
                  ['Forma', forma?.name ?? '—'],
                  perfil.mostraBandeira ? ['Bandeira', bandeira?.nome ?? '—'] : null,
                  perfil.mostraAdquirente ? ['Adquirente', adquirentes.find((a) => a.id === f.adquirenteId)?.nome ?? '—'] : null,
                  perfil.mostraFinalidade ? ['Finalidade', f.finalidade ? FINALIDADE_LABEL[f.finalidade] : '—'] : null,
                  perfil.mostraGrade
                    ? ['Grade', `${f.grade.length} parcela(s) · ${f.grade[0]?.pct ?? '—'}% → ${f.grade[f.grade.length - 1]?.pct ?? '—'}%`]
                    : calcBoleto === 'FIXO'
                      ? ['Valor fixo', `${f.moeda || 'BRL'} ${f.fixedFee ?? '—'}`]
                      : ['Percentual', `${f.feePercent ?? '—'}%`],
                  ['Absorção', QUEM_ABSORVE_LABEL[f.quemAbsorve]],
                  ['Status', f.ativo ? 'Ativa' : 'Inativa'],
                ].filter(Boolean).map((row, i) => {
                  const [l, v] = row as [string, string]
                  return <div key={i} className="flex justify-between gap-3"><span className="text-white/45">{l}</span><span className="truncate text-right text-white/85">{v}</span></div>
                })}
              </div>
            </Secao>
            <div className={`${GLASS} p-4`}>
              <div className="mb-1 flex items-center gap-2"><Cpu className="h-4 w-4" style={{ color: OURO }} /><h4 className="text-sm font-semibold text-white">Como o motor usa esta tabela</h4></div>
              <p className="text-[12px] leading-relaxed text-white/55">
                Na Cobrança, o motor localiza a taxa pela <b>forma</b>, pela <b>bandeira</b> e pela <b>quantidade de parcelas</b>, aplica exatamente o percentual da grade e <b>congela</b> o valor. Editar aqui nunca altera cobranças já emitidas.
              </p>
            </div>
          </div>
        )}
      </>
    </ModalWizard>
  )
}

// ── Grade 1x–12x do cartão de crédito (toda a tabela numa tela) ─────────────
function GradeCredito({ grade, onChange, bandeira }: { grade: { n: number; pct: number | null }[]; onChange: (g: { n: number; pct: number | null }[]) => void; bandeira: string | null }) {
  const ordenada = [...grade].sort((a, b) => a.n - b.n)
  const maxN = ordenada.length ? Math.max(...ordenada.map((g) => g.n)) : 0
  const patch = (n: number, pct: number | null) => onChange(ordenada.map((g) => (g.n === n ? { ...g, pct } : g)))
  const addParcela = () => { if (maxN < 12) onChange([...ordenada, { n: maxN + 1, pct: null }]) }
  const removerUltima = () => { if (ordenada.length > 1) onChange(ordenada.slice(0, -1)) }

  const nInput = 'w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:border-white/30'
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-white/50">Grade de {bandeira || 'cartão'} — um percentual por quantidade de parcelas. Editável e salvo de uma só vez.</p>
      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03] text-left text-[11px] uppercase tracking-wide text-white/40">
              <th className="px-3 py-2 font-medium">Parcelas</th>
              <th className="px-3 py-2 font-medium">Taxa (%)</th>
            </tr>
          </thead>
          <tbody>
            {ordenada.map((g) => (
              <tr key={g.n} className="border-b border-white/5 last:border-0">
                <td className="px-3 py-1.5 font-medium text-white/80">{g.n}x</td>
                <td className="px-3 py-1.5">
                  <input type="number" step="0.0001" min={0} placeholder="0,00" className={nInput} value={g.pct ?? ''}
                    onChange={(e) => patch(g.n, e.target.value === '' ? null : Number(e.target.value))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={addParcela} disabled={maxN >= 12} className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" /> Adicionar parcela
        </button>
        <button type="button" onClick={removerUltima} disabled={ordenada.length <= 1} className="inline-flex items-center gap-1 rounded-md border border-red-500/20 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-500/10 disabled:opacity-40">
          <Trash2 className="h-3.5 w-3.5" /> Remover última
        </button>
        <span className="text-[11px] text-white/35">{ordenada.length} de até 12 parcelas</span>
      </div>
    </div>
  )
}
