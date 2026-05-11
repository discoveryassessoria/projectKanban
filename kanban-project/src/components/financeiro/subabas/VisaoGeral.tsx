// src/components/financeiro/subabas/VisaoGeral.tsx
//
// 🆕 Fase 3 v2.3 — Clone FIEL de `renderVisaoGeralPrem()` (linha 7469 do
// html_final_marco.html). Versão Premium consolidada em BRL (caixa real).
//
// Estrutura (4 linhas, igual HTML mestre):
//   Linha 1: 5 KPIs coloridos com ícone + barra de cor inferior
//            Receita Total | Recebida | Pendente | Custo Total | Lucro Líquido
//   Linha 2: Resumo Financeiro (lista) | Donut Receitas (% no centro) | Donut Custos
//   Linha 3: Resultado do Processo (sparkline) | Inadimplência | Fluxo de Caixa 30d
//   Linha 4: Saldos por Moeda (EUR/BRL/USD) | Resumo Rápido (4 cells)
//
// Endpoints: /api/financeiro/receitas e /api/financeiro/custos.
// Imposto: 10% sobre receita total (placeholder do HTML — linha 7494).
// FX hoje: 5.5 (placeholder — props `fxHoje` futura).

'use client'

import '@/src/styles/financeiro-paginas.css'
import { useEffect, useMemo, useState } from 'react'
import { parseLista } from '@/src/lib/financeiro/parseLista'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type StatusParcela = 'PENDENTE' | 'RECEBIDA' | 'PAGA' | 'CANCELADA'

interface ParcelaAPI {
  id: number
  numero: number
  vencimento: string
  valor: number | string
  status: StatusParcela
  dataPagamento?: string | null
  cambioAplicado?: number | string | null
  valorBrl?: number | string | null
}

interface ItemAPI {
  id: number
  codigo: string
  categoria: string
  descricao: string
  moeda: Moeda
  valor: number | string
  fxEstimado: number | string
  fxRule: FxRule
  fxFixo?: number | string | null
  parcelas: ParcelaAPI[]
}

export interface VisaoGeralProps {
  processoId: number
  nomeFamilia?: string
  fxHoje?: number
}

// ============================================================================
// Helpers (replicam fmtBRL, fmtEUR, _fmtUSD, _fmtDateShort do HTML)
// ============================================================================

const num = (v: unknown): number => {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const n = parseFloat(String(v))
  return isFinite(n) ? n : 0
}
const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtEUR = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'EUR' })
const fmtUSD = (v: number) =>
  'US$ ' +
  (v || 0)
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')

const fmtPctBR = (v: number) => v.toFixed(2).replace('.', ',') + '%'

function fmtDateShort(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return (
    d.getDate().toString().padStart(2, '0') +
    '/' +
    (d.getMonth() + 1).toString().padStart(2, '0')
  )
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

// ============================================================================
// _parcToBrl (clone EXATO do helper do HTML, linha 7327)
// ============================================================================

function parcToBrl(item: ItemAPI, p: ParcelaAPI, FX: number): number {
  const moeda = item.moeda || 'EUR'
  const vBrlSalvo = num(p.valorBrl)
  if (vBrlSalvo > 0) return vBrlSalvo
  if (moeda === 'BRL') return num(p.valor)
  const isPago = p.status === 'PAGA' || p.status === 'RECEBIDA'
  const cambio = num(p.cambioAplicado)
  if (isPago && cambio > 0) return num(p.valor) * cambio
  const fx =
    item.fxRule === 'FIXO'
      ? num(item.fxFixo) || num(item.fxEstimado) || FX
      : num(item.fxEstimado) || num(item.fxFixo) || FX
  return num(p.valor) * fx
}

// ============================================================================
// Donut SVG (clone EXATO de _donutSvg do HTML, linha 5877)
// ============================================================================

interface DonutSeg {
  value: number
  color: string
}

function DonutSvg({
  segments,
  size = 160,
  thickness = 18,
}: {
  segments: DonutSeg[]
  size?: number
  thickness?: number
}) {
  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  let acc = 0
  const paths: React.ReactNode[] = [
    <circle
      key="bg"
      cx={cx}
      cy={cy}
      r={r}
      fill="none"
      stroke="#f1f5f9"
      strokeWidth={thickness}
    />,
  ]
  segments.forEach((seg, idx) => {
    if (seg.value <= 0) return
    const ratio = seg.value / total
    if (ratio >= 0.9999) {
      paths.push(
        <circle
          key={`s-${idx}`}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={seg.color}
          strokeWidth={thickness}
        />,
      )
      acc += seg.value
      return
    }
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2
    const end = ((acc + seg.value) / total) * Math.PI * 2 - Math.PI / 2
    const x1 = cx + r * Math.cos(start)
    const y1 = cy + r * Math.sin(start)
    const x2 = cx + r * Math.cos(end)
    const y2 = cy + r * Math.sin(end)
    const large = seg.value / total > 0.5 ? 1 : 0
    paths.push(
      <path
        key={`s-${idx}`}
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
        fill="none"
        stroke={seg.color}
        strokeWidth={thickness}
        strokeLinecap="round"
      />,
    )
    acc += seg.value
  })
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {paths}
    </svg>
  )
}

// ============================================================================
// Sparkline SVG (clone de _sparkSvg do HTML, linha 5909)
// ============================================================================

function SparkSvg({
  values,
  width = 300,
  height = 90,
  color = '#10b981',
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (!values || values.length === 0) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const step = width / (values.length - 1 || 1)
  let path = ''
  values.forEach((v, i) => {
    const x = i * step
    const y = height - ((v - min) / range) * (height - 6) - 3
    path += (i === 0 ? 'M' : 'L') + ` ${x.toFixed(1)} ${y.toFixed(1)} `
  })
  const area = path + `L ${width} ${height} L 0 ${height} Z`
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={area} fill={color + '20'} />
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  )
}

// ============================================================================
// Componente principal
// ============================================================================

export function VisaoGeral({ processoId, fxHoje = 5.5 }: VisaoGeralProps) {
  const [receitas, setReceitas] = useState<ItemAPI[]>([])
  const [custos, setCustos] = useState<ItemAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // ---- Load ----
  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setLoading(true)
      setErro(null)
      try {
        const headers = {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        }
        const [resR, resC] = await Promise.all([
          fetch(`/api/financeiro/receitas?processoId=${processoId}`, { headers }),
          fetch(`/api/financeiro/custos?processoId=${processoId}`, { headers }),
        ])
        if (cancelado) return
        if (resR.ok) {
          const d = await resR.json()
          const lst = parseLista<ItemAPI>(d)
          if (!cancelado) setReceitas(Array.isArray(lst) ? lst : [])
        }
        if (resC.ok) {
          const d = await resC.json()
          const lst = parseLista<ItemAPI>(d)
          if (!cancelado) setCustos(Array.isArray(lst) ? lst : [])
        }
      } catch (err) {
        console.error('[VisaoGeral] erro:', err)
        if (!cancelado) setErro('Erro de conexão ao carregar dados financeiros.')
      } finally {
        if (!cancelado) setLoading(false)
      }
    }
    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId])

  // ---- Agregação BRL (clone EXATO de _aggrBrl do HTML, linha 7285) ----
  const a = useMemo(() => {
    const o = {
      rec: { totalBrl: 0, recebidoBrl: 0, pendenteBrl: 0 },
      cus: { totalBrl: 0, recebidoBrl: 0, pendenteBrl: 0 },
    }
    for (const r of receitas) {
      for (const p of r.parcelas) {
        const v = parcToBrl(r, p, fxHoje)
        o.rec.totalBrl += v
        if (p.status === 'RECEBIDA' || p.status === 'PAGA') o.rec.recebidoBrl += v
        else o.rec.pendenteBrl += v
      }
    }
    for (const c of custos) {
      for (const p of c.parcelas) {
        const v = parcToBrl(c, p, fxHoje)
        o.cus.totalBrl += v
        if (p.status === 'PAGA' || p.status === 'RECEBIDA') o.cus.recebidoBrl += v
        else o.cus.pendenteBrl += v
      }
    }
    return o
  }, [receitas, custos, fxHoje])

  // ---- Métricas derivadas (linha 7488 do HTML) ----
  const metrics = useMemo(() => {
    const recT = a.rec.totalBrl
    const recR = a.rec.recebidoBrl
    const recP = a.rec.pendenteBrl
    const cusT = a.cus.totalBrl
    const cusPagos = a.cus.recebidoBrl
    const cusAPagar = cusT - cusPagos
    const impostoBrl = recT * 0.1 // 10% — igual HTML
    const recLiq = recT - impostoBrl
    const lucroBruto = recLiq - cusT
    const lucroLiquido = recT - cusT
    const margem = recT > 0 ? (lucroBruto / recT) * 100 : 0
    const margemLucroLiq = recT > 0 ? (lucroLiquido / recT) * 100 : 0
    const pctR = recT > 0 ? (recR / recT) * 100 : 0
    const pctP = recT > 0 ? (recP / recT) * 100 : 0
    const pctCustos = recT > 0 ? (cusT / recT) * 100 : 0
    const pctCustoPagos = cusT > 0 ? (cusPagos / cusT) * 100 : 0
    return {
      recT,
      recR,
      recP,
      cusT,
      cusPagos,
      cusAPagar,
      impostoBrl,
      recLiq,
      lucroBruto,
      lucroLiquido,
      margem,
      margemLucroLiq,
      pctR,
      pctP,
      pctCustos,
      pctCustoPagos,
    }
  }, [a])

  // ---- Inadimplência (parcelas vencidas) ----
  const inad = useMemo(() => {
    const today = todayISO()
    let totalInadBrl = 0
    let inadCount = 0
    for (const r of receitas) {
      for (const p of r.parcelas) {
        const venc = (p.vencimento || '').slice(0, 10)
        if (p.status === 'PENDENTE' && venc && venc < today) {
          totalInadBrl += parcToBrl(r, p, fxHoje)
          inadCount += 1
        }
      }
    }
    return { totalInadBrl, inadCount }
  }, [receitas, fxHoje])

  // ---- Fluxo de Caixa 30 dias ----
  const fluxo = useMemo(() => {
    const today = todayISO()
    const dueIn30 = new Date()
    dueIn30.setDate(dueIn30.getDate() + 30)
    const dueIn30Iso = dueIn30.toISOString().split('T')[0]
    const fluxos: Array<{
      date: string
      dir: 'in' | 'out'
      label: string
      valBrl: number
    }> = []
    for (const r of receitas) {
      for (const p of r.parcelas) {
        if (p.status === 'RECEBIDA' || p.status === 'PAGA') continue
        const venc = (p.vencimento || '').slice(0, 10)
        if (venc && venc >= today && venc <= dueIn30Iso) {
          fluxos.push({
            date: venc,
            dir: 'in',
            label: 'Recebimento previsto',
            valBrl: parcToBrl(r, p, fxHoje),
          })
        }
      }
    }
    for (const c of custos) {
      for (const p of c.parcelas) {
        if (p.status === 'PAGA' || p.status === 'RECEBIDA') continue
        const venc = (p.vencimento || '').slice(0, 10)
        if (venc && venc >= today && venc <= dueIn30Iso) {
          fluxos.push({
            date: venc,
            dir: 'out',
            label: 'Pagamento previsto',
            valBrl: parcToBrl(c, p, fxHoje),
          })
        }
      }
    }
    fluxos.sort((x, y) => x.date.localeCompare(y.date))
    const fluxos5 = fluxos.slice(0, 5)
    const saldoPrevisto = fluxos.reduce(
      (s, f) => s + (f.dir === 'in' ? f.valBrl : -f.valBrl),
      0,
    )
    return { fluxos5, saldoPrevisto, total: fluxos.length }
  }, [receitas, custos, fxHoje])

  // ---- Sparkline do lucro (cosmético, igual HTML) ----
  const lucroSpark = useMemo(() => {
    const out: number[] = []
    let acc = metrics.lucroLiquido * 0.45
    for (let i = 0; i < 14; i++) {
      acc +=
        metrics.lucroLiquido * 0.045 * (Math.sin(i * 0.55) + 1) +
        metrics.lucroLiquido * 0.025
      out.push(Math.max(metrics.lucroLiquido * 0.35, acc))
    }
    return out
  }, [metrics.lucroLiquido])

  // ---- Saldos por moeda (placeholder zero — backend pendente) ----
  const saldos = useMemo(
    () => ({ EUR: 0, BRL: 0, USD: 0 }),
    [],
  )

  // ---- Render ----
  if (loading) {
    return (
      <div className="fpag-page">
        <div className="empty-state" style={{ padding: 60 }}>
          Carregando dados financeiros...
        </div>
      </div>
    )
  }

  return (
    <div className="fpag-page">
      <div className="vg-prem-root">
        {erro && (
          <div className="alert alert-warning">
            <i className="alert-icon">⚠</i>
            <span>{erro}</span>
          </div>
        )}

        {/* ============ LINHA 1: 5 KPIs ============ */}
        <div className="vg-kpis">
          <Kpi
            iconCls="green"
            iconChar="$"
            label="RECEITA TOTAL"
            value={fmtBRL(metrics.recT)}
            sub="100% do previsto"
            barColor="#22c55e"
          />
          <Kpi
            iconCls="blue"
            iconChar="💳"
            label="RECEITA RECEBIDA"
            value={fmtBRL(metrics.recR)}
            sub={`${fmtPctBR(metrics.pctR)} do total`}
            barColor="#3b82f6"
          />
          <Kpi
            iconCls="amber"
            iconChar="🕐"
            label="RECEITA PENDENTE"
            value={fmtBRL(metrics.recP)}
            sub={`${fmtPctBR(metrics.pctP)} do total`}
            barColor="#f97316"
          />
          <Kpi
            iconCls="red"
            iconChar="📈"
            label="CUSTO TOTAL"
            value={fmtBRL(metrics.cusT)}
            sub={`${fmtPctBR(metrics.pctCustos)} da receita`}
            barColor="#ef4444"
          />
          <Kpi
            iconCls="purple"
            iconChar="📊"
            label="LUCRO LÍQUIDO"
            value={fmtBRL(metrics.lucroLiquido)}
            sub={`${fmtPctBR(metrics.margemLucroLiq)} da receita`}
            barColor="#7c3aed"
          />
        </div>

        {/* ============ LINHA 2: Resumo Financeiro + 2 Donuts ============ */}
        <div className="vg-r2">
          {/* Resumo Financeiro */}
          <div className="vg-card-clean">
            <h3>Resumo Financeiro</h3>
            <div className="resumo-fin">
              <div className="rf-row">
                <span className="rf-l">Receita Total</span>
                <span className="rf-c">{fmtBRL(metrics.recT)}</span>
              </div>
              <div className="rf-row">
                <span className="rf-l">(-) Impostos</span>
                <span className="rf-c">-{fmtBRL(metrics.impostoBrl)}</span>
              </div>
              <div className="rf-row high">
                <span className="rf-l">Receita Líquida</span>
                <span className="rf-c">{fmtBRL(metrics.recLiq)}</span>
              </div>
              <div className="rf-row">
                <span className="rf-l">(-) Custos Totais</span>
                <span className="rf-c">-{fmtBRL(metrics.cusT)}</span>
              </div>
              <div className="rf-row high">
                <span className="rf-l">Lucro Bruto</span>
                <span className="rf-c">{fmtBRL(metrics.lucroBruto)}</span>
              </div>
              <div className="rf-row margem">
                <span className="rf-l">Margem de Lucro</span>
                <span className="rf-c">{fmtPctBR(metrics.margem)}</span>
              </div>
            </div>
          </div>

          {/* Donut Receitas */}
          <div className="vg-card-clean">
            <h3>Receitas</h3>
            <div className="donut-clean">
              <div className="donut-clean-svg">
                <DonutSvg
                  segments={
                    metrics.recT > 0
                      ? [
                          { value: metrics.recR, color: '#22c55e' },
                          { value: metrics.recP, color: '#f97316' },
                          { value: 0, color: '#9ca3af' },
                        ]
                      : [{ value: 1, color: '#e5e7eb' }]
                  }
                  size={160}
                  thickness={18}
                />
                <div className="donut-clean-center">
                  <div className="pct">{Math.round(metrics.pctR)}%</div>
                  <div className="lbl">recebido</div>
                </div>
              </div>
              <div className="donut-clean-leg">
                <div className="dlg-row">
                  <div className="dot" style={{ background: '#22c55e' }} />
                  <div className="lbl">Recebido</div>
                  <div className="val">{fmtBRL(metrics.recR)}</div>
                </div>
                <div className="dlg-row">
                  <div className="dot" style={{ background: '#f97316' }} />
                  <div className="lbl">Pendente</div>
                  <div className="val">{fmtBRL(metrics.recP)}</div>
                </div>
                <div className="dlg-row">
                  <div className="dot" style={{ background: '#9ca3af' }} />
                  <div className="lbl">A vencer</div>
                  <div className="val">{fmtBRL(0)}</div>
                </div>
              </div>
            </div>
            <div className="donut-total">
              <span>Total</span>
              <span>{fmtBRL(metrics.recT)}</span>
            </div>
          </div>

          {/* Donut Custos */}
          <div className="vg-card-clean">
            <h3>Custos</h3>
            <div className="donut-clean">
              <div className="donut-clean-svg">
                <DonutSvg
                  segments={
                    metrics.cusT > 0
                      ? [
                          { value: metrics.cusPagos, color: '#ef4444' },
                          { value: metrics.cusAPagar, color: '#fb923c' },
                        ]
                      : [{ value: 1, color: '#e5e7eb' }]
                  }
                  size={160}
                  thickness={18}
                />
                <div className="donut-clean-center">
                  <div className="pct">{Math.round(metrics.pctCustoPagos)}%</div>
                  <div className="lbl">do total</div>
                </div>
              </div>
              <div className="donut-clean-leg">
                <div className="dlg-row">
                  <div className="dot" style={{ background: '#ef4444' }} />
                  <div className="lbl">Custos pagos</div>
                  <div className="val">{fmtBRL(metrics.cusPagos)}</div>
                </div>
                <div className="dlg-row">
                  <div className="dot" style={{ background: '#fb923c' }} />
                  <div className="lbl">A pagar</div>
                  <div className="val">{fmtBRL(metrics.cusAPagar)}</div>
                </div>
              </div>
            </div>
            <div className="donut-total">
              <span>Total</span>
              <span>{fmtBRL(metrics.cusT)}</span>
            </div>
          </div>
        </div>

        {/* ============ LINHA 3: Resultado + Inadimplência + Fluxo ============ */}
        <div className="vg-r3-new">
          {/* Resultado do Processo */}
          <div className="vg-card-clean">
            <h3>Resultado do Processo</h3>
            <div className="res-proc-val">{fmtBRL(metrics.lucroLiquido)}</div>
            <div className="res-proc-lbl">Lucro líquido</div>
            <div className="res-proc-badge">{fmtPctBR(metrics.margem)} de margem</div>
            <div className="res-proc-chart">
              {metrics.lucroLiquido > 0 ? (
                <SparkSvg values={lucroSpark} width={300} height={90} color="#10b981" />
              ) : null}
            </div>
          </div>

          {/* Inadimplência */}
          <div className="vg-card-clean">
            <h3>Inadimplência</h3>
            <div className={`inad-val${inad.totalInadBrl === 0 ? ' zero' : ''}`}>
              {fmtBRL(inad.totalInadBrl)}
            </div>
            <div className="inad-lbl">
              {inad.totalInadBrl === 0 ? 'Nenhum atraso' : 'Em atraso'}
            </div>
            {inad.totalInadBrl > 0 ? (
              <div className="inad-alert">
                <div className="inad-alert-icon">!</div>
                <div className="inad-alert-text">
                  <strong>
                    {inad.inadCount} {inad.inadCount === 1 ? 'parcela' : 'parcelas'} em atraso
                  </strong>
                  <small>Cobrança recomendada</small>
                </div>
              </div>
            ) : (
              <div className="inad-empty">
                <div className="inad-empty-icon">✓</div>
                <div className="inad-alert-text">
                  <strong style={{ color: '#065f46' }}>Tudo em dia</strong>
                  <small>Sem parcelas em atraso</small>
                </div>
              </div>
            )}
          </div>

          {/* Fluxo de Caixa 30 dias */}
          <div className="vg-card-clean">
            <h3>
              Fluxo de Caixa{' '}
              <span style={{ fontSize: 13, color: 'var(--fpag-gray-500)', fontWeight: 400 }}>
                (Próximos 30 dias)
              </span>
            </h3>
            <div className="fluxo-grid">
              <div className="fluxo-list">
                {fluxo.fluxos5.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: 20,
                      color: 'var(--fpag-gray-500)',
                      fontSize: 13,
                    }}
                  >
                    Nenhuma movimentação prevista
                  </div>
                ) : (
                  fluxo.fluxos5.map((f, i) => (
                    <div className="fluxo-row" key={i}>
                      <span className="fdate">{fmtDateShort(f.date)}</span>
                      <span className={`farrow ${f.dir}`}>
                        {f.dir === 'in' ? '↓' : '↑'}
                      </span>
                      <span className="flbl">{f.label}</span>
                      <span className="fval">
                        {f.dir === 'in' ? '' : '-'}
                        {fmtBRL(f.valBrl)}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="fluxo-saldo">
                <div className="fluxo-saldo-lbl">Saldo previsto</div>
                <div className="fluxo-saldo-val">{fmtBRL(fluxo.saldoPrevisto)}</div>
                <div className="fluxo-saldo-sub">para os próximos 30 dias</div>
              </div>
            </div>
          </div>
        </div>

        {/* ============ LINHA 4: Saldos por Moeda + Resumo Rápido ============ */}
        <div className="vg-r4-new">
          {/* Saldos por Moeda */}
          <div className="vg-card-clean">
            <div className="saldos-h">
              <h3>Saldos por Moeda</h3>
            </div>
            <div className="saldos-grid">
              <div className="saldo-mc">
                <div className="saldo-mc-h">
                  <div className="saldo-mc-icon eur">€</div>
                  <div className="saldo-mc-lbl">EUR</div>
                </div>
                <div className="saldo-mc-val">{fmtEUR(saldos.EUR)}</div>
                <div className="saldo-mc-sub">Saldo disponível</div>
              </div>
              <div className="saldo-mc">
                <div className="saldo-mc-h">
                  <div className="saldo-mc-icon brl">R$</div>
                  <div className="saldo-mc-lbl">BRL</div>
                </div>
                <div className="saldo-mc-val">{fmtBRL(saldos.BRL)}</div>
                <div className="saldo-mc-sub">Saldo disponível</div>
              </div>
              <div className="saldo-mc">
                <div className="saldo-mc-h">
                  <div className="saldo-mc-icon usd">$</div>
                  <div className="saldo-mc-lbl">USD</div>
                </div>
                <div className="saldo-mc-val">{fmtUSD(saldos.USD)}</div>
                <div className="saldo-mc-sub">Saldo disponível</div>
              </div>
            </div>
          </div>

          {/* Resumo Rápido */}
          <div className="vg-card-clean">
            <div className="saldos-h">
              <h3>Resumo Rápido</h3>
            </div>
            <div className="rr-grid-4">
              <div className="rr-cell">
                <div className="rr-cell-icon fa">📄</div>
                <div className="rr-cell-lbl">Faturas emitidas</div>
                <div className="rr-cell-val">0</div>
              </div>
              <div className="rr-cell">
                <div className="rr-cell-icon re">📋</div>
                <div className="rr-cell-lbl">Recibos emitidos</div>
                <div className="rr-cell-val">0</div>
              </div>
              <div className="rr-cell">
                <div className="rr-cell-icon in">⚠</div>
                <div className="rr-cell-lbl">Inadimplência</div>
                <div className={`rr-cell-val${inad.totalInadBrl > 0 ? ' red' : ''}`}>
                  {inad.totalInadBrl > 0 ? fmtBRL(inad.totalInadBrl) : '0'}
                </div>
              </div>
              <div className="rr-cell">
                <div className="rr-cell-icon do">📁</div>
                <div className="rr-cell-lbl">Documentos</div>
                <div className="rr-cell-val">0</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// KPI subcomponente
// ============================================================================

function Kpi({
  iconCls,
  iconChar,
  label,
  value,
  sub,
  barColor,
}: {
  iconCls: 'green' | 'blue' | 'amber' | 'red' | 'purple'
  iconChar: string
  label: string
  value: string
  sub: string
  barColor: string
}) {
  return (
    <div className="vg-kpi">
      <div className="vg-kpi-h">
        <div className={`vg-kpi-icon ${iconCls}`}>{iconChar}</div>
        <div className="vg-kpi-text">
          <div className="vg-kpi-label">{label}</div>
          <div className="vg-kpi-value">{value}</div>
        </div>
      </div>
      <div className="vg-kpi-sub">{sub}</div>
      <div className="vg-kpi-bar" style={{ background: barColor }} />
    </div>
  )
}

export default VisaoGeral