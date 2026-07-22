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

const OURO = '#D2A948'
const GLASS = 'rounded-xl border border-white/10 bg-white/[0.05] backdrop-blur-md'
const brl = (v: any, m = 'BRL') => { const n = v == null ? 0 : Number(v); try { return n.toLocaleString('pt-BR', { style: 'currency', currency: m }) } catch { return `${m} ${n.toFixed(2)}` } }
const dt = (s: any) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—')

function tok() { return typeof window !== 'undefined' ? localStorage.getItem('authToken') : null }
async function jf(url: string, opts: RequestInit = {}) {
  const t = tok()
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

      {wizard && <CobrancaWizard receitaId={receitaId} valor={contratado} moeda={moeda} onClose={() => setWizard(false)} onCriada={() => { setWizard(false); carregar(); onChanged?.() }} />}
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
                    {!quit && <button disabled={pagando === p.id} onClick={() => pagar(p.id, Number(p.valor))} className="rounded-md border border-white/20 px-2.5 py-1 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-50">{pagando === p.id ? '...' : 'Registrar pagamento'}</button>}
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

// ── Wizard de Cobrança (Forma → Condição → Conta/Carteira → prévia → confirmar) ──
function CobrancaWizard({ receitaId, valor, moeda, onClose, onCriada }: { receitaId: number; valor: number; moeda: string; onClose: () => void; onCriada: () => void }) {
  const [cfg, setCfg] = React.useState<Cfg | null>(null)
  const [step, setStep] = React.useState(1)
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [f, setF] = React.useState<{ formaPagamentoId?: number; condicaoPagamentoId?: number; contaBancariaId?: number; carteiraId?: number; gateway?: string }>({})

  React.useEffect(() => { jf('/api/financeiro/config').then(setCfg).catch((e) => setErro(e.message)) }, [])

  const condicao = cfg?.condicoesPagamento?.find((c: any) => c.id === f.condicaoPagamentoId)
  // prévia local aproximada das parcelas (a geração oficial acontece no backend)
  const nPrev = condicao ? (condicao.parcelasPadrao || condicao.parcelas || 1) : 1
  const previa = Array.from({ length: nPrev }, (_, i) => ({ numero: i + 1, valor: valor / nPrev }))

  async function confirmar() {
    setSalvando(true); setErro(null)
    try { await jf(`/api/financeiro/receitas/${receitaId}/cobrancas`, { method: 'POST', body: JSON.stringify(f) }); onCriada() }
    catch (e: any) { setErro(e.message) } finally { setSalvando(false) }
  }

  const Passo = ({ n, label, icon: Ic }: { n: number; label: string; icon: any }) => (
    <div className={`flex items-center gap-1.5 text-xs ${step === n ? 'text-white' : step > n ? 'text-emerald-400' : 'text-white/35'}`}>
      <span className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${step === n ? 'border-white/40' : step > n ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-white/15'}`}>{step > n ? <Check className="h-3 w-3" /> : n}</span>
      <Ic className="h-3.5 w-3.5" /> {label}
    </div>
  )
  const sel = 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h3 className="text-base font-semibold">Cadastrar Cobrança</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-white/10 px-5 py-2">
          <Passo n={1} label="Forma" icon={CreditCard} /><Passo n={2} label="Condição" icon={CalendarClock} /><Passo n={3} label="Conta/Carteira" icon={Landmark} /><Passo n={4} label="Parcelas" icon={Wallet} /><Passo n={5} label="Confirmar" icon={Check} />
        </div>

        <div className="space-y-3 px-5 py-4">
          {!cfg && <p className="text-sm text-white/50">Carregando configuração…</p>}
          {erro && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-200">{erro}</div>}

          {cfg && step === 1 && (<div><label className="mb-1 block text-xs text-white/60">Forma de pagamento</label>
            <select className={sel} value={f.formaPagamentoId ?? ''} onChange={(e) => setF({ ...f, formaPagamentoId: Number(e.target.value) || undefined })}>
              <option value="" className="bg-zinc-900">Selecione</option>
              {cfg.formasPagamento.map((x: any) => <option key={x.id} value={x.id} className="bg-zinc-900">{x.name}</option>)}
            </select></div>)}

          {cfg && step === 2 && (<div><label className="mb-1 block text-xs text-white/60">Condição de pagamento</label>
            <select className={sel} value={f.condicaoPagamentoId ?? ''} onChange={(e) => setF({ ...f, condicaoPagamentoId: Number(e.target.value) || undefined })}>
              <option value="" className="bg-zinc-900">Selecione</option>
              {cfg.condicoesPagamento.filter((c: any) => c.aplicaA !== 'CUSTO').map((x: any) => <option key={x.id} value={x.id} className="bg-zinc-900">{x.name} ({x.tipoPagamento})</option>)}
            </select></div>)}

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
          </div>)}

          {cfg && step === 4 && (<div>
            <p className="mb-2 text-xs text-white/60">Prévia das parcelas (gerada oficialmente pela Condição ao confirmar):</p>
            <div className="overflow-hidden rounded-lg border border-white/10">
              <table className="w-full text-[13px]"><tbody>
                {previa.map((p) => <tr key={p.numero} className="border-t border-white/5 first:border-0"><td className="px-3 py-1.5 text-white/60">Parcela {p.numero}</td><td className="px-3 py-1.5 text-right tabular-nums">{brl(p.valor, moeda)}</td></tr>)}
              </tbody></table>
            </div>
            <p className="mt-2 text-[11px] text-white/40">Total: {brl(valor, moeda)} · {nPrev}x</p>
          </div>)}

          {cfg && step === 5 && (<div className={`${GLASS} p-3 text-sm`}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">Confirmação</p>
            {[['Forma', cfg.formasPagamento.find((x: any) => x.id === f.formaPagamentoId)?.name], ['Condição', condicao?.name], ['Carteira', cfg.carteiras.find((x: any) => x.id === f.carteiraId)?.nome], ['Conta', cfg.contasBancarias.find((x: any) => x.id === f.contaBancariaId)?.nome], ['Total', brl(valor, moeda)]].map(([l, v], i) => (
              <div key={i} className="flex justify-between py-0.5"><span className="text-white/45">{l}</span><span className="text-white/85">{v ?? '—'}</span></div>
            ))}
          </div>)}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
          <button onClick={() => (step > 1 ? setStep(step - 1) : onClose())} className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"><ArrowLeft className="h-4 w-4" /> {step > 1 ? 'Voltar' : 'Cancelar'}</button>
          {step < 5 ? (
            <button disabled={(step === 1 && !f.formaPagamentoId) || (step === 2 && !f.condicaoPagamentoId)} onClick={() => setStep(step + 1)} className="inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition disabled:opacity-40" style={{ background: OURO }}>Próximo <ArrowRight className="h-4 w-4" /></button>
          ) : (
            <button disabled={salvando} onClick={confirmar} className="inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition disabled:opacity-50" style={{ background: OURO }}>{salvando ? 'Criando…' : 'Criar Cobrança'} <Check className="h-4 w-4" /></button>
          )}
        </div>
      </div>
    </div>
  )
}
