// src/components/financeiro/subabas/Custos.tsx
//
// 🆕 Fase 3 v2 — Custos com view router interno.
//
// Estrutura:
//   - View 'lista':
//       Section 1: 📂 Pasta Documental (TabelaCustos antiga, intocada)
//       Section 2: 🧾 Registrar Custos (Fase 3 — KPIs + tabela)
//   - View 'nova'  → renderiza <NovoCustoPagina />
//   - View 'lancar' → renderiza <LancarParcelaPagina tipo="custo" />
//
// Decisão Marco (30/04/2026): Pasta Documental NÃO entra no totalizador
// "PAGAMENTO A FORNECEDORES" da sidebar — é apenas reposição/repasse documental.
//
// ⚠️ Importação da TabelaCustos: usa o caminho que você já tem no projeto
// (provavelmente `@/src/components/financeiro/financeiroComponents/TabelaCustos`).
// Se a sua importação for outra, ajuste a linha do import abaixo.

'use client'

import '@/src/styles/financeiro-paginas.css'
import { useEffect, useState, useMemo } from 'react'
import { NovoCustoPagina } from '@/src/components/financeiro/paginas/NovoCustoPagina'
import {
  LancarParcelaPagina,
  type ParcelaLancavel,
  type EntidadeLancavel,
} from '@/src/components/financeiro/paginas/LancarParcelaPagina'

// ⚠️ Ajuste o caminho se diferente no seu projeto:
import { TabelaCustos } from '@/src/components/kanban/TabelaCustos'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type StatusParcela = 'PENDENTE' | 'RECEBIDA' | 'PAGA' | 'CANCELADA'
type TipoCusto = 'SERVICO' | 'IMPOSTO' | 'DOCUMENTO' | 'DESPESA'
type CategoriaCusto =
  | 'TRADUCOES_JURAMENTACOES'
  | 'APOSTILAMENTOS'
  | 'HONORARIOS_ESCRITORIO'
  | 'TAXAS_CONSULARES'
  | 'OUTROS'

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

interface CustoAPI {
  id: number
  codigo: string
  tipo: TipoCusto
  categoria: CategoriaCusto
  descricao: string
  fornecedor?: string | null
  moeda: Moeda
  valor: number | string
  fxEstimado: number | string
  fxRule: FxRule
  fxFixo?: number | string | null
  nParcelas: number
  vencimento: string
  custoOperacional?: boolean
  parcelas: ParcelaAPI[]
}

type Filter = 'todos' | 'pagos' | 'pendentes'

export interface CustosProps {
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

const TIPO_LABEL: Record<TipoCusto, string> = {
  SERVICO: 'Serviço',
  IMPOSTO: 'Imposto',
  DOCUMENTO: 'Documento',
  DESPESA: 'Despesa',
}
const CAT_LABEL: Record<CategoriaCusto, string> = {
  TRADUCOES_JURAMENTACOES: 'Traduções e juramentações',
  APOSTILAMENTOS: 'Apostilamentos',
  HONORARIOS_ESCRITORIO: 'Honorários do escritório',
  TAXAS_CONSULARES: 'Taxas consulares',
  OUTROS: 'Outros',
}

function cambioEfetivo(c: CustoAPI): number {
  if (c.moeda === 'BRL') return 1
  if (c.fxRule === 'FIXO' && c.fxFixo) return num(c.fxFixo)
  return num(c.fxEstimado) || 1
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

export function Custos({
  processoId,
  nomeFamilia,
  onUpdate,
  fxHoje = 5.5,
}: CustosProps) {
  const [view, setView] = useState<View>({ kind: 'lista' })
  const [custos, setCustos] = useState<CustoAPI[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filter>('todos')

  // ---- Load ----
  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setLoading(true)
      setErro(null)
      try {
        const res = await fetch(
          `/api/financeiro/custos?processoId=${processoId}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
            },
          },
        )
        if (cancelado) return
        if (!res.ok) {
          setErro(`Não foi possível carregar custos (HTTP ${res.status}).`)
          setCustos([])
          return
        }
        const data = await res.json()
        const lista: CustoAPI[] = data?.custos || data?.data || []
        if (!cancelado) setCustos(Array.isArray(lista) ? lista : [])
      } catch (err) {
        console.error('[Custos] erro:', err)
        if (!cancelado) {
          setErro('Erro de conexão ao carregar custos.')
          setCustos([])
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
      const res = await fetch(`/api/financeiro/custos?processoId=${processoId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })
      if (!res.ok) return
      const data = await res.json()
      const lista: CustoAPI[] = data?.custos || data?.data || []
      setCustos(Array.isArray(lista) ? lista : [])
    } catch (err) {
      console.error('[Custos] recarregar:', err)
    }
  }

  // ---- KPIs ----
  const kpis = useMemo(() => {
    let totalEur = 0
    let totalBrl = 0
    let pagoEur = 0
    let pagoBrl = 0
    let pendenteEur = 0
    let pendenteBrl = 0
    let atrasadoEur = 0
    let qtdAtrasadas = 0
    custos.forEach((c) => {
      const cx = cambioEfetivo(c)
      c.parcelas?.forEach((p) => {
        const v = num(p.valor)
        const vBrl = num(p.valorBrl) || v * cx
        totalEur += v
        totalBrl += vBrl
        if (p.status === 'PAGA' || p.status === 'RECEBIDA') {
          pagoEur += v
          pagoBrl += num(p.valorBrl) || v * (num(p.cambioAplicado) || cx)
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
      pagoEur,
      pagoBrl,
      pendenteEur,
      pendenteBrl,
      atrasadoEur,
      qtdAtrasadas,
    }
  }, [custos])

  const custosFiltrados = useMemo(() => {
    if (filtro === 'todos') return custos
    if (filtro === 'pagos') {
      return custos.filter((c) => {
        const tot = c.parcelas?.length || 0
        const pg = c.parcelas?.filter(
          (p) => p.status === 'PAGA' || p.status === 'RECEBIDA',
        ).length
        return tot > 0 && pg === tot
      })
    }
    return custos.filter((c) => c.parcelas?.some((p) => p.status === 'PENDENTE'))
  }, [custos, filtro])

  // ---- Render por view ----
  if (view.kind === 'nova') {
    return (
      <NovoCustoPagina
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
      {/* === Section 1: Pasta Documental === */}
      <section style={{ marginBottom: 32 }}>
        <div className="page-header">
          <div>
            <h1 className="page-title">📂 Pasta Documental</h1>
            <div className="page-subtitle">
              Custos de aquisição/reposição documental ligados à pasta do processo
            </div>
          </div>
        </div>
        <TabelaCustos processoId={processoId} nomeFamilia={nomeFamilia} />
      </section>

      {/* === Section 2: Custos Novos (Fase 3) === */}
      <section>
        <div className="page-header">
          <div>
            <h1 className="page-title">🧾 Registrar Custos</h1>
            <div className="page-subtitle">
              Serviços, impostos, despesas e demais saídas operacionais do processo
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setView({ kind: 'nova' })}
          >
            + Novo Custo
          </button>
        </div>

        {/* KPIs */}
        <div className="grid-4">
          <div className="kpi">
            <div className="kpi-label">📉 Total Previsto</div>
            <div className="kpi-value">{fmtMoeda(kpis.totalEur, 'EUR')}</div>
            <div className="kpi-sub">{fmtBRL(kpis.totalBrl)}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">✓ Pago</div>
            <div className="kpi-value pos">{fmtMoeda(kpis.pagoEur, 'EUR')}</div>
            <div className="kpi-sub pos">{fmtBRL(kpis.pagoBrl)}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">⏳ A Pagar</div>
            <div className="kpi-value">{fmtMoeda(kpis.pendenteEur, 'EUR')}</div>
            <div className="kpi-sub">{fmtBRL(kpis.pendenteBrl)}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">⚠ Atrasado</div>
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
            className={`filter-tab ${filtro === 'todos' ? 'active' : ''}`}
            onClick={() => setFiltro('todos')}
          >
            Todos
          </button>
          <button
            type="button"
            className={`filter-tab ${filtro === 'pagos' ? 'active' : ''}`}
            onClick={() => setFiltro('pagos')}
          >
            Pagos
          </button>
          <button
            type="button"
            className={`filter-tab ${filtro === 'pendentes' ? 'active' : ''}`}
            onClick={() => setFiltro('pendentes')}
          >
            A pagar
          </button>
        </div>

        {erro && (
          <div className="alert alert-danger" style={{ marginBottom: 16 }}>
            <i className="alert-icon">⚠</i>
            <span>{erro}</span>
          </div>
        )}

        <div className="table-card">
          {loading ? (
            <div className="empty-state">Carregando custos...</div>
          ) : custosFiltrados.length === 0 && custos.length === 0 ? (
            <div className="empty-state">
              Nenhum custo cadastrado. Clique em <strong>+ Novo Custo</strong> para começar.
            </div>
          ) : custosFiltrados.length === 0 ? (
            <div className="empty-state">Nenhum custo corresponde ao filtro.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>Descrição</th>
                  <th>Tipo / Categoria</th>
                  <th>Fornecedor</th>
                  <th>Total (EUR)</th>
                  <th>Total (BRL)</th>
                  <th>Câmbio</th>
                  <th>Parcelas</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {custosFiltrados.map((c) => {
                  const cx = cambioEfetivo(c)
                  const totEur = num(c.valor)
                  const totBrl = totEur * cx
                  let pgCount = 0
                  c.parcelas?.forEach((p) => {
                    if (p.status === 'PAGA' || p.status === 'RECEBIDA') pgCount++
                  })
                  const totParc = c.parcelas?.length || 0
                  const isQuit = totParc > 0 && pgCount === totParc
                  const temAtraso = c.parcelas?.some(isVencida)

                  let statusBadge: React.ReactNode
                  if (isQuit) statusBadge = <span className="badge badge-recebida">Pago</span>
                  else if (temAtraso)
                    statusBadge = <span className="badge badge-atrasada">Atrasado</span>
                  else statusBadge = <span className="badge badge-pendente">A pagar</span>

                  const fxBadge =
                    c.moeda === 'BRL' ? (
                      <span className="badge badge-pendente">BRL</span>
                    ) : c.fxRule === 'FIXO' ? (
                      <span className="badge-fx-fixo-sm">FIXO</span>
                    ) : (
                      <span className="badge-fx-var-sm">VAR</span>
                    )

                  const proximaPendente = c.parcelas?.find((p) => p.status === 'PENDENTE')

                  return (
                    <tr key={c.id}>
                      <td>📋</td>
                      <td>
                        <strong>{c.descricao}</strong>
                        <span className="muted-xs">{c.codigo}</span>
                      </td>
                      <td>
                        {TIPO_LABEL[c.tipo]}
                        <span className="muted-xs">{CAT_LABEL[c.categoria]}</span>
                      </td>
                      <td>{c.fornecedor || <span className="muted">—</span>}</td>
                      <td>{fmtMoeda(totEur, c.moeda)}</td>
                      <td className="brl">
                        <strong>
                          {fmtBRL(totBrl)}
                          {c.moeda !== 'BRL' && c.fxRule === 'VARIAVEL' && (
                            <span className="muted-xs">(est.)</span>
                          )}
                        </strong>
                      </td>
                      <td>
                        {c.moeda === 'BRL' ? (
                          <span className="muted">—</span>
                        ) : c.fxRule === 'FIXO' ? (
                          <>
                            {fmtFX(num(c.fxFixo))} {fxBadge}
                          </>
                        ) : (
                          <>
                            {fmtFX(num(c.fxEstimado))} {fxBadge}
                          </>
                        )}
                      </td>
                      <td>
                        {pgCount}/{totParc}
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
                                  tipo: 'custo',
                                  descricao: c.descricao,
                                  fornecedor: c.fornecedor,
                                  moeda: c.moeda,
                                  fxRule: c.fxRule,
                                  fxFixo: c.fxFixo != null ? num(c.fxFixo) : null,
                                  fxEstimado: num(c.fxEstimado) || 1,
                                  totalParcelas: c.nParcelas,
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
      </section>
    </div>
  )
}

export default Custos