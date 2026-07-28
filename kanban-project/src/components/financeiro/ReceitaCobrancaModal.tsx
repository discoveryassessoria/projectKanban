'use client'
// ============================================================================
// ReceitaCobrancaModal — NOVA experiência do Financeiro do Processo (base ÚNICA).
// Separa claramente Receita (contrato) · Cobrança (como cobrar) · Pagamento (recebido).
// Identidade premium do módulo Financeiro (dark glass + OURO). Consome só os cadastros
// oficiais de Gerenciamento (via /api/financeiro/config) — nunca duplica config.
//   • Sem cobrança → Empty State elegante + "Cadastrar Cobrança" (wizard).
//   • Com cobrança → resumo + parcelas + registrar pagamento + histórico.
// ============================================================================
import * as React from 'react'
import { X, ArrowRight, ArrowLeft, Check, CreditCard, CalendarClock, Wallet, Landmark, ReceiptText, Sparkles } from 'lucide-react'
import { authToken } from "@/src/lib/financeiro/http"
import { fmtMoeda as brl } from "@/src/lib/financeiro/formato"

const OURO = '#D2A948'
const GLASS = 'rounded-xl border border-white/10 bg-white/[0.05] backdrop-blur-md'
const dt = (s: any) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—')

async function jf(url: string, opts: RequestInit = {}) {
  const t = authToken()
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(opts.headers || {}) }, cache: 'no-store' })
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error((d as any)?.error || `Erro ${r.status}`); return d
}

type Cfg = any
type Detalhe = any
type Cobranca = any

export function ReceitaCobrancaModal({ receitaId, onClose, onChanged }: { receitaId: number; onClose: () => void; onChanged?: () => void }) {
  const [det, setDet] = React.useState<Detalhe | null>(null)
  const [cobrancas, setCobrancas] = React.useState<Cobranca[]>([])
  const [erro, setErro] = React.useState<string | null>(null)
  const [wizard, setWizard] = React.useState(false)

  const carregar = React.useCallback(async () => {
    try {
      const [d, c] = await Promise.all([jf(`/api/financeiro/receitas/${receitaId}/detalhe`), jf(`/api/financeiro/receitas/${receitaId}/cobrancas`)])
      setDet(d.receita ? d : { receita: d }); setCobrancas((c as any).cobrancas || [])
    } catch (e: any) { setErro(e.message || 'erro') }
  }, [receitaId])
  React.useEffect(() => { carregar() }, [carregar])

  const r = det?.receita ?? {}
  const moeda = r.moeda || 'EUR'
  const recebido = cobrancas.flatMap((c: any) => c.eventos || []).filter((e: any) => e.tipo === 'RECEBIMENTO').reduce((s: number, e: any) => s + Number(e.valor || 0), 0)
  const contratado = Number(r.valor || 0)
  const saldo = contratado - recebido

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4" style={{ color: OURO }} />
              <h3 className="text-base font-semibold">Receita {r.codigo ? `· ${r.codigo}` : ''}</h3>
            </div>
            <p className="mt-0.5 text-xs text-white/50">{r.descricao || 'Compromisso financeiro gerado pelo motor'}</p>
          </div>
          <button onClick={onClose} className="text-white/40 transition hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {erro && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erro}</div>}

          {/* CONTRATO — só o que a Receita É */}
          <div className="grid grid-cols-3 gap-3">
            {[['Valor contratado', brl(contratado, moeda)], ['Valor recebido', brl(recebido, moeda)], ['Saldo', brl(saldo, moeda)]].map(([l, v], i) => (
              <div key={i} className={`${GLASS} p-3`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{l}</p>
                <p className="mt-1 text-lg font-bold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <div className={`${GLASS} p-4`}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">Contrato</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              {[['Regra financeira', r.regraFinanceiraId ?? det?.origem?.regra ?? '—'], ['Serviço', r.tipoServico?.name ?? det?.origem?.servico ?? '—'], ['Processo', r.processoId], ['Requerente', (det?.requerentesConsiderados?.[0]?.nome) ?? r.pessoa?.nome ?? '—'], ['Moeda', moeda], ['Cotação utilizada', r.fxEstimado ? `1 ${moeda} = R$ ${Number(r.fxEstimado).toFixed(4)}` : '—']].map(([l, v], i) => (
                <div key={i} className="flex justify-between gap-3"><span className="text-white/45">{l}</span><span className="truncate text-right text-white/85">{String(v ?? '—')}</span></div>
              ))}
            </div>
          </div>

          {/* COBRANÇA */}
          {cobrancas.length === 0 ? (
            <div className={`${GLASS} flex flex-col items-center px-6 py-10 text-center`}>
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-full border" style={{ borderColor: `${OURO}40`, background: `${OURO}1f` }}>
                <CreditCard className="h-6 w-6" style={{ color: OURO }} />
              </div>
              <h4 className="text-base font-semibold">Esta receita ainda não possui uma cobrança</h4>
              <p className="mx-auto mt-1 max-w-sm text-sm text-white/55">Para iniciar o processo financeiro, escolha como o cliente irá pagar esta receita.</p>
              <button onClick={() => setWizard(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition" style={{ background: OURO }} onMouseEnter={(e) => (e.currentTarget.style.background = '#e0b957')} onMouseLeave={(e) => (e.currentTarget.style.background = OURO)}>
                <Sparkles className="h-4 w-4" /> Cadastrar Cobrança
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {cobrancas.map((c: any) => <CobrancaCard key={c.id} cobranca={c} moeda={moeda} onPago={() => { carregar(); onChanged?.() }} />)}
              <button onClick={() => setWizard(true)} className="w-full rounded-lg border border-white/15 py-2 text-sm text-white/80 transition hover:bg-white/10">+ Nova cobrança para esta receita</button>
            </div>
          )}
        </div>
      </div>

      {wizard && <CobrancaWizard receitaId={receitaId} valor={contratado} moeda={moeda} receita={r} onClose={() => setWizard(false)} onCriada={() => { setWizard(false); carregar(); onChanged?.() }} />}
    </div>
  )
}

// ── Card de uma Cobrança (resumo + parcelas + registrar pagamento) ───────────
function CobrancaCard({ cobranca, moeda, onPago }: { cobranca: any; moeda: string; onPago: () => void }) {
  const [pagando, setPagando] = React.useState<number | null>(null)
  const parcelas = (cobranca.parcelas || []).slice().sort((a: any, b: any) => a.numero - b.numero)
  const statusCls: Record<string, string> = { ABERTA: 'bg-sky-500/15 text-sky-300 border-sky-500/25', PARCIAL: 'bg-amber-500/15 text-amber-300 border-amber-500/25', QUITADA: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25', CANCELADA: 'bg-white/10 text-white/50 border-white/15' }
  async function pagar(parcelaId: number, valor: number) {
    setPagando(parcelaId)
    try { await jf(`/api/financeiro/cobrancas/${cobranca.id}/pagamentos`, { method: 'POST', body: JSON.stringify({ parcelaId, valor }) }); onPago() }
    catch (e: any) { alert(e.message) } finally { setPagando(null) }
  }
  return (
    <div className={`${GLASS} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4" style={{ color: OURO }} /> Cobrança #{cobranca.id} · {parcelas.length}x</div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusCls[cobranca.status] || 'border-white/15 text-white/60'}`}>{cobranca.status}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-[13px]">
          <thead><tr className="bg-white/5 text-left text-[11px] uppercase tracking-wide text-white/45">
            {['#', 'Vencimento', 'Valor', 'Status', ''].map((h, i) => <th key={i} className="px-3 py-2 font-semibold">{h}</th>)}
          </tr></thead>
          <tbody>
            {parcelas.map((p: any) => {
              const quit = p.status === 'RECEBIDA' || p.status === 'PAGA'
              return (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="px-3 py-2 tabular-nums text-white/70">{p.numero}</td>
                  <td className="px-3 py-2 text-white/70">{dt(p.vencimento)}</td>
                  <td className="px-3 py-2 tabular-nums">{brl(p.valor, moeda)}</td>
                  <td className="px-3 py-2">{quit ? <span className="text-emerald-400">recebida</span> : <span className="text-white/50">pendente</span>}</td>
                  <td className="px-3 py-2 text-right">
                    {!quit && <button disabled title="Registrar pagamento é feito no Financeiro do processo (fluxo canônico único)." className="rounded-md border border-white/20 px-2.5 py-1 text-xs text-white/80 cursor-not-allowed opacity-40">Registrar pagamento</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Wizard de Cobrança — 4 ETAPAS ──────────────────────────────────────────
//   1 Forma e configuração → 2 Condição e entrada → 3 Recebimento →
//   4 Simulação e geração (última etapa: revisão + simulação + gerar).
// NÃO há mais etapa "Confirmação": a Simulação é a última e traz o botão final
// "Confirmar e gerar cobrança". A prévia é a SIMULAÇÃO oficial do backend
// (ChargeCalculationService); a criação RECALCULA no servidor (autoridade) e
// congela a cotação no snapshot. Valores em EUR e BRL quando há conversão.
function CobrancaWizard({ receitaId, valor, moeda, receita, onClose, onCriada }: { receitaId: number; valor: number; moeda: string; receita?: any; onClose: () => void; onCriada: () => void }) {
  const [cfg, setCfg] = React.useState<Cfg | null>(null)
  const [step, setStep] = React.useState(1)
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [sucesso, setSucesso] = React.useState<any>(null)
  const [f, setF] = React.useState<{ formaPagamentoId?: number; condicaoPagamentoId?: number; contaBancariaId?: number; carteiraId?: number; gateway?: string; adquirenteId?: number; bandeiraId?: number; entradaValor?: number; moedaRecebimento?: string; cotacaoManual?: number; cotacaoManualAtiva?: boolean; justificativaCotacao?: string }>({})
  const [nParcelas, setNParcelas] = React.useState<number | ''>('')
  const [politicaEscolha, setPoliticaEscolha] = React.useState<string | null>(null)
  const [sim, setSim] = React.useState<any>(null)
  const [simulando, setSimulando] = React.useState(false)
  // Chave de idempotência: uma por sessão do wizard (retry/duplo-clique não duplica).
  const idemKey = React.useMemo(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `idem-${Date.now()}-${Math.round(Math.random() * 1e9)}`), [])
  // Campos de câmbio comuns às requisições de simular/criar.
  const camposCambio = () => ({
    moedaRecebimento: f.moedaRecebimento ?? undefined,
    cotacaoManual: f.cotacaoManualAtiva && f.cotacaoManual != null ? f.cotacaoManual : undefined,
    justificativaCotacaoManual: f.cotacaoManualAtiva ? (f.justificativaCotacao ?? undefined) : undefined,
    fonteCotacao: f.cotacaoManualAtiva ? 'Manual' : undefined,
  })

  React.useEffect(() => { jf('/api/financeiro/config').then(setCfg).catch((e) => setErro(e.message)) }, [])

  const condicao = cfg?.condicoesPagamento?.find((c: any) => c.id === f.condicaoPagamentoId)
  const formaSel = cfg?.formasPagamento?.find((x: any) => x.id === f.formaPagamentoId)
  // Cartão de crédito exige adquirente + bandeira (o motor desempata a taxa por
  // bandeira). Débito também usa bandeira; demais formas não.
  const ehCartaoCredito = formaSel?.type === 'CARTAO_CREDITO'
  const ehCartao = formaSel?.type === 'CARTAO_CREDITO' || formaSel?.type === 'CARTAO_DEBITO'
  const adqOpcoes = React.useMemo(
    () => (cfg?.adquirentes ?? []).filter((a: any) => !a.formasSuportadas?.length || (f.formaPagamentoId && a.formasSuportadas.includes(f.formaPagamentoId))),
    [cfg, f.formaPagamentoId],
  )

  // Formas que a condição permite (vazio = sem restrição → qualquer forma ativa
  // compatível). A compatibilidade real (moeda/direção/parcelas/adquirente) é do
  // backend: aqui só se restringe a lista e se sugere a padrão.
  const permitidas: number[] = condicao?.formasPermitidas ?? []
  const formasDisponiveis = React.useMemo(
    () => (cfg?.formasPagamento ?? []).filter((x: any) => !permitidas.length || permitidas.includes(x.id)),
    [cfg, condicao], // eslint-disable-line
  )
  const [avisoForma, setAvisoForma] = React.useState<string | null>(null)

  // Ao escolher a condição: pré-seleciona a FORMA PADRÃO e descarta uma forma
  // que a condição não permita (o operador pode trocar por qualquer permitida).
  React.useEffect(() => {
    if (!condicao) return
    const atual = f.formaPagamentoId
    if (atual && permitidas.length && !permitidas.includes(atual)) {
      const padrao = condicao.formaPadraoId && permitidas.includes(condicao.formaPadraoId) ? condicao.formaPadraoId : undefined
      setF((p) => ({ ...p, formaPagamentoId: padrao }))
      setAvisoForma('A forma escolhida não é permitida por esta condição — selecione uma das formas permitidas.')
      return
    }
    setAvisoForma(null)
    if (!atual && condicao.formaPadraoId) setF((p) => ({ ...p, formaPagamentoId: condicao.formaPadraoId }))
  }, [f.condicaoPagamentoId]) // eslint-disable-line

  // SIMULAÇÃO oficial no backend (não persiste). Recalcula ao mudar seleção/parcelas/política.
  const simular = React.useCallback(async () => {
    if (!f.formaPagamentoId) return
    setSimulando(true)
    try {
      const d = await jf('/api/financeiro/cobrancas/simular', {
        method: 'POST',
        body: JSON.stringify({ receitaId, ...f, ...camposCambio(), nParcelas: nParcelas === '' ? undefined : nParcelas, politicaTaxasEscolhida: politicaEscolha ?? undefined }),
      })
      setSim(d.simulacao)
    } catch (e: any) { setSim(null); setErro(e.message) } finally { setSimulando(false) }
  }, [receitaId, f, nParcelas, politicaEscolha])

  React.useEffect(() => { if (step >= 3) simular() }, [step, f.formaPagamentoId, f.condicaoPagamentoId, f.carteiraId, f.contaBancariaId, f.bandeiraId, f.adquirenteId, f.entradaValor, f.moedaRecebimento, f.cotacaoManual, f.cotacaoManualAtiva, nParcelas, politicaEscolha]) // eslint-disable-line

  const precisaEscolha = !!sim && !sim.ok && sim.erros?.some((e: any) => e.codigo === 'ESCOLHA_TAXA_OBRIGATORIA')
  const podeConfirmar = !!sim && sim.ok

  async function confirmar() {
    setSalvando(true); setErro(null)
    try {
      const d = await jf(`/api/financeiro/receitas/${receitaId}/cobrancas`, {
        method: 'POST',
        body: JSON.stringify({ ...f, ...camposCambio(), idempotencyKey: idemKey, nParcelas: nParcelas === '' ? undefined : nParcelas, politicaTaxasEscolhida: politicaEscolha ?? undefined }),
      })
      setSucesso(d) // tela de sucesso (não fecha direto)
    } catch (e: any) { setErro(e.message) } finally { setSalvando(false) }
  }

  const sel = 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30'
  const linha = (l: string, v: any) => (<div className="flex justify-between gap-3 py-0.5"><span className="text-white/45">{l}</span><span className="truncate text-right tabular-nums text-white/85">{v ?? '—'}</span></div>)
  const POL_LABEL: Record<string, string> = { IGNORAR: 'Ignorar', REPASSAR: 'Repassar ao cliente', ABSORVER: 'Absorver' }

  // ── câmbio derivado (usado pela Simulação E pelo resumo lateral) ──
  const cotacao = sim?.cambio?.cotacao != null ? Number(sim.cambio.cotacao) : null
  const origem = sim?.cambio?.moedaOrigem ? String(sim.cambio.moedaOrigem).toUpperCase() : moeda
  const destino = sim?.cambio?.moedaDestino ? String(sim.cambio.moedaDestino).toUpperCase() : null
  const temConv = !!destino && destino !== origem && cotacao != null && cotacao > 0
  const emDest = (v: number) => (v == null ? 0 : Math.round(Number(v) * (cotacao ?? 1) * 100) / 100)
  const dual = (v: number, bold = false) => (
    <span className="tabular-nums text-white/85">{bold ? <b>{brl(v, moeda)}</b> : brl(v, moeda)}{temConv && <span className="text-white/45"> · {brl(emDest(v), destino!)}</span>}</span>
  )
  const nomeForma = (id?: number) => cfg?.formasPagamento?.find((x: any) => x.id === id)?.name
  const nomeAdq = (id?: number) => (cfg?.adquirentes ?? []).find((x: any) => x.id === id)?.nome
  const nomeBand = (id?: number) => (cfg?.bandeiras ?? []).find((x: any) => x.id === id)?.nome
  const entradaSim = sim?.ok ? Number(sim.parcelas?.find((p: any) => p.entrada)?.valor ?? 0) : 0
  const saldoSim = sim?.ok ? Math.round((Number(sim.valorBase) - entradaSim) * 100) / 100 : 0

  const PASSOS = [
    { n: 1, label: 'Forma e configuração', desc: 'Forma, adquirente, bandeira e parcelas', icon: CreditCard },
    { n: 2, label: 'Entrada e vencimentos', desc: 'Entrada e cronograma', icon: CalendarClock },
    { n: 3, label: 'Recebimento', desc: 'Conta, moeda e cotação', icon: Landmark },
    { n: 4, label: 'Simulação e geração', desc: 'Revise, valide e gere', icon: Wallet },
  ]
  const Card = ({ label, children, destaque }: { label: string; children: React.ReactNode; destaque?: boolean }) => (
    <div className="rounded-xl border p-3" style={destaque ? { borderColor: `${OURO}55`, background: `${OURO}12` } : { borderColor: 'rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">{label}</p>
      <div className="mt-1 text-sm font-semibold">{children}</div>
    </div>
  )

  // Painel da SIMULAÇÃO (etapa 4). Cards + cronograma em EUR e na moeda de
  // destino. A cotação/valores vêm do runtime — o frontend só apresenta.
  const Simulacao = () => (
    <div className="space-y-4">
      {simulando && <p className="text-sm text-white/50">Simulando no servidor…</p>}
      {!simulando && sim && !sim.ok && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {sim.erros.map((e: any, i: number) => <div key={i}>• {e.mensagem}</div>)}
          {precisaEscolha && (
            <div className="mt-2 flex flex-wrap gap-2">
              {['IGNORAR', 'REPASSAR', 'ABSORVER'].map((p) => (
                <button key={p} onClick={() => setPoliticaEscolha(p)} className={`rounded-md border px-2.5 py-1 text-xs ${politicaEscolha === p ? 'text-[#1b1508]' : 'border-white/20 text-white/80 hover:bg-white/10'}`} style={politicaEscolha === p ? { background: OURO, borderColor: OURO } : undefined}>{POL_LABEL[p]}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {!simulando && sim && sim.ok && (<>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Card label="Valor contratado">{dual(sim.valorBase)}</Card>
          {entradaSim > 0 && <Card label="Entrada">{dual(entradaSim)}</Card>}
          {entradaSim > 0 && <Card label="Saldo financiado">{dual(saldoSim)}</Card>}
          <Card label={`Taxa da operação (${POL_LABEL[sim.politicaTaxas] ?? sim.politicaTaxas})`}>{sim.valorTaxa > 0 ? dual(sim.valorTaxa) : '—'}</Card>
          <Card label="Total cobrado" destaque>{dual(sim.totalCobrado, true)}</Card>
          <Card label="Valor líquido">{dual(sim.valorLiquido)}</Card>
        </div>
        {temConv && (
          <div className={`${GLASS} flex flex-wrap items-center justify-between gap-2 p-3 text-[12px]`}>
            <span className="text-white/70">Cotação: <b>1 {origem} = {cotacao} {destino}</b></span>
            <span className="text-white/45">{sim.cambio.fonte ?? '—'}{sim.cambio.data ? ` · ${dt(sim.cambio.data)}` : ''} · {(sim.cambio.tipo || '').toLowerCase() || (sim.cambio.estimado ? 'estimada — congelada ao gerar' : 'congelada nesta cobrança')}</span>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">Cronograma de parcelas</p>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-[13px]"><thead><tr className="bg-white/5 text-left text-[11px] uppercase tracking-wide text-white/45"><th className="px-3 py-2">#</th><th className="px-3 py-2">Descrição</th><th className="px-3 py-2">Vencimento</th><th className="px-3 py-2 text-right">Valor ({moeda})</th>{temConv && <th className="px-3 py-2 text-right">Valor ({destino})</th>}</tr></thead><tbody>
              {sim.parcelas.map((p: any) => <tr key={p.numero} className="border-t border-white/5"><td className="px-3 py-1.5 text-white/60">{p.numero}</td><td className="px-3 py-1.5 text-white/70">{p.entrada ? 'Entrada' : `Parcela ${p.entrada ? '' : p.numero}`}</td><td className="px-3 py-1.5 text-white/70">{dt(p.vencimento)}</td><td className="px-3 py-1.5 text-right tabular-nums">{brl(p.valor, moeda)}</td>{temConv && <td className="px-3 py-1.5 text-right tabular-nums text-white/70">{brl(emDest(p.valor), destino!)}</td>}</tr>)}
            </tbody></table>
          </div>
        </div>
        {Array.isArray(sim.memoria) && (
          <details className="text-[11px] text-white/50"><summary className="cursor-pointer text-white/60">Memória de cálculo</summary>
            <div className="mt-1 space-y-0.5 rounded-lg border border-white/10 bg-black/20 p-2">{sim.memoria.map((m: string, i: number) => <div key={i}>{m}</div>)}</div>
          </details>
        )}
      </>)}
    </div>
  )

  // ── Tela de SUCESSO após gerar ──
  if (sucesso) {
    const cob = sucesso.cobranca
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm" onClick={() => onCriada()}>
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/95 p-6 text-center text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full" style={{ background: `${OURO}22`, color: OURO }}><Check className="h-7 w-7" /></div>
          <h3 className="text-lg font-semibold">Cobrança criada com sucesso</h3>
          <p className="mt-1 text-sm text-white/55">A cobrança foi gerada e vinculada à receita.</p>
          <div className={`${GLASS} mt-4 space-y-1 p-4 text-left text-sm`}>
            {linha('Cobrança', `#${cob?.id}`)}
            {linha('Valor total', brl(cob?.valorTotal, cob?.moeda ?? moeda))}
            {linha('Parcelas', sucesso.parcelas)}
            {linha('Status', cob?.status)}
            {sucesso.idempotente && linha('Idempotência', 'requisição reaproveitada')}
          </div>
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={() => onCriada()} className="rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508]" style={{ background: OURO }}>Ver cobrança</button>
            <button onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Voltar para receita</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div className="flex h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold">Cadastrar Cobrança</h3>
            <p className="text-xs text-white/50">Crie uma nova cobrança vinculada à receita selecionada.</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        {/* Barra de etapas */}
        <div className="flex flex-wrap gap-2 border-b border-white/10 px-6 py-3">
          {PASSOS.map((p) => (
            <div key={p.n} className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2 ${step === p.n ? 'border-white/25 bg-white/[0.04]' : 'border-transparent'}`}>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px]" style={step === p.n ? { background: OURO, borderColor: OURO, color: '#1b1508' } : step > p.n ? { borderColor: '#34d39955', background: '#34d39914', color: '#6ee7b7' } : { borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)' }}>{step > p.n ? <Check className="h-3.5 w-3.5" /> : p.n}</span>
              <div className="min-w-0">
                <p className={`truncate text-[13px] font-medium ${step === p.n ? 'text-white' : 'text-white/60'}`}>{p.label}</p>
                <p className="truncate text-[10px] text-white/40">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Corpo: conteúdo (esq) + resumo lateral persistente (dir) */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!cfg && <p className="text-sm text-white/50">Carregando configuração…</p>}
          {erro && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-200">{erro}</div>}

          {cfg && step === 1 && (<div className="space-y-3"><div><label className="mb-1 block text-xs text-white/60">Forma de pagamento</label>
            <select className={sel} value={f.formaPagamentoId ?? ''} onChange={(e) => { const id = Number(e.target.value) || undefined; setF({ ...f, formaPagamentoId: id, adquirenteId: undefined, bandeiraId: undefined }) }}>
              <option value="" className="bg-zinc-900">Selecione</option>
              {formasDisponiveis.map((x: any) => <option key={x.id} value={x.id} className="bg-zinc-900">{x.name}{condicao?.formaPadraoId === x.id ? ' · padrão' : ''}</option>)}
            </select>
            {avisoForma && <p className="mt-1 text-[11px] text-amber-300/80">{avisoForma}</p>}
            {!!permitidas.length && <p className="mt-1 text-[11px] text-white/40">Somente as formas permitidas pela condição selecionada.</p>}
            </div>
            {ehCartao && (<>
              <div><label className="mb-1 block text-xs text-white/60">Adquirente {ehCartaoCredito ? '' : '(opcional)'}</label>
                <select className={sel} value={f.adquirenteId ?? ''} onChange={(e) => setF({ ...f, adquirenteId: Number(e.target.value) || undefined })}>
                  <option value="" className="bg-zinc-900">Selecione</option>
                  {adqOpcoes.map((a: any) => <option key={a.id} value={a.id} className="bg-zinc-900">{a.nome}</option>)}
                </select></div>
              <div><label className="mb-1 block text-xs text-white/60">Bandeira do cartão *</label>
                <select className={sel} value={f.bandeiraId ?? ''} onChange={(e) => setF({ ...f, bandeiraId: Number(e.target.value) || undefined })}>
                  <option value="" className="bg-zinc-900">Selecione</option>
                  {(cfg.bandeiras ?? []).map((b: any) => <option key={b.id} value={b.id} className="bg-zinc-900">{b.nome}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-white/40">A taxa do cartão é resolvida pela bandeira × parcelas na Tabela de Taxas.</p></div>
            </>)}
            </div>)}

          {cfg && step === 2 && (<div className="space-y-3">
            <div><label className="mb-1 block text-xs text-white/60">Condição de pagamento</label>
              <select className={sel} value={f.condicaoPagamentoId ?? ''} onChange={(e) => setF({ ...f, condicaoPagamentoId: Number(e.target.value) || undefined })}>
                <option value="" className="bg-zinc-900">Selecione</option>
                {cfg.condicoesPagamento.filter((c: any) => c.aplicaA !== 'CUSTO').map((x: any) => <option key={x.id} value={x.id} className="bg-zinc-900">{x.name} ({x.tipoPagamento})</option>)}
              </select></div>
            {condicao && condicao.tipoPagamento === 'PARCELADO' && (
              <div><label className="mb-1 block text-xs text-white/60">Quantidade de parcelas {condicao.parcelasMin || condicao.parcelasMax ? `(${condicao.parcelasMin ?? 1}–${condicao.parcelasMax ?? '—'})` : ''}</label>
                <input type="number" min={1} className={sel} value={nParcelas} placeholder={String(condicao.parcelasPadrao || 1)} onChange={(e) => setNParcelas(e.target.value === '' ? '' : Number(e.target.value))} /></div>
            )}
            {condicao?.temEntrada && (
              <div><label className="mb-1 block text-xs text-white/60">Entrada (opcional · PIX/Transferência, à parte)</label>
                <input type="number" min={0} step="0.01" className={sel} value={f.entradaValor ?? ''} placeholder="0,00" onChange={(e) => setF({ ...f, entradaValor: e.target.value === '' ? undefined : Number(e.target.value) })} />
                <p className="mt-1 text-[11px] text-white/40">A entrada é paga à parte e NÃO recebe taxa de cartão/boleto. O saldo é parcelado.</p></div>
            )}
          </div>)}

          {cfg && step === 3 && (<div className="space-y-3">
            <div><label className="mb-1 block text-xs text-white/60">Carteira de recebimento</label>
              <select className={sel} value={f.carteiraId ?? ''} onChange={(e) => setF({ ...f, carteiraId: Number(e.target.value) || undefined })}>
                <option value="" className="bg-zinc-900">— (opcional)</option>
                {cfg.carteiras.map((x: any) => <option key={x.id} value={x.id} className="bg-zinc-900">{x.nome}{x.contaNome ? ` · ${x.contaNome}` : ''}</option>)}
              </select></div>
            <div><label className="mb-1 block text-xs text-white/60">Conta bancária</label>
              <select className={sel} value={f.contaBancariaId ?? ''} onChange={(e) => setF({ ...f, contaBancariaId: Number(e.target.value) || undefined })}>
                <option value="" className="bg-zinc-900">— (opcional)</option>
                {cfg.contasBancarias.map((x: any) => <option key={x.id} value={x.id} className="bg-zinc-900">{x.nome} · {x.moeda}</option>)}
              </select></div>

            {/* Moeda e cotação */}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs text-white/60">Moeda da cobrança</label>
                <input className={`${sel} opacity-60`} value={moeda} readOnly title="Vem da receita" /></div>
              <div><label className="mb-1 block text-xs text-white/60">Moeda de recebimento</label>
                <select className={sel} value={f.moedaRecebimento ?? moeda} onChange={(e) => setF({ ...f, moedaRecebimento: e.target.value })}>
                  <option value={moeda} className="bg-zinc-900">{moeda} · mesma da receita</option>
                  {(cfg.moedas ?? []).filter((m: any) => m.code !== moeda).map((m: any) => <option key={m.code} value={m.code} className="bg-zinc-900">{m.code}{m.name ? ` · ${m.name}` : ''}</option>)}
                </select></div>
            </div>

            {f.moedaRecebimento && f.moedaRecebimento !== moeda && (
              <div className={`${GLASS} space-y-2 p-3 text-sm`}>
                {sim?.cambio && sim.cambio.estado !== 'INDISPONIVEL' ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-white/70">Cotação {sim.cambio.moedaOrigem}→{sim.cambio.moedaDestino}: <b>{Number(sim.cambio.cotacao)}</b></span>
                    <span className="text-[11px] text-white/45">{sim.cambio.fonte ?? '—'}{sim.cambio.data ? ` · ${dt(sim.cambio.data)}` : ''} · {(sim.cambio.tipo || '').toLowerCase() || (sim.cambio.estimado ? 'estimada' : 'congelada')}</span>
                  </div>
                ) : (
                  <p className="text-[12px] text-amber-300/80">Sem cotação automática vigente para {moeda}→{f.moedaRecebimento}. Informe uma cotação manual (requer permissão).</p>
                )}
                <label className="flex items-center gap-2 text-[12px] text-white/70">
                  <input type="checkbox" checked={!!f.cotacaoManualAtiva} onChange={(e) => setF({ ...f, cotacaoManualAtiva: e.target.checked })} />
                  Usar cotação manual
                </label>
                {f.cotacaoManualAtiva && (
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" step="0.0001" min={0} className={sel} placeholder={`1 ${moeda} = ? ${f.moedaRecebimento}`} value={f.cotacaoManual ?? ''} onChange={(e) => setF({ ...f, cotacaoManual: e.target.value === '' ? undefined : Number(e.target.value) })} />
                    <input className={sel} placeholder="Justificativa" value={f.justificativaCotacao ?? ''} onChange={(e) => setF({ ...f, justificativaCotacao: e.target.value })} />
                  </div>
                )}
              </div>
            )}
          </div>)}

          {cfg && step === 4 && (<div className="space-y-4">
            <div>
              <h4 className="text-base font-semibold">Simulação da cobrança</h4>
              <p className="text-xs text-white/50">Confira os valores, o cronograma e as conversões antes de gerar a cobrança.</p>
            </div>
            <Simulacao />
          </div>)}
          </div>{/* fim conteúdo esquerdo */}

          {/* Resumo lateral persistente */}
          <aside className="w-full shrink-0 space-y-3 overflow-y-auto border-t border-white/10 bg-black/20 px-5 py-5 lg:w-80 lg:border-l lg:border-t-0">
            <div className={`${GLASS} p-4`}>
              <div className="flex items-center gap-2 text-sm font-semibold"><ReceiptText className="h-4 w-4" style={{ color: OURO }} /> Receita selecionada</div>
              <p className="mt-1 text-xs text-white/50">{receita?.codigo ?? `#${receitaId}`}{receita?.descricao ? ` · ${receita.descricao}` : ''}</p>
              <div className="mt-3 space-y-1 text-sm">
                {linha('Valor contratado', brl(valor, moeda))}
                {linha('Moeda', moeda)}
                {linha('Processo', receita?.processoId ?? '—')}
                {linha('Regra financeira', receita?.regraFinanceiraId ?? '—')}
              </div>
            </div>

            <div className={`${GLASS} p-4`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Resumo da configuração</p>
              <div className="mt-2 space-y-1 text-sm">
                {linha('Forma', nomeForma(f.formaPagamentoId))}
                {ehCartao && linha('Adquirente', nomeAdq(f.adquirenteId))}
                {ehCartao && linha('Bandeira', nomeBand(f.bandeiraId))}
                {condicao?.tipoPagamento === 'PARCELADO' && linha('Parcelas', `${nParcelas || condicao?.parcelasPadrao || 1}x`)}
                {linha('Condição', condicao?.name)}
                {linha('Taxa', sim?.taxaAplicada?.nome ?? (sim?.valorTaxa ? 'resolvida' : '—'))}
                {linha('Política', sim?.politicaTaxas ? POL_LABEL[sim.politicaTaxas] : '—')}
              </div>
            </div>

            {temConv && (
              <div className={`${GLASS} p-4`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Valores de referência</p>
                <div className="mt-2 space-y-1 text-sm">
                  {linha('Cotação', `1 ${origem} = ${cotacao} ${destino}`)}
                  {linha(`Contratado (${destino})`, brl(emDest(valor), destino!))}
                  {sim?.ok && linha(`Total a receber (${destino})`, brl(emDest(sim.totalCobrado), destino!))}
                </div>
              </div>
            )}
          </aside>
        </div>{/* fim corpo */}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-6 py-3">
          <button onClick={() => (step > 1 ? setStep(step - 1) : onClose())} className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"><ArrowLeft className="h-4 w-4" /> {step > 1 ? 'Voltar' : 'Cancelar'}</button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/40">Etapa {step} de 4</span>
            {step < 4 ? (
              <button disabled={(step === 1 && (!f.formaPagamentoId || (ehCartaoCredito && !f.bandeiraId))) || (step === 2 && !f.condicaoPagamentoId)} onClick={() => setStep(step + 1)} className="inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition disabled:opacity-40" style={{ background: OURO }}>Próximo <ArrowRight className="h-4 w-4" /></button>
            ) : (
              <button disabled={salvando || !podeConfirmar} onClick={confirmar} className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold text-[#1b1508] transition disabled:opacity-50" style={{ background: OURO }}>{salvando ? 'Gerando…' : 'Confirmar e gerar cobrança'} <Check className="h-4 w-4" /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
