// src/components/financeiro/subabas/Extrato.tsx
//
// 🆕 Fase 3 v2.5 — Clone FIEL de `#page-extrato` + `renderExtrato()` do
// html_final_marco.html (linhas 1438 e 2894).
//
// Estrutura:
//   - Header: Extrato / "Histórico de movimentações efetivadas..."
//   - 4 KPIs: Total de Entradas / Saídas / Saldo / Movimentações
//   - Filter tabs: Todas / Entradas / Saídas
//   - Tabela com colunas: Data / Tipo / Descrição / Categoria /
//     Câmbio aplicado / Valor (EUR) / Valor (BRL) / Ações
//
// Endpoints: GET /api/financeiro/receitas e /custos
// Lógica de filtro: status === RECEBIDA/PAGA com dataPagamento → entrada/saída

'use client'

import '@/src/styles/financeiro-paginas.css'
import { useEffect, useMemo, useState } from 'react'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type StatusParcela = 'PENDENTE' | 'RECEBIDA' | 'PAGA' | 'CANCELADA'
type FormaPagamento = 'TRANSFERENCIA' | 'PIX' | 'BOLETO' | 'CARTAO_CREDITO' | string

interface ParcelaAPI {
  id: number
  numero: number
  vencimento: string
  valor: number | string
  status: StatusParcela
  dataPagamento?: string | null
  cambioAplicado?: number | string | null
  valorBrl?: number | string | null
  formaPagamento?: FormaPagamento | null
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

export interface ExtratoProps {
  processoId: number
  fxHoje?: number
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
const fmtFX = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const fmtDate = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

const FORMA_LABEL: Record<string, string> = {
  TRANSFERENCIA: 'Transferência',
  PIX: 'PIX',
  BOLETO: 'Boleto',
  CARTAO_CREDITO: 'Cartão',
}
const CAT_LABEL: Record<string, string> = {
  HONORARIOS: 'Honorários',
  REEMBOLSO: 'Reembolso',
  PASTA_DOCUMENTAL: 'Pasta Documental',
  OUTROS: 'Outros',
  TRADUCOES_JURAMENTACOES: 'Traduções e juramentações',
  APOSTILAMENTOS: 'Apostilamentos',
  HONORARIOS_ESCRITORIO: 'Honorários do escritório',
  TAXAS_CONSULARES: 'Taxas consulares',
}
function prettyCategoria(s: string): string {
  if (!s) return '—'
  if (CAT_LABEL[s]) return CAT_LABEL[s]
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ============================================================================
// Componente
// ============================================================================

type Filtro = 'todos' | 'entradas' | 'saidas'

interface MovimentacaoEx {
  data: string
  tipo: 'entrada' | 'saida'
  desc: string
  subdesc: string
  categoria: string
  moeda: Moeda
  cambio: number
  valorEur: number
  valorBrl: number
  forma: string
  fxRule: FxRule
  origemId: number
  parcelaN: number
}

export function Extrato({ processoId, fxHoje = 5.5 }: ExtratoProps) {
  const [receitas, setReceitas] = useState<ItemAPI[]>([])
  const [custos, setCustos] = useState<ItemAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todos')

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
          const lst: ItemAPI[] = d?.receitas || d?.data || []
          if (!cancelado) setReceitas(Array.isArray(lst) ? lst : [])
        }
        if (resC.ok) {
          const d = await resC.json()
          const lst: ItemAPI[] = d?.custos || d?.data || []
          if (!cancelado) setCustos(Array.isArray(lst) ? lst : [])
        }
      } catch (err) {
        console.error('[Extrato] erro:', err)
        if (!cancelado) setErro('Erro de conexão ao carregar extrato.')
      } finally {
        if (!cancelado) setLoading(false)
      }
    }
    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId])

  // ---- Movimentações (clone EXATO de renderExtrato do HTML) ----
  const movs: MovimentacaoEx[] = useMemo(() => {
    const out: MovimentacaoEx[] = []
    for (const r of receitas) {
      for (const p of r.parcelas) {
        if (p.status !== 'RECEBIDA' && p.status !== 'PAGA') continue
        const valorEur = num(p.valor)
        const cambio = num(p.cambioAplicado) || num(r.fxFixo) || num(r.fxEstimado) || fxHoje
        const valorBrl =
          num(p.valorBrl) || (r.moeda === 'BRL' ? valorEur : valorEur * cambio)
        out.push({
          data: (p.dataPagamento || p.vencimento || '').slice(0, 10),
          tipo: 'entrada',
          desc: r.descricao,
          subdesc: `Parcela ${p.numero}/${r.parcelas.length}`,
          categoria: r.categoria,
          moeda: r.moeda,
          cambio: r.moeda === 'BRL' ? 1 : cambio,
          valorEur,
          valorBrl,
          forma: FORMA_LABEL[p.formaPagamento || ''] || '—',
          fxRule: r.fxRule,
          origemId: r.id,
          parcelaN: p.numero,
        })
      }
    }
    for (const c of custos) {
      for (const p of c.parcelas) {
        if (p.status !== 'PAGA' && p.status !== 'RECEBIDA') continue
        const valorEur = num(p.valor)
        const cambio = num(p.cambioAplicado) || num(c.fxFixo) || num(c.fxEstimado) || fxHoje
        const valorBrl =
          num(p.valorBrl) || (c.moeda === 'BRL' ? valorEur : valorEur * cambio)
        out.push({
          data: (p.dataPagamento || p.vencimento || '').slice(0, 10),
          tipo: 'saida',
          desc: c.descricao,
          subdesc: `Parcela ${p.numero}/${c.parcelas.length}`,
          categoria: c.categoria,
          moeda: c.moeda,
          cambio: c.moeda === 'BRL' ? 1 : cambio,
          valorEur,
          valorBrl,
          forma: FORMA_LABEL[p.formaPagamento || ''] || '—',
          fxRule: c.fxRule,
          origemId: c.id,
          parcelaN: p.numero,
        })
      }
    }
    return out.sort((a, b) => (b.data || '').localeCompare(a.data || ''))
  }, [receitas, custos, fxHoje])

  // ---- KPIs ----
  const kpis = useMemo(() => {
    let totalEntradasBrl = 0
    let totalEntradasEur = 0
    let totalSaidasBrl = 0
    let totalSaidasEur = 0
    for (const m of movs) {
      if (m.tipo === 'entrada') {
        totalEntradasBrl += m.valorBrl
        totalEntradasEur += m.valorEur
      } else {
        totalSaidasBrl += m.valorBrl
        totalSaidasEur += m.valorEur
      }
    }
    return {
      totalEntradasBrl,
      totalEntradasEur,
      totalSaidasBrl,
      totalSaidasEur,
      saldoBrl: totalEntradasBrl - totalSaidasBrl,
      saldoEur: totalEntradasEur - totalSaidasEur,
      count: movs.length,
    }
  }, [movs])

  // ---- Filtro ----
  const filtrada = useMemo(() => {
    if (filtro === 'entradas') return movs.filter((m) => m.tipo === 'entrada')
    if (filtro === 'saidas') return movs.filter((m) => m.tipo === 'saida')
    return movs
  }, [movs, filtro])

  // ---- Render ----
  if (loading) {
    return (
      <div className="fpag-page">
        <div className="empty-state" style={{ padding: 60 }}>
          Carregando extrato...
        </div>
      </div>
    )
  }

  return (
    <div className="fpag-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Extrato</h1>
          <div className="page-subtitle">
            Histórico de movimentações efetivadas (recebimentos e pagamentos)
          </div>
        </div>
      </div>

      {erro && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <i className="alert-icon">⚠</i>
          <span>{erro}</span>
        </div>
      )}

      {/* === KPIs === */}
      <div className="grid-4">
        <div className="kpi">
          <div className="kpi-label">↑ Total de Entradas</div>
          <div className="kpi-value pos">{fmtBRL(kpis.totalEntradasBrl)}</div>
          <div className="kpi-sub">{fmtEUR(kpis.totalEntradasEur)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">↓ Total de Saídas</div>
          <div className="kpi-value neg">{fmtBRL(kpis.totalSaidasBrl)}</div>
          <div className="kpi-sub">{fmtEUR(kpis.totalSaidasEur)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">💰 Saldo</div>
          <div className={`kpi-value ${kpis.saldoBrl >= 0 ? 'pos' : 'neg'}`}>
            {fmtBRL(kpis.saldoBrl)}
          </div>
          <div className="kpi-sub">{fmtEUR(kpis.saldoEur)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">📋 Movimentações</div>
          <div className="kpi-value">{kpis.count}</div>
          <div className="kpi-sub">lançamentos registrados</div>
        </div>
      </div>

      {/* === Filter tabs === */}
      <div className="filter-tabs">
        <button
          type="button"
          className={`filter-tab ${filtro === 'todos' ? 'active' : ''}`}
          onClick={() => setFiltro('todos')}
        >
          Todas
        </button>
        <button
          type="button"
          className={`filter-tab ${filtro === 'entradas' ? 'active' : ''}`}
          onClick={() => setFiltro('entradas')}
        >
          Entradas
        </button>
        <button
          type="button"
          className={`filter-tab ${filtro === 'saidas' ? 'active' : ''}`}
          onClick={() => setFiltro('saidas')}
        >
          Saídas
        </button>
      </div>

      {/* === Tabela === */}
      <div className="table-card">
        {filtrada.length === 0 ? (
          <div className="empty-state">
            {movs.length === 0
              ? 'Nenhuma movimentação registrada. Confirme recebimentos/pagamentos em Receitas e Custos.'
              : 'Nenhuma movimentação corresponde ao filtro.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Câmbio aplicado</th>
                <th>Valor (EUR)</th>
                <th>Valor (BRL)</th>
              </tr>
            </thead>
            <tbody>
              {filtrada.map((m, idx) => {
                const valorClass = m.tipo === 'entrada' ? 'val-pos' : 'val-neg'
                const sinal = m.tipo === 'entrada' ? '+' : '−'
                return (
                  <tr key={`${m.origemId}-${m.tipo}-${m.parcelaN}-${idx}`}>
                    <td>{fmtDate(m.data)}</td>
                    <td>
                      {m.tipo === 'entrada' ? (
                        <span className="badge badge-recebida">↑ Entrada</span>
                      ) : (
                        <span className="badge badge-atrasada">↓ Saída</span>
                      )}
                    </td>
                    <td>
                      <strong>{m.desc}</strong>
                      <span className="muted-xs">
                        {m.subdesc} • {m.forma}
                      </span>
                    </td>
                    <td>{prettyCategoria(m.categoria)}</td>
                    <td>
                      {m.moeda === 'BRL' ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          {fmtFX(m.cambio)}{' '}
                          {m.fxRule === 'FIXO' ? (
                            <span className="badge-fx-fixo-sm">FIXO</span>
                          ) : (
                            <span className="badge-fx-var-sm">VAR</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className={valorClass}>
                      {m.moeda === 'BRL' ? (
                        <span className="muted">—</span>
                      ) : (
                        `${sinal} ${fmtMoeda(m.valorEur, m.moeda)}`
                      )}
                    </td>
                    <td className={valorClass}>
                      <strong>
                        {sinal} {fmtBRL(m.valorBrl)}
                      </strong>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default Extrato