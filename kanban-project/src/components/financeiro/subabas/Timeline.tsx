// src/components/financeiro/subabas/Timeline.tsx
//
// 🆕 Fase 3 v2.7 — Clone FIEL de `renderTimelinePrem()` (linha 6783 do
// html_final_marco.html). Timeline Financeira do processo.
//
// Estrutura:
//   1. Header "Timeline Financeira"
//   2. 6 KPIs (Total Recebido / Total Pago / Lucro Líquido / Movimentações /
//              Impacto Cambial / Próximo Vencimento)
//   3. Filter bar (Tipo evento, Período, Requerente, Receita/Custo, Status, Busca)
//   4. Lista agrupada por dia: cabeçalho de data + cards de evento
//      ["12:32"] [⭕ ícone] [Título / Descrição] [Valor / Câmbio] [⋯]
//   5. Painel lateral com detalhes do evento clicado
//
// Eventos derivados (sem backend novo de EventoFinanceiro):
//   - Receita criada (create / 🔵)
//   - Fatura emitida (doc / 🟣)
//   - Pagamento recebido (in / 🟢)
//   - Recibo emitido (recibo / 🟢)
//   - Parcela vencida (warn / 🟡)
//   - Pagamento custo (out / 🔴)
//   Quando o backend tiver EventoFinanceiro real, troca o useMemo por fetch.

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
  formaPagamento?: string | null
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
  criadoEm?: string | null
}

interface CustoAPI {
  id: number
  descricao: string
  fornecedor?: string | null
  moeda: Moeda
  valor: number | string
  fxEstimado: number | string
  fxRule: FxRule
  fxFixo?: number | string | null
  parcelas: ParcelaAPI[]
}

export interface TimelineProps {
  processoId: number
  fxHoje?: number
}

type EvtType =
  | 'create'
  | 'doc'
  | 'in'
  | 'recibo'
  | 'warn'
  | 'out'
  | 'fx'
  | 'bell'

interface Evento {
  id: string
  date: string // YYYY-MM-DD
  time: string // HH:MM
  type: EvtType
  icon: string
  title: string
  desc: string
  amount: string
  amountSec?: string
  cambio?: number | null
  amountClass: 'in' | 'out' | ''
  status: string
  statusBd: 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'gray'
  recCusto: 'receita' | 'custo' | ''
  reqIdx?: number
  reqNome?: string
  parcelaN?: number
  totalParcelas?: number
  refKind: 'receita' | 'custo' | ''
  refDescricao?: string
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
function shortHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return (Math.abs(h) % 9999).toString().padStart(4, '0')
}
function formatDayLabel(iso: string): string {
  const meses = [
    'JAN',
    'FEV',
    'MAR',
    'ABR',
    'MAIO',
    'JUN',
    'JUL',
    'AGO',
    'SET',
    'OUT',
    'NOV',
    'DEZ',
  ]
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return (
    d.getDate().toString().padStart(2, '0') +
    ' ' +
    meses[d.getMonth()] +
    ' ' +
    d.getFullYear()
  )
}

// ============================================================================
// Componente
// ============================================================================

interface TlFiltros {
  tipo: '' | EvtType
  requerente: string
  recCusto: '' | 'receita' | 'custo'
  search: string
}

export function Timeline({ processoId, fxHoje = 5.5 }: TimelineProps) {
  const [receitas, setReceitas] = useState<ReceitaAPI[]>([])
  const [custos, setCustos] = useState<CustoAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<TlFiltros>({
    tipo: '',
    requerente: '',
    recCusto: '',
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
        console.error('[Timeline] erro:', err)
        if (!cancelado) setErro('Erro de conexão ao carregar timeline.')
      } finally {
        if (!cancelado) setLoading(false)
      }
    }
    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId])

  // ---- Geração de eventos (clone _gerarEventos do HTML) ----
  const todos: Evento[] = useMemo(() => {
    const out: Evento[] = []
    const today = todayISO()

    for (const r of receitas) {
      const fx =
        r.moeda === 'BRL'
          ? 1
          : r.fxRule === 'FIXO'
            ? num(r.fxFixo) || num(r.fxEstimado) || fxHoje
            : num(r.fxEstimado) || fxHoje
      const reqs = (r.requerentes || []).map((x, idx) => ({
        idx,
        nome: x.requerente?.nome || x.nome || `Requerente ${idx + 1}`,
      }))
      const semReq = reqs.length === 0
      const dataCriacao = (r.criadoEm || todayISO()).slice(0, 10)

      // 1. Receita criada
      out.push({
        id: `${r.id}-create`,
        date: dataCriacao,
        time: '17:25',
        type: 'create',
        icon: '＋',
        title: 'Receita criada',
        desc: r.descricao || 'Nova receita',
        amount: fmtMoeda(num(r.valor), r.moeda),
        amountSec: fmtBRL(num(r.valor) * fx),
        cambio: r.moeda !== 'BRL' && r.fxRule === 'FIXO' ? num(r.fxFixo) : null,
        amountClass: 'in',
        status: 'Criado',
        statusBd: 'blue',
        recCusto: 'receita',
        refKind: 'receita',
        refDescricao: r.descricao,
      })

      for (const p of r.parcelas) {
        const linhas = semReq ? [{ idx: 0, nome: '—' }] : reqs
        for (const reqInfo of linhas) {
          const seedF = `${r.id}-${reqInfo.idx}-${p.numero}`
          const valorEur = num(p.valor)
          const valorBrl =
            num(p.valorBrl) || (r.moeda === 'BRL' ? valorEur : valorEur * fx)
          const venc = (p.vencimento || '').slice(0, 10)
          const isPaga = p.status === 'RECEBIDA' || p.status === 'PAGA'

          // 2. Fatura emitida (sempre, no dia da criação)
          out.push({
            id: `${seedF}-fat`,
            date: dataCriacao,
            time: '10:15',
            type: 'doc',
            icon: '📄',
            title: 'Fatura FAT-' + shortHash(seedF) + ' enviada',
            desc: `Fatura enviada para ${shortName(reqInfo.nome)}`,
            amount: fmtMoeda(valorEur, r.moeda),
            amountSec: r.moeda !== 'BRL' ? fmtBRL(valorBrl) : '',
            amountClass: '',
            status: 'Enviado',
            statusBd: 'purple',
            recCusto: 'receita',
            reqIdx: reqInfo.idx,
            reqNome: reqInfo.nome,
            parcelaN: p.numero,
            totalParcelas: r.nParcelas,
            refKind: 'receita',
            refDescricao: r.descricao,
          })

          if (isPaga) {
            const dp = (p.dataPagamento || venc).slice(0, 10)
            const cambio = num(p.cambioAplicado) || fx
            // 3. Pagamento recebido
            out.push({
              id: `${seedF}-rec`,
              date: dp,
              time: '14:32',
              type: 'in',
              icon: '✓',
              title: `${shortName(reqInfo.nome)} pagou parcela ${p.numero}/${r.nParcelas}`,
              desc: 'Pagamento recebido',
              amount: '+ ' + fmtBRL(valorBrl),
              amountSec: r.moeda !== 'BRL' ? fmtMoeda(valorEur, r.moeda) : '',
              cambio: r.moeda === 'BRL' ? null : cambio,
              amountClass: 'in',
              status: 'Recebido',
              statusBd: 'green',
              recCusto: 'receita',
              reqIdx: reqInfo.idx,
              reqNome: reqInfo.nome,
              parcelaN: p.numero,
              totalParcelas: r.nParcelas,
              refKind: 'receita',
              refDescricao: r.descricao,
            })
            // 4. Recibo emitido
            out.push({
              id: `${seedF}-rcb`,
              date: dp,
              time: '11:20',
              type: 'recibo',
              icon: '📜',
              title: 'Recibo REC-' + shortHash(seedF + '-rec') + ' emitido',
              desc: `Recibo emitido para pagamento da parcela ${p.numero}/${r.nParcelas}`,
              amount: fmtBRL(valorBrl),
              amountSec: r.moeda !== 'BRL' ? fmtMoeda(valorEur, r.moeda) : '',
              amountClass: '',
              status: 'Emitido',
              statusBd: 'green',
              recCusto: 'receita',
              reqIdx: reqInfo.idx,
              reqNome: reqInfo.nome,
              parcelaN: p.numero,
              totalParcelas: r.nParcelas,
              refKind: 'receita',
              refDescricao: r.descricao,
            })
          } else if (venc && venc < today) {
            // 5. Parcela vencida
            out.push({
              id: `${seedF}-venc`,
              date: venc,
              time: '08:30',
              type: 'warn',
              icon: '⚠',
              title: `Parcela ${p.numero}/${r.nParcelas} vencida`,
              desc: `${shortName(reqInfo.nome)} - Parcela vencida`,
              amount: fmtMoeda(valorEur, r.moeda),
              amountSec: r.moeda !== 'BRL' ? fmtBRL(valorBrl) : '',
              amountClass: '',
              status: 'Vencido',
              statusBd: 'red',
              recCusto: 'receita',
              reqIdx: reqInfo.idx,
              reqNome: reqInfo.nome,
              parcelaN: p.numero,
              totalParcelas: r.nParcelas,
              refKind: 'receita',
              refDescricao: r.descricao,
            })
          }
        }
      }
    }

    // Custos pagos
    for (const c of custos) {
      const fx =
        c.moeda === 'BRL'
          ? 1
          : c.fxRule === 'FIXO'
            ? num(c.fxFixo) || num(c.fxEstimado) || fxHoje
            : num(c.fxEstimado) || fxHoje
      for (const p of c.parcelas) {
        if (p.status !== 'PAGA' && p.status !== 'RECEBIDA') continue
        const dp = (p.dataPagamento || p.vencimento || todayISO()).slice(0, 10)
        const valorEur = num(p.valor)
        const valorBrl =
          num(p.valorBrl) || (c.moeda === 'BRL' ? valorEur : valorEur * fx)
        out.push({
          id: `c${c.id}-${p.numero}-pag`,
          date: dp,
          time: '16:45',
          type: 'out',
          icon: '⬆',
          title: 'Pagamento para fornecedor',
          desc: `Pagamento referente a ${c.descricao || c.fornecedor || 'fornecedor'}`,
          amount: '- ' + fmtBRL(valorBrl),
          amountSec: c.moeda !== 'BRL' ? fmtMoeda(valorEur, c.moeda) : '',
          amountClass: 'out',
          status: 'Pago',
          statusBd: 'red',
          recCusto: 'custo',
          parcelaN: p.numero,
          totalParcelas: c.parcelas.length,
          refKind: 'custo',
          refDescricao: c.descricao,
        })
      }
    }

    // Ordena descendente por data + hora
    out.sort((a, b) =>
      (b.date + ' ' + b.time).localeCompare(a.date + ' ' + a.time),
    )
    return out
  }, [receitas, custos, fxHoje])

  // ---- Requerentes únicos pra filtro ----
  const requerentesUnicos = useMemo(() => {
    const set = new Set<string>()
    todos.forEach((e) => {
      if (e.reqNome && e.reqNome !== '—') set.add(e.reqNome)
    })
    return Array.from(set).sort()
  }, [todos])

  // ---- KPIs (6) ----
  const kpis = useMemo(() => {
    let totalRecBrl = 0
    let totalRecPrevisto = 0
    let totalPagBrl = 0
    let proxVenc: { date: string; count: number } | null = null

    for (const r of receitas) {
      const fx =
        r.moeda === 'BRL'
          ? 1
          : r.fxRule === 'FIXO'
            ? num(r.fxFixo) || num(r.fxEstimado) || fxHoje
            : num(r.fxEstimado) || fxHoje
      for (const p of r.parcelas) {
        const valorEur = num(p.valor)
        const valorBrl =
          num(p.valorBrl) || (r.moeda === 'BRL' ? valorEur : valorEur * fx)
        totalRecPrevisto += valorBrl
        if (p.status === 'RECEBIDA' || p.status === 'PAGA') {
          totalRecBrl += valorBrl
        } else {
          const v = (p.vencimento || '').slice(0, 10)
          if (v && v >= todayISO()) {
            if (!proxVenc || v < proxVenc.date) proxVenc = { date: v, count: 1 }
            else if (v === proxVenc.date) proxVenc.count++
          }
        }
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
        const valorEur = num(p.valor)
        const valorBrl =
          num(p.valorBrl) || (c.moeda === 'BRL' ? valorEur : valorEur * fx)
        totalPagBrl += valorBrl
      }
    }
    const lucroLiq = totalRecBrl - totalPagBrl
    const margem = totalRecBrl > 0 ? (lucroLiq / totalRecBrl) * 100 : 0
    return {
      totalRec: totalRecBrl,
      pctRec:
        totalRecPrevisto > 0 ? (totalRecBrl / totalRecPrevisto) * 100 : 0,
      totalPag: totalPagBrl,
      pctPag:
        totalRecPrevisto > 0 ? (totalPagBrl / totalRecPrevisto) * 100 : 0,
      lucroLiq,
      margem,
      movMes: todos.length,
      proxVenc,
    }
  }, [receitas, custos, todos.length, fxHoje])

  // ---- Filtros ----
  const filtrada = useMemo(() => {
    let f = todos.slice()
    if (filtros.tipo) f = f.filter((e) => e.type === filtros.tipo)
    if (filtros.requerente)
      f = f.filter((e) => e.reqNome === filtros.requerente)
    if (filtros.recCusto) f = f.filter((e) => e.recCusto === filtros.recCusto)
    if (filtros.search.trim()) {
      const s = filtros.search.toLowerCase()
      f = f.filter(
        (e) =>
          e.title.toLowerCase().includes(s) ||
          e.desc.toLowerCase().includes(s),
      )
    }
    return f
  }, [todos, filtros])

  // ---- Agrupamento por dia ----
  const grupos = useMemo(() => {
    const map = new Map<string, Evento[]>()
    for (const e of filtrada) {
      const arr = map.get(e.date) || []
      arr.push(e)
      map.set(e.date, arr)
    }
    return Array.from(map.entries()).sort((a, b) =>
      b[0].localeCompare(a[0]),
    )
  }, [filtrada])

  // ---- Item selecionado ----
  const itemSelecionado = useMemo(() => {
    if (selected) {
      const found = filtrada.find((e) => e.id === selected)
      if (found) return found
    }
    return filtrada[0] || null
  }, [selected, filtrada])

  function limparFiltros() {
    setFiltros({ tipo: '', requerente: '', recCusto: '', search: '' })
    setSelected(null)
  }

  if (loading) {
    return (
      <div className="fpag-page">
        <div className="empty-state" style={{ padding: 60 }}>
          Carregando timeline...
        </div>
      </div>
    )
  }

  return (
    <div className="fpag-page">
      <div className="pp-head">
        <div className="pp-head-l">
          <h1>Timeline Financeira</h1>
          <div className="pps">
            Acompanhe toda movimentação financeira do processo
          </div>
        </div>
        <div className="pp-head-r">
          <button type="button" className="btn-prem" disabled>
            ⬇ Exportar
          </button>
          <button type="button" className="btn-prem primary" disabled>
            ▼ Filtrar eventos
          </button>
        </div>
      </div>

      {erro && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <i className="alert-icon">⚠</i>
          <span>{erro}</span>
        </div>
      )}

      {/* === KPIs (6) === */}
      <div className="kpi-strip c6">
        <div className="kpi-prem">
          <div className="kpi-prem-head">
            <div className="kpi-prem-icon green">📥</div>
            <div className="kpi-prem-label">Total Recebido</div>
          </div>
          <div className="kpi-prem-value green">{fmtBRL(kpis.totalRec)}</div>
          <div className="kpi-prem-sub">
            {fmtPctBR(kpis.pctRec)} do previsto
          </div>
        </div>
        <div className="kpi-prem">
          <div className="kpi-prem-head">
            <div className="kpi-prem-icon red">📤</div>
            <div className="kpi-prem-label">Total Pago</div>
          </div>
          <div className="kpi-prem-value red">{fmtBRL(kpis.totalPag)}</div>
          <div className="kpi-prem-sub">{fmtPctBR(kpis.pctPag)} da receita</div>
        </div>
        <div className="kpi-prem">
          <div className="kpi-prem-head">
            <div className="kpi-prem-icon purple">📊</div>
            <div className="kpi-prem-label">Lucro Líquido</div>
          </div>
          <div className="kpi-prem-value">{fmtBRL(kpis.lucroLiq)}</div>
          <div className="kpi-prem-sub">Margem {fmtPctBR(kpis.margem)}</div>
        </div>
        <div className="kpi-prem">
          <div className="kpi-prem-head">
            <div className="kpi-prem-icon blue">🔄</div>
            <div className="kpi-prem-label">Movimentações</div>
          </div>
          <div className="kpi-prem-value">{kpis.movMes}</div>
          <div className="kpi-prem-sub">Total no processo</div>
        </div>
        <div className="kpi-prem">
          <div className="kpi-prem-head">
            <div className="kpi-prem-icon amber">💱</div>
            <div className="kpi-prem-label">Impacto Cambial</div>
          </div>
          <div className="kpi-prem-value">+ R$ 0,00</div>
          <div className="kpi-prem-sub">Sem impacto registrado</div>
        </div>
        <div className="kpi-prem">
          <div className="kpi-prem-head">
            <div className="kpi-prem-icon amber">⏱</div>
            <div className="kpi-prem-label">Próximo Vencimento</div>
          </div>
          <div className="kpi-prem-value">
            {kpis.proxVenc ? fmtDate(kpis.proxVenc.date) : '—'}
          </div>
          <div className="kpi-prem-sub">
            {kpis.proxVenc
              ? `${kpis.proxVenc.count} ${kpis.proxVenc.count === 1 ? 'parcela' : 'parcelas'}`
              : 'Nenhum'}
          </div>
        </div>
      </div>

      {/* === Layout split === */}
      <div className="split-l">
        <div>
          {/* Filter bar */}
          <div className="fbar">
            <div className="fbr1">
              <label>
                Tipo de evento
                <select
                  value={filtros.tipo}
                  onChange={(e) =>
                    setFiltros((p) => ({
                      ...p,
                      tipo: e.target.value as TlFiltros['tipo'],
                    }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="in">Recebimento</option>
                  <option value="out">Pagamento</option>
                  <option value="doc">Documento</option>
                  <option value="warn">Vencimento</option>
                  <option value="recibo">Recibo</option>
                  <option value="create">Criação</option>
                </select>
              </label>
              <label>
                Período
                <input type="text" placeholder="📅 Período" disabled />
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
                Receita / Custo
                <select
                  value={filtros.recCusto}
                  onChange={(e) =>
                    setFiltros((p) => ({
                      ...p,
                      recCusto: e.target.value as TlFiltros['recCusto'],
                    }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="receita">Receitas</option>
                  <option value="custo">Custos</option>
                </select>
              </label>
              <label>
                Status
                <select disabled>
                  <option>Todos</option>
                </select>
              </label>
              <label>
                Buscar
                <input
                  type="text"
                  placeholder="🔍 Buscar eventos..."
                  value={filtros.search}
                  onChange={(e) =>
                    setFiltros((p) => ({ ...p, search: e.target.value }))
                  }
                />
              </label>
            </div>
            <div className="fbr2">
              <span />
              <button
                type="button"
                className="fb-clear"
                onClick={limparFiltros}
              >
                ↻ Limpar filtros
              </button>
            </div>
          </div>

          {/* Lista agrupada por dia */}
          {grupos.length === 0 ? (
            <div
              className="empty-state"
              style={{
                textAlign: 'center',
                padding: 40,
                background: '#fff',
                borderRadius: 12,
                border: '1px solid var(--fpag-gray-200)',
              }}
            >
              Nenhum evento encontrado.
            </div>
          ) : (
            <div>
              {grupos.map(([date, eventos]) => (
                <div key={date}>
                  <div className="tl-day-h">{formatDayLabel(date)}</div>
                  {eventos.map((e) => {
                    const isSel = itemSelecionado?.id === e.id
                    return (
                      <div
                        key={e.id}
                        className={`tl-event-prem${isSel ? ' sel' : ''}`}
                        onClick={() => setSelected(e.id)}
                      >
                        <div className="tlt">{e.time}</div>
                        <div className={`tl-circle ${e.type}`}>{e.icon}</div>
                        <div className="tl-cnt">
                          <div className="tl-r1">
                            <span className="tl-tt">{e.title}</span>
                            <span className={`bd ${e.statusBd}`}>{e.status}</span>
                          </div>
                          <div className="tl-ds">{e.desc}</div>
                        </div>
                        <div className={`tl-amt ${e.amountClass}`}>
                          <span>{e.amount}</span>
                          {e.amountSec && (
                            <span className="tl-fx">{e.amountSec}</span>
                          )}
                          {e.cambio ? (
                            <span className="tl-fx">
                              Câmbio:{' '}
                              {e.cambio
                                .toFixed(2)
                                .replace('.', ',')}
                            </span>
                          ) : null}
                        </div>
                        <div
                          className="tl-menu"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          ⋯
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* === Painel lateral === */}
        <div>
          {!itemSelecionado ? (
            <div className="spnl">
              <div className="spnl-head">
                <h3>Detalhes do evento</h3>
              </div>
              <div style={{ fontSize: 12, color: 'var(--fpag-gray-500)' }}>
                Selecione um evento na timeline para ver os detalhes.
              </div>
            </div>
          ) : (
            <div className="spnl">
              <div className="spnl-head">
                <h3>Detalhes do evento</h3>
                <button
                  type="button"
                  className="spnl-close"
                  onClick={() => setSelected(null)}
                >
                  ✕
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  paddingBottom: 8,
                }}
              >
                <div
                  className={`tl-circle ${itemSelecionado.type}`}
                  style={{ width: 44, height: 44, fontSize: 18 }}
                >
                  {itemSelecionado.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{ fontSize: 11, color: 'var(--fpag-gray-500)' }}
                  >
                    Evento
                  </div>
                  <div
                    style={{
                      fontWeight: 600,
                      color: 'var(--fpag-gray-900)',
                      fontSize: 14,
                    }}
                  >
                    {itemSelecionado.title}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--fpag-gray-500)',
                      marginTop: 2,
                    }}
                  >
                    {fmtDate(itemSelecionado.date)} às {itemSelecionado.time}
                  </div>
                </div>
                <span className={`bd ${itemSelecionado.statusBd}`}>
                  {itemSelecionado.status}
                </span>
              </div>

              <div className="spnl-sec">
                <h4>Informações gerais</h4>
                {itemSelecionado.reqNome && itemSelecionado.reqNome !== '—' && (
                  <div className="spnl-row">
                    <span>Requerente</span>
                    <span>{shortName(itemSelecionado.reqNome)}</span>
                  </div>
                )}
                {itemSelecionado.parcelaN && (
                  <div className="spnl-row">
                    <span>Parcela</span>
                    <span>
                      {itemSelecionado.parcelaN}
                      {itemSelecionado.totalParcelas
                        ? ` de ${itemSelecionado.totalParcelas}`
                        : ''}
                    </span>
                  </div>
                )}
                {itemSelecionado.refDescricao && (
                  <div className="spnl-row">
                    <span>{itemSelecionado.refKind === 'custo' ? 'Custo' : 'Receita'}</span>
                    <span style={{ fontSize: 11 }}>
                      {itemSelecionado.refDescricao}
                    </span>
                  </div>
                )}
                <div className="spnl-row">
                  <span>Descrição</span>
                  <span style={{ fontSize: 11 }}>{itemSelecionado.desc}</span>
                </div>
                {itemSelecionado.cambio ? (
                  <div className="spnl-row">
                    <span>Câmbio aplicado</span>
                    <span>
                      {itemSelecionado.cambio.toFixed(4).replace('.', ',')}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="spnl-sec">
                <h4>Valor</h4>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color:
                      itemSelecionado.amountClass === 'in'
                        ? 'var(--fpag-success-dark)'
                        : itemSelecionado.amountClass === 'out'
                          ? 'var(--fpag-danger-dark)'
                          : 'var(--fpag-gray-900)',
                    letterSpacing: '-0.4px',
                  }}
                >
                  {itemSelecionado.amount}
                </div>
                {itemSelecionado.amountSec && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--fpag-gray-500)',
                      marginTop: 4,
                    }}
                  >
                    {itemSelecionado.amountSec}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button type="button" className="sp-btn" disabled>
                  <span className="sp-btn-icon">👁</span>
                  Ver origem
                </button>
                <button type="button" className="sp-btn" disabled>
                  <span className="sp-btn-icon">📋</span>
                  Copiar referência
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Timeline