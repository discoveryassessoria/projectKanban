'use client'

// src/components/gerenciamentoComponents/CondicoesPagamentoTab.tsx
// ============================================================================
// CONDIÇÃO DE PAGAMENTO — REGRA REUTILIZÁVEL usada pelo motor ao criar Cobranças.
// NUNCA representa uma cobrança real nem congela cliente/conta/cotação/datas.
// Tudo aqui é POLÍTICA/SUGESTÃO; a decisão efetiva é da Cobrança.
// Identidade premium (dark glass + OURO) em WIZARD de 9 passos (shell pagamentoUI).
// Legados removidos da UI: "Forma padrão", "Moeda do cadastro", "Aplicar taxas",
// câmbio congelado, carteira obrigatória (virou sugerida). Colunas preservadas no banco.
//   Backend: /api/gerenciamento/condicoes-pagamento (GET/POST) + /[id] (PUT/DELETE)
// ============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CalendarClock, Search, Plus, X, Check, ArrowRight, ArrowLeft, Loader2, Pencil, Trash2,
  Tag, Filter, Layers, CalendarRange, CreditCard, Percent, Coins, Scale, Sparkles, GitBranch,
} from 'lucide-react'
import { OURO, OURO_TINTA, GLASS, INPUT, jf, toggleArr, Secao, Campo, Select, Toggle, ChipsMulti, MultiSelect, ModalWizard, Stepper, fecharTodosMultiSelects } from './pagamentoUI'
import {
  POLITICAS_TAXAS, POLITICAS_TAXAS_LABEL, POLITICAS_CAMBIO, POLITICAS_CAMBIO_LABEL,
  APLICA_A, APLICA_A_LABEL, TIPOS_PAGAMENTO, TIPOS_PAGAMENTO_LABEL, PERIODICIDADES, PERIODICIDADES_LABEL,
  INICIOS, INICIOS_LABEL, DISTRIBUICOES, DISTRIBUICOES_LABEL, ENTRADA_TIPOS, ENTRADA_TIPOS_LABEL,
  DIA_INEXISTENTE, DIA_INEXISTENTE_LABEL, AJUSTE_DATA, AJUSTE_DATA_LABEL,
  MULTA_TIPOS, JUROS_TIPOS, JUROS_PERIODOS, DESCONTO_TIPOS,
} from '@/lib/financeiro/condicao-constants'
import { useApi } from "@/src/lib/dados"

type Ref = { id: number; name: string; code?: string | null; icone?: string | null }
type CarteiraRef = { id: number; nome: string }
type TaxaRef = { id: number; name: string; feeType?: string | null }
type MoedaRef = { id: number; code: string; name?: string | null }
type PaisRef = { id: number; countryKey: string; countryLabel: string; flag?: string | null }
type ModalidadeRef = { id: number; countryKey: string; modalityKey: string; modalityLabel: string }
type Condicao = any

// 4 seções (spec): sem wizard fragmentado. Os 9 blocos foram reagrupados em:
//   1 Identificação · 2 Parcelamento/entrada/cronograma/formas/política ·
//   3 Aplicabilidade + câmbio + encargos · 4 Revisão.
const PASSOS = ['Identificação', 'Parcelamento e vencimentos', 'Aplicabilidade e encargos', 'Revisão']

const VAZIO = () => ({
  // `codigo` é somente leitura: o backend gera pelo serviço central e nunca muda.
  // `formaPadraoId` é a FORMA PADRÃO (persistida na coluna legada
  // formaSugeridaId). Só sugestão inicial da cobrança — nunca uma restrição.
  name: '', codigo: '', descricao: '', ativo: true, carteiraId: null as number | null, formaPadraoId: null as number | null,
  aplicaA: 'AMBOS',
  // Aplicabilidade por ID de cadastro real (nada de texto livre). Vazio = sem restrição.
  moedasIds: [] as number[], paisesIds: [] as number[], modalidadesIds: [] as number[], servicosIds: [] as number[],
  tiposProcesso: [] as string[],
  valorMinimo: null as number | null, valorMaximo: null as number | null,
  tipoPagamento: 'PARCELADO', temEntrada: false, entradaObrigatoria: false, entradaTipo: 'PERCENTUAL' as string | null,
  percentEntrada: null as number | null, valorEntradaFixo: null as number | null, entradaMin: null as number | null, entradaMax: null as number | null,
  entradaCompoeTotal: true, entradaAdicional: false,
  parcelasMin: 1 as number | null, parcelasPadrao: 1 as number | null, parcelasMax: 1 as number | null,
  permiteParcelasPersonalizadas: false, permiteEdicaoManual: false,
  inicioCronograma: 'IMEDIATA', primeiraParcelaDias: null as number | null, primeiraParcelaData: '',
  periodicidade: 'MENSAL', periodicidadeDias: null as number | null, diaFixo: null as number | null,
  diaInexistente: null as string | null, comportamentoFimSemana: null as string | null, comportamentoFeriado: null as string | null,
  distribuicao: 'ULTIMA_AJUSTA', primeiraParcelaPercent: null as number | null,
  formasPermitidas: [] as number[], politicaTaxas: 'IGNORAR', taxasVinculadas: [] as number[],
  politicaCambio: 'PADRAO_SISTEMA',
  multaTipo: null as string | null, multaValor: null as number | null, multaPercent: null as number | null,
  jurosTipo: null as string | null, jurosPeriodo: null as string | null, jurosMesPercent: null as number | null, carenciaDias: null as number | null,
  descontoTipo: null as string | null, descontoPercent: null as number | null, descontoAntecipacaoPercent: null as number | null,
  descontoAVistaPercent: null as number | null, descontoAntecipacaoAuto: false, quemConcedeDesconto: '',
  observacoes: '',
})
type Form = ReturnType<typeof VAZIO>

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function CondicoesPagamentoTab() {
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState(false)
  const [editando, setEditando] = useState<Condicao | null>(null)

  // UMA consulta, várias listas derivadas da MESMA resposta — o endpoint já
  // devolve tudo junto. loading/erro vêm da camada; nada de setState em efeito.
  const { dados, carregando: loading, erro, recarregar: carregar } = useApi<{ condicoes?: Condicao[], carteiras?: any[], formasPagamento?: any[], taxas?: any[], servicos?: any[], moedas?: any[], paises?: any[], modalidades?: any[] }>('/api/gerenciamento/condicoes-pagamento')
  const itens: Condicao[] = dados?.condicoes ?? SEM_ITENS
  const carteiras: any[] = dados?.carteiras ?? SEM_ITENS
  const formas: any[] = dados?.formasPagamento ?? SEM_ITENS
  const taxas: any[] = dados?.taxas ?? SEM_ITENS
  const servicos: any[] = dados?.servicos ?? SEM_ITENS
  const moedas: any[] = dados?.moedas ?? SEM_ITENS
  const paises: any[] = dados?.paises ?? SEM_ITENS
  const modalidades: any[] = dados?.modalidades ?? SEM_ITENS
  const erroLista = erro ? (erro.message || 'Não foi possível carregar.') : null

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return itens
    return itens.filter((x: any) => x.name.toLowerCase().includes(q) || (x.codigo || '').toLowerCase().includes(q))
  }, [itens, busca])

  async function excluir(x: Condicao) {
    if (!confirm(`Excluir a condição "${x.name}"?`)) return
    try { await jf(`/api/gerenciamento/condicoes-pagamento/${x.id}`, { method: 'DELETE' }); await carregar() }
    catch (e: any) { alert(e.message || 'Não foi possível excluir. Se estiver em uso, desative.') }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${OURO}22`, color: OURO_TINTA }}><CalendarClock className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-semibold text-white">Condições de Pagamento</h2>
            <p className="text-sm text-[var(--text-secondary)]">Regra reutilizável do motor. Só sugere/parametriza — a Cobrança decide.</p>
          </div>
        </div>
        <button onClick={() => { setEditando(null); setAberto(true) }} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition" style={{ background: OURO }}>
          <Plus className="h-4 w-4" /> Nova condição
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar condição…" className="w-full rounded-lg border border-[var(--border-default)] bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder:text-[var(--text-muted)] outline-none focus:border-white/25" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-[var(--text-secondary)]" /></div>
      ) : erroLista ? (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 text-sm text-red-700">{erroLista}<button onClick={() => void carregar()} className="ml-3 underline hover:text-white">Tentar de novo</button></div>
      ) : filtrados.length === 0 ? (
        <div className={`${GLASS} flex flex-col items-center gap-2 py-16 text-center`}>
          <CalendarClock className="h-10 w-10 text-[var(--text-muted)]" />
          <p className="text-[var(--text-secondary)]">{busca ? 'Nenhuma condição encontrada.' : 'Nenhuma condição cadastrada.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((x: any) => {
            const usoReal = (x._count?.receitas || 0) + (x._count?.custos || 0) + (x._count?.configuracoes || 0)
            return (
              <div key={x.id} className={`${GLASS} flex items-center gap-4 p-4 transition hover:border-[var(--border-strong)]`}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${OURO}18`, color: OURO_TINTA }}><CalendarClock className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-white">{x.name}</span>
                    {x.codigo && <span className="shrink-0 rounded-md border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">v{x.versao} · {x.codigo}</span>}
                    {!x.ativo && <span className="shrink-0 rounded-md border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">inativa</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                    <span>{APLICA_A_LABEL[x.aplicaA] || x.aplicaA}</span>
                    <span>{TIPOS_PAGAMENTO_LABEL[x.tipoPagamento] || x.tipoPagamento}{x.tipoPagamento === 'PARCELADO' ? ` até ${x.parcelasMax ?? '—'}×` : ''}</span>
                    <span>{POLITICAS_TAXAS_LABEL[x.politicaTaxas] || 'taxas: —'}</span>
                    {usoReal > 0 && <span className="text-amber-700/70">em uso ({usoReal})</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => { setEditando(x); setAberto(true) }} className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-white/70 transition hover:bg-[var(--surface-hover)] hover:text-white"><Pencil className="h-3 w-3" /> {usoReal > 0 ? 'Nova versão' : 'Editar'}</button>
                  <button onClick={() => excluir(x)} className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-red-700/80 transition hover:bg-[var(--surface-secondary)]"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {aberto && (
        <CondicaoWizard
          editando={editando} carteiras={carteiras} formas={formas} taxas={taxas} servicos={servicos}
          moedas={moedas} paises={paises} modalidades={modalidades}
          onClose={() => setAberto(false)} onSalvo={() => { setAberto(false); carregar() }}
        />
      )}
    </div>
  )
}

// ── wizard premium (9 passos) ───────────────────────────────────────────────
function CondicaoWizard({ editando, carteiras, formas, taxas, servicos, moedas, paises, modalidades, onClose, onSalvo }: {
  editando: Condicao | null; carteiras: CarteiraRef[]; formas: Ref[]; taxas: TaxaRef[]; servicos: Ref[]
  moedas: MoedaRef[]; paises: PaisRef[]; modalidades: ModalidadeRef[]
  onClose: () => void; onSalvo: () => void
}) {
  const [step, setStep] = useState(1)
  const [f, setF] = useState<Form>(() => editando ? mapear(editando) : VAZIO())
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [novaVersao, setNovaVersao] = useState(false)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))
  const parcela = f.tipoPagamento === 'PARCELADO'

  async function salvar(comoNovaVersao = false) {
    if (!f.name.trim()) { setStep(1); setErro('Informe o nome.'); return }
    setSalvando(true); setErro(null)
    try {
      // `codigo` nunca vai no payload: é gerado pelo backend e é imutável.
      const { codigo: _codigo, ...resto } = f
      const body: any = { ...resto }
      if (editando && comoNovaVersao) body.substituiId = editando.id
      if (editando && !comoNovaVersao) {
        await jf(`/api/gerenciamento/condicoes-pagamento/${editando.id}`, { method: 'PUT', body: JSON.stringify(body) })
      } else {
        await jf('/api/gerenciamento/condicoes-pagamento', { method: 'POST', body: JSON.stringify(body) })
      }
      onSalvo()
    } catch (e: any) {
      if ((e.message || '').includes('EXIGE_NOVA_VERSAO') || (e.message || '').toLowerCase().includes('nova versão')) {
        setNovaVersao(true); setErro('Esta condição já está em uso. Alterações estruturais exigem uma nova versão (o histórico fica intacto).')
      } else setErro(e.message || 'Não foi possível salvar.')
    } finally { setSalvando(false) }
  }

  // Toda troca de etapa fecha os seletores abertos: nenhum menu sobrevive à
  // navegação e nenhum resto de camada fica capturando clique.
  const irPara = (n: number) => { fecharTodosMultiSelects(); setStep(n) }

  return (
    <ModalWizard
      onClose={onClose}
      header={<>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" style={{ color: OURO_TINTA }} /><h3 className="text-base font-semibold">{editando ? 'Editar condição' : 'Nova condição de pagamento'}</h3></div>
          <button onClick={() => { fecharTodosMultiSelects(); onClose() }} className="text-[var(--text-muted)] transition hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3"><Stepper passos={PASSOS} atual={step} /></div>
      </>}
      footer={
        <div className="flex items-center justify-between">
          <button onClick={() => (step > 1 ? irPara(step - 1) : (fecharTodosMultiSelects(), onClose()))} className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] transition hover:text-white"><ArrowLeft className="h-4 w-4" /> {step > 1 ? 'Voltar' : 'Cancelar'}</button>
          {step < PASSOS.length ? (
            <button onClick={() => { fecharTodosMultiSelects(); if (step === 1 && !f.name.trim()) { setErro('Informe o nome.'); return } setErro(null); setStep(step + 1) }} className="inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition" style={{ background: OURO }}>Próximo <ArrowRight className="h-4 w-4" /></button>
          ) : (
            <button onClick={() => salvar(false)} disabled={salvando} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition disabled:opacity-50" style={{ background: OURO }}>{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{salvando ? 'Salvando…' : (editando ? 'Salvar' : 'Criar condição')}</button>
          )}
        </div>
      }
    >
      <>
          {erro && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-amber-700">
              {erro}
              {novaVersao && <button onClick={() => salvar(true)} className="ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#1b1508]" style={{ background: OURO }}><GitBranch className="h-3 w-3" /> Criar nova versão</button>}
            </div>
          )}

          {step === 1 && (
            <Secao icon={Tag} titulo="Identificação">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Nome *"><input className={INPUT} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Parcelado 3x sem juros" autoFocus /></Campo>
                <Campo label="Código">
                  <input
                    className={`${INPUT} cursor-not-allowed opacity-60`} value={f.codigo} readOnly disabled
                    placeholder={editando ? '' : 'Gerado automaticamente ao salvar'}
                    title="Código público gerado pelo sistema — imutável."
                  />
                </Campo>
                <Campo label="Descrição" wide><input className={INPUT} value={f.descricao} onChange={(e) => set('descricao', e.target.value)} /></Campo>
                <Campo label="Carteira sugerida"><Select value={f.carteiraId ? String(f.carteiraId) : ''} onChange={(v) => set('carteiraId', v ? Number(v) : null)} options={[['', '— nenhuma —'], ...carteiras.map((x) => [String(x.id), x.nome] as [string, string])]} /></Campo>
              </div>
              {/* O antigo campo único de forma saiu daqui: virou FORMA PADRÃO na
                  etapa Formas, ao lado das Formas permitidas (conceitos separados). */}
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">A carteira aqui é apenas uma <b>sugestão</b>. As formas de pagamento ficam na etapa <b>Formas</b>.</p>
              <div className="mt-3"><Toggle label="Condição ativa" on={f.ativo} onChange={(v) => set('ativo', v)} /></div>
            </Secao>
          )}

          {/*
            Etapa 2 — três blocos claros. Nada aqui é digitado livremente: moeda,
            país, modalidade e serviço só podem ser SELECIONADOS entre registros
            do cadastro real. Vazio = sem restrição.
            Perfil e Canal saíram: não tinham regra de negócio (colunas e dados
            históricos preservados no banco, apenas não expostos/exigidos).
          */}
          {step === 3 && (
            <div className="space-y-4">
              {/* VALIDADE É ESTADO, NÃO DATA (09/08/2026): condição ativa vale por
                  tempo indeterminado. Os campos de vigência saíram. */}
              <Secao icon={ArrowRight} titulo="Direção" dica="A condição vale enquanto estiver ativa.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Campo label="Aplica a"><Select value={f.aplicaA} onChange={(v) => set('aplicaA', v)} options={APLICA_A.map((a) => [a, APLICA_A_LABEL[a]] as [string, string])} /></Campo>
                  
                </div>
              </Secao>

              <Secao icon={Coins} titulo="Restrições financeiras" dica="Nenhuma moeda selecionada = sem restrição de moeda.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Campo label="Moedas permitidas">
                    <MultiSelect
                      opcoes={moedas.map((m) => ({ id: m.id, label: m.code, hint: m.name || undefined }))}
                      selecionados={f.moedasIds} onChange={(ids) => set('moedasIds', ids)}
                      placeholder="Todas as moedas" dicaVazio="Sem restrição de moeda."
                      vazioMsg="Nenhuma moeda ativa cadastrada."
                    />
                  </Campo>
                  <Campo label="Valor mínimo"><input type="number" min={0} step="0.01" className={INPUT} value={f.valorMinimo ?? ''} onChange={(e) => set('valorMinimo', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                  <Campo label="Valor máximo"><input type="number" min={0} step="0.01" className={INPUT} value={f.valorMaximo ?? ''} onChange={(e) => set('valorMaximo', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                </div>
              </Secao>

              <Secao icon={Filter} titulo="Restrições operacionais" dica="Nada selecionado = a condição vale para todos.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Campo label="Países permitidos">
                    <MultiSelect
                      opcoes={paises.map((p) => ({ id: p.id, label: `${p.flag ? `${p.flag} ` : ''}${p.countryLabel}` }))}
                      selecionados={f.paisesIds} onChange={(ids) => set('paisesIds', ids)}
                      placeholder="Todos os países" dicaVazio="Sem restrição de país."
                      vazioMsg="Nenhum país ativo cadastrado."
                    />
                  </Campo>
                  <Campo label="Serviços permitidos">
                    <MultiSelect
                      opcoes={servicos.map((s) => ({ id: s.id, label: s.name, hint: s.code || undefined }))}
                      selecionados={f.servicosIds} onChange={(ids) => set('servicosIds', ids)}
                      placeholder="Todos os serviços" dicaVazio="Aplicável a todos os serviços."
                      vazioMsg="Nenhum serviço ativo cadastrado."
                    />
                  </Campo>
                  {/* Modalidade PERMANECE: tem entidade própria (ModalidadePais),
                      chave por país e preço vinculado (TabelaValor) — não é
                      duplicação conceitual de Serviço. */}
                  <Campo label="Modalidades permitidas">
                    <MultiSelect
                      opcoes={modalidades.map((m) => ({ id: m.id, label: m.modalityLabel, hint: m.countryKey }))}
                      selecionados={f.modalidadesIds} onChange={(ids) => set('modalidadesIds', ids)}
                      placeholder="Todas as modalidades" dicaVazio="Sem restrição de modalidade."
                      vazioMsg="Nenhuma modalidade ativa cadastrada."
                    />
                  </Campo>
                </div>
              </Secao>
            </div>
          )}

          {step === 2 && (
            <Secao icon={Layers} titulo="Parcelamento e entrada">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Campo label="Tipo"><Select value={f.tipoPagamento} onChange={(v) => set('tipoPagamento', v)} options={TIPOS_PAGAMENTO.map((t) => [t, TIPOS_PAGAMENTO_LABEL[t]] as [string, string])} /></Campo>
                {parcela && <>
                  <Campo label="Mínimo"><input type="number" min={1} className={INPUT} value={f.parcelasMin ?? ''} onChange={(e) => set('parcelasMin', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                  <Campo label="Padrão"><input type="number" min={1} className={INPUT} value={f.parcelasPadrao ?? ''} onChange={(e) => set('parcelasPadrao', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                  <Campo label="Máximo"><input type="number" min={1} className={INPUT} value={f.parcelasMax ?? ''} onChange={(e) => set('parcelasMax', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                </>}
              </div>
              {parcela && <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                <Toggle label="Permite quantidade personalizada" on={f.permiteParcelasPersonalizadas} onChange={(v) => set('permiteParcelasPersonalizadas', v)} />
                <Toggle label="Permite edição manual das parcelas" on={f.permiteEdicaoManual} onChange={(v) => set('permiteEdicaoManual', v)} />
              </div>}
              <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                <Toggle label="Possui entrada" on={f.temEntrada} onChange={(v) => set('temEntrada', v)} />
                {f.temEntrada && (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Campo label="Tipo da entrada"><Select value={f.entradaTipo ?? 'PERCENTUAL'} onChange={(v) => set('entradaTipo', v)} options={ENTRADA_TIPOS.map((t) => [t, ENTRADA_TIPOS_LABEL[t]] as [string, string])} /></Campo>
                    {f.entradaTipo === 'PERCENTUAL'
                      ? <Campo label="Percentual (%)"><input type="number" step="0.01" className={INPUT} value={f.percentEntrada ?? ''} onChange={(e) => set('percentEntrada', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                      : <Campo label="Valor fixo"><input type="number" step="0.01" className={INPUT} value={f.valorEntradaFixo ?? ''} onChange={(e) => set('valorEntradaFixo', e.target.value === '' ? null : Number(e.target.value))} /></Campo>}
                    <Campo label="Mínimo"><input type="number" step="0.01" className={INPUT} value={f.entradaMin ?? ''} onChange={(e) => set('entradaMin', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                    <Campo label="Máximo"><input type="number" step="0.01" className={INPUT} value={f.entradaMax ?? ''} onChange={(e) => set('entradaMax', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                    <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-2">
                      <Toggle label="Entrada obrigatória" on={f.entradaObrigatoria} onChange={(v) => set('entradaObrigatoria', v)} />
                      <Toggle label="Entrada compõe o total" on={f.entradaCompoeTotal} onChange={(v) => set('entradaCompoeTotal', v)} />
                      <Toggle label="Entrada é adicional" on={f.entradaAdicional} onChange={(v) => set('entradaAdicional', v)} />
                    </div>
                  </div>
                )}
              </div>
            </Secao>
          )}

          {step === 2 && (
            <Secao icon={CalendarRange} titulo="Cronograma" dica="Comportamentos explícitos — nada implícito.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Início"><Select value={f.inicioCronograma} onChange={(v) => set('inicioCronograma', v)} options={INICIOS.map((i) => [i, INICIOS_LABEL[i]] as [string, string])} /></Campo>
                {f.inicioCronograma === 'DIAS' && <Campo label="Após N dias"><input type="number" className={INPUT} value={f.primeiraParcelaDias ?? ''} onChange={(e) => set('primeiraParcelaDias', e.target.value === '' ? null : Number(e.target.value))} /></Campo>}
                {f.inicioCronograma === 'DATA_ESPECIFICA' && <Campo label="Data"><input type="date" className={INPUT} value={f.primeiraParcelaData?.slice(0, 10) || ''} onChange={(e) => set('primeiraParcelaData', e.target.value)} /></Campo>}
                <Campo label="Periodicidade"><Select value={f.periodicidade} onChange={(v) => set('periodicidade', v)} options={PERIODICIDADES.map((p) => [p, PERIODICIDADES_LABEL[p]] as [string, string])} /></Campo>
                {f.periodicidade === 'PERSONALIZADA' && <Campo label="Intervalo (dias)"><input type="number" className={INPUT} value={f.periodicidadeDias ?? ''} onChange={(e) => set('periodicidadeDias', e.target.value === '' ? null : Number(e.target.value))} /></Campo>}
                <Campo label="Dia fixo (1–31)"><input type="number" min={1} max={31} className={INPUT} value={f.diaFixo ?? ''} onChange={(e) => set('diaFixo', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                <Campo label="Se o dia não existir no mês"><Select value={f.diaInexistente ?? ''} onChange={(v) => set('diaInexistente', v || null)} options={[['', '— padrão —'], ...DIA_INEXISTENTE.map((d) => [d, DIA_INEXISTENTE_LABEL[d]] as [string, string])]} /></Campo>
                <Campo label="Se cair em fim de semana"><Select value={f.comportamentoFimSemana ?? ''} onChange={(v) => set('comportamentoFimSemana', v || null)} options={[['', '— padrão —'], ...AJUSTE_DATA.map((a) => [a, AJUSTE_DATA_LABEL[a]] as [string, string])]} /></Campo>
                <Campo label="Se cair em feriado"><Select value={f.comportamentoFeriado ?? ''} onChange={(v) => set('comportamentoFeriado', v || null)} options={[['', '— padrão —'], ...AJUSTE_DATA.map((a) => [a, AJUSTE_DATA_LABEL[a]] as [string, string])]} /></Campo>
                <Campo label="Distribuição"><Select value={f.distribuicao} onChange={(v) => set('distribuicao', v)} options={DISTRIBUICOES.map((d) => [d, DISTRIBUICOES_LABEL[d]] as [string, string])} /></Campo>
              </div>
            </Secao>
          )}

          {/*
            Etapa 5 — DOIS conceitos separados, nunca no mesmo campo:
              • Formas permitidas: multisseleção. Vazio = sem restrição de forma.
              • Forma padrão: seleção única, opcional, restrita às permitidas.
            Uma condição "À vista" permite PIX, Transferência, Dinheiro, Débito e
            Boleto ao mesmo tempo — sem duplicar a condição por forma.
          */}
          {step === 2 && (
            <Secao icon={CreditCard} titulo="Compatibilidade com formas de pagamento" dica="A Condição só informa quais Formas são aceitas. Quem escolhe é a Cobrança.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Formas permitidas">
                  <MultiSelect
                    opcoes={formas.map((x) => ({ id: x.id, label: `${x.icone || ''} ${x.name}`.trim() }))}
                    selecionados={f.formasPermitidas}
                    onChange={(ids) => {
                      // Remover das permitidas a forma que era padrão limpa o
                      // campo — nunca fica referência inválida gravada.
                      set('formasPermitidas', ids)
                      if (f.formaPadraoId && ids.length && !ids.includes(f.formaPadraoId)) set('formaPadraoId', null)
                    }}
                    placeholder="Qualquer forma compatível"
                    dicaVazio="Sem restrição: a cobrança poderá usar qualquer forma ativa compatível."
                    vazioMsg="Nenhuma forma ativa cadastrada."
                  />
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">Selecione todas as formas que poderão ser usadas com esta condição.</p>
                </Campo>
                <Campo label="Forma padrão (opcional)">
                  <Select
                    value={f.formaPadraoId ? String(f.formaPadraoId) : ''}
                    onChange={(v) => set('formaPadraoId', v ? Number(v) : null)}
                    options={[
                      ['', '— nenhuma —'],
                      // Restrita às permitidas; sem restrição, qualquer forma ativa.
                      ...(f.formasPermitidas.length ? formas.filter((x) => f.formasPermitidas.includes(x.id)) : formas)
                        .map((x) => [String(x.id), `${x.icone || ''} ${x.name}`.trim()] as [string, string]),
                    ]}
                  />
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">Será pré-selecionada na cobrança, mas poderá ser alterada por outra forma permitida.</p>
                </Campo>
              </div>
              <p className="mt-3 text-[11px] text-[var(--text-muted)]">
                A forma padrão será sugerida inicialmente. Na cobrança, o operador poderá escolher qualquer outra forma
                permitida <b>e compatível</b> — a condição nunca torna válida uma forma incompatível (moeda, direção,
                parcelamento, adquirente continuam valendo).
              </p>
            </Secao>
          )}

          {step === 2 && (
            <Secao icon={Percent} titulo="Política de Taxas" dica="A taxa depende da FORMA escolhida na Cobrança — aqui só a política. O valor vem de Taxas de Pagamento.">
              <Campo label="Política"><Select value={f.politicaTaxas} onChange={(v) => set('politicaTaxas', v)} options={POLITICAS_TAXAS.map((p) => [p, POLITICAS_TAXAS_LABEL[p]] as [string, string])} /></Campo>
              {f.politicaTaxas !== 'IGNORAR' && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Taxas consideradas (opcional)</p>
                  {taxas.length === 0 ? <p className="text-[11px] text-[var(--text-muted)]">Nenhuma taxa ativa cadastrada.</p> : (
                    <ChipsMulti items={taxas.map((x) => ({ id: x.id, label: x.name }))} selecionados={f.taxasVinculadas} onToggle={(id) => set('taxasVinculadas', toggleArr(f.taxasVinculadas, Number(id)))} />
                  )}
                </div>
              )}
            </Secao>
          )}

          {step === 3 && (
            <Secao icon={Coins} titulo="Política Cambial" dica="A Condição não congela política cambial — apenas sugere. Quem decide é a Cobrança.">
              <Campo label="Política padrão"><Select value={f.politicaCambio} onChange={(v) => set('politicaCambio', v)} options={POLITICAS_CAMBIO.map((p) => [p, POLITICAS_CAMBIO_LABEL[p]] as [string, string])} /></Campo>
            </Secao>
          )}

          {step === 3 && (
            <Secao icon={Scale} titulo="Encargos e descontos">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Multa — tipo"><Select value={f.multaTipo ?? ''} onChange={(v) => set('multaTipo', v || null)} options={[['', '— sem multa —'], ...MULTA_TIPOS.map((m) => [m, m === 'FIXA' ? 'Fixa' : 'Percentual'] as [string, string])]} /></Campo>
                {f.multaTipo === 'PERCENTUAL' && <Campo label="Multa (%)"><input type="number" step="0.0001" className={INPUT} value={f.multaPercent ?? ''} onChange={(e) => set('multaPercent', e.target.value === '' ? null : Number(e.target.value))} /></Campo>}
                {f.multaTipo === 'FIXA' && <Campo label="Multa (valor)"><input type="number" step="0.01" className={INPUT} value={f.multaValor ?? ''} onChange={(e) => set('multaValor', e.target.value === '' ? null : Number(e.target.value))} /></Campo>}
                <Campo label="Juros — tipo"><Select value={f.jurosTipo ?? ''} onChange={(v) => set('jurosTipo', v || null)} options={[['', '— sem juros —'], ...JUROS_TIPOS.map((j) => [j, j === 'SIMPLES' ? 'Simples' : 'Compostos'] as [string, string])]} /></Campo>
                {f.jurosTipo && <Campo label="Juros — período"><Select value={f.jurosPeriodo ?? 'MENSAL'} onChange={(v) => set('jurosPeriodo', v)} options={JUROS_PERIODOS.map((j) => [j, j === 'DIARIO' ? 'Diário' : 'Mensal'] as [string, string])} /></Campo>}
                {f.jurosTipo && <Campo label="Juros (%)"><input type="number" step="0.0001" className={INPUT} value={f.jurosMesPercent ?? ''} onChange={(e) => set('jurosMesPercent', e.target.value === '' ? null : Number(e.target.value))} /></Campo>}
                <Campo label="Carência (dias)"><input type="number" className={INPUT} value={f.carenciaDias ?? ''} onChange={(e) => set('carenciaDias', e.target.value === '' ? null : Number(e.target.value))} /></Campo>
                <Campo label="Desconto — tipo"><Select value={f.descontoTipo ?? ''} onChange={(v) => set('descontoTipo', v || null)} options={[['', '— sem desconto —'], ...DESCONTO_TIPOS.map((d) => [d, d === 'COMERCIAL' ? 'Comercial' : 'Antecipação'] as [string, string])]} /></Campo>
                {f.descontoTipo === 'COMERCIAL' && <Campo label="Desconto (%)"><input type="number" step="0.0001" className={INPUT} value={f.descontoPercent ?? ''} onChange={(e) => set('descontoPercent', e.target.value === '' ? null : Number(e.target.value))} /></Campo>}
                {f.descontoTipo === 'ANTECIPACAO' && <Campo label="Desconto antecipação (%)"><input type="number" step="0.0001" className={INPUT} value={f.descontoAntecipacaoPercent ?? ''} onChange={(e) => set('descontoAntecipacaoPercent', e.target.value === '' ? null : Number(e.target.value))} /></Campo>}
                <Campo label="Quem concede desconto"><input className={INPUT} value={f.quemConcedeDesconto} onChange={(e) => set('quemConcedeDesconto', e.target.value)} /></Campo>
              </div>
              {f.descontoTipo === 'ANTECIPACAO' && <div className="mt-2"><Toggle label="Antecipação automática" on={f.descontoAntecipacaoAuto} onChange={(v) => set('descontoAntecipacaoAuto', v)} /></div>}
            </Secao>
          )}

          {step === 4 && (
            <Secao icon={Check} titulo="Revisão">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                {[
                  ['Nome', f.name], ['Código', f.codigo || 'gerado ao salvar'],
                  ['Aplica a', APLICA_A_LABEL[f.aplicaA]],
                  ['Moedas', f.moedasIds.length ? `${f.moedasIds.length} selecionada(s)` : 'sem restrição'],
                  ['Países', f.paisesIds.length ? `${f.paisesIds.length} selecionado(s)` : 'sem restrição'],
                  ['Serviços', f.servicosIds.length ? `${f.servicosIds.length} selecionado(s)` : 'todos'],
                  ['Modalidades', f.modalidadesIds.length ? `${f.modalidadesIds.length} selecionada(s)` : 'sem restrição'],
                  ['Pagamento', TIPOS_PAGAMENTO_LABEL[f.tipoPagamento] + (parcela ? ` (${f.parcelasMin}–${f.parcelasMax}, padrão ${f.parcelasPadrao})` : '')],
                  ['Entrada', f.temEntrada ? (f.entradaTipo === 'PERCENTUAL' ? `${f.percentEntrada ?? '—'}%` : `fixo ${f.valorEntradaFixo ?? '—'}`) : 'não'],
                  ['Periodicidade', PERIODICIDADES_LABEL[f.periodicidade]], ['Distribuição', DISTRIBUICOES_LABEL[f.distribuicao]],
                  ['Formas permitidas', f.formasPermitidas.length ? `${f.formasPermitidas.length} selecionada(s)` : 'sem restrição'],
                  ['Forma padrão', formas.find((x) => x.id === f.formaPadraoId)?.name ?? 'nenhuma'],
                  ['Política de taxas', POLITICAS_TAXAS_LABEL[f.politicaTaxas]], ['Câmbio', POLITICAS_CAMBIO_LABEL[f.politicaCambio]],
                ].map(([l, v], i) => (
                  <div key={i} className="flex justify-between gap-3"><span className="text-[var(--text-secondary)]">{l}</span><span className="truncate text-right text-white/85">{String(v ?? '—')}</span></div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-[var(--text-muted)]">Ao salvar, o motor usará esta regra para gerar Cobranças. Ela nunca congela dados da Cobrança.</p>
            </Secao>
          )}
      </>
    </ModalWizard>
  )
}

/** API condicao → estado do formulário. */
function mapear(c: any): Form {
  const v = VAZIO()
  return {
    ...v,
    name: c.name || '', codigo: c.codigo || '', descricao: c.descricao || '', ativo: c.ativo ?? true,
    // Forma padrão: persistida na coluna legada `formaSugeridaId`.
    carteiraId: c.carteiraId ?? null, formaPadraoId: c.formaPadraoId ?? c.formaSugeridaId ?? null,
    aplicaA: c.aplicaA || 'AMBOS',
    // Aplicabilidade vem SEMPRE dos vínculos reais (nunca dos arrays legados).
    moedasIds: (c.moedasVinculadas || []).map((x: any) => x.moedaId),
    paisesIds: (c.paisesPermitidos || []).map((x: any) => x.paisId),
    modalidadesIds: (c.modalidadesPermitidas || []).map((x: any) => x.modalidadeId),
    servicosIds: (c.servicosPermitidos || []).map((x: any) => x.servicoId),
    tiposProcesso: c.tiposProcesso || [],
    valorMinimo: c.valorMinimo != null ? Number(c.valorMinimo) : null, valorMaximo: c.valorMaximo != null ? Number(c.valorMaximo) : null,
    tipoPagamento: c.tipoPagamento || 'PARCELADO', temEntrada: !!c.temEntrada, entradaObrigatoria: !!c.entradaObrigatoria,
    entradaTipo: c.entradaTipo || 'PERCENTUAL', percentEntrada: c.percentEntrada != null ? Number(c.percentEntrada) : null,
    valorEntradaFixo: c.valorEntradaFixo != null ? Number(c.valorEntradaFixo) : null,
    entradaMin: c.entradaMin != null ? Number(c.entradaMin) : null, entradaMax: c.entradaMax != null ? Number(c.entradaMax) : null,
    entradaCompoeTotal: c.entradaCompoeTotal ?? true, entradaAdicional: !!c.entradaAdicional,
    parcelasMin: c.parcelasMin ?? 1, parcelasPadrao: c.parcelasPadrao ?? 1, parcelasMax: c.parcelasMax ?? 1,
    permiteParcelasPersonalizadas: !!c.permiteParcelasPersonalizadas, permiteEdicaoManual: !!c.permiteEdicaoManual,
    inicioCronograma: c.inicioCronograma || 'IMEDIATA', primeiraParcelaDias: c.primeiraParcelaDias ?? null, primeiraParcelaData: c.primeiraParcelaData || '',
    periodicidade: c.periodicidade || 'MENSAL', periodicidadeDias: c.periodicidadeDias ?? null, diaFixo: c.diaFixo ?? null,
    diaInexistente: c.diaInexistente ?? null, comportamentoFimSemana: c.comportamentoFimSemana ?? null, comportamentoFeriado: c.comportamentoFeriado ?? null,
    distribuicao: c.distribuicao || 'ULTIMA_AJUSTA', primeiraParcelaPercent: c.primeiraParcelaPercent != null ? Number(c.primeiraParcelaPercent) : null,
    formasPermitidas: (c.formasPermitidas || []).map((x: any) => x.formaId ?? x),
    politicaTaxas: c.politicaTaxas || 'IGNORAR', taxasVinculadas: (c.taxasVinculadas || []).map((x: any) => x.taxaId ?? x),
    politicaCambio: ['PADRAO_SISTEMA', 'SUGERIR_VARIAVEL', 'SUGERIR_TRAVA'].includes(c.politicaCambio) ? c.politicaCambio : 'PADRAO_SISTEMA',
    multaTipo: c.multaTipo ?? null, multaValor: c.multaValor != null ? Number(c.multaValor) : null, multaPercent: c.multaPercent != null ? Number(c.multaPercent) : null,
    jurosTipo: c.jurosTipo ?? null, jurosPeriodo: c.jurosPeriodo ?? null, jurosMesPercent: c.jurosMesPercent != null ? Number(c.jurosMesPercent) : null,
    carenciaDias: c.carenciaDias ?? null, descontoTipo: c.descontoTipo ?? null,
    descontoPercent: c.descontoPercent != null ? Number(c.descontoPercent) : null,
    descontoAntecipacaoPercent: c.descontoAntecipacaoPercent != null ? Number(c.descontoAntecipacaoPercent) : null,
    descontoAVistaPercent: c.descontoAVistaPercent != null ? Number(c.descontoAVistaPercent) : null,
    descontoAntecipacaoAuto: !!c.descontoAntecipacaoAuto, quemConcedeDesconto: c.quemConcedeDesconto || '',
    observacoes: c.observacoes || '',
  }
}
