// src/components/financeiro/subabas/Receitas.tsx
//
// 🆕 Fase 3 v2 — Receitas com view router interno (não usa mais modais).
//
// Views:
//   - 'lista'   → KPIs + tabela de receitas (clone visual do #page-receitas)
//   - 'nova'    → renderiza <NovaReceitaPagina />
//   - 'lancar'  → renderiza <LancarParcelaPagina tipo="receita" />
//
// Endpoint: GET /api/financeiro/receitas?processoId=X

'use client'

import '@/src/styles/financeiro-paginas.css'
import { useEffect, useState, useMemo } from 'react'
import { NovaReceitaPagina } from '@/src/components/financeiro/paginas/NovaReceitaPagina'
import {
  LancarParcelaPagina,
  type ParcelaLancavel,
  type EntidadeLancavel,
} from '@/src/components/financeiro/paginas/LancarParcelaPagina'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type StatusParcela = 'PENDENTE' | 'RECEBIDA' | 'PAGA' | 'CANCELADA'
type CategoriaReceita = 'HONORARIOS' | 'REEMBOLSO' | 'PASTA_DOCUMENTAL' | 'OUTROS'

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

interface ReceitaRequerenteAPI {
  id: number
  percentual: number | string
  nome?: string
  requerente?: { id: number; nome: string }
}

interface ReceitaAPI {
  id: number
  codigo: string
  categoria: CategoriaReceita
  descricao: string
  moeda: Moeda
  valor: number | string
  fxEstimado: number | string
  fxRule: FxRule
  fxFixo?: number | string | null
  nParcelas: number
  data1: string
  parcelas: ParcelaAPI[]
  requerentes?: ReceitaRequerenteAPI[]
}

type Filter = 'todas' | 'recebidas' | 'pendentes'

export interface ReceitasProps {
  processoId: number
  nomeFamilia?: string
  onUpdate?: () => void
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
const fmtMoeda = (v: number, m: Moeda) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: m })
const fmtFX = (v: number) => v.toFixed(4).replace('.', ',')
const fmtDate = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

const CATEGORIA_LABEL: Record<CategoriaReceita, string> = {
  HONORARIOS: 'Honorários',
  REEMBOLSO: 'Reembolso',
  PASTA_DOCUMENTAL: 'Pasta Documental',
  OUTROS: 'Outros',
}

function cambioEfetivo(r: ReceitaAPI): number {
  if (r.moeda === 'BRL') return 1
  if (r.fxRule === 'FIXO' && r.fxFixo) return num(r.fxFixo)
  return num(r.fxEstimado) || 1
}
function isVencida(p: ParcelaAPI): boolean {
  if (p.status !== 'PENDENTE') return false
  if (!p.vencimento) return false
  const v = new Date(p.vencimento.includes('T') ? p.vencimento : p.vencimento + 'T00:00:00')
  v.setHours(0, 0, 0, 0)
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return v.getTime() < hoje.getTime()
}

// ============================================================================
// Componente
// ============================================================================

type View =
  | { kind: 'lista' }
  | { kind: 'nova' }
  | { kind: 'lancar'; parcela: ParcelaLancavel; entidade: EntidadeLancavel }

export function Receitas({ processoId, onUpdate, fxHoje = 5.5 }: ReceitasProps) {
  const [view, setView] = useState<View>({ kind: 'lista' })
  const [receitas, setReceitas] = useState<ReceitaAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filter>('todas')

  // ---- Load ----
  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setLoading(true)
      setErro(null)
      try {
        const res = await fetch(
          `/api/financeiro/receitas?processoId=${processoId}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
            },
          },
        )
        if (cancelado) return
        if (!res.ok) {
          setErro(`Não foi possível carregar receitas (HTTP ${res.status}).`)
          setReceitas([])
          return
        }
        const data = await res.json()
        const lista: ReceitaAPI[] = data?.receitas || data?.data || []
        if (!cancelado) setReceitas(Array.isArray(lista) ? lista : [])
      } catch (err) {
        console.error('[Receitas] erro:', err)
        if (!cancelado) {
          setErro('Erro de conexão ao carregar receitas.')
          setReceitas([])
        }
      } finally {
        if (!cancelado) setLoading(false)
      }
    }
    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId])

  async function recarregar() {
    try {
      const res = await fetch(`/api/financeiro/receitas?processoId=${processoId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })
      if (!res.ok) return
      const data = await res.json()
      const lista: ReceitaAPI[] = data?.receitas || data?.data || []
      setReceitas(Array.isArray(lista) ? lista : [])
    } catch (err) {
      console.error('[Receitas] recarregar:', err)
    }
  }

  // ---- KPIs ----
  const kpis = useMemo(() => {
    let totalEur = 0
    let totalBrl = 0
    let recebidoEur = 0
    let recebidoBrl = 0
    let pendenteEur = 0
    let pendenteBrl = 0
    let atrasadoEur = 0
    let qtdAtrasadas = 0
    receitas.forEach((r) => {
      const cx = cambioEfetivo(r)
      r.parcelas?.forEach((p) => {
        const v = num(p.valor)
        const vBrl = num(p.valorBrl) || v * cx
        totalEur += v
        totalBrl += vBrl
        if (p.status === 'RECEBIDA' || p.status === 'PAGA') {
          recebidoEur += v
          recebidoBrl += num(p.valorBrl) || v * (num(p.cambioAplicado) || cx)
        } else if (p.status === 'PENDENTE') {
          pendenteEur += v
          pendenteBrl += vBrl
          if (isVencida(p)) {
            atrasadoEur += v
            qtdAtrasadas++
          }
        }
      })
    })
    return {
      totalEur,
      totalBrl,
      recebidoEur,
      recebidoBrl,
      pendenteEur,
      pendenteBrl,
      atrasadoEur,
      qtdAtrasadas,
    }
  }, [receitas])

  // ---- Filtro ----
  const receitasFiltradas = useMemo(() => {
    if (filtro === 'todas') return receitas
    if (filtro === 'recebidas') {
      return receitas.filter((r) => {
        const tot = r.parcelas?.length || 0
        const rec = r.parcelas?.filter(
          (p) => p.status === 'RECEBIDA' || p.status === 'PAGA',
        ).length
        return tot > 0 && rec === tot
      })
    }
    return receitas.filter((r) =>
      r.parcelas?.some((p) => p.status === 'PENDENTE'),
    )
  }, [receitas, filtro])

  // ---- Render por view ----
  if (view.kind === 'nova') {
    return (
      <NovaReceitaPagina
        processoId={processoId}
        fxHoje={fxHoje}
        onVoltar={() => setView({ kind: 'lista' })}
        onCriado={() => {
          setView({ kind: 'lista' })
          recarregar()
          onUpdate?.()
        }}
      />
    )
  }

  if (view.kind === 'lancar') {
    return (
      <LancarParcelaPagina
        parcela={view.parcela}
        entidade={view.entidade}
        fxHoje={fxHoje}
        onVoltar={() => setView({ kind: 'lista' })}
        onLancado={() => {
          setView({ kind: 'lista' })
          recarregar()
          onUpdate?.()
        }}
      />
    )
  }

  // ---- View 'lista' ----
  return (
    <div className="fpag-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Receitas</h1>
          <div className="page-subtitle">Honorários e demais entradas do processo</div>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setView({ kind: 'nova' })}
        >
          + Nova Receita
        </button>
      </div>

      {/* KPIs */}
      <div className="grid-4">
        <div className="kpi">
          <div className="kpi-label">📈 Total Previsto</div>
          <div className="kpi-value">{fmtMoeda(kpis.totalEur, 'EUR')}</div>
          <div className="kpi-sub">{fmtBRL(kpis.totalBrl)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">✓ Recebido</div>
          <div className="kpi-value pos">{fmtMoeda(kpis.recebidoEur, 'EUR')}</div>
          <div className="kpi-sub pos">{fmtBRL(kpis.recebidoBrl)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">⏳ Pendente</div>
          <div className="kpi-value">{fmtMoeda(kpis.pendenteEur, 'EUR')}</div>
          <div className="kpi-sub">{fmtBRL(kpis.pendenteBrl)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">⚠ Inadimplente</div>
          <div className="kpi-value neg">{fmtMoeda(kpis.atrasadoEur, 'EUR')}</div>
          <div className="kpi-sub">
            {kpis.qtdAtrasadas} {kpis.qtdAtrasadas === 1 ? 'parcela' : 'parcelas'}
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="filter-tabs">
        <button
          type="button"
          className={`filter-tab ${filtro === 'todas' ? 'active' : ''}`}
          onClick={() => setFiltro('todas')}
        >
          Todas
        </button>
        <button
          type="button"
          className={`filter-tab ${filtro === 'recebidas' ? 'active' : ''}`}
          onClick={() => setFiltro('recebidas')}
        >
          Recebidas
        </button>
        <button
          type="button"
          className={`filter-tab ${filtro === 'pendentes' ? 'active' : ''}`}
          onClick={() => setFiltro('pendentes')}
        >
          Pendentes
        </button>
      </div>

      {/* Erro / Loading / Lista */}
      {erro && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <i className="alert-icon">⚠</i>
          <span>{erro}</span>
        </div>
      )}

      <div className="table-card">
        {loading ? (
          <div className="empty-state">Carregando receitas...</div>
        ) : receitasFiltradas.length === 0 && receitas.length === 0 ? (
          <div className="empty-state">
            Nenhuma receita cadastrada. Clique em <strong>+ Nova Receita</strong> para começar.
          </div>
        ) : receitasFiltradas.length === 0 ? (
          <div className="empty-state">Nenhuma receita corresponde ao filtro.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Total (EUR)</th>
                <th>Total (BRL)</th>
                <th>Câmbio</th>
                <th>Parcelas</th>
                <th>Progresso</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {receitasFiltradas.map((r) => {
                const cx = cambioEfetivo(r)
                const totEur = num(r.valor)
                const totBrl = totEur * cx
                let recCount = 0
                r.parcelas?.forEach((p) => {
                  if (p.status === 'RECEBIDA' || p.status === 'PAGA') recCount++
                })
                const totParc = r.parcelas?.length || 0
                const pct = totParc > 0 ? (recCount / totParc) * 100 : 0
                const isQuit = totParc > 0 && recCount === totParc
                const temAtraso = r.parcelas?.some(isVencida)

                let statusBadge: React.ReactNode
                if (isQuit)
                  statusBadge = <span className="badge badge-recebida">Quitada</span>
                else if (temAtraso)
                  statusBadge = <span className="badge badge-atrasada">Atrasada</span>
                else statusBadge = <span className="badge badge-pendente">Em aberto</span>

                const fxBadge =
                  r.moeda === 'BRL' ? (
                    <span className="badge badge-pendente">BRL</span>
                  ) : r.fxRule === 'FIXO' ? (
                    <span className="badge-fx-fixo-sm">FIXO</span>
                  ) : (
                    <span className="badge-fx-var-sm">VAR</span>
                  )

                const proximaPendente = r.parcelas?.find((p) => p.status === 'PENDENTE')

                return (
                  <tr key={r.id}>
                    <td>📑</td>
                    <td>
                      <strong>{r.descricao}</strong>
                      <span className="muted-xs">{r.codigo}</span>
                    </td>
                    <td>{CATEGORIA_LABEL[r.categoria]}</td>
                    <td>{fmtMoeda(totEur, r.moeda)}</td>
                    <td className="brl">
                      <strong>
                        {fmtBRL(totBrl)}
                        {r.moeda !== 'BRL' && r.fxRule === 'VARIAVEL' && (
                          <span className="muted-xs">(est.)</span>
                        )}
                      </strong>
                    </td>
                    <td>
                      {r.moeda === 'BRL' ? (
                        <span className="muted">—</span>
                      ) : r.fxRule === 'FIXO' ? (
                        <>
                          {fmtFX(num(r.fxFixo))} {fxBadge}
                        </>
                      ) : (
                        <>
                          {fmtFX(num(r.fxEstimado))} {fxBadge}
                        </>
                      )}
                    </td>
                    <td>
                      {recCount}/{totParc}
                    </td>
                    <td>
                      <div
                        style={{
                          width: 100,
                          height: 6,
                          background: 'var(--fpag-gray-100)',
                          borderRadius: 3,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: 'var(--fpag-success)',
                            transition: 'width .3s',
                          }}
                        />
                      </div>
                      <div className="muted-xs">{pct.toFixed(0)}%</div>
                    </td>
                    <td>{statusBadge}</td>
                    <td>
                      {proximaPendente ? (
                        <button
                          type="button"
                          className="btn-link-sm"
                          onClick={() =>
                            setView({
                              kind: 'lancar',
                              parcela: {
                                id: proximaPendente.id,
                                numero: proximaPendente.numero,
                                valor: num(proximaPendente.valor),
                                vencimento: proximaPendente.vencimento,
                              },
                              entidade: {
                                tipo: 'receita',
                                descricao: r.descricao,
                                moeda: r.moeda,
                                fxRule: r.fxRule,
                                fxFixo: r.fxFixo != null ? num(r.fxFixo) : null,
                                fxEstimado: num(r.fxEstimado) || 1,
                                totalParcelas: r.nParcelas,
                              },
                            })
                          }
                        >
                          Lançar
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
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

export default Receitas