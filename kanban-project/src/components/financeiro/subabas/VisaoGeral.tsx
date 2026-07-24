// src/components/financeiro/subabas/VisaoGeral.tsx
// ============================================================================
// VISÃO GERAL FINANCEIRA DO PROCESSO — painel OPERACIONAL (não é BI genérico).
// Mesma identidade das telas de Receitas / Dossiê. Só reorganização visual:
// consome os MESMOS endpoints (/api/financeiro/receitas + /custos) e as MESMAS
// fórmulas de conversão/agregação — nenhuma regra de negócio ou cálculo mudou.
//
// Estrutura (mockup aprovado):
//   1) 5 cards: A Receber · Recebido · Custos · Lucro · Situação Financeira
//   2) Próximos eventos financeiros (≈70%) + Ações rápidas (≈30%)
//   3) Fluxo de Caixa Previsto · Distribuição por Moeda · Distribuição por Requerente
// ============================================================================
'use client'

import { useEffect, useMemo, useState } from 'react'
import { parseLista } from '@/src/lib/financeiro/parseLista'
import {
  DollarSign, CreditCard, Database, BarChart3, CheckCircle2, AlertTriangle, ChevronRight,
  Loader2, Calendar, Receipt, Wallet, FileDown, ArrowRight,
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

// Mapeia uma obrigação nativa V3 (lançamento manual) para o shape ItemAPI que a
// Visão Geral consome — uma "parcela" sintética = o valor contratado; quitação
// deriva do recebido. Sem fx próprio → conversão usa fxHoje (estimativa).
function obrToItem(o: any, natureza: 'RECEITA' | 'CUSTO'): ItemAPI {
  const quitado = Number(o.recebido) >= Number(o.valorContratado) - 0.005
  const statusParc = quitado ? (natureza === 'RECEITA' ? 'RECEBIDA' : 'PAGA') : 'PENDENTE'
  return {
    id: o.obrigacaoId, codigo: o.codigoOperacional ?? `#${o.obrigacaoId}`,
    descricao: o.descricao ?? '', moeda: (o.moeda ?? 'BRL') as Moeda,
    valor: Number(o.valorContratado), fxEstimado: 0, fxRule: 'VARIAVEL', fxFixo: null,
    status: o.status === 'CANCELADO' ? 'CANCELADA' : 'ATIVA',
    parcelas: [{ id: o.obrigacaoId, numero: 1, vencimento: o.vencimento ?? '', valor: Number(o.valorContratado), status: statusParc, valorBrl: o.moeda === 'BRL' ? Number(o.valorContratado) : null }],
  }
}
// mesma regra de "ativo" do módulo (exclui cancelados) — sem alterar cálculo.
const ativo = (x: ItemAPI) => !x.cancelada && !x.cancelado && x.status !== 'CANCELADA'

export function VisaoGeral({ processoId, fxHoje = 5.5, onIrPara }: VisaoGeralProps) {
  const [receitas, setReceitas] = useState<ItemAPI[]>([])
  const [custos, setCustos] = useState<ItemAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true); setErro(null)
      try {
        const headers = { Authorization: `Bearer ${localStorage.getItem('authToken') || ''}` }
        // Legado (Receita/Custo) + lançamentos MANUAIS nativos do motor V3
        // (origemTipo='nativo': só existem como obrigação, sem linha legada → sem
        // dupla contagem com as receitas legadas já espelhadas em obrigação).
        const [resR, resC, resNR, resNC] = await Promise.all([
          fetch(`/api/financeiro/receitas?processoId=${processoId}`, { headers }),
          fetch(`/api/financeiro/custos?processoId=${processoId}`, { headers }),
          fetch(`/api/financeiro/v3/obrigacoes?processoId=${processoId}&natureza=RECEITA&origemTipo=nativo`, { headers }),
          fetch(`/api/financeiro/v3/obrigacoes?processoId=${processoId}&natureza=CUSTO&origemTipo=nativo`, { headers }),
        ])
        if (cancelado) return
        const nativosR = resNR.ok ? ((await resNR.json())?.obrigacoes ?? []).map((o: any) => obrToItem(o, 'RECEITA')) : []
        const nativosC = resNC.ok ? ((await resNC.json())?.obrigacoes ?? []).map((o: any) => obrToItem(o, 'CUSTO')) : []
        if (resR.ok) { const d = await resR.json(); const l = parseLista<ItemAPI>(d); if (!cancelado) setReceitas([...(Array.isArray(l) ? l : []), ...nativosR]) }
        else if (!cancelado) setReceitas(nativosR)
        if (resC.ok) { const d = await resC.json(); const l = parseLista<ItemAPI>(d); if (!cancelado) setCustos([...(Array.isArray(l) ? l : []), ...nativosC]) }
        else if (!cancelado) setCustos(nativosC)
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

  const fluxo = useMemo(() => eventos.filter((e) => e.tipo === 'Receita').slice(0, 4), [eventos])

  const porMoeda = useMemo(() => {
    const mp = new Map<string, number>()
    for (const r of receitas.filter(ativo)) { const tot = r.parcelas.reduce((s, p) => s + parcToBrl(r, p, fxHoje), 0); mp.set(r.moeda, (mp.get(r.moeda) || 0) + tot) }
    const total = [...mp.values()].reduce((s, v) => s + v, 0) || 1
    const cores: Record<string, string> = { BRL: '#4ade80', EUR: '#fbbf24', USD: '#7dd3fc' }
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

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/40" /></div>
  if (erro) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{erro}</div>

  const emDia = m.inadCount === 0

  return (
    <div className="space-y-4 text-white">
      {/* 1 · cinco cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card titulo="A Receber" valor={brl(m.recP)} sub={`${pct(m.pctReceber)} do previsto`} icon={DollarSign} cor="#4ade80" />
        <Card titulo="Recebido" valor={brl(m.recR)} sub={`${pct(m.pctReceb)} do total`} icon={CreditCard} cor="#7dd3fc" />
        <Card titulo="Custos" valor={brl(m.cusT)} sub={`${pct(m.pctCustos)} do total`} icon={Database} cor="#fbbf24" />
        <Card titulo="Lucro" valor={brl(m.lucro)} sub={`${pct(m.pctLucro)} do previsto`} icon={BarChart3} cor="#a78bfa" />
        <Card titulo="Situação Financeira" valor={emDia ? 'Tudo em dia' : `${m.inadCount} parcela(s) vencida(s)`} valorCor={emDia ? 'text-[#4ade80]' : 'text-red-400'} sub={emDia ? 'Nenhuma pendência' : brl(m.inadBrl)} icon={emDia ? CheckCircle2 : AlertTriangle} cor={emDia ? '#4ade80' : '#f87171'} />
      </div>

      {/* 2 · eventos + ações */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <Painel titulo="Próximos eventos financeiros" acao={<button onClick={() => onIrPara?.('receitas')} className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/70 hover:bg-white/10">Ver todos</button>}>
          {eventos.length === 0 ? (
            <div className="py-10 text-center text-sm text-white/40">Nenhum evento financeiro pendente.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-white/40">{['Data', 'Tipo', 'Requerente', 'Descrição', 'Valor', 'Status', ''].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {eventos.slice(0, 6).map((e, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-3 py-2.5 text-white/70"><div>{diaMes(e.date)}</div><div className="text-[10px] text-white/35">{diaSemana(e.date)}</div></td>
                      <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5" style={{ color: e.tipo === 'Receita' ? '#4ade80' : '#7dd3fc' }}>{e.tipo === 'Receita' ? <Receipt className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}{e.tipo}</span></td>
                      <td className="px-3 py-2.5 text-white/80">{e.requerente}</td>
                      <td className="px-3 py-2.5 text-white/60">{e.descricao}</td>
                      <td className="px-3 py-2.5 tabular-nums font-medium text-white/90">{brl(e.valorBrl)}</td>
                      <td className="px-3 py-2.5"><Tag cor={e.cor}>{e.status}</Tag></td>
                      <td className="px-3 py-2.5"><button onClick={() => onIrPara?.('receitas')} className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10">Abrir</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => onIrPara?.('receitas')} className="mt-3 inline-flex items-center gap-1 text-xs text-white/50 hover:text-white">Ver todos os eventos financeiros <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </Painel>

        <Painel titulo="Ações rápidas">
          <div className="space-y-2">
            <Acao icon={DollarSign} cor="#4ade80" titulo="Abrir Receitas" sub="Visualizar todas as receitas do processo" onClick={() => onIrPara?.('receitas')} />
            <Acao icon={Database} cor="#fbbf24" titulo="Abrir Custos" sub="Visualizar todos os custos do processo" onClick={() => onIrPara?.('custos')} />
            <Acao icon={Receipt} cor="#D2A948" titulo="Gerar Cobrança" sub="Gerar nova cobrança para o processo" onClick={() => onIrPara?.('receitas')} />
            <Acao icon={CreditCard} cor="#7dd3fc" titulo="Registrar Pagamento" sub="Registrar pagamento recebido" onClick={() => onIrPara?.('receitas')} />
            <Acao icon={FileDown} cor="#a78bfa" titulo="Exportar Financeiro" sub="Exportar relatório financeiro" onClick={() => window.print()} />
          </div>
        </Painel>
      </div>

      {/* 3 · fluxo / moeda / requerente */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Painel titulo="Fluxo de Caixa Previsto">
          {fluxo.length === 0 ? <div className="py-8 text-center text-sm text-white/40">Sem recebimentos previstos.</div> : (
            <div className="space-y-4">
              {fluxo.map((e, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-9 shrink-0 text-center"><div className="text-sm font-bold text-white">{diaMes(e.date).slice(0, 2)}</div><div className="text-[9px] uppercase text-white/40">{new Date(e.date).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</div></div>
                  <div className="relative flex flex-col items-center self-stretch"><span className="h-2.5 w-2.5 rounded-full bg-[#4ade80]" />{i < fluxo.length - 1 && <span className="w-px flex-1 bg-white/15" />}</div>
                  <div className="min-w-0 flex-1"><p className="text-sm text-white/80">Recebimento previsto</p><p className="truncate text-[11px] text-white/45">{e.descricao}</p></div>
                  <span className="tabular-nums text-sm font-medium text-[#4ade80]">{brl(e.valorBrl)}</span>
                </div>
              ))}
            </div>
          )}
        </Painel>

        <Painel titulo="Distribuição por Moeda">
          <div className="flex items-center gap-4">
            <Donut itens={porMoeda.itens} />
            <div className="flex-1 space-y-2 text-xs">
              {porMoeda.itens.map((x) => (
                <div key={x.code} className="flex items-start gap-2">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.cor }} />
                  <div className="min-w-0"><p className="text-white/80">{x.code} — {x.nome}</p><p className="text-white/45">{brl(x.valor)} ({x.pct.toFixed(0)}%)</p></div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2 text-sm"><span className="text-white/45">Total</span><span className="tabular-nums font-semibold">{brl(porMoeda.total === 1 ? 0 : porMoeda.total)}</span></div>
        </Painel>

        <Painel titulo="Distribuição por Requerente">
          {porRequerente.linhas.length === 0 ? <div className="py-8 text-center text-sm text-white/40">Sem requerentes.</div> : (
            <div className="space-y-3">
              {porRequerente.linhas.map((x, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm"><span className="truncate text-white/80">{x.nome}</span><span className="ml-2 shrink-0 tabular-nums text-white/70">{brl(x.valor)} <span className="text-white/40">{x.pct.toFixed(1)}%</span></span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[#4ade80]" style={{ width: `${Math.max(2, x.pct)}%` }} /></div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-white/10 pt-2 text-sm"><span className="text-white/45">Total</span><span className="tabular-nums font-semibold">{brl(porRequerente.total === 1 ? 0 : porRequerente.total)}</span></div>
            </div>
          )}
        </Painel>
      </div>
    </div>
  )
}

// ── auxiliares de UI (identidade Receitas/Dossiê) ───────────────────────────
const CARD = 'rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-sm'
function Card({ titulo, valor, sub, icon: Ic, cor, valorCor }: { titulo: string; valor: string; sub: string; icon: any; cor: string; valorCor?: string }) {
  return (
    <div className={`${CARD} relative overflow-hidden p-4`}>
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{titulo}</p>
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${cor}22`, color: cor }}><Ic className="h-4 w-4" /></span>
      </div>
      <p className={`mt-2 text-xl font-bold ${valorCor ?? 'text-white'}`}>{valor}</p>
      <p className="mt-0.5 text-[11px] text-white/45">{sub}</p>
      <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: cor }} />
    </div>
  )
}
function Painel({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-white">{titulo}</h3>{acao}</div>
      {children}
    </section>
  )
}
function Acao({ icon: Ic, cor, titulo, sub, onClick }: { icon: any; cor: string; titulo: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-left transition hover:bg-white/[0.06]">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${cor}22`, color: cor }}><Ic className="h-4.5 w-4.5" /></span>
      <div className="min-w-0 flex-1"><p className="text-sm font-medium text-white">{titulo}</p><p className="truncate text-[11px] text-white/45">{sub}</p></div>
      <ChevronRight className="h-4 w-4 text-white/30 transition group-hover:text-white/60" />
    </button>
  )
}
function Tag({ cor, children }: { cor: string; children: React.ReactNode }) {
  const map: Record<string, string> = { amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30', red: 'bg-red-500/15 text-red-300 border-red-500/30', sky: 'bg-sky-500/15 text-sky-300 border-sky-500/30', emerald: 'bg-emerald-500/15 text-[#4ade80] border-emerald-500/30' }
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${map[cor] ?? map.sky}`}>{children}</span>
}
function Donut({ itens }: { itens: { cor: string; valor: number; pct: number; code: string }[] }) {
  const size = 116, thick = 16, r = (size - thick) / 2, c = size / 2, circ = 2 * Math.PI * r
  const total = itens.reduce((s, x) => s + x.valor, 0)
  const principal = itens.slice().sort((a, b) => b.valor - a.valor)[0]
  let acc = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={thick} />
        {total > 0 && itens.filter((x) => x.valor > 0).map((x, i) => {
          const frac = x.valor / total; const dash = frac * circ; const off = acc * circ; acc += frac
          return <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={x.cor} strokeWidth={thick} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-off} />
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-bold text-white">{total > 0 ? `${Math.round(principal.pct)}%` : '—'}</span><span className="text-[10px] text-white/40">{total > 0 ? principal.code : ''}</span></div>
    </div>
  )
}

export default VisaoGeral
