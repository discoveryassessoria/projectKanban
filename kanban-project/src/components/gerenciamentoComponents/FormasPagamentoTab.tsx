'use client'

// src/components/gerenciamentoComponents/FormasPagamentoTab.tsx
// ============================================================================
// FORMA DE PAGAMENTO — cadastro mestre das CAPACIDADES TÉCNICAS do meio.
// Não define regra comercial (isso é da Condição), taxa concreta (é da Taxa) nem
// decisão da Cobrança. Identidade premium do Financeiro (dark glass + OURO).
// Painel por seções com disclosure progressivo. Consome só cadastros oficiais.
//   Backend: /api/gerenciamento/formas-pagamento (GET/POST) + /[id] (PUT/DELETE)
//   Regras/enums: lib/financeiro/payment-method-constants (fonte única).
// ============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CreditCard, Search, Plus, X, Check, Settings2, Coins, Cable, Landmark,
  Timer, Percent, Loader2, Pencil, Trash2, Sparkles,
} from 'lucide-react'
import {
  TIPOS_FORMA, TIPOS_FORMA_LABEL, TIPOS_INTEGRACAO, TIPOS_INTEGRACAO_LABEL,
  PRAZOS_LIQUIDACAO, PRAZOS_LIQUIDACAO_LABEL, CATEGORIAS_FORMA, CATEGORIAS_FORMA_LABEL,
} from '@/lib/financeiro/payment-method-constants'
import { useApi } from "@/src/lib/dados"

const OURO = 'var(--accent-primary)'
const OURO_TINTA = 'var(--accent-text)'
const GLASS = 'rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-md'

type MoedaRef = { id: number; code: string; name: string | null }
type DestinoRef = { id: number; nome: string; moeda: string }
type Forma = {
  id: number; code: string | null; name: string; type: string | null; descricao: string | null; categoria: string | null
  moeda: string | null; moedasAceitas: string[]; permiteParcelas: boolean; minParcelas: number | null; maxParcelas: number | null
  exigeAdquirente: boolean; usoRecebimento: boolean; usoPagamento: boolean
  ativo: boolean; ordem: number; icone: string | null; observacoes: string | null
  aceitaEntrada: boolean; aceitaRecorrencia: boolean; aceitaMoedaEstrangeira: boolean
  permiteCancelamento: boolean; permiteEstorno: boolean; permiteReembolso: boolean; permiteInternacional: boolean
  liquidacaoAutomatica: boolean; conciliacaoAutomatica: boolean; permiteComprovante: boolean
  emissaoAutomatica: boolean; permiteCobrancaManual: boolean
  tipoIntegracao: string | null; provedorIntegracao: string | null; integracaoAtiva: boolean
  carteirasCompativeis: number[]; contasCompativeis: number[]
  prazoLiquidacao: string | null; diasLiquidacao: number | null; diasCorridos: boolean; permiteAntecipacao: boolean
  utilizaTaxas: boolean; permiteTaxaAntecipacao: boolean; permiteTaxaParcelamento: boolean; permiteTaxaInternacional: boolean
}

const VAZIO = (): Omit<Forma, 'id'> => ({
  code: '', name: '', type: '', descricao: '', categoria: null, moeda: null, moedasAceitas: [],
  permiteParcelas: false, minParcelas: 1, maxParcelas: null,
  exigeAdquirente: false, usoRecebimento: true, usoPagamento: true,
  ativo: true, ordem: 0, icone: '', observacoes: '',
  aceitaEntrada: false, aceitaRecorrencia: false, aceitaMoedaEstrangeira: false,
  permiteCancelamento: false, permiteEstorno: false, permiteReembolso: false, permiteInternacional: false,
  liquidacaoAutomatica: false, conciliacaoAutomatica: false, permiteComprovante: false,
  emissaoAutomatica: false, permiteCobrancaManual: true,
  tipoIntegracao: 'NENHUMA', provedorIntegracao: '', integracaoAtiva: false,
  carteirasCompativeis: [], contasCompativeis: [],
  prazoLiquidacao: null, diasLiquidacao: null, diasCorridos: true, permiteAntecipacao: false,
  utilizaTaxas: false, permiteTaxaAntecipacao: false, permiteTaxaParcelamento: false, permiteTaxaInternacional: false,
})

async function jf(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function FormasPagamentoTab() {
  const [busca, setBusca] = useState('')

  const [aberto, setAberto] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [f, setF] = useState<Omit<Forma, 'id'>>(VAZIO())
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)
  const set = <K extends keyof Omit<Forma, 'id'>>(k: K, v: Omit<Forma, 'id'>[K]) => setF((p) => ({ ...p, [k]: v }))

  // UMA consulta, várias listas derivadas da MESMA resposta — o endpoint já
  // devolve tudo junto. loading/erro vêm da camada; nada de setState em efeito.
  const { dados, carregando: loading, erro, recarregar: carregar } = useApi<{ formasPagamento?: Forma[], moedas?: any[], carteiras?: any[], contas?: any[] }>('/api/gerenciamento/formas-pagamento')
  const itens: Forma[] = dados?.formasPagamento ?? SEM_ITENS
  const moedas: any[] = dados?.moedas ?? SEM_ITENS
  const carteiras: any[] = dados?.carteiras ?? SEM_ITENS
  const contas: any[] = dados?.contas ?? SEM_ITENS
  const erroLista = erro ? (erro.message || 'Não foi possível carregar.') : null

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return itens
    return itens.filter((x) => x.name.toLowerCase().includes(q) || (x.code || '').toLowerCase().includes(q))
  }, [itens, busca])

  function abrirNovo() { setEditId(null); setF(VAZIO()); setErroModal(null); setAberto(true) }
  function abrirEditar(x: Forma) {
    const { id, ...rest } = x
    setEditId(id)
    setF({ ...VAZIO(), ...rest, code: rest.code ?? '', descricao: rest.descricao ?? '', icone: rest.icone ?? '', observacoes: rest.observacoes ?? '', provedorIntegracao: rest.provedorIntegracao ?? '', tipoIntegracao: rest.tipoIntegracao ?? 'NENHUMA' })
    setErroModal(null); setAberto(true)
  }

  async function salvar() {
    if (!f.name.trim()) { setErroModal('Informe o nome.'); return }
    if (f.moedasAceitas.length === 0) { setErroModal('Selecione ao menos uma moeda aceita.'); return }
    setSalvando(true); setErroModal(null)
    try {
      const body = JSON.stringify(f)
      if (editId) await jf(`/api/gerenciamento/formas-pagamento/${editId}`, { method: 'PUT', body })
      else await jf('/api/gerenciamento/formas-pagamento', { method: 'POST', body })
      setAberto(false); await carregar()
    } catch (e: any) { setErroModal(e.message || 'Não foi possível salvar.') }
    finally { setSalvando(false) }
  }

  async function excluir(x: Forma) {
    if (!confirm(`Excluir a forma "${x.name}"?`)) return
    try { await jf(`/api/gerenciamento/formas-pagamento/${x.id}`, { method: 'DELETE' }); await carregar() }
    catch (e: any) { alert(e.message || 'Não foi possível excluir.') }
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${OURO}22`, color: OURO_TINTA }}><CreditCard className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-semibold text-white">Formas de Pagamento</h2>
            <p className="text-sm text-[var(--text-secondary)]">Capacidades técnicas do meio. Regra comercial pertence à Condição.</p>
          </div>
        </div>
        <button onClick={abrirNovo} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] transition" style={{ background: OURO }}>
          <Plus className="h-4 w-4" /> Nova forma
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar forma de pagamento…" className="w-full rounded-lg border border-[var(--border-default)] bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder:text-[var(--text-muted)] outline-none focus:border-white/25" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-[var(--text-secondary)]" /></div>
      ) : erroLista ? (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 text-sm text-red-700">{erroLista}<button onClick={() => void carregar()} className="ml-3 underline hover:text-white">Tentar de novo</button></div>
      ) : filtrados.length === 0 ? (
        <div className={`${GLASS} flex flex-col items-center gap-2 py-16 text-center`}>
          <CreditCard className="h-10 w-10 text-[var(--text-muted)]" />
          <p className="text-[var(--text-secondary)]">{busca ? 'Nenhuma forma encontrada.' : 'Nenhuma forma de pagamento ainda.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((x) => (
            <div key={x.id} className={`${GLASS} flex items-center gap-4 p-4 transition hover:border-[var(--border-strong)]`}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg" style={{ background: `${OURO}18` }}>{x.icone || '💳'}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-white">{x.name}</span>
                  {x.type && <span className="shrink-0 rounded-md border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">{TIPOS_FORMA_LABEL[x.type] || x.type}</span>}
                  {!x.ativo && <span className="shrink-0 rounded-md border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">inativa</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                  {x.code && <span className="font-mono">{x.code}</span>}
                  <span>{(x.moedasAceitas?.length ? x.moedasAceitas : (x.moeda ? [x.moeda] : [])).join(' · ') || '—'}</span>
                  <span>{x.permiteParcelas ? `até ${x.maxParcelas ?? '—'}×` : 'sem parcelamento'}</span>
                  {x.integracaoAtiva && x.provedorIntegracao && <span className="inline-flex items-center gap-1"><Cable className="h-3 w-3" />{x.provedorIntegracao}</span>}
                  {x.prazoLiquidacao && <span className="inline-flex items-center gap-1"><Timer className="h-3 w-3" />{PRAZOS_LIQUIDACAO_LABEL[x.prazoLiquidacao] || x.prazoLiquidacao}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => abrirEditar(x)} className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-white/70 transition hover:bg-[var(--surface-hover)] hover:text-white"><Pencil className="h-3 w-3" /> Editar</button>
                <button onClick={() => excluir(x)} className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-red-700/80 transition hover:bg-[var(--surface-secondary)]"><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {aberto && (
        <FormaPanel
          f={f} set={set} editId={editId} moedas={moedas} carteiras={carteiras} contas={contas}
          salvando={salvando} erro={erroModal} onClose={() => setAberto(false)} onSalvar={salvar}
        />
      )}
    </div>
  )
}

// ── painel premium (seções + disclosure) ──────────────────────────────────
function FormaPanel({ f, set, editId, moedas, carteiras, contas, salvando, erro, onClose, onSalvar }: {
  f: Omit<Forma, 'id'>; set: <K extends keyof Omit<Forma, 'id'>>(k: K, v: Omit<Forma, 'id'>[K]) => void
  editId: number | null; moedas: MoedaRef[]; carteiras: DestinoRef[]; contas: DestinoRef[]
  salvando: boolean; erro: string | null; onClose: () => void; onSalvar: () => void
}) {
  const input = 'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder:text-[var(--text-muted)] outline-none focus:border-white/30'
  const semIntegracao = !f.tipoIntegracao || f.tipoIntegracao === 'NENHUMA'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 text-white shadow-[var(--elev-3)]" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-default)] bg-zinc-900/95 px-6 py-4">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" style={{ color: OURO_TINTA }} /><h3 className="text-base font-semibold">{editId ? 'Editar forma de pagamento' : 'Nova forma de pagamento'}</h3></div>
          <button onClick={onClose} className="text-[var(--text-muted)] transition hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* Identificação */}
          <Secao icon={CreditCard} titulo="Identificação">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="Nome *"><input className={input} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Pix" autoFocus /></Campo>
              <Campo label="Código"><input className={`${input} cursor-not-allowed opacity-60`} value={f.code ?? ''} readOnly disabled placeholder={editId ? '' : 'gerado automaticamente'} title="Código público gerado pelo sistema — imutável." /></Campo>
              <Campo label="Tipo"><Select value={f.type ?? ''} onChange={(v) => set('type', v)} options={[['', '— selecione —'], ...TIPOS_FORMA.map((t) => [t, TIPOS_FORMA_LABEL[t]] as [string, string])]} /></Campo>
              <Campo label="Categoria"><Select value={f.categoria ?? ''} onChange={(v) => set('categoria', v || null)} options={[['', '— opcional —'], ...CATEGORIAS_FORMA.map((c) => [c, CATEGORIAS_FORMA_LABEL[c]] as [string, string])]} /></Campo>
              <Campo label="Descrição curta" wide><input className={input} value={f.descricao ?? ''} onChange={(e) => set('descricao', e.target.value)} placeholder="Ex.: Pix instantâneo, chave CNPJ" /></Campo>
              <Campo label="Ícone"><input className={input} maxLength={8} value={f.icone ?? ''} onChange={(e) => set('icone', e.target.value)} placeholder="💳" /></Campo>
              <Campo label="Ordem de exibição"><input type="number" className={input} value={f.ordem} onChange={(e) => set('ordem', Number(e.target.value) || 0)} /></Campo>
            </div>
            <Toggle label="Ativo" on={f.ativo} onChange={(v) => set('ativo', v)} />
          </Secao>

          {/* Moedas */}
          <Secao icon={Coins} titulo="Moedas aceitas" dica="A forma pode aceitar uma ou várias moedas. Consome o cadastro de Moedas.">
            {moedas.length === 0 ? <p className="text-[11px] text-amber-800/70">Cadastre moedas em “Moedas” para escolher aqui.</p> : (
              <ChipsMulti items={moedas.map((m) => ({ id: m.code, label: m.code + (m.name ? ` · ${m.name}` : '') }))} selecionados={f.moedasAceitas} onToggle={(code) => set('moedasAceitas', toggle(f.moedasAceitas, String(code)))} />
            )}
          </Secao>

          {/* Capacidades + parcelamento */}
          <Secao icon={Settings2} titulo="Capacidades do meio" dica="Só o que o MEIO suporta. Quantidade comercial de parcelas, entrada e cronograma pertencem à Condição de Pagamento — aqui vai apenas o limite técnico.">
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
              <Toggle label="Suporta parcelamento" on={f.permiteParcelas} onChange={(v) => { set('permiteParcelas', v); if (!v) { set('maxParcelas', null); set('minParcelas', 1) } }} />
              {f.permiteParcelas && (<>
                <label className="flex items-center gap-2 text-sm text-white/70">Mín. técnico<input type="number" min={1} className="w-20 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-sm text-white outline-none focus:border-white/30" value={f.minParcelas ?? ''} onChange={(e) => set('minParcelas', e.target.value === '' ? null : Number(e.target.value))} placeholder="1" /></label>
                <label className="flex items-center gap-2 text-sm text-white/70">Máx. técnico<input type="number" min={1} className="w-20 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-sm text-white outline-none focus:border-white/30" value={f.maxParcelas ?? ''} onChange={(e) => set('maxParcelas', e.target.value === '' ? null : Number(e.target.value))} placeholder="12" /></label>
              </>)}
            </div>

            {/* Direção de uso — a forma serve a entradas, saídas, ou ambas. */}
            <div className="mb-3 grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3 sm:grid-cols-2">
              <Toggle label="Usar em recebimentos" on={f.usoRecebimento} onChange={(v) => set('usoRecebimento', v)} />
              <Toggle label="Usar em pagamentos" on={f.usoPagamento} onChange={(v) => set('usoPagamento', v)} />
              <Toggle label="Exige adquirente" on={f.exigeAdquirente} onChange={(v) => set('exigeAdquirente', v)} />
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <Toggle label="Aceita entrada" on={f.aceitaEntrada} onChange={(v) => set('aceitaEntrada', v)} />
              <Toggle label="Aceita recorrência" on={f.aceitaRecorrencia} onChange={(v) => set('aceitaRecorrencia', v)} />
              <Toggle label="Aceita moeda estrangeira" on={f.aceitaMoedaEstrangeira} onChange={(v) => set('aceitaMoedaEstrangeira', v)} />
              <Toggle label="Permite cobrança internacional" on={f.permiteInternacional} onChange={(v) => set('permiteInternacional', v)} />
              <Toggle label="Permite cancelamento" on={f.permiteCancelamento} onChange={(v) => set('permiteCancelamento', v)} />
              <Toggle label="Permite estorno" on={f.permiteEstorno} onChange={(v) => set('permiteEstorno', v)} />
              <Toggle label="Permite reembolso" on={f.permiteReembolso} onChange={(v) => set('permiteReembolso', v)} />
              <Toggle label="Permite comprovante" on={f.permiteComprovante} onChange={(v) => set('permiteComprovante', v)} />
              <Toggle label="Permite cobrança manual" on={f.permiteCobrancaManual} onChange={(v) => set('permiteCobrancaManual', v)} />
            </div>
          </Secao>

          {/* Integração */}
          <Secao icon={Cable} titulo="Integração">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo label="Tipo de integração"><Select value={f.tipoIntegracao ?? 'NENHUMA'} onChange={(v) => { set('tipoIntegracao', v); if (v === 'NENHUMA') { set('integracaoAtiva', false); set('provedorIntegracao', '') } }} options={TIPOS_INTEGRACAO.map((t) => [t, TIPOS_INTEGRACAO_LABEL[t]] as [string, string])} /></Campo>
              {!semIntegracao && <Campo label="Provedor vinculado"><input className={input} value={f.provedorIntegracao ?? ''} onChange={(e) => set('provedorIntegracao', e.target.value)} placeholder="Stripe, Stone, Wise…" /></Campo>}
            </div>
            {!semIntegracao && (
              <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                <Toggle label="Integração ativa" on={f.integracaoAtiva} onChange={(v) => set('integracaoAtiva', v)} />
                <Toggle label="Liquidação automática" on={f.liquidacaoAutomatica} onChange={(v) => set('liquidacaoAutomatica', v)} />
                <Toggle label="Conciliação automática" on={f.conciliacaoAutomatica} onChange={(v) => set('conciliacaoAutomatica', v)} />
                <Toggle label="Emissão automática" on={f.emissaoAutomatica} onChange={(v) => set('emissaoAutomatica', v)} />
              </div>
            )}
          </Secao>

          {/* Destinos compatíveis */}
          <Secao icon={Landmark} titulo="Destinos compatíveis" dica="Só restringe quais destinos são compatíveis. A escolha efetiva ocorre na Cobrança.">
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Carteiras</p>
            {carteiras.length === 0 ? <p className="mb-3 text-[11px] text-[var(--text-muted)]">Nenhuma carteira cadastrada.</p> : (
              <ChipsMulti items={carteiras.map((c) => ({ id: c.id, label: `${c.nome} · ${c.moeda}` }))} selecionados={f.carteirasCompativeis} onToggle={(id) => set('carteirasCompativeis', toggle(f.carteirasCompativeis, Number(id)))} />
            )}
            <p className="mb-1.5 mt-3 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Contas bancárias</p>
            {contas.length === 0 ? <p className="text-[11px] text-[var(--text-muted)]">Nenhuma conta cadastrada.</p> : (
              <ChipsMulti items={contas.map((c) => ({ id: c.id, label: `${c.nome} · ${c.moeda}` }))} selecionados={f.contasCompativeis} onToggle={(id) => set('contasCompativeis', toggle(f.contasCompativeis, Number(id)))} />
            )}
          </Secao>

          {/* Liquidação */}
          <Secao icon={Timer} titulo="Liquidação" dica="Informativo — apoia projeção de caixa e conciliação. Não marca um pagamento como recebido.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Campo label="Prazo padrão"><Select value={f.prazoLiquidacao ?? ''} onChange={(v) => set('prazoLiquidacao', v || null)} options={[['', '— opcional —'], ...PRAZOS_LIQUIDACAO.map((p) => [p, PRAZOS_LIQUIDACAO_LABEL[p]] as [string, string])]} /></Campo>
              {f.prazoLiquidacao === 'DN' && <Campo label="Qtde. de dias"><input type="number" min={0} className={input} value={f.diasLiquidacao ?? ''} onChange={(e) => set('diasLiquidacao', e.target.value === '' ? null : Number(e.target.value))} /></Campo>}
            </div>
            <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <Toggle label="Dias corridos (desmarcado = úteis)" on={f.diasCorridos} onChange={(v) => set('diasCorridos', v)} />
              <Toggle label="Permite antecipação" on={f.permiteAntecipacao} onChange={(v) => set('permiteAntecipacao', v)} />
            </div>
          </Secao>

          {/* Taxas (flags) */}
          <Secao icon={Percent} titulo="Taxas" dica="A Forma não cadastra valor de taxa — só sinaliza capacidade. Os valores vêm de Taxas de Pagamento.">
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <Toggle label="Utiliza taxas" on={f.utilizaTaxas} onChange={(v) => set('utilizaTaxas', v)} />
              <Toggle label="Permite taxa de antecipação" on={f.permiteTaxaAntecipacao} onChange={(v) => set('permiteTaxaAntecipacao', v)} />
              <Toggle label="Permite taxa por parcelamento" on={f.permiteTaxaParcelamento} onChange={(v) => set('permiteTaxaParcelamento', v)} />
              <Toggle label="Permite taxa por operação internacional" on={f.permiteTaxaInternacional} onChange={(v) => set('permiteTaxaInternacional', v)} />
            </div>
          </Secao>

          {/* Observações */}
          <Secao icon={Pencil} titulo="Observações">
            <textarea rows={2} className={input} value={f.observacoes ?? ''} onChange={(e) => set('observacoes', e.target.value)} />
          </Secao>

          {erro && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-red-700">{erro}</div>}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-[var(--border-default)] bg-zinc-900/95 px-6 py-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white">Cancelar</button>
          <button onClick={onSalvar} disabled={salvando} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] transition disabled:opacity-50" style={{ background: OURO }}>{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

// ── helpers de UI ──────────────────────────────────────────────────────────
function toggle<T>(arr: T[], v: T): T[] { return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] }

function Secao({ icon: Ic, titulo, dica, children }: { icon: any; titulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <div className={`${GLASS} p-4`}>
      <div className="mb-1 flex items-center gap-2"><Ic className="h-4 w-4" style={{ color: OURO_TINTA }} /><h4 className="text-sm font-semibold text-white">{titulo}</h4></div>
      {dica && <p className="mb-3 text-[11px] text-[var(--text-muted)]">{dica}</p>}
      <div className={dica ? '' : 'mt-2'}>{children}</div>
    </div>
  )
}
function Campo({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={wide ? 'sm:col-span-2' : ''}><label className="mb-1 block text-xs text-[var(--text-secondary)]">{label}</label>{children}</div>
}
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white outline-none focus:border-white/30">
      {options.map(([v, l]) => <option key={v} value={v} className="bg-zinc-900">{l}</option>)}
    </select>
  )
}
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-2 text-left text-sm text-white/80">
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? '' : 'bg-[var(--surface-secondary)]'}`} style={on ? { background: OURO } : undefined}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--surface-primary)] transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}
function ChipsMulti({ items, selecionados, onToggle }: { items: { id: string | number; label: string }[]; selecionados: (string | number)[]; onToggle: (id: string | number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const on = selecionados.includes(it.id)
        return (
          <button key={String(it.id)} type="button" onClick={() => onToggle(it.id)} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition ${on ? 'text-[var(--accent-ink)]' : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:text-white'}`} style={on ? { background: OURO, borderColor: OURO } : undefined}>
            {on && <Check className="h-3 w-3" />}{it.label}
          </button>
        )
      })}
    </div>
  )
}
