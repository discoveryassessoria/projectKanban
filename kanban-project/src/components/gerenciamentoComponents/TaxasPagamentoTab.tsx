'use client'

// src/components/gerenciamentoComponents/TaxasPagamentoTab.tsx
// ============================================================================
// TAXA DE PAGAMENTO — regra REUTILIZÁVEL de cálculo. Não conhece Receita,
// Cobrança nem Pagamento: só parametriza como uma taxa é calculada quando uma
// Cobrança usar determinada Forma. Identidade premium (dark glass + OURO) em
// WIZARD enxuto. Enums = fonte única (lib/financeiro/taxa-constants).
//   Backend: /api/gerenciamento/taxas-pagamento (GET/POST) + /[id] (PUT/DELETE)
// ============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Percent, Search, Plus, X, Check, ArrowRight, ArrowLeft, Loader2, Pencil, Trash2,
  Tag, Calculator, Layers, Scale, Filter, CalendarClock, Cpu, Sparkles,
} from 'lucide-react'
import { OURO, GLASS, INPUT, jf, toggleArr, Secao, Campo, Select, Toggle, ChipsMulti, Stepper } from './pagamentoUI'
import {
  FEE_TYPES, FEE_TYPES_LABEL, FEE_TYPES_COM_MOEDA, CATEGORIAS_TAXA, CATEGORIAS_TAXA_LABEL,
  APLICA_PARCELA, APLICA_PARCELA_LABEL, ANTICIPATION_TYPES, ANTICIPATION_TYPES_LABEL,
  BASE_INCIDENCIA, BASE_INCIDENCIA_LABEL, QUEM_ABSORVE, QUEM_ABSORVE_LABEL,
  ADQUIRENTES, ADQUIRENTES_LABEL, MOMENTO_CAMBIO, MOMENTO_CAMBIO_LABEL,
} from '@/lib/financeiro/taxa-constants'

type Ref = { id: number; name: string; code?: string | null }
type MoedaRef = { id: number; code: string; name: string | null }
type Taxa = {
  id: number; code: string | null; name: string; descricao: string | null; categoria: string | null; ativo: boolean; prioridade: number
  formaPagamentoId: number | null; formasAplicaveis: number[]
  feeType: string | null; feePercent: number | null; fixedFee: number | null; moeda: string | null
  aplicaParcela: string | null; installmentsFrom: number | null; installmentsTo: number | null
  anticipationType: string | null; anticipationPercent: number | null; anticipationFixed: number | null; anticipationMinDays: number | null
  baseIncidencia: string; quemAbsorve: string; absorcaoPercentEmpresa: number | null; adquirente: string | null
  paises: string[]; moedasAplicaveis: string[]; servicos: number[]; modalidades: string[]; tiposProcesso: string[]
  valorMinimo: number | null; valorMaximo: number | null; canal: string | null; gateway: string | null; perfil: string | null
  momentoCambio: string | null; vigenciaInicio: string | null; vigenciaFim: string | null
}
type Form = Omit<Taxa, 'id'>

const VAZIO = (): Form => ({
  code: '', name: '', descricao: '', categoria: null, ativo: true, prioridade: 0,
  formaPagamentoId: null, formasAplicaveis: [],
  feeType: 'percentage', feePercent: null, fixedFee: null, moeda: null,
  aplicaParcela: 'TODAS', installmentsFrom: null, installmentsTo: null,
  anticipationType: 'NAO_POSSUI', anticipationPercent: null, anticipationFixed: null, anticipationMinDays: null,
  baseIncidencia: 'TOTAL', quemAbsorve: 'EMPRESA', absorcaoPercentEmpresa: null, adquirente: null,
  paises: [], moedasAplicaveis: [], servicos: [], modalidades: [], tiposProcesso: [],
  valorMinimo: null, valorMaximo: null, canal: '', gateway: '', perfil: '',
  momentoCambio: null, vigenciaInicio: null, vigenciaFim: null,
})

const PASSOS = ['Identificação', 'Cálculo', 'Incidência', 'Absorção', 'Aplicabilidade', 'Vigência', 'Revisão']

export default function TaxasPagamentoTab() {
  const [itens, setItens] = useState<Taxa[]>([])
  const [formas, setFormas] = useState<Ref[]>([])
  const [moedas, setMoedas] = useState<MoedaRef[]>([])
  const [servicos, setServicos] = useState<Ref[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const [aberto, setAberto] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErroLista(null)
    try {
      const d = await jf('/api/gerenciamento/taxas-pagamento', { cache: 'no-store' })
      setItens(d.taxas || []); setFormas(d.formasPagamento || []); setMoedas(d.moedas || []); setServicos(d.servicos || [])
    } catch (e: any) { setErroLista(e.message || 'Não foi possível carregar.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return itens
    return itens.filter((x) => x.name.toLowerCase().includes(q) || (x.code || '').toLowerCase().includes(q))
  }, [itens, busca])

  const editando = editId != null ? itens.find((x) => x.id === editId) ?? null : null

  async function excluir(x: Taxa) {
    if (!confirm(`Excluir a taxa "${x.name}"?`)) return
    try { await jf(`/api/gerenciamento/taxas-pagamento/${x.id}`, { method: 'DELETE' }); await carregar() }
    catch (e: any) { alert(e.message || 'Não foi possível excluir.') }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${OURO}22`, color: OURO }}><Percent className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-semibold text-white">Taxas de Pagamento</h2>
            <p className="text-sm text-white/50">Regra reutilizável de cálculo. A Cobrança escolhe a Forma e congela a taxa.</p>
          </div>
        </div>
        <button onClick={() => { setEditId(null); setAberto(true) }} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition" style={{ background: OURO }}>
          <Plus className="h-4 w-4" /> Nova taxa
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar taxa…" className="w-full rounded-lg border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>
      ) : erroLista ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{erroLista}<button onClick={carregar} className="ml-3 underline hover:text-white">Tentar de novo</button></div>
      ) : filtrados.length === 0 ? (
        <div className={`${GLASS} flex flex-col items-center gap-2 py-16 text-center`}>
          <Percent className="h-10 w-10 text-white/20" />
          <p className="text-white/60">{busca ? 'Nenhuma taxa encontrada.' : 'Nenhuma taxa cadastrada.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((x) => (
            <div key={x.id} className={`${GLASS} flex items-center gap-4 p-4 transition hover:border-white/20`}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${OURO}18`, color: OURO }}><Percent className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-white">{x.name}</span>
                  {x.categoria && <span className="shrink-0 rounded-md border border-white/15 px-2 py-0.5 text-[11px] text-white/60">{CATEGORIAS_TAXA_LABEL[x.categoria] || x.categoria}</span>}
                  {!x.ativo && <span className="shrink-0 rounded-md border border-white/15 px-2 py-0.5 text-[11px] text-white/40">inativa</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
                  {x.code && <span className="font-mono">{x.code}</span>}
                  <span>{FEE_TYPES_LABEL[x.feeType || ''] || x.feeType || '—'}</span>
                  {x.feePercent != null && <span>{x.feePercent}%</span>}
                  {x.fixedFee != null && <span>{x.moeda || ''} {x.fixedFee}</span>}
                  <span>{APLICA_PARCELA_LABEL[x.aplicaParcela || 'TODAS']}</span>
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
        <TaxaWizard
          editando={editando} formas={formas} moedas={moedas} servicos={servicos}
          onClose={() => setAberto(false)} onSalvo={() => { setAberto(false); carregar() }}
        />
      )}
    </div>
  )
}

// ── wizard premium ─────────────────────────────────────────────────────────
function TaxaWizard({ editando, formas, moedas, servicos, onClose, onSalvo }: {
  editando: Taxa | null; formas: Ref[]; moedas: MoedaRef[]; servicos: Ref[]; onClose: () => void; onSalvo: () => void
}) {
  const [step, setStep] = useState(1)
  const [f, setF] = useState<Form>(() => editando ? { ...VAZIO(), ...normalizar(editando) } : VAZIO())
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  const comMoeda = FEE_TYPES_COM_MOEDA.includes(f.feeType || '')
  const temPercent = (f.feeType || '').includes('percentage')
  const temFixo = (f.feeType || '').includes('fixed') || (f.feeType || '').includes('percentage_plus_fixed')
  const temAntecipacao = f.anticipationType === 'OPCIONAL' || f.anticipationType === 'OBRIGATORIA'

  async function salvar() {
    if (!f.name.trim()) { setStep(1); setErro('Informe o nome.'); return }
    setSalvando(true); setErro(null)
    try {
      const body = JSON.stringify({ ...f, anticipationEnabled: temAntecipacao })
      if (editando) await jf(`/api/gerenciamento/taxas-pagamento/${editando.id}`, { method: 'PUT', body })
      else await jf('/api/gerenciamento/taxas-pagamento', { method: 'POST', body })
      onSalvo()
    } catch (e: any) { setErro(e.message || 'Não foi possível salvar.') }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 border-b border-white/10 bg-zinc-900/95 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" style={{ color: OURO }} /><h3 className="text-base font-semibold">{editando ? 'Editar taxa' : 'Nova taxa de pagamento'}</h3></div>
            <button onClick={onClose} className="text-white/40 transition hover:text-white"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-3"><Stepper passos={PASSOS} atual={step} /></div>
        </div>

        <div className="space-y-4 px-6 py-5">
          {erro && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erro}</div>}

          {step === 1 && (
            <Secao icon={Tag} titulo="Identificação">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Nome *"><input className={INPUT} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Taxa Cartão 12x" autoFocus /></Campo>
                <Campo label="Código"><input className={INPUT} value={f.code ?? ''} onChange={(e) => set('code', e.target.value)} placeholder="TAX-CARD" /></Campo>
                <Campo label="Categoria"><Select value={f.categoria ?? ''} onChange={(v) => set('categoria', v || null)} options={[['', '— opcional —'], ...CATEGORIAS_TAXA.map((c) => [c, CATEGORIAS_TAXA_LABEL[c]] as [string, string])]} /></Campo>
                <Campo label="Prioridade"><input type="number" className={INPUT} value={f.prioridade} onChange={(e) => set('prioridade', Number(e.target.value) || 0)} /></Campo>
                <Campo label="Descrição" wide><input className={INPUT} value={f.descricao ?? ''} onChange={(e) => set('descricao', e.target.value)} placeholder="Quando e por que esta taxa se aplica" /></Campo>
              </div>
              <div className="mt-3"><Toggle label="Taxa ativa" on={f.ativo} onChange={(v) => set('ativo', v)} /></div>
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] uppercase tracking-wide text-white/40">Formas de pagamento aplicáveis</p>
                {formas.length === 0 ? <p className="text-[11px] text-white/35">Nenhuma forma ativa cadastrada.</p> : (
                  <ChipsMulti items={formas.map((x) => ({ id: x.id, label: x.name }))} selecionados={f.formasAplicaveis} onToggle={(id) => set('formasAplicaveis', toggleArr(f.formasAplicaveis, Number(id)))} />
                )}
                <p className="mt-1 text-[11px] text-white/35">Vazio = aplica a qualquer forma. Pode marcar várias.</p>
              </div>
            </Secao>
          )}

          {step === 2 && (
            <Secao icon={Calculator} titulo="Tipo de cálculo" dica="Percentual independe de moeda; valor fixo depende — a moeda só aparece quando necessária.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Tipo"><Select value={f.feeType ?? 'percentage'} onChange={(v) => set('feeType', v)} options={FEE_TYPES.map((t) => [t, FEE_TYPES_LABEL[t]] as [string, string])} /></Campo>
                {comMoeda && <Campo label="Moeda (valor fixo)"><Select value={f.moeda ?? ''} onChange={(v) => set('moeda', v || null)} options={[['', '— selecione —'], ...moedas.map((m) => [m.code, m.code + (m.name ? ` · ${m.name}` : '')] as [string, string])]} /></Campo>}
                {temPercent && <Campo label="Percentual (%)"><input type="number" step="0.0001" className={INPUT} value={f.feePercent ?? ''} onChange={(e) => set('feePercent', e.target.value === '' ? null : Number(e.target.value))} placeholder="2.99" /></Campo>}
                {temFixo && <Campo label="Valor fixo"><input type="number" step="0.01" className={INPUT} value={f.fixedFee ?? ''} onChange={(e) => set('fixedFee', e.target.value === '' ? null : Number(e.target.value))} placeholder="0.39" /></Campo>}
              </div>
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] uppercase tracking-wide text-white/40">Antecipação</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Campo label="Tipo"><Select value={f.anticipationType ?? 'NAO_POSSUI'} onChange={(v) => set('anticipationType', v)} options={ANTICIPATION_TYPES.map((t) => [t, ANTICIPATION_TYPES_LABEL[t]] as [string, string])} /></Campo>
                  {temAntecipacao && <>
                    <Campo label="% antecipação"><input type="number" step="0.0001" className={INPUT} value={f.anticipationPercent ?? ''} onChange={(e) => set('anticipationPercent', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                    <Campo label="Valor fixo antecipação"><input type="number" step="0.01" className={INPUT} value={f.anticipationFixed ?? ''} onChange={(e) => set('anticipationFixed', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                    <Campo label="Prazo mínimo (dias)"><input type="number" className={INPUT} value={f.anticipationMinDays ?? ''} onChange={(e) => set('anticipationMinDays', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                  </>}
                </div>
              </div>
            </Secao>
          )}

          {step === 3 && (
            <Secao icon={Layers} titulo="Incidência" dica="Sobre o que a taxa incide e a quais parcelas se aplica.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Base de incidência"><Select value={f.baseIncidencia} onChange={(v) => set('baseIncidencia', v)} options={BASE_INCIDENCIA.map((b) => [b, BASE_INCIDENCIA_LABEL[b]] as [string, string])} /></Campo>
                <Campo label="Aplica-se a"><Select value={f.aplicaParcela ?? 'TODAS'} onChange={(v) => set('aplicaParcela', v)} options={APLICA_PARCELA.map((a) => [a, APLICA_PARCELA_LABEL[a]] as [string, string])} /></Campo>
                {f.aplicaParcela === 'FAIXA' && <>
                  <Campo label="Parcela inicial"><input type="number" min={1} className={INPUT} value={f.installmentsFrom ?? ''} onChange={(e) => set('installmentsFrom', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                  <Campo label="Parcela final"><input type="number" min={1} className={INPUT} value={f.installmentsTo ?? ''} onChange={(e) => set('installmentsTo', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                </>}
              </div>
            </Secao>
          )}

          {step === 4 && (
            <Secao icon={Scale} titulo="Absorção" dica="Quem paga a taxa. Na Cobrança essa decisão pode ser refinada quando 'Configurável na Cobrança'.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Quem absorve"><Select value={f.quemAbsorve} onChange={(v) => set('quemAbsorve', v)} options={QUEM_ABSORVE.map((q) => [q, QUEM_ABSORVE_LABEL[q]] as [string, string])} /></Campo>
                {f.quemAbsorve === 'COMPARTILHADA' && <Campo label="% que a empresa absorve"><input type="number" step="0.01" min={0} max={100} className={INPUT} value={f.absorcaoPercentEmpresa ?? ''} onChange={(e) => set('absorcaoPercentEmpresa', e.target.value === '' ? null : Number(e.target.value))} /></Campo>}
                <Campo label="Adquirente"><Select value={f.adquirente ?? ''} onChange={(v) => set('adquirente', v || null)} options={[['', '— opcional —'], ...ADQUIRENTES.map((a) => [a, ADQUIRENTES_LABEL[a]] as [string, string])]} /></Campo>
              </div>
            </Secao>
          )}

          {step === 5 && (
            <Secao icon={Filter} titulo="Aplicabilidade" dica="Restrinja onde a taxa vale (tudo opcional). Vazio = sem restrição.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Países (ISO, vírgula)"><input className={INPUT} value={f.paises.join(', ')} onChange={(e) => set('paises', e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))} placeholder="BR, PT" /></Campo>
                <Campo label="Moedas (vírgula)"><input className={INPUT} value={f.moedasAplicaveis.join(', ')} onChange={(e) => set('moedasAplicaveis', e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))} placeholder="BRL, EUR" /></Campo>
                <Campo label="Valor mínimo"><input type="number" step="0.01" className={INPUT} value={f.valorMinimo ?? ''} onChange={(e) => set('valorMinimo', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                <Campo label="Valor máximo"><input type="number" step="0.01" className={INPUT} value={f.valorMaximo ?? ''} onChange={(e) => set('valorMaximo', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                <Campo label="Canal"><input className={INPUT} value={f.canal ?? ''} onChange={(e) => set('canal', e.target.value)} /></Campo>
                <Campo label="Gateway"><input className={INPUT} value={f.gateway ?? ''} onChange={(e) => set('gateway', e.target.value)} /></Campo>
                <Campo label="Perfil"><input className={INPUT} value={f.perfil ?? ''} onChange={(e) => set('perfil', e.target.value)} /></Campo>
                <Campo label="Câmbio (taxa internacional)"><Select value={f.momentoCambio ?? ''} onChange={(v) => set('momentoCambio', v || null)} options={[['', '— não se aplica —'], ...MOMENTO_CAMBIO.map((m) => [m, MOMENTO_CAMBIO_LABEL[m]] as [string, string])]} /></Campo>
              </div>
              {servicos.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-white/40">Serviços (opcional)</p>
                  <ChipsMulti items={servicos.map((x) => ({ id: x.id, label: x.name }))} selecionados={f.servicos} onToggle={(id) => set('servicos', toggleArr(f.servicos, Number(id)))} />
                </div>
              )}
            </Secao>
          )}

          {step === 6 && (
            <Secao icon={CalendarClock} titulo="Vigência">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Válida a partir de"><input type="date" className={INPUT} value={f.vigenciaInicio?.slice(0, 10) ?? ''} onChange={(e) => set('vigenciaInicio', e.target.value || null)} /></Campo>
                <Campo label="Válida até"><input type="date" className={INPUT} value={f.vigenciaFim?.slice(0, 10) ?? ''} onChange={(e) => set('vigenciaFim', e.target.value || null)} /></Campo>
              </div>
            </Secao>
          )}

          {step === 7 && (
            <div className="space-y-3">
              <Secao icon={Check} titulo="Revisão">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {[
                    ['Nome', f.name], ['Categoria', f.categoria ? CATEGORIAS_TAXA_LABEL[f.categoria] : '—'],
                    ['Cálculo', FEE_TYPES_LABEL[f.feeType || ''] || '—'],
                    ['Valor', [temPercent && f.feePercent != null ? `${f.feePercent}%` : null, temFixo && f.fixedFee != null ? `${f.moeda || ''} ${f.fixedFee}` : null].filter(Boolean).join(' + ') || '—'],
                    ['Incidência', BASE_INCIDENCIA_LABEL[f.baseIncidencia]], ['Aplica-se a', APLICA_PARCELA_LABEL[f.aplicaParcela || 'TODAS']],
                    ['Absorção', QUEM_ABSORVE_LABEL[f.quemAbsorve]], ['Antecipação', ANTICIPATION_TYPES_LABEL[f.anticipationType || 'NAO_POSSUI']],
                    ['Formas', f.formasAplicaveis.length ? `${f.formasAplicaveis.length} selecionada(s)` : 'qualquer'],
                  ].map(([l, v], i) => (
                    <div key={i} className="flex justify-between gap-3"><span className="text-white/45">{l}</span><span className="truncate text-right text-white/85">{String(v ?? '—')}</span></div>
                  ))}
                </div>
              </Secao>
              <div className={`${GLASS} p-4`}>
                <div className="mb-1 flex items-center gap-2"><Cpu className="h-4 w-4" style={{ color: OURO }} /><h4 className="text-sm font-semibold text-white">Como o motor usa esta taxa</h4></div>
                <p className="text-[12px] leading-relaxed text-white/55">
                  Esta taxa será aplicada quando: a <b>Forma de Pagamento</b> for compatível, a <b>Condição</b> permitir e a <b>Cobrança</b> selecionar essa Forma.
                  O motor calcula e <b>congela</b> o valor na Cobrança. Ela <b>nunca</b> é aplicada diretamente na Receita nem congelada na Condição.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between border-t border-white/10 bg-zinc-900/95 px-6 py-4">
          <button onClick={() => (step > 1 ? setStep(step - 1) : onClose())} className="inline-flex items-center gap-1 text-sm text-white/60 transition hover:text-white"><ArrowLeft className="h-4 w-4" /> {step > 1 ? 'Voltar' : 'Cancelar'}</button>
          {step < PASSOS.length ? (
            <button onClick={() => { if (step === 1 && !f.name.trim()) { setErro('Informe o nome.'); return } setErro(null); setStep(step + 1) }} className="inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition" style={{ background: OURO }}>Próximo <ArrowRight className="h-4 w-4" /></button>
          ) : (
            <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition disabled:opacity-50" style={{ background: OURO }}>{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{salvando ? 'Salvando…' : 'Salvar'}</button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Normaliza a taxa vinda da API (nulls → arrays/strings; datas mantidas ISO). */
function normalizar(t: Taxa): Partial<Form> {
  return {
    ...t,
    code: t.code ?? '', descricao: t.descricao ?? '', canal: t.canal ?? '', gateway: t.gateway ?? '', perfil: t.perfil ?? '',
    formasAplicaveis: t.formasAplicaveis ?? [], paises: t.paises ?? [], moedasAplicaveis: t.moedasAplicaveis ?? [],
    servicos: t.servicos ?? [], modalidades: t.modalidades ?? [], tiposProcesso: t.tiposProcesso ?? [],
    aplicaParcela: t.aplicaParcela ?? 'TODAS', anticipationType: t.anticipationType ?? 'NAO_POSSUI',
    feeType: t.feeType ?? 'percentage', baseIncidencia: t.baseIncidencia ?? 'TOTAL', quemAbsorve: t.quemAbsorve ?? 'EMPRESA',
    vigenciaInicio: t.vigenciaInicio ?? null, vigenciaFim: t.vigenciaFim ?? null,
  }
}
