// src/components/financeiro/subabas/Custos.tsx
//
// 🆕 Fase 3 v2.1 — Custos com view router interno.
//
// Estrutura:
//   - View 'lista':
//       Section 1: 📂 Pasta Documental (TabelaCustos antiga, intocada)
//       Section 2: 🧾 Registrar Custos (Fase 3 — KPIs + tabela)
//   - View 'nova'   → renderiza <NovoCustoPagina />
//   - View 'editar' → renderiza <NovoCustoPagina custoInicial={...} />
//   - View 'lancar' → renderiza <LancarParcelaPagina tipo="custo" />
//
// 🆕 v2.1 — KPIs em BRL principal (igual ao Receitas).
// 🆕 v2   — Header da coluna "Total (orig.)" sempre.
//         — Filtra custos cancelados (cancelado=true) antes de tudo.
//         — Aba 📝 Rascunhos após "A pagar".
//         — Linha de rascunho com botões Editar / Excluir.
//         — KPIs agora consideram apenas custos ATIVOS (rascunhos fora).

'use client'

import '@/src/styles/financeiro-paginas.css'
import { useEffect, useState, useMemo } from 'react'
import { NovoCustoPagina } from '@/src/components/financeiro/paginas/NovoCustoPagina'
import {
  LancarParcelaPagina,
  type ParcelaLancavel,
  type EntidadeLancavel,
} from '@/src/components/financeiro/paginas/LancarParcelaPagina'

import { TabelaCustos } from '@/src/components/kanban/TabelaCustos'
import { parseLista } from '@/src/lib/financeiro/parseLista'

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
type CustoStatus = 'ATIVA' | 'RASCUNHO' | 'CANCELADA'

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
  fxData?: string | null
  nParcelas: number
  vencimento: string
  custoOperacional?: boolean
  categoriaVinculada?: string | null
  percentualVinculado?: number | null
  formaPagamento?: string | null
  status?: CustoStatus
  cancelado?: boolean
  parcelas: ParcelaAPI[]
}

type Filter = 'todos' | 'pagos' | 'pendentes' | 'rascunhos'

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
  | { kind: 'editar'; custo: CustoAPI }
  | { kind: 'lancar'; parcela: ParcelaLancavel; entidade: EntidadeLancavel }

// Cast pra TS não reclamar de prop opcional `custoInicial` adicionada na v4.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NovoCustoPaginaAny = NovoCustoPagina as any

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
  const [excluindoId, setExcluindoId] = useState<number | null>(null)

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
        const lista = parseLista<CustoAPI>(data)
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
      const lista = parseLista<CustoAPI>(data)
      setCustos(Array.isArray(lista) ? lista : [])
    } catch (err) {
      console.error('[Custos] recarregar:', err)
    }
  }

  // ---- Excluir rascunho (soft delete: marca cancelado=true) ----
  async function excluirRascunho(c: CustoAPI) {
    if (!window.confirm(`Excluir o rascunho "${c.descricao}"?\n\nEsta ação não pode ser desfeita.`)) {
      return
    }
    setExcluindoId(c.id)
    try {
      const res = await fetch(`/api/financeiro/custos/${c.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data?.error || `Falha ao excluir (HTTP ${res.status}).`)
        return
      }
      await recarregar()
      onUpdate?.()
    } catch (err) {
      console.error('[Custos] excluir:', err)
      alert('Erro de conexão ao excluir.')
    } finally {
      setExcluindoId(null)
    }
  }

  // ---- Separação por status (custos cancelados somem) ----
  const custosVisiveis = useMemo(
    () => custos.filter((c) => !c.cancelado),
    [custos],
  )

  const custosAtivos = useMemo(
    () => custosVisiveis.filter((c) => (c.status ?? 'ATIVA') === 'ATIVA'),
    [custosVisiveis],
  )
  const custosRascunho = useMemo(
    () => custosVisiveis.filter((c) => c.status === 'RASCUNHO'),
    [custosVisiveis],
  )

  // ---- KPIs (sempre sobre ATIVOS, em BRL como denominador comum) ----
  const kpis = useMemo(() => {
    let totalBrl = 0
    let pagoBrl = 0
    let pendenteBrl = 0
    let atrasadoBrl = 0
    let qtdAtrasadas = 0
    custosAtivos.forEach((c) => {
      const cx = cambioEfetivo(c)
      c.parcelas?.forEach((p) => {
        const v = num(p.valor)
        const vBrl = num(p.valorBrl) || v * cx
        totalBrl += vBrl
        if (p.status === 'PAGA' || p.status === 'RECEBIDA') {
          pagoBrl += num(p.valorBrl) || v * (num(p.cambioAplicado) || cx)
        } else if (p.status === 'PENDENTE') {
          pendenteBrl += vBrl
          if (isVencida(p)) {
            atrasadoBrl += vBrl
            qtdAtrasadas++
          }
        }
      })
    })
    return {
      totalBrl,
      pagoBrl,
      pendenteBrl,
      atrasadoBrl,
      qtdAtrasadas,
    }
  }, [custosAtivos])

  // ---- Filtro aplicado ----
  const custosExibidos = useMemo(() => {
    if (filtro === 'rascunhos') return custosRascunho
    if (filtro === 'todos') return custosAtivos
    if (filtro === 'pagos') {
      return custosAtivos.filter((c) => {
        const tot = c.parcelas?.length || 0
        const pg = c.parcelas?.filter(
          (p) => p.status === 'PAGA' || p.status === 'RECEBIDA',
        ).length
        return tot > 0 && pg === tot
      })
    }
    return custosAtivos.filter((c) =>
      c.parcelas?.some((p) => p.status === 'PENDENTE'),
    )
  }, [custosAtivos, custosRascunho, filtro])

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

  if (view.kind === 'editar') {
    return (
      <NovoCustoPaginaAny
        processoId={processoId}
        fxHoje={fxHoje}
        custoInicial={view.custo}
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

        {/* KPIs (BRL como denominador comum entre moedas) */}
        <div className="grid-4">
          <div className="kpi">
            <div className="kpi-label">📉 Total Previsto</div>
            <div className="kpi-value">{fmtBRL(kpis.totalBrl)}</div>
            <div className="kpi-sub">
              {custosAtivos.length} {custosAtivos.length === 1 ? 'custo' : 'custos'}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">✓ Pago</div>
            <div className="kpi-value pos">{fmtBRL(kpis.pagoBrl)}</div>
            <div className="kpi-sub pos">já pago</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">⏳ A Pagar</div>
            <div className="kpi-value">{fmtBRL(kpis.pendenteBrl)}</div>
            <div className="kpi-sub">pendente</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">⚠ Atrasado</div>
            <div className="kpi-value neg">
              {kpis.qtdAtrasadas} {kpis.qtdAtrasadas === 1 ? 'parc.' : 'parc.'}
            </div>
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
            Todos{' '}
            <span style={{ opacity: 0.6, marginLeft: 6 }}>
              ({custosAtivos.length})
            </span>
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
          <button
            type="button"
            className={`filter-tab ${filtro === 'rascunhos' ? 'active' : ''}`}
            onClick={() => setFiltro('rascunhos')}
          >
            📝 Rascunhos{' '}
            <span style={{ opacity: 0.6, marginLeft: 6 }}>
              ({custosRascunho.length})
            </span>
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
          ) : custosExibidos.length === 0 &&
            custosAtivos.length === 0 &&
            custosRascunho.length === 0 ? (
            <div className="empty-state">
              Nenhum custo cadastrado. Clique em <strong>+ Novo Custo</strong> para começar.
            </div>
          ) : custosExibidos.length === 0 ? (
            <div className="empty-state">
              {filtro === 'rascunhos'
                ? 'Nenhum rascunho salvo.'
                : 'Nenhum custo corresponde ao filtro.'}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>Descrição</th>
                  <th>Tipo / Categoria</th>
                  <th>Fornecedor</th>
                  <th>Total (orig.)</th>
                  <th>Total (BRL)</th>
                  <th>Câmbio</th>
                  <th>Parcelas</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {custosExibidos.map((c) => {
                  const cx = cambioEfetivo(c)
                  const totOrig = num(c.valor)
                  const totBrl = totOrig * cx
                  let pgCount = 0
                  c.parcelas?.forEach((p) => {
                    if (p.status === 'PAGA' || p.status === 'RECEBIDA') pgCount++
                  })
                  const totParc = c.parcelas?.length || 0
                  const isQuit = totParc > 0 && pgCount === totParc
                  const temAtraso = c.parcelas?.some(isVencida)
                  const isRascunho = c.status === 'RASCUNHO'
                  const sendoExcluido = excluindoId === c.id

                  let statusBadge: React.ReactNode
                  if (isRascunho)
                    statusBadge = (
                      <span
                        className="badge"
                        style={{ background: '#f1f5f9', color: '#475569' }}
                      >
                        📝 Rascunho
                      </span>
                    )
                  else if (isQuit)
                    statusBadge = <span className="badge badge-recebida">Pago</span>
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
                    <tr
                      key={c.id}
                      style={
                        isRascunho || sendoExcluido
                          ? { opacity: sendoExcluido ? 0.4 : 0.7 }
                          : undefined
                      }
                    >
                      <td>{isRascunho ? '📝' : '📋'}</td>
                      <td>
                        <strong>{c.descricao}</strong>
                        <span className="muted-xs">{c.codigo}</span>
                      </td>
                      <td>
                        {TIPO_LABEL[c.tipo]}
                        <span className="muted-xs">{CAT_LABEL[c.categoria]}</span>
                      </td>
                      <td>{c.fornecedor || <span className="muted">—</span>}</td>
                      <td>{fmtMoeda(totOrig, c.moeda)}</td>
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
                        {isRascunho ? (
                          <div style={{ display: 'flex', gap: 12, whiteSpace: 'nowrap' }}>
                            <button
                              type="button"
                              className="btn-link-sm"
                              onClick={() => setView({ kind: 'editar', custo: c })}
                              disabled={sendoExcluido}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn-link-sm"
                              style={{ color: '#dc2626' }}
                              onClick={() => excluirRascunho(c)}
                              disabled={sendoExcluido}
                            >
                              {sendoExcluido ? 'Excluindo...' : 'Excluir'}
                            </button>
                          </div>
                        ) : proximaPendente ? (
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