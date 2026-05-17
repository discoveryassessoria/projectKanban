// src/components/financeiro/subabas/Inadimplencia.tsx
//
// 🆕 Fase 3 v2.4 — Clone FIEL de `renderInadPrem()` (linha 6278 do
// html_final_marco.html). Central de cobrança de parcelas vencidas.
//
// Estrutura:
//   1. Header "Central de Inadimplência" + botões Exportar/Filtros
//   2. 6 KPIs: Total em atraso / Mais antigo / A vencer (7d) /
//              Requerentes / Recebido este mês / Taxa de inadimplência
//   3. Filter bar (5 selects + busca)
//   4. Layout split:
//      - Esquerda: Tabela de inadimplentes (linha clicável + ações)
//                  Faixas de atraso (4 cells coloridos)
//                  Gráfico de evolução (linha SVG)
//      - Direita: Painel lateral com detalhes do selecionado + 5 ações
//
// Notas:
//   - Por enquanto pega só RECEITAS (igual HTML); custos vencidos podem
//     ser adicionados depois numa segunda passada.
//   - "Status overrides" (cobrança_enviada, negociação, promessa) são
//     mantidos em estado local — quando o backend tiver Eventos, persiste lá.
//   - Ações WhatsApp/E-mail/Fatura/Recibo apenas marcam status localmente
//     com toast (igual HTML).

'use client'

import '@/src/styles/financeiro-paginas.css'
import { useEffect, useMemo, useState } from 'react'
import { parseLista } from '@/src/lib/financeiro/parseLista'
import { apenasAtivos } from '@/src/lib/financeiro/filtros'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type StatusParcela = 'PENDENTE' | 'RECEBIDA' | 'PAGA' | 'CANCELADA'

type StatusInad =
  | 'em_atraso'
  | 'cobranca_enviada'
  | 'negociacao'
  | 'promessa'
  | 'vence_hoje'

interface ReceitaRequerenteAPI {
  id?: number
  requerenteId?: number | null
  nome?: string | null
  percentual: number | string
  requerente?: { id: number; nome: string } | null
}

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

interface ReceitaAPI {
  id: number
  codigo: string
  descricao: string
  moeda: Moeda
  valor: number | string
  fxEstimado: number | string
  fxRule: FxRule
  fxFixo?: number | string | null
  nParcelas: number
  parcelas: ParcelaAPI[]
  requerentes?: ReceitaRequerenteAPI[]
  cancelada?: boolean
  status?: 'ATIVA' | 'RASCUNHO' | 'CANCELADA'
}

interface ParcelaAPIComCusto extends ParcelaAPI {}

interface CustoAPI {
  id: number
  parcelas: ParcelaAPIComCusto[]
  fxEstimado: number | string
  fxRule: FxRule
  fxFixo?: number | string | null
  moeda: Moeda
  dataPagamento?: string | null
  cancelado?: boolean
  status?: 'ATIVA' | 'RASCUNHO' | 'CANCELADA'
}

export interface InadimplenciaProps {
  processoId: number
  nomeFamilia?: string
  fxHoje?: number
}

interface InadItem {
  parcId: string
  receitaId: number
  reqIdx: number
  requerente: string
  parcela: string
  parcelaN: number
  vencimento: string
  diasAtraso: number
  valorEur: number
  moeda: Moeda
  valorBrl: number
  fx: number
  status: StatusInad
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
const fmtMoeda = (v: number, m: Moeda) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: m })
const fmtFX = (v: number) => v.toFixed(4).replace('.', ',')
const fmtPctBR = (v: number) => v.toFixed(1).replace('.', ',') + '%'

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
function shortName(n: string): string {
  if (!n) return '—'
  const parts = n.trim().split(/\s+/)
  if (parts.length <= 2) return n
  return parts[0] + ' ' + parts[parts.length - 1]
}
function avtIni(n: string): string {
  const parts = (n || '').trim().split(/\s+/)
  if (!parts.length || !parts[0]) return '?'
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
function avtColor(n: string): string {
  let h = 0
  for (let i = 0; i < n.length; i++) h = (h << 5) - h + n.charCodeAt(i)
  return 'c' + (Math.abs(h) % 7)
}

// ============================================================================
// Linha SVG (evolução da inadimplência)
// ============================================================================

function LineChartSvg({
  values,
  labels,
  width = 600,
  height = 180,
  color = '#ef4444',
}: {
  values: number[]
  labels?: string[]
  width?: number
  height?: number
  color?: string
}) {
  if (!values || values.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fpag-gray-400)',
          fontSize: 13,
        }}
      >
        Sem dados de evolução
      </div>
    )
  }
  const padL = 50,
    padB = 24,
    padT = 10,
    padR = 10
  const cw = width - padL - padR
  const ch = height - padT - padB
  const max = Math.max(...values, 1) * 1.2
  const step = cw / (values.length - 1 || 1)
  let path = ''
  const dots: React.ReactNode[] = []
  const grid: React.ReactNode[] = []
  // grid horizontal
  for (let i = 0; i <= 3; i++) {
    const y = padT + (ch / 3) * i
    grid.push(
      <line
        key={`gh-${i}`}
        x1={padL}
        y1={y}
        x2={width - padR}
        y2={y}
        stroke="#f1f5f9"
        strokeWidth={1}
      />,
    )
    const yv = max - (max / 3) * i
    grid.push(
      <text
        key={`gl-${i}`}
        x={padL - 8}
        y={y + 4}
        textAnchor="end"
        fontSize={10}
        fill="#9ca3af"
      >
        R$ {(yv / 1000).toFixed(0)}k
      </text>,
    )
  }
  values.forEach((v, i) => {
    const x = padL + i * step
    const y = padT + ch - (v / max) * ch
    path += (i === 0 ? 'M' : 'L') + ` ${x.toFixed(1)} ${y.toFixed(1)} `
    dots.push(
      <circle
        key={`d-${i}`}
        cx={x.toFixed(1)}
        cy={y.toFixed(1)}
        r={3.5}
        fill="#fff"
        stroke={color}
        strokeWidth={2}
      />,
    )
    if (labels && labels[i]) {
      grid.push(
        <text
          key={`lb-${i}`}
          x={x}
          y={height - 6}
          textAnchor="middle"
          fontSize={10}
          fill="#9ca3af"
        >
          {labels[i]}
        </text>,
      )
    }
  })
  const area =
    path +
    `L ${(padL + (values.length - 1) * step).toFixed(1)} ${(padT + ch).toFixed(1)} L ${padL} ${(padT + ch).toFixed(1)} Z`
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {grid}
      <path d={area} fill={color + '15'} />
      <path d={path} fill="none" stroke={color} strokeWidth={2} />
      {dots}
    </svg>
  )
}

// ============================================================================
// Componente
// ============================================================================

const STATUS_LABEL: Record<StatusInad, string> = {
  em_atraso: 'Em atraso',
  cobranca_enviada: 'Cobrança enviada',
  negociacao: 'Negociação',
  promessa: 'Promessa',
  vence_hoje: 'Vence hoje',
}
const STATUS_BD_CLASS: Record<StatusInad, string> = {
  em_atraso: 'red',
  cobranca_enviada: 'amber',
  negociacao: 'blue',
  promessa: 'purple',
  vence_hoje: 'amber',
}

interface InadFiltros {
  status: '' | StatusInad
  requerente: string
  dias: '' | '0-15' | '16-30' | '31-60' | '60+'
  search: string
}

export function Inadimplencia({ processoId, fxHoje = 5.5 }: InadimplenciaProps) {
  const [receitas, setReceitas] = useState<ReceitaAPI[]>([])
  const [custos, setCustos] = useState<CustoAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [statusOverrides, setStatusOverrides] = useState<Record<string, StatusInad>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<InadFiltros>({
    status: '',
    requerente: '',
    dias: '',
    search: '',
  })

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
          const lst = parseLista<ReceitaAPI>(d)
          if (!cancelado) setReceitas(Array.isArray(lst) ? lst : [])
        }
        if (resC.ok) {
          const d = await resC.json()
          const lst = parseLista<CustoAPI>(d)
          if (!cancelado) setCustos(Array.isArray(lst) ? lst : [])
        }
      } catch (err) {
        console.error('[Inadimplencia] erro:', err)
        if (!cancelado) setErro('Erro de conexão ao carregar dados.')
      } finally {
        if (!cancelado) setLoading(false)
      }
    }
    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId])

  // ---- Toast auto-dismiss ----
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(t)
  }, [toast])

  // ---- Lista de inadimplentes (clone _inadimplentes do HTML, linha 5074) ----
  const lista: InadItem[] = useMemo(() => {
    const today = todayISO()
    const out: InadItem[] = []
    for (const r of apenasAtivos(receitas)) {
      const fx =
        r.moeda === 'BRL'
          ? 1
          : r.fxRule === 'FIXO'
            ? num(r.fxFixo) || num(r.fxEstimado) || fxHoje
            : num(r.fxEstimado) || fxHoje

      // Tenta inferir requerentes da receita; se não houver, usa "—"
      const reqs = (r.requerentes || []).map((x, idx) => ({
        idx,
        nome: x.requerente?.nome || x.nome || `Requerente ${idx + 1}`,
        percentual: num(x.percentual),
      }))

      for (const p of r.parcelas) {
        if (p.status === 'RECEBIDA' || p.status === 'PAGA') continue
        const venc = (p.vencimento || '').slice(0, 10)
        if (!venc || venc >= today) continue
        const diasAtraso = Math.floor(
          (new Date(today).getTime() - new Date(venc).getTime()) / 86_400_000,
        )
        const valorEur = num(p.valor)

        if (reqs.length === 0) {
          // Sem requerentes na receita → uma linha só
          const parcId = `${r.id}-0-${p.numero}`
          out.push({
            parcId,
            receitaId: r.id,
            reqIdx: 0,
            requerente: '—',
            parcela: `${p.numero} de ${r.nParcelas}`,
            parcelaN: p.numero,
            vencimento: venc,
            diasAtraso,
            valorEur,
            moeda: r.moeda,
            valorBrl: valorEur * fx,
            fx,
            status: statusOverrides[parcId] || 'em_atraso',
          })
        } else {
          // Uma linha POR requerente (split visual igual ao HTML)
          for (const reqInfo of reqs) {
            if (reqInfo.percentual <= 0) continue
            const fracao = reqInfo.percentual / 100
            const parcId = `${r.id}-${reqInfo.idx}-${p.numero}`
            out.push({
              parcId,
              receitaId: r.id,
              reqIdx: reqInfo.idx,
              requerente: reqInfo.nome,
              parcela: `${p.numero} de ${r.nParcelas}`,
              parcelaN: p.numero,
              vencimento: venc,
              diasAtraso,
              valorEur: valorEur * fracao,
              moeda: r.moeda,
              valorBrl: valorEur * fracao * fx,
              fx,
              status: statusOverrides[parcId] || 'em_atraso',
            })
          }
        }
      }
    }
    return out.sort((a, b) => b.diasAtraso - a.diasAtraso)
  }, [receitas, statusOverrides, fxHoje])

  // ---- Lista de requerentes únicos (pro filtro) ----
  const requerentesUnicos = useMemo(() => {
    const set = new Set<string>()
    lista.forEach((x) => set.add(x.requerente))
    return Array.from(set).filter((x) => x !== '—').sort()
  }, [lista])

  // ---- KPIs (clone das fórmulas linha 6285-6320) ----
  const kpis = useMemo(() => {
    const today = todayISO()
    const totalAtraso = lista.reduce((s, x) => s + x.valorBrl, 0)
    const maiorAtraso = lista.length > 0 ? Math.max(...lista.map((x) => x.diasAtraso)) : 0
    const requerentesUniq = new Set(lista.map((x) => x.requerente)).size
    const maisAntigo = lista.length > 0 ? lista[0] : null

    // A vencer próximos 7 dias
    const in7 = new Date()
    in7.setDate(in7.getDate() + 7)
    const in7iso = in7.toISOString().slice(0, 10)
    let aVencer = 0
    let aVencerCount = 0
    for (const r of apenasAtivos(receitas)) {
      const fx =
        r.moeda === 'BRL'
          ? 1
          : r.fxRule === 'FIXO'
            ? num(r.fxFixo) || num(r.fxEstimado) || fxHoje
            : num(r.fxEstimado) || fxHoje
      for (const p of r.parcelas) {
        if (p.status === 'RECEBIDA' || p.status === 'PAGA') continue
        const venc = (p.vencimento || '').slice(0, 10)
        if (venc >= today && venc <= in7iso) {
          aVencer += num(p.valor) * fx
          aVencerCount++
        }
      }
    }

    // Recebido este mês (parcelas pagas com dataPagamento >= primeiro dia do mês)
    const monthStart = today.substring(0, 8) + '01'
    let recMes = 0
    for (const r of apenasAtivos(receitas)) {
      for (const p of r.parcelas) {
        if (p.status !== 'RECEBIDA' && p.status !== 'PAGA') continue
        const dp = (p.dataPagamento || '').slice(0, 10)
        if (dp && dp >= monthStart) {
          recMes += num(p.valorBrl)
        }
      }
    }

    const totalPendBrl = totalAtraso + aVencer
    const taxa = totalPendBrl > 0 ? (totalAtraso / totalPendBrl) * 100 : 0

    return {
      totalAtraso,
      qtdAtraso: lista.length,
      maiorAtraso,
      maisAntigoVenc: maisAntigo?.vencimento || '',
      aVencer,
      aVencerCount,
      requerentesUniq,
      recMes,
      taxa,
    }
  }, [lista, receitas, fxHoje])

  // ---- Filtros aplicados ----
  const filtrada = useMemo(() => {
    let f = lista.slice()
    if (filtros.status) f = f.filter((x) => x.status === filtros.status)
    if (filtros.requerente) f = f.filter((x) => x.requerente === filtros.requerente)
    if (filtros.dias) {
      f = f.filter((x) => {
        if (filtros.dias === '0-15') return x.diasAtraso <= 15
        if (filtros.dias === '16-30') return x.diasAtraso > 15 && x.diasAtraso <= 30
        if (filtros.dias === '31-60') return x.diasAtraso > 30 && x.diasAtraso <= 60
        if (filtros.dias === '60+') return x.diasAtraso > 60
        return true
      })
    }
    if (filtros.search.trim()) {
      const s = filtros.search.toLowerCase()
      f = f.filter((x) => x.requerente.toLowerCase().includes(s))
    }
    return f
  }, [lista, filtros])

  // ---- Faixas de atraso ----
  const faixas = useMemo(
    () => [
      {
        range: '0-15 dias',
        cls: 'f1',
        items: lista.filter((x) => x.diasAtraso <= 15),
      },
      {
        range: '16-30 dias',
        cls: 'f2',
        items: lista.filter((x) => x.diasAtraso > 15 && x.diasAtraso <= 30),
      },
      {
        range: '31-60 dias',
        cls: 'f3',
        items: lista.filter((x) => x.diasAtraso > 30 && x.diasAtraso <= 60),
      },
      {
        range: '+60 dias',
        cls: 'f4',
        items: lista.filter((x) => x.diasAtraso > 60),
      },
    ],
    [lista],
  )

  // ---- Evolução (mock cosmético, igual HTML) ----
  const evolucao = useMemo(() => {
    const base = kpis.totalAtraso || 8000
    const today = new Date()
    const labels: string[] = []
    const vals: number[] = []
    const factors = [0.4, 0.7, 0.85, 0.6, 0.55, 0.65, 1]
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - (6 - i) * 5)
      labels.push(
        d.getDate().toString().padStart(2, '0') +
          '/' +
          (d.getMonth() + 1).toString().padStart(2, '0'),
      )
      vals.push(base * factors[i])
    }
    return { labels, vals }
  }, [kpis.totalAtraso])

  // ---- Item selecionado pro painel lateral ----
  const itemSelecionado = useMemo(() => {
    if (selected) return filtrada.find((x) => x.parcId === selected) || null
    return filtrada[0] || null
  }, [selected, filtrada])

  // ---- Ações ----
  function aplicarStatus(parcId: string, novoStatus: StatusInad, msg: string) {
    setStatusOverrides((prev) => ({ ...prev, [parcId]: novoStatus }))
    setToast(msg)
  }

  function limparFiltros() {
    setFiltros({ status: '', requerente: '', dias: '', search: '' })
  }

  // ---- Render ----
  if (loading) {
    return (
      <div className="fpag-page">
        <div className="empty-state" style={{ padding: 60 }}>
          Carregando dados de inadimplência...
        </div>
      </div>
    )
  }

  return (
    <div className="fpag-page">
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 24,
            right: 24,
            zIndex: 9999,
            background: '#10b981',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(0,0,0,.2)',
          }}
        >
          ✓ {toast}
        </div>
      )}

      {erro && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <i className="alert-icon">⚠</i>
          <span>{erro}</span>
        </div>
      )}

      {/* === Header === */}
      <div className="pp-head">
        <div className="pp-head-l">
          <h1>Central de Inadimplência</h1>
          <div className="pps">
            Acompanhe e gerencie todas as parcelas em atraso
          </div>
        </div>
        <div className="pp-head-r">
          <button type="button" className="btn-prem" disabled>
            ⬇ Exportar
          </button>
          <button type="button" className="btn-prem primary" disabled>
            ▼ Filtros
          </button>
        </div>
      </div>

      {/* === KPIs (6) === */}
      <div className="kpi-strip c6">
        <KpiPrem
          iconCls="red"
          icon="📋"
          label="Total em atraso"
          value={fmtBRL(kpis.totalAtraso)}
          sub={`${kpis.qtdAtraso} ${kpis.qtdAtraso === 1 ? 'parcela' : 'parcelas'}`}
          valCls="red"
        />
        <KpiPrem
          iconCls="amber"
          icon="⏰"
          label="Mais antigo"
          value={`${kpis.maiorAtraso} dias`}
          sub={
            kpis.maiorAtraso > 0
              ? `Vencida em ${fmtDate(kpis.maisAntigoVenc)}`
              : '—'
          }
        />
        <KpiPrem
          iconCls="amber"
          icon="⚠"
          label="A vencer (próx. 7 dias)"
          value={fmtBRL(kpis.aVencer)}
          sub={`${kpis.aVencerCount} ${kpis.aVencerCount === 1 ? 'parcela' : 'parcelas'}`}
        />
        <KpiPrem
          iconCls="blue"
          icon="👤"
          label="Requerentes"
          value={String(kpis.requerentesUniq)}
          sub="Com parcelas em atraso"
        />
        <KpiPrem
          iconCls="green"
          icon="✓"
          label="Recebido este mês"
          value={fmtBRL(kpis.recMes)}
          sub="Em outras parcelas"
        />
        <KpiPrem
          iconCls="purple"
          icon="📈"
          label="Taxa de inadimplência"
          value={fmtPctBR(kpis.taxa)}
          sub="Sobre o total pendente"
        />
      </div>

      {/* === Layout split === */}
      <div className="split-l">
        <div>
          {/* Filter bar */}
          <div className="fbar">
            <div className="fbr1">
              <label>
                Status
                <select
                  value={filtros.status}
                  onChange={(e) =>
                    setFiltros((p) => ({ ...p, status: e.target.value as InadFiltros['status'] }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="em_atraso">Em atraso</option>
                  <option value="cobranca_enviada">Cobrança enviada</option>
                  <option value="negociacao">Negociação</option>
                  <option value="promessa">Promessa</option>
                  <option value="vence_hoje">Vence hoje</option>
                </select>
              </label>
              <label>
                Processo
                <select disabled>
                  <option>Todos</option>
                </select>
              </label>
              <label>
                Requerente
                <select
                  value={filtros.requerente}
                  onChange={(e) =>
                    setFiltros((p) => ({ ...p, requerente: e.target.value }))
                  }
                >
                  <option value="">Todos</option>
                  {requerentesUnicos.map((r) => (
                    <option key={r} value={r}>
                      {shortName(r)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Vencimento
                <input type="text" placeholder="📅 Período" disabled />
              </label>
              <label>
                Dias em atraso
                <select
                  value={filtros.dias}
                  onChange={(e) =>
                    setFiltros((p) => ({ ...p, dias: e.target.value as InadFiltros['dias'] }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="0-15">0-15 dias</option>
                  <option value="16-30">16-30 dias</option>
                  <option value="31-60">31-60 dias</option>
                  <option value="60+">+60 dias</option>
                </select>
              </label>
              <label>
                Buscar
                <input
                  type="text"
                  placeholder="🔍 Buscar inadimplentes..."
                  value={filtros.search}
                  onChange={(e) =>
                    setFiltros((p) => ({ ...p, search: e.target.value }))
                  }
                />
              </label>
            </div>
            <div className="fbr2">
              <span />
              <button type="button" className="fb-clear" onClick={limparFiltros}>
                ↻ Limpar filtros
              </button>
            </div>
          </div>

          {/* Tabela */}
          <div className="tprem">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }}>
                    <input type="checkbox" disabled />
                  </th>
                  <th>Requerente</th>
                  <th>Parcela</th>
                  <th>Vencimento</th>
                  <th>Dias em atraso</th>
                  <th>Valor (EUR)</th>
                  <th>Valor (BRL)</th>
                  <th>Câmbio</th>
                  <th>Status</th>
                  <th className="right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrada.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="empty-state"
                      style={{ textAlign: 'center', padding: 40 }}
                    >
                      ✓ Nenhum inadimplente neste filtro.
                    </td>
                  </tr>
                ) : (
                  filtrada.map((x) => {
                    const sev =
                      x.diasAtraso > 30
                        ? 'sev-h'
                        : x.diasAtraso >= 15
                          ? 'sev-m'
                          : 'sev-l'
                    const isSel = itemSelecionado?.parcId === x.parcId
                    return (
                      <tr
                        key={x.parcId}
                        className={`rcp${isSel ? ' sel' : ''}`}
                        onClick={() => setSelected(x.parcId)}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" />
                        </td>
                        <td>
                          <div className="req-cell">
                            <div className={`avt ${avtColor(x.requerente)}`}>
                              {avtIni(x.requerente)}
                            </div>
                            <div className="ri">
                              <strong>{shortName(x.requerente)}</strong>
                              <small>{x.parcela}</small>
                            </div>
                          </div>
                        </td>
                        <td>{x.parcela}</td>
                        <td>{fmtDate(x.vencimento)}</td>
                        <td className={sev}>
                          {x.diasAtraso} {x.diasAtraso === 1 ? 'dia' : 'dias'}
                        </td>
                        <td>{fmtMoeda(x.valorEur, x.moeda)}</td>
                        <td>{fmtBRL(x.valorBrl)}</td>
                        <td>{x.moeda === 'BRL' ? '—' : fmtFX(x.fx)}</td>
                        <td>
                          <span className={`bd ${STATUS_BD_CLASS[x.status]}`}>
                            {STATUS_LABEL[x.status]}
                          </span>
                        </td>
                        <td className="right" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            title="WhatsApp"
                            onClick={() =>
                              aplicarStatus(x.parcId, 'cobranca_enviada', 'WhatsApp enviado')
                            }
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: 14,
                              color: '#10b981',
                              margin: '0 2px',
                            }}
                          >
                            💬
                          </button>
                          <button
                            type="button"
                            title="E-mail"
                            onClick={() =>
                              aplicarStatus(x.parcId, 'cobranca_enviada', 'E-mail enviado')
                            }
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: 14,
                              color: 'var(--fpag-gray-600)',
                              margin: '0 2px',
                            }}
                          >
                            ✉
                          </button>
                          <button
                            type="button"
                            title="Mais"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: 14,
                              color: 'var(--fpag-gray-600)',
                              margin: '0 2px',
                            }}
                          >
                            ⋯
                          </button>
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
            Mostrando 1 a {filtrada.length} de {lista.length} registros
          </div>

          {/* Faixas + Gráfico */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1.4fr',
              gap: 18,
              marginTop: 24,
            }}
          >
            <div className="vg-card-inad">
              <div className="vg-card-inad-title">Inadimplência por faixa de atraso</div>
              <div className="faixa-grid">
                {faixas.map((f) => {
                  const total = f.items.reduce((s, x) => s + x.valorBrl, 0)
                  return (
                    <div className={`faixa-cell ${f.cls}`} key={f.range}>
                      <div className="f-range">{f.range}</div>
                      <div className="f-count">
                        {f.items.length} {f.items.length === 1 ? 'parcela' : 'parcelas'}
                      </div>
                      <div className="f-value">{fmtBRL(total)}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="vg-chart-card">
              <div className="vg-chart-head">
                <h4>Evolução da inadimplência</h4>
                <select
                  disabled
                  style={{
                    padding: '6px 10px',
                    border: '1px solid var(--fpag-gray-200)',
                    borderRadius: 6,
                    fontSize: 11,
                    background: '#fff',
                    color: 'var(--fpag-gray-700)',
                  }}
                >
                  <option>Últimos 30 dias</option>
                </select>
              </div>
              <LineChartSvg
                values={evolucao.vals}
                labels={evolucao.labels}
                height={180}
                color="#ef4444"
              />
            </div>
          </div>
        </div>

        {/* === Painel Lateral === */}
        <div>
          {!itemSelecionado ? (
            <div className="spnl">
              <div className="spnl-head">
                <h3>Nenhum selecionado</h3>
              </div>
              <div style={{ fontSize: 12, color: 'var(--fpag-gray-500)' }}>
                Selecione um inadimplente na tabela para ver os detalhes.
              </div>
            </div>
          ) : (
            <SidePanel
              item={itemSelecionado}
              onClose={() => setSelected(null)}
              onWhatsApp={() =>
                aplicarStatus(itemSelecionado.parcId, 'cobranca_enviada', 'WhatsApp enviado')
              }
              onEmail={() =>
                aplicarStatus(itemSelecionado.parcId, 'cobranca_enviada', 'E-mail enviado')
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Subcomponentes
// ============================================================================

function KpiPrem({
  iconCls,
  icon,
  label,
  value,
  sub,
  valCls,
}: {
  iconCls: 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'gray'
  icon: string
  label: string
  value: string
  sub: string
  valCls?: 'red' | 'green'
}) {
  return (
    <div className="kpi-prem">
      <div className="kpi-prem-head">
        <div className={`kpi-prem-icon ${iconCls}`}>{icon}</div>
        <div className="kpi-prem-label">{label}</div>
      </div>
      <div className={`kpi-prem-value${valCls ? ' ' + valCls : ''}`}>{value}</div>
      <div className="kpi-prem-sub">{sub}</div>
    </div>
  )
}

function SidePanel({
  item,
  onClose,
  onWhatsApp,
  onEmail,
}: {
  item: InadItem
  onClose: () => void
  onWhatsApp: () => void
  onEmail: () => void
}) {
  return (
    <div className="spnl">
      <div className="spnl-head">
        <div>
          <h3>{shortName(item.requerente)}</h3>
          <div style={{ marginTop: 6 }}>
            <span className={`bd ${STATUS_BD_CLASS[item.status]}`}>
              {item.status === 'em_atraso'
                ? `${item.diasAtraso} dias em atraso`
                : STATUS_LABEL[item.status]}
            </span>
          </div>
        </div>
        <button type="button" className="spnl-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="spnl-sec">
        <h4>
          Parcela em atraso{' '}
          <span
            style={{
              float: 'right',
              background: 'var(--fpag-primary-light)',
              color: 'var(--fpag-primary)',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 10,
            }}
          >
            {item.parcela}
          </span>
        </h4>
        <div className="spnl-row">
          <span>Vencimento</span>
          <span>{fmtDate(item.vencimento)}</span>
        </div>
        <div className="spnl-row">
          <span>Valor ({item.moeda})</span>
          <span>{fmtMoeda(item.valorEur, item.moeda)}</span>
        </div>
        <div className="spnl-row">
          <span>Valor (BRL)</span>
          <span>{fmtBRL(item.valorBrl)}</span>
        </div>
        <div className="spnl-row">
          <span>Câmbio aplicado</span>
          <span>{item.moeda === 'BRL' ? '—' : fmtFX(item.fx)}</span>
        </div>
        <div className="spnl-row">
          <span>Dias em atraso</span>
          <span style={{ color: '#dc2626' }}>{item.diasAtraso} dias</span>
        </div>
        <div className="spnl-row">
          <span>Status</span>
          <span>
            <span className={`bd ${STATUS_BD_CLASS[item.status]}`}>
              {STATUS_LABEL[item.status]}
            </span>
          </span>
        </div>
      </div>

      <div className="spnl-sec">
        <h4>Observações</h4>
        <div
          style={{
            fontSize: 12,
            color: 'var(--fpag-gray-600)',
            lineHeight: 1.5,
          }}
        >
          Nenhuma observação registrada para esta parcela.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" className="sp-btn green" onClick={onWhatsApp}>
          <span className="sp-btn-icon">💬</span>
          Enviar WhatsApp
        </button>
        <button type="button" className="sp-btn purple" onClick={onEmail}>
          <span className="sp-btn-icon">✉</span>
          Enviar E-mail
        </button>
        <button type="button" className="sp-btn amber" disabled>
          <span className="sp-btn-icon">📄</span>
          Gerar nova fatura
        </button>
        <button type="button" className="sp-btn blue" disabled>
          <span className="sp-btn-icon">📜</span>
          Emitir recibo
        </button>
        <button type="button" className="sp-btn" disabled>
          <span className="sp-btn-icon">📝</span>
          Registrar observação
        </button>
      </div>
    </div>
  )
}

export default Inadimplencia