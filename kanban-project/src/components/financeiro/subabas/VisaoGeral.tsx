// src/components/financeiro/subabas/VisaoGeral.tsx
// ============================================================================
// VISÃO GERAL FINANCEIRA DO PROCESSO — painel OPERACIONAL (não é BI genérico).
// Mesma identidade das telas de Receitas / Dossiê. Fonte ÚNICA V3: consome
// /api/financeiro/v3/visao-geral (ObrigacaoEconomica + parcelas reais) — as
// MESMAS fórmulas de conversão/agregação abaixo continuam intactas (mesmo
// shape ItemAPI/ParcelaAPI → mesma matemática, sem alterar cálculo).
//
// Estrutura (mockup aprovado):
//   1) 5 cards: A Receber · Recebido · Custos · Lucro · Situação Financeira
//   2) Próximos eventos financeiros (≈70%) + Ações rápidas (≈30%)
//   3) Fluxo de Caixa Previsto · Distribuição por Moeda · Distribuição por Requerente
// ============================================================================
'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DollarSign, CreditCard, Database, BarChart3, CheckCircle2, AlertTriangle, ChevronRight,
  Loader2, Calendar, Receipt, Wallet, ArrowRight,
} from 'lucide-react'

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
interface ParcelaAPI { id: number; numero: number; vencimento: string; valor: number | string; status: string; dataPagamento?: string | null; cambioAplicado?: number | string | null; valorBrl?: number | string | null }
interface ItemAPI {
  id: number; codigo: string; categoria?: string; descricao: string; moeda: Moeda
  valor: number | string; fxEstimado: number | string; fxRule: FxRule; fxFixo?: number | string | null
  parcelas: ParcelaAPI[]; cancelada?: boolean; cancelado?: boolean; status?: string
  faseLabel?: string | null; tipoServico?: { nome: string } | null
  pessoa?: { id: number; nome: string; sobrenome?: string | null } | null
  requerentes?: { nome: string }[] | null
}

export interface VisaoGeralProps {
  processoId: number
  nomeFamilia?: string
  fxHoje?: number
  onIrPara?: (aba: 'receitas' | 'custos' | 'extrato') => void
}

const num = (v: unknown): number => { if (v == null) return 0; if (typeof v === 'number') return v; const n = parseFloat(String(v)); return isFinite(n) ? n : 0 }
const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${(v || 0).toFixed(2).replace('.', ',')}%`
const todayISO = () => new Date().toISOString().slice(0, 10)
const diaMes = (iso: string) => { const d = new Date((iso || '').includes('T') ? iso : iso + 'T00:00:00'); return isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` }
const diaSemana = (iso: string) => { const d = new Date((iso || '').includes('T') ? iso : iso + 'T00:00:00'); if (isNaN(d.getTime())) return ''; const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']; const hoje = todayISO(); const s = (iso || '').slice(0, 10); return s === hoje ? 'Hoje' : dias[d.getDay()] }
const nomeReq = (r: ItemAPI) => r.pessoa ? `${r.pessoa.nome}${r.pessoa.sobrenome ? ` ${r.pessoa.sobrenome}` : ''}` : (r.requerentes?.[0]?.nome ?? '—')
const descreve = (r: ItemAPI) => r.faseLabel || r.tipoServico?.nome || r.descricao || r.codigo

// Conversão para BRL — clone da regra existente (não altera cálculo).
function parcToBrl(item: ItemAPI, p: ParcelaAPI, FX: number): number {
  const moeda = item.moeda || 'EUR'
  const vBrlSalvo = num(p.valorBrl); if (vBrlSalvo > 0) return vBrlSalvo
  if (moeda === 'BRL') return num(p.valor)
  const isPago = p.status === 'PAGA' || p.status === 'RECEBIDA'
  const cambio = num(p.cambioAplicado); if (isPago && cambio > 0) return num(p.valor) * cambio
  const fx = item.fxRule === 'FIXO' ? (num(item.fxFixo) || num(item.fxEstimado) || FX) : (num(item.fxEstimado) || num(item.fxFixo) || FX)
  return num(p.valor) * fx
}
const pago = (s: string) => s === 'PAGA' || s === 'RECEBIDA'

// mesma regra de "ativo" do módulo (exclui cancelados) — sem alterar cálculo.
const ativo = (x: ItemAPI) => !x.cancelada && !x.cancelado && x.status !== 'CANCELADA'

export function VisaoGeral({ processoId, fxHoje = 5.5, onIrPara }: VisaoGeralProps) {
  const [receitas, setReceitas] = useState<ItemAPI[]>([])
  const [custos, setCustos] = useState<ItemAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [mesesFluxo, setMesesFluxo] = useState(6)

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true); setErro(null)
      try {
        const headers = { Authorization: `Bearer ${localStorage.getItem('authToken') || ''}` }
        // Fonte ÚNICA V3: uma chamada, já no shape ItemAPI (obrigações + parcelas reais).
        const res = await fetch(`/api/financeiro/v3/visao-geral?processoId=${processoId}`, { headers })
        if (cancelado) return
        if (res.ok) {
          const d = await res.json()
          setReceitas(Array.isArray(d?.receitas) ? d.receitas : [])
          setCustos(Array.isArray(d?.custos) ? d.custos : [])
        } else {
          setErro('Erro ao carregar dados financeiros.')
        }
      } catch { if (!cancelado) setErro('Erro de conexão ao carregar dados financeiros.') }
      finally { if (!cancelado) setLoading(false) }
    })()
    return () => { cancelado = true }
  }, [processoId])

  const m = useMemo(() => {
    let recT = 0, recR = 0, recP = 0, cusT = 0, inadCount = 0, inadBrl = 0
    const today = todayISO()
    for (const r of receitas.filter(ativo)) for (const p of r.parcelas) {
      const v = parcToBrl(r, p, fxHoje); recT += v
      if (pago(p.status)) recR += v
      else { recP += v; const venc = (p.vencimento || '').slice(0, 10); if (venc && venc < today) { inadCount++; inadBrl += v } }
    }
    for (const c of custos.filter(ativo)) for (const p of c.parcelas) cusT += parcToBrl(c, p, fxHoje)
    const lucro = recT - cusT
    return { recT, recR, recP, cusT, lucro, inadCount, inadBrl, pctReceber: recT > 0 ? (recP / recT) * 100 : 0, pctReceb: recT > 0 ? (recR / recT) * 100 : 0, pctCustos: recT > 0 ? (cusT / recT) * 100 : 0, pctLucro: recT > 0 ? (lucro / recT) * 100 : 100 }
  }, [receitas, custos, fxHoje])

  const eventos = useMemo(() => {
    const today = todayISO()
    const evs: { date: string; tipo: 'Receita' | 'Pagamento'; requerente: string; descricao: string; valorBrl: number; status: string; cor: string }[] = []
    for (const r of receitas.filter(ativo)) for (const p of r.parcelas) {
      if (pago(p.status)) continue
      const venc = (p.vencimento || '').slice(0, 10)
      const vencida = venc && venc < today
      evs.push({ date: p.vencimento, tipo: 'Receita', requerente: nomeReq(r), descricao: descreve(r), valorBrl: parcToBrl(r, p, fxHoje), status: vencida ? 'Vencida' : 'A vencer', cor: vencida ? 'red' : 'amber' })
    }
    for (const c of custos.filter(ativo)) for (const p of c.parcelas) {
      if (pago(p.status)) continue
      evs.push({ date: p.vencimento, tipo: 'Pagamento', requerente: nomeReq(c), descricao: descreve(c), valorBrl: parcToBrl(c, p, fxHoje), status: 'Pendente', cor: 'sky' })
    }
    return evs.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }, [receitas, custos, fxHoje])


  const porMoeda = useMemo(() => {
    const mp = new Map<string, number>()
    for (const r of receitas.filter(ativo)) { const tot = r.parcelas.reduce((s, p) => s + parcToBrl(r, p, fxHoje), 0); mp.set(r.moeda, (mp.get(r.moeda) || 0) + tot) }
    const total = [...mp.values()].reduce((s, v) => s + v, 0) || 1
    const cores: Record<string, string> = { BRL: 'var(--success)', EUR: 'var(--warning)', USD: 'var(--info)' }
    const nomes: Record<string, string> = { BRL: 'Real Brasileiro', EUR: 'Euro', USD: 'Dólar Americano' }
    return { total, itens: ['BRL', 'EUR', 'USD'].map((c) => ({ code: c, nome: nomes[c], cor: cores[c], valor: mp.get(c) || 0, pct: ((mp.get(c) || 0) / total) * 100 })) }
  }, [receitas, fxHoje])

  const porRequerente = useMemo(() => {
    const mp = new Map<string, number>()
    for (const r of receitas.filter(ativo)) { const nome = nomeReq(r); const tot = r.parcelas.reduce((s, p) => s + parcToBrl(r, p, fxHoje), 0); mp.set(nome, (mp.get(nome) || 0) + tot) }
    const arr = [...mp.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor)
    const total = arr.reduce((s, x) => s + x.valor, 0) || 1
    const top = arr.slice(0, 3)
    const restoVal = arr.slice(3).reduce((s, x) => s + x.valor, 0)
    const linhas = top.map((x) => ({ ...x, pct: (x.valor / total) * 100 }))
    if (restoVal > 0) linhas.push({ nome: 'Demais requerentes', valor: restoVal, pct: (restoVal / total) * 100 })
    return { total, linhas }
  }, [receitas, fxHoje])

  // Fluxo de Caixa Previsto — buckets mensais (Entradas = receitas, Saídas =
  // custos) a partir dos vencimentos das parcelas; Saldo = acumulado.
  const fluxoCaixa = useMemo(() => {
    const base = new Date(); base.setDate(1); base.setHours(0, 0, 0, 0)
    const meses = Array.from({ length: mesesFluxo }, (_, i) => {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1)
      return { ano: d.getFullYear(), mes: d.getMonth(), label: `${d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')} de ${String(d.getFullYear()).slice(2)}`, entradas: 0, saidas: 0 }
    })
    const idx = (iso: string) => { const d = new Date((iso || '').includes('T') ? iso : iso + 'T00:00:00'); return meses.findIndex((mm) => mm.ano === d.getFullYear() && mm.mes === d.getMonth()) }
    for (const r of receitas.filter(ativo)) for (const p of r.parcelas) { const k = idx(p.vencimento); if (k >= 0) meses[k].entradas += parcToBrl(r, p, fxHoje) }
    for (const c of custos.filter(ativo)) for (const p of c.parcelas) { const k = idx(p.vencimento); if (k >= 0) meses[k].saidas += parcToBrl(c, p, fxHoje) }
    let acc = 0
    const pontos = meses.map((mm) => { acc += mm.entradas - mm.saidas; return { label: mm.label, entradas: mm.entradas, saidas: mm.saidas, saldo: acc } })
    const totalEnt = pontos.reduce((s, p) => s + p.entradas, 0)
    const totalSai = pontos.reduce((s, p) => s + p.saidas, 0)
    return { pontos, totalEnt, totalSai, totalSaldo: totalEnt - totalSai }
  }, [receitas, custos, fxHoje, mesesFluxo])

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-[var(--text-muted)]" /></div>
  if (erro) return <div className="rounded-[var(--radius-md)] border p-4 text-sm text-[var(--danger)]" style={{ borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)' }}>{erro}</div>

  const emDia = m.inadCount === 0

  return (
    <div className="space-y-4 text-[var(--text-primary)]">
      {/* 1 · cinco cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card titulo="A Receber" valor={brl(m.recP)} sub={`${pct(m.pctReceber)} do previsto`} icon={DollarSign} cor="var(--success)" />
        <Card titulo="Recebido" valor={brl(m.recR)} sub={`${pct(m.pctReceb)} do total`} icon={CreditCard} cor="var(--info)" />
        <Card titulo="Custos" valor={brl(m.cusT)} sub={`${pct(m.pctCustos)} do total`} icon={Database} cor="var(--warning)" />
        <Card titulo="Lucro" valor={brl(m.lucro)} sub={`${pct(m.pctLucro)} do previsto`} icon={BarChart3} cor="var(--info)" />
        <Card titulo="Situação Financeira" valor={emDia ? 'Tudo em dia' : `${m.inadCount} parcela(s) vencida(s)`} valorCor={emDia ? 'text-[var(--success)]' : 'text-[var(--danger)]'} sub={emDia ? 'Nenhuma pendência' : brl(m.inadBrl)} icon={emDia ? CheckCircle2 : AlertTriangle} cor={emDia ? 'var(--success)' : 'var(--danger)'} />
      </div>

      {/* 2 · próximos eventos financeiros */}
      <div className="grid grid-cols-1 gap-4">
        <Painel titulo="Próximos eventos financeiros" acao={<button onClick={() => onIrPara?.('receitas')} className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Ver todos</button>}>
          {eventos.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--text-muted)]">Nenhum evento financeiro pendente.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{['Data', 'Tipo', 'Requerente', 'Descrição', 'Valor', 'Status', ''].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {eventos.slice(0, 6).map((e, i) => (
                    <tr key={i} className="border-t border-[var(--border-default)]">
                      <td className="px-3 py-2.5 text-[var(--text-secondary)]"><div>{diaMes(e.date)}</div><div className="text-[10px] text-[var(--text-muted)]">{diaSemana(e.date)}</div></td>
                      <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5" style={{ color: e.tipo === 'Receita' ? 'var(--success)' : 'var(--info)' }}>{e.tipo === 'Receita' ? <Receipt className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}{e.tipo}</span></td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)]">{e.requerente}</td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)]">{e.descricao}</td>
                      <td className="px-3 py-2.5 tabular-nums font-medium text-[var(--text-primary)]">{brl(e.valorBrl)}</td>
                      <td className="px-3 py-2.5"><Tag cor={e.cor}>{e.status}</Tag></td>
                      <td className="px-3 py-2.5"><button onClick={() => onIrPara?.('receitas')} className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Abrir</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => onIrPara?.('receitas')} className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">Ver todos os eventos financeiros <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </Painel>

      </div>

      {/* 3 · fluxo / moeda / requerente */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Painel titulo="Fluxo de Caixa Previsto" acao={
          <select value={mesesFluxo} onChange={(e) => setMesesFluxo(Number(e.target.value))} className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-input)] px-2 py-1 text-xs text-[var(--text-secondary)] outline-none">
            {[3, 6, 12].map((n) => <option key={n} value={n} className="bg-[var(--surface-popover)]">{n} meses</option>)}
          </select>
        }>
          <FluxoCaixaChart pontos={fluxoCaixa.pontos} totalEnt={fluxoCaixa.totalEnt} totalSai={fluxoCaixa.totalSai} totalSaldo={fluxoCaixa.totalSaldo} />
        </Painel>

        <Painel titulo="Distribuição por Moeda">
          <div className="flex items-center gap-4">
            <Donut itens={porMoeda.itens} />
            <div className="flex-1 space-y-2 text-xs">
              {porMoeda.itens.map((x) => (
                <div key={x.code} className="flex items-start gap-2">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.cor }} />
                  <div className="min-w-0"><p className="text-[var(--text-secondary)]">{x.code} — {x.nome}</p><p className="text-[var(--text-muted)]">{brl(x.valor)} ({x.pct.toFixed(0)}%)</p></div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-[var(--border-default)] pt-2 text-sm"><span className="text-[var(--text-muted)]">Total</span><span className="tabular-nums font-semibold">{brl(porMoeda.total === 1 ? 0 : porMoeda.total)}</span></div>
        </Painel>

        <Painel titulo="Distribuição por Requerente">
          {porRequerente.linhas.length === 0 ? <div className="py-8 text-center text-sm text-[var(--text-muted)]">Sem requerentes.</div> : (
            <div className="space-y-3">
              {porRequerente.linhas.map((x, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm"><span className="truncate text-[var(--text-secondary)]">{x.nome}</span><span className="ml-2 shrink-0 tabular-nums text-[var(--text-secondary)]">{brl(x.valor)} <span className="text-[var(--text-muted)]">{x.pct.toFixed(1)}%</span></span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]"><span className="block h-full rounded-full bg-[var(--success)]" style={{ width: `${Math.max(2, x.pct)}%` }} /></div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-[var(--border-default)] pt-2 text-sm"><span className="text-[var(--text-muted)]">Total</span><span className="tabular-nums font-semibold">{brl(porRequerente.total === 1 ? 0 : porRequerente.total)}</span></div>
            </div>
          )}
        </Painel>
      </div>

    </div>
  )
}

// ── auxiliares de UI (identidade Receitas/Dossiê) ───────────────────────────
const CARD = 'rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)]'
function Card({ titulo, valor, sub, icon: Ic, cor, valorCor }: { titulo: string; valor: string; sub: string; icon: any; cor: string; valorCor?: string }) {
  return (
    <div className={`${CARD} relative overflow-hidden p-4`}>
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{titulo}</p>
        <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)]" style={{ background: `color-mix(in srgb, ${cor} 13%, transparent)`, color: cor }}><Ic className="h-4 w-4" /></span>
      </div>
      <p className={`mt-2 text-xl font-bold ${valorCor ?? 'text-[var(--text-primary)]'}`}>{valor}</p>
      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{sub}</p>
    </div>
  )
}
function Painel({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-[var(--text-primary)]">{titulo}</h3>{acao}</div>
      {children}
    </section>
  )
}
function Tag({ cor, children }: { cor: string; children: React.ReactNode }) {
  const map: Record<string, string> = { amber: 'var(--warning)', red: 'var(--danger)', sky: 'var(--info)', emerald: 'var(--success)' }
  const v = map[cor] ?? map.sky
  return <span className="inline-block rounded-[var(--radius-sm)] border px-2 py-0.5 text-[11px] font-medium" style={{ color: v, borderColor: `color-mix(in srgb, ${v} 30%, transparent)`, background: `color-mix(in srgb, ${v} 15%, transparent)` }}>{children}</span>
}
function Donut({ itens }: { itens: { cor: string; valor: number; pct: number; code: string }[] }) {
  const size = 116, thick = 16, r = (size - thick) / 2, c = size / 2, circ = 2 * Math.PI * r
  const total = itens.reduce((s, x) => s + x.valor, 0)
  const principal = itens.slice().sort((a, b) => b.valor - a.valor)[0]
  let acc = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--border-default)" strokeWidth={thick} />
        {total > 0 && itens.filter((x) => x.valor > 0).map((x, i) => {
          const frac = x.valor / total; const dash = frac * circ; const off = acc * circ; acc += frac
          return <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={x.cor} strokeWidth={thick} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-off} />
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-bold text-[var(--text-primary)]">{total > 0 ? `${Math.round(principal.pct)}%` : '—'}</span><span className="text-[10px] text-[var(--text-muted)]">{total > 0 ? principal.code : ''}</span></div>
    </div>
  )
}

// Gráfico de Fluxo de Caixa Previsto (linhas Entradas/Saídas/Saldo por mês).
// Grid + eixos em HTML (não distorce), linhas em SVG com traço não-escalável,
// pontos em HTML (círculos perfeitos). Discovery tokens.
function FluxoCaixaChart({ pontos, totalEnt, totalSai, totalSaldo }: { pontos: { label: string; entradas: number; saidas: number; saldo: number }[]; totalEnt: number; totalSai: number; totalSaldo: number }) {
  const n = pontos.length
  const yMax = Math.max(1, ...pontos.flatMap((p) => [p.entradas, p.saidas, p.saldo]))
  const yMin = Math.min(0, ...pontos.map((p) => p.saldo))
  const range = (yMax - yMin) || 1
  const xPct = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100)
  const yPct = (v: number) => (1 - (v - yMin) / range) * 100
  const linha = (k: 'entradas' | 'saidas' | 'saldo') => pontos.map((p, i) => `${xPct(i)},${yPct(p[k])}`).join(' ')
  const gridVals = [0, 1, 2, 3, 4].map((i) => yMin + (range * (4 - i)) / 4)
  const fmtK = (v: number) => `R$ ${Math.round(v / 1000)}k`
  const PAD = 44
  const series = [{ k: 'entradas', cor: 'var(--success)' }, { k: 'saidas', cor: 'var(--danger)' }, { k: 'saldo', cor: 'var(--info)' }] as const
  return (
    <div>
      <div className="relative" style={{ height: 170 }}>
        {gridVals.map((v, i) => (
          <div key={i} className="absolute left-0 right-0 flex items-center" style={{ top: `${(i / 4) * 100}%` }}>
            <span className="shrink-0 -translate-y-1/2 pr-2 text-right text-[10px] text-[var(--text-muted)]" style={{ width: PAD }}>{fmtK(v)}</span>
            <div className="h-px flex-1 bg-[var(--border-default)]" />
          </div>
        ))}
        <svg className="absolute top-0 h-full" style={{ left: PAD, width: `calc(100% - ${PAD}px)` }} viewBox="0 0 100 100" preserveAspectRatio="none">
          {series.map((s) => <polyline key={s.k} points={linha(s.k)} fill="none" stroke={s.cor} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />)}
        </svg>
        {series.map((s) => pontos.map((p, i) => (
          <span key={s.k + i} className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: s.cor, left: `calc(${PAD}px + (100% - ${PAD}px) * ${xPct(i) / 100})`, top: `${yPct(p[s.k])}%` }} />
        )))}
      </div>
      <div className="mt-1 flex" style={{ paddingLeft: PAD }}>
        {pontos.map((p, i) => <span key={i} className="flex-1 text-center text-[10px] text-[var(--text-muted)]">{p.label}</span>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        <LegendaFluxo cor="var(--success)" label="Entradas" valor={totalEnt} />
        <LegendaFluxo cor="var(--danger)" label="Saídas" valor={totalSai} />
        <LegendaFluxo cor="var(--info)" label="Saldo" valor={totalSaldo} />
      </div>
    </div>
  )
}
function LegendaFluxo({ cor, label, valor }: { cor: string; label: string; valor: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: cor }} />
      <span className="text-[var(--text-secondary)]">{label} - </span>
      <span className="tabular-nums text-[var(--text-primary)]">{brl(valor)}</span>
    </span>
  )
}

export default VisaoGeral
