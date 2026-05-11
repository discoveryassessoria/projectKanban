// src/components/financeiro/subabas/Carteira.tsx
//
// 🆕 Fase 3 v2.8 — Clone FIEL de `renderCartPrem()` (linha 7000 do
// html_final_marco.html). Carteira Financeira por Moeda.
//
// Estrutura:
//   1. Header "Carteira Financeira por Moeda"
//   2. 3 cards principais EUR / BRL / USD com:
//      - Saldo grande
//      - Sparkline cosmético decorativo
//      - "Background" da moeda (€, R$, $)
//      - 4 mini cells (Total Recebido, Pendente/Pago, Entrada do mês, Saída do mês)
//   3. Linha 2 com 5 cards:
//      - Mercado Cambial (3 fx-rows com setinhas)
//      - Evolução do Saldo BRL (sparkline + valor + ▲%)
//      - Entradas × Saídas (donut)
//      - Fluxo por Moeda (donut)
//      - Impacto Cambial (Ganho / Perda / Líquido)
//   4. Histórico de Movimentações (tabela)

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
  fornecedor?: string | null
  moeda: Moeda
  valor: number | string
  fxEstimado: number | string
  fxRule: FxRule
  fxFixo?: number | string | null
  parcelas: ParcelaAPI[]
}

export interface CarteiraProps {
  processoId: number
  fxHoje?: number
  fxUsdHoje?: number
}

interface MovHistorico {
  id: string
  tipo: 'in' | 'out' | 'conv' | 'ajuste'
  categoria: string
  moedaOrig: Moeda
  valorOrig: number
  valorBrl: number
  cambio: number
  data: string
  hora: string
  status: string
  statusBd: 'green' | 'red' | 'amber' | 'purple' | 'blue'
}

// ============================================================================
// Helpers
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
const fmtMoeda = (v: number, m: Moeda) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: m })
const fmtUSD = (v: number) =>
  'US$ ' +
  (v || 0)
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
function monthStart(): string {
  return todayISO().substring(0, 8) + '01'
}

// ============================================================================
// Donut SVG e Spark SVG (mesmos do _donutSvg / _sparkSvg)
// ============================================================================

interface DonutSeg {
  value: number
  color: string
}
function DonutSvg({
  segments,
  size = 110,
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

function SparkSvg({
  values,
  width = 280,
  height = 80,
  color = '#5b3fff',
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
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ============================================================================
// Componente
// ============================================================================

export function Carteira({
  processoId,
  fxHoje = 5.5,
  fxUsdHoje = 5.4,
}: CarteiraProps) {
  const [receitas, setReceitas] = useState<ItemAPI[]>([])
  const [custos, setCustos] = useState<ItemAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<'' | 'in' | 'out' | 'conv' | 'ajuste'>('')
  const [filtroMoeda, setFiltroMoeda] = useState<'' | Moeda>('')

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
        console.error('[Carteira] erro:', err)
        if (!cancelado) setErro('Erro de conexão ao carregar carteira.')
      } finally {
        if (!cancelado) setLoading(false)
      }
    }
    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId])

  // ---- _carteiraData (clone do helper do HTML linha 6965) ----
  const dt = useMemo(() => {
    const d = {
      EUR: { recebido: 0, pendente: 0, entradaMes: 0, saidaMes: 0, saldo: 0 },
      BRL: { recebido: 0, pago: 0, entradaMes: 0, saidaMes: 0, saldo: 0 },
      USD: { conv: 0, reservas: 0, ganho: 0, perda: 0, saldo: 0 },
    }
    const ms = monthStart()

    // Por moeda nativa (recebido/pendente em valor original)
    for (const r of receitas) {
      const m = r.moeda
      if (m !== 'EUR' && m !== 'BRL' && m !== 'USD') continue
      for (const p of r.parcelas) {
        const v = num(p.valor)
        if (p.status === 'RECEBIDA' || p.status === 'PAGA') {
          if (m === 'EUR') {
            d.EUR.recebido += v
            const dp = (p.dataPagamento || '').slice(0, 10)
            if (dp >= ms) d.EUR.entradaMes += v
          } else if (m === 'USD') {
            const dp = (p.dataPagamento || '').slice(0, 10)
            if (dp >= ms) d.USD.conv += v
          }
          // BRL é tratado abaixo no agregado
        } else {
          if (m === 'EUR') d.EUR.pendente += v
        }
      }
    }
    for (const c of custos) {
      const m = c.moeda
      if (m !== 'EUR' && m !== 'BRL' && m !== 'USD') continue
      for (const p of c.parcelas) {
        if (p.status !== 'PAGA' && p.status !== 'RECEBIDA') continue
        const v = num(p.valor)
        const dp = (p.dataPagamento || '').slice(0, 10)
        if (m === 'EUR' && dp >= ms) d.EUR.saidaMes += v
        if (m === 'USD' && dp >= ms) d.USD.reservas += v
      }
    }

    // BRL saldo agregado em BRL real (caixa)
    let brlEnt = 0
    let brlSai = 0
    let brlEntMes = 0
    let brlSaiMes = 0
    for (const r of receitas) {
      const fx =
        r.moeda === 'BRL'
          ? 1
          : r.fxRule === 'FIXO'
            ? num(r.fxFixo) || num(r.fxEstimado) || fxHoje
            : num(r.fxEstimado) || fxHoje
      for (const p of r.parcelas) {
        if (p.status !== 'RECEBIDA' && p.status !== 'PAGA') continue
        const cambio = num(p.cambioAplicado) || fx
        const valorEur = num(p.valor)
        const valorBrl =
          num(p.valorBrl) || (r.moeda === 'BRL' ? valorEur : valorEur * cambio)
        brlEnt += valorBrl
        const dp = (p.dataPagamento || '').slice(0, 10)
        if (dp >= ms) brlEntMes += valorBrl
      }
    }
    for (const c of custos) {
      const fx =
        c.moeda === 'BRL'
          ? 1
          : c.fxRule === 'FIXO'
            ? num(c.fxFixo) || num(c.fxEstimado) || fxHoje
            : num(c.fxEstimado) || fxHoje
      for (const p of c.parcelas) {
        if (p.status !== 'PAGA' && p.status !== 'RECEBIDA') continue
        const cambio = num(p.cambioAplicado) || fx
        const valorEur = num(p.valor)
        const valorBrl =
          num(p.valorBrl) || (c.moeda === 'BRL' ? valorEur : valorEur * cambio)
        brlSai += valorBrl
        const dp = (p.dataPagamento || '').slice(0, 10)
        if (dp >= ms) brlSaiMes += valorBrl
      }
    }
    d.BRL.recebido = brlEnt
    d.BRL.pago = brlSai
    d.BRL.entradaMes = brlEntMes
    d.BRL.saidaMes = brlSaiMes
    d.BRL.saldo = brlEnt - brlSai
    d.EUR.saldo = d.EUR.recebido - d.EUR.saidaMes
    return d
  }, [receitas, custos, fxHoje])

  // ---- Histórico de movimentações (clone _gerarMovimentacoes) ----
  const movs: MovHistorico[] = useMemo(() => {
    const out: MovHistorico[] = []
    for (const r of receitas) {
      const fx =
        r.moeda === 'BRL'
          ? 1
          : r.fxRule === 'FIXO'
            ? num(r.fxFixo) || num(r.fxEstimado) || fxHoje
            : num(r.fxEstimado) || fxHoje
      for (const p of r.parcelas) {
        if (p.status !== 'RECEBIDA' && p.status !== 'PAGA') continue
        const cambio = num(p.cambioAplicado) || fx
        const valorOrig = num(p.valor)
        const valorBrl =
          num(p.valorBrl) || (r.moeda === 'BRL' ? valorOrig : valorOrig * cambio)
        out.push({
          id: `r-${r.id}-${p.numero}`,
          tipo: 'in',
          categoria: `Parcela ${p.numero}/${r.parcelas.length}`,
          moedaOrig: r.moeda,
          valorOrig,
          valorBrl,
          cambio,
          data: (p.dataPagamento || p.vencimento || '').slice(0, 10),
          hora: '14:32',
          status: 'Recebido',
          statusBd: 'green',
        })
      }
    }
    for (const c of custos) {
      const fx =
        c.moeda === 'BRL'
          ? 1
          : c.fxRule === 'FIXO'
            ? num(c.fxFixo) || num(c.fxEstimado) || fxHoje
            : num(c.fxEstimado) || fxHoje
      for (const p of c.parcelas) {
        if (p.status !== 'PAGA' && p.status !== 'RECEBIDA') continue
        const cambio = num(p.cambioAplicado) || fx
        const valorOrig = num(p.valor)
        const valorBrl =
          num(p.valorBrl) || (c.moeda === 'BRL' ? valorOrig : valorOrig * cambio)
        out.push({
          id: `c-${c.id}-${p.numero}`,
          tipo: 'out',
          categoria: c.fornecedor || c.descricao || 'Fornecedor',
          moedaOrig: c.moeda,
          valorOrig,
          valorBrl,
          cambio,
          data: (p.dataPagamento || p.vencimento || '').slice(0, 10),
          hora: '16:45',
          status: 'Pago',
          statusBd: 'red',
        })
      }
    }
    out.sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))
    return out
  }, [receitas, custos, fxHoje])

  // ---- Filtros ----
  const filtrada = useMemo(() => {
    let f = movs.slice()
    if (filtroTipo) f = f.filter((m) => m.tipo === filtroTipo)
    if (filtroMoeda) f = f.filter((m) => m.moedaOrig === filtroMoeda)
    return f
  }, [movs, filtroTipo, filtroMoeda])

  // ---- Sparklines cosméticos baseados em dados reais ----
  const sparkEur = useMemo(() => {
    const base = dt.EUR.saldo || 1000
    return Array.from({ length: 12 }, (_, i) => base * (0.5 + i / 24))
  }, [dt.EUR.saldo])
  const sparkBrl = useMemo(() => {
    const base = dt.BRL.saldo || 1000
    return Array.from({ length: 12 }, (_, i) => base * (0.5 + i / 24))
  }, [dt.BRL.saldo])
  const sparkUsd = useMemo(
    () => Array.from({ length: 12 }, (_, i) => 5 + i * 0.5),
    [],
  )

  // ---- % por moeda (donut Fluxo por Moeda) ----
  const fluxoMoeda = useMemo(() => {
    const totalBrl = dt.BRL.recebido
    const totalEurEmBrl = dt.EUR.recebido * fxHoje
    const totalUsdEmBrl = dt.USD.conv * fxUsdHoje
    const total = totalBrl + totalEurEmBrl + totalUsdEmBrl || 1
    return {
      brl: { valor: totalBrl, pct: (totalBrl / total) * 100 },
      eur: { valor: totalEurEmBrl, pct: (totalEurEmBrl / total) * 100 },
      usd: { valor: totalUsdEmBrl, pct: (totalUsdEmBrl / total) * 100 },
    }
  }, [dt, fxHoje, fxUsdHoje])

  if (loading) {
    return (
      <div className="fpag-page">
        <div className="empty-state" style={{ padding: 60 }}>
          Carregando carteira...
        </div>
      </div>
    )
  }

  return (
    <div className="fpag-page">
      <div className="pp-head">
        <div className="pp-head-l">
          <h1>Carteira Financeira por Moeda</h1>
          <div className="pps">
            Controle saldos, movimentações e impacto cambial por moeda
          </div>
        </div>
        <div className="pp-head-r">
          <button type="button" className="btn-prem" disabled>
            ↻ Atualizar câmbio
          </button>
          <button type="button" className="btn-prem" disabled>
            ⬇ Exportar
          </button>
          <button type="button" className="btn-prem primary" disabled>
            + Nova movimentação
          </button>
        </div>
      </div>

      {erro && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <i className="alert-icon">⚠</i>
          <span>{erro}</span>
        </div>
      )}

      {/* === 3 cards principais (EUR / BRL / USD) === */}
      <div className="moeda-grid-3">
        {/* EUR */}
        <div className="moeda-card">
          <div className="moeda-card-h">
            <div className="moeda-card-l">
              <div className="mch-icon eur">€</div>
              <div className="ml">EUR</div>
            </div>
            <span className="mc-flag">Moeda Principal</span>
          </div>
          <div className="mc-saldo">{fmtEUR(dt.EUR.saldo)}</div>
          <div className="mc-saldo-lbl">Saldo disponível</div>
          <div className="mc-spark">
            <SparkSvg values={sparkEur} width={120} height={50} color="#5b3fff" />
          </div>
          <div className="mc-bg" style={{ color: '#ebe6ff' }}>
            €
          </div>
          <div className="mc-mini">
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Total Recebido</div>
              <div className="mc-mini-val green">{fmtEUR(dt.EUR.recebido)}</div>
            </div>
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Pendente</div>
              <div className="mc-mini-val amber">{fmtEUR(dt.EUR.pendente)}</div>
            </div>
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Entrada do mês</div>
              <div className="mc-mini-val">{fmtEUR(dt.EUR.entradaMes)}</div>
            </div>
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Saída do mês</div>
              <div className="mc-mini-val red">{fmtEUR(dt.EUR.saidaMes)}</div>
            </div>
          </div>
        </div>

        {/* BRL */}
        <div className="moeda-card">
          <div className="moeda-card-h">
            <div className="moeda-card-l">
              <div className="mch-icon brl">R$</div>
              <div className="ml">BRL</div>
            </div>
            <span className="mc-flag green">Moeda Base</span>
          </div>
          <div className="mc-saldo">{fmtBRL(dt.BRL.saldo)}</div>
          <div className="mc-saldo-lbl">Saldo disponível</div>
          <div className="mc-spark">
            <SparkSvg values={sparkBrl} width={120} height={50} color="#10b981" />
          </div>
          <div className="mc-bg" style={{ color: '#d1fae5' }}>
            R$
          </div>
          <div className="mc-mini">
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Total Recebido</div>
              <div className="mc-mini-val green">{fmtBRL(dt.BRL.recebido)}</div>
            </div>
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Total Pago</div>
              <div className="mc-mini-val red">{fmtBRL(dt.BRL.pago)}</div>
            </div>
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Entrada do mês</div>
              <div className="mc-mini-val">{fmtBRL(dt.BRL.entradaMes)}</div>
            </div>
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Saída do mês</div>
              <div className="mc-mini-val red">{fmtBRL(dt.BRL.saidaMes)}</div>
            </div>
          </div>
        </div>

        {/* USD */}
        <div className="moeda-card">
          <div className="moeda-card-h">
            <div className="moeda-card-l">
              <div className="mch-icon usd">$</div>
              <div className="ml">USD</div>
            </div>
            <span className="mc-flag blue">Moeda Estrangeira</span>
          </div>
          <div className="mc-saldo">{fmtUSD(dt.USD.saldo)}</div>
          <div className="mc-saldo-lbl">Saldo disponível</div>
          <div className="mc-spark">
            <SparkSvg values={sparkUsd} width={120} height={50} color="#3b82f6" />
          </div>
          <div className="mc-bg" style={{ color: '#dbeafe' }}>
            $
          </div>
          <div className="mc-mini">
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Conversões realizadas</div>
              <div className="mc-mini-val">{fmtUSD(dt.USD.conv)}</div>
            </div>
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Reservas</div>
              <div className="mc-mini-val">{fmtUSD(dt.USD.reservas)}</div>
            </div>
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Ganho cambial</div>
              <div className="mc-mini-val green">{fmtUSD(dt.USD.ganho)}</div>
            </div>
            <div className="mc-mini-cell">
              <div className="mc-mini-lbl">Perda cambial</div>
              <div className="mc-mini-val red">{fmtUSD(dt.USD.perda)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* === Linha 5 cards === */}
      <div className="cart-r2">
        {/* Mercado Cambial */}
        <div className="cart-card">
          <div className="cart-card-h">
            <h4>Mercado Cambial</h4>
            <div className="upd">Hoje</div>
          </div>
          <div className="fx-row">
            <span className="fxp">EUR → BRL</span>
            <span className="fxv">{fmtBRL(fxHoje)}</span>
            <span className="fxd up">▲ —</span>
          </div>
          <div className="fx-row">
            <span className="fxp">USD → BRL</span>
            <span className="fxv">{fmtBRL(fxUsdHoje)}</span>
            <span className="fxd down">▼ —</span>
          </div>
          <div className="fx-row">
            <span className="fxp">EUR → USD</span>
            <span className="fxv">
              US$ {(fxHoje / fxUsdHoje).toFixed(2).replace('.', ',')}
            </span>
            <span className="fxd up">▲ —</span>
          </div>
        </div>

        {/* Evolução BRL */}
        <div className="cart-card">
          <div className="cart-card-h">
            <h4>Evolução do Saldo (BRL)</h4>
            <select disabled>
              <option>Últimos 30 dias</option>
            </select>
          </div>
          <div>
            <SparkSvg
              values={sparkBrl}
              width={280}
              height={80}
              color="#5b3fff"
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: 'var(--fpag-gray-900)',
              }}
            >
              {fmtBRL(dt.BRL.saldo)}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--fpag-success)',
                fontWeight: 600,
              }}
            >
              Saldo atual
            </div>
          </div>
        </div>

        {/* Entradas × Saídas */}
        <div className="cart-card">
          <div className="cart-card-h">
            <h4>Entradas × Saídas (BRL)</h4>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <DonutSvg
              segments={[
                { value: dt.BRL.recebido || 1, color: '#10b981' },
                { value: dt.BRL.pago || 1, color: '#ef4444' },
              ]}
              size={110}
              thickness={18}
            />
          </div>
          <div
            style={{
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#10b981',
                    marginRight: 6,
                  }}
                />
                Entradas
              </span>
              <strong>{fmtBRL(dt.BRL.recebido)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#ef4444',
                    marginRight: 6,
                  }}
                />
                Saídas
              </span>
              <strong>{fmtBRL(dt.BRL.pago)}</strong>
            </div>
          </div>
        </div>

        {/* Fluxo por Moeda */}
        <div className="cart-card">
          <div className="cart-card-h">
            <h4>Fluxo por Moeda</h4>
            <select disabled>
              <option>Total</option>
            </select>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <DonutSvg
              segments={[
                { value: fluxoMoeda.brl.valor || 1, color: '#10b981' },
                { value: fluxoMoeda.eur.valor || 1, color: '#5b3fff' },
                { value: fluxoMoeda.usd.valor || 1, color: '#3b82f6' },
              ]}
              size={110}
              thickness={18}
            />
          </div>
          <div
            style={{
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#10b981',
                    marginRight: 6,
                  }}
                />
                BRL
              </span>
              <strong>{fluxoMoeda.brl.pct.toFixed(0)}%</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#5b3fff',
                    marginRight: 6,
                  }}
                />
                EUR
              </span>
              <strong>{fluxoMoeda.eur.pct.toFixed(0)}%</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#3b82f6',
                    marginRight: 6,
                  }}
                />
                USD
              </span>
              <strong>{fluxoMoeda.usd.pct.toFixed(0)}%</strong>
            </div>
          </div>
        </div>

        {/* Impacto Cambial */}
        <div className="cart-card">
          <div className="cart-card-h">
            <h4>Impacto Cambial</h4>
            <select disabled>
              <option>Total</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--fpag-gray-500)' }}>
                Ganho Cambial
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'var(--fpag-success)',
                }}
              >
                + {fmtBRL(0)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--fpag-gray-500)' }}>
                Perda Cambial
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'var(--fpag-danger)',
                }}
              >
                − {fmtBRL(0)}
              </div>
            </div>
            <div
              style={{
                borderTop: '1px solid var(--fpag-gray-100)',
                paddingTop: 10,
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--fpag-gray-500)' }}>
                Líquido
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'var(--fpag-success)',
                }}
              >
                + {fmtBRL(0)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* === Histórico de Movimentações === */}
      <div className="vg-card-inad" style={{ marginTop: 24 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--fpag-gray-900)',
            }}
          >
            Histórico de Movimentações
          </div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontSize: 12,
            }}
          >
            <span style={{ color: 'var(--fpag-gray-500)' }}>Tipo:</span>
            <select
              value={filtroTipo}
              onChange={(e) =>
                setFiltroTipo(e.target.value as typeof filtroTipo)
              }
              style={{
                padding: '6px 10px',
                border: '1px solid var(--fpag-gray-200)',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'inherit',
              }}
            >
              <option value="">Todos</option>
              <option value="in">Recebimento</option>
              <option value="out">Pagamento</option>
            </select>
            <span style={{ color: 'var(--fpag-gray-500)' }}>Moeda:</span>
            <select
              value={filtroMoeda}
              onChange={(e) =>
                setFiltroMoeda(e.target.value as typeof filtroMoeda)
              }
              style={{
                padding: '6px 10px',
                border: '1px solid var(--fpag-gray-200)',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'inherit',
              }}
            >
              <option value="">Todas</option>
              <option value="EUR">EUR</option>
              <option value="BRL">BRL</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        <div className="tprem" style={{ border: 'none', boxShadow: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Categoria</th>
                <th>Entrada / Saída</th>
                <th>Moeda Original</th>
                <th>Valor Original</th>
                <th>Valor BRL</th>
                <th>Câmbio</th>
                <th>Data</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtrada.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="empty-state"
                    style={{ textAlign: 'center', padding: 40 }}
                  >
                    Sem movimentações registradas.
                  </td>
                </tr>
              ) : (
                filtrada.slice(0, 10).map((m) => {
                  const tipoIc = m.tipo === 'in' ? '⬇' : '⬆'
                  const tipoCls = m.tipo === 'in' ? 'green' : 'red'
                  const tipoLbl = m.tipo === 'in' ? 'Recebimento' : 'Pagamento'
                  const esBd = m.tipo === 'in' ? 'green' : 'red'
                  const esLbl = m.tipo === 'in' ? 'Entrada' : 'Saída'
                  const iconBg =
                    tipoCls === 'green' ? '#ecfdf5' : '#fef2f2'
                  const iconColor =
                    tipoCls === 'green' ? '#10b981' : '#ef4444'
                  return (
                    <tr key={m.id}>
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 6,
                              background: iconBg,
                              color: iconColor,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 13,
                            }}
                          >
                            {tipoIc}
                          </span>
                          {tipoLbl}
                        </span>
                      </td>
                      <td>{m.categoria}</td>
                      <td>
                        <span className={`bd ${esBd}`}>{esLbl}</span>
                      </td>
                      <td>{m.moedaOrig}</td>
                      <td>{fmtMoeda(m.valorOrig, m.moedaOrig)}</td>
                      <td>{fmtBRL(m.valorBrl)}</td>
                      <td>
                        {m.moedaOrig === 'BRL'
                          ? '—'
                          : m.cambio.toFixed(4).replace('.', ',')}
                      </td>
                      <td>{fmtDate(m.data)}</td>
                      <td>
                        <span className={`bd ${m.statusBd}`}>{m.status}</span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: 'var(--fpag-gray-500)',
          }}
        >
          Mostrando {Math.min(10, filtrada.length)} de {movs.length} movimentações
        </div>
      </div>
    </div>
  )
}

export default Carteira