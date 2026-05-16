// src/components/financeiro/paginas/DetalhesReceitaPagina.tsx
//
// 🆕 Página de detalhes da receita — clone fiel da #page-detalhes-receita do
// html_final_marco.html. Substitui o "ver" inexistente do sistema atual.
//
// Estrutura (igual ao HTML):
//   - Breadcrumb: Financeiro › Receitas › Detalhes
//   - Header com título + tipo · código + botão "← Voltar"
//   - Action bar: Gerar Fatura | Gerar Recibo | Editar | Excluir
//   - Coluna principal:
//       Card "Regra de câmbio" (só se moeda !== BRL)
//       3 KPIs: Valor Total / Recebido / Pendente
//       Tabela de Parcelas (#, Vencimento, Valor orig, Câmbio aplicado, BRL, Status, Ação)
//   - Sidebar "Situação do Recebimento" (status geral, contagem de parcelas,
//     próximo vencimento, requerentes com %).
//
// Ações:
//   - Editar       → onEditar(receita)  (pai abre NovaReceitaPagina em modo edição)
//   - Excluir      → DELETE /api/financeiro/receitas/[id] (soft delete) + onExcluido()
//   - Lançar parc. → onLancarParcela(parc, entidade)  (pai abre LancarParcelaPagina)
//   - Gerar Fatura/Recibo → ainda não conectado; botões desabilitados.

'use client'

import { useState, useMemo } from 'react'
import type {
  ParcelaLancavel,
  EntidadeLancavel,
} from '@/src/components/financeiro/paginas/LancarParcelaPagina'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type StatusParcela = 'PENDENTE' | 'RECEBIDA' | 'PAGA' | 'CANCELADA'
type CategoriaReceita =
  | 'HONORARIOS'
  | 'REEMBOLSO'
  | 'PASTA_DOCUMENTAL'
  | 'OUTROS'
type ReceitaStatus = 'ATIVA' | 'RASCUNHO' | 'CANCELADA'
type FormaPagamento =
  | 'PIX'
  | 'CARTAO_CREDITO'
  | 'CARTAO_DEBITO'
  | 'BOLETO'
  | 'TRANSFERENCIA'
  | 'DINHEIRO'
  | 'CHEQUE'
  | 'OUTRO'

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

interface ReceitaRequerenteAPI {
  id: number
  idx?: number
  requerenteId?: number | null
  percentual: number | string
  nome?: string
  statusFamiliar?: string | null
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
  fxData?: string | null
  nParcelas: number
  data1: string
  status?: ReceitaStatus
  cancelada?: boolean
  observacoes?: string | null
  parcelas: ParcelaAPI[]
  requerentes?: ReceitaRequerenteAPI[]
}

export interface DetalhesReceitaPaginaProps {
  receita: ReceitaAPI
  fxHoje?: number
  onVoltar: () => void
  onEditar: (receita: ReceitaAPI) => void
  onLancarParcela: (parcela: ParcelaLancavel, entidade: EntidadeLancavel) => void
  /** Disparado depois de excluir com sucesso — pai recarrega a lista e volta. */
  onExcluido: () => void
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

const FORMA_LABEL: Record<FormaPagamento, string> = {
  PIX: 'PIX',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferência',
  DINHEIRO: 'Dinheiro',
  CHEQUE: 'Cheque',
  OUTRO: 'Outro',
}

function cambioEfetivo(r: ReceitaAPI): number {
  if (r.moeda === 'BRL') return 1
  if (r.fxRule === 'FIXO' && r.fxFixo) return num(r.fxFixo)
  return num(r.fxEstimado) || 1
}

function isVencida(p: ParcelaAPI): boolean {
  if (p.status !== 'PENDENTE') return false
  if (!p.vencimento) return false
  const v = new Date(
    p.vencimento.includes('T') ? p.vencimento : p.vencimento + 'T00:00:00',
  )
  v.setHours(0, 0, 0, 0)
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return v.getTime() < hoje.getTime()
}

// ============================================================================
// Componente
// ============================================================================

export function DetalhesReceitaPagina({
  receita,
  fxHoje,
  onVoltar,
  onEditar,
  onLancarParcela,
  onExcluido,
}: DetalhesReceitaPaginaProps) {
  const [excluindo, setExcluindo] = useState(false)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  const cx = cambioEfetivo(receita)
  const valorTotal = num(receita.valor)
  const valorTotalBrl = valorTotal * cx

  // ---- Agregações sobre parcelas ----
  const agg = useMemo(() => {
    let recebido = 0
    let recebidoBrl = 0
    let pendente = 0
    let pendenteBrl = 0
    let recCount = 0
    let pendCount = 0
    let atrasadasCount = 0
    let proximaPendente: ParcelaAPI | null = null

    for (const p of receita.parcelas || []) {
      const v = num(p.valor)
      if (p.status === 'RECEBIDA' || p.status === 'PAGA') {
        recebido += v
        recebidoBrl += num(p.valorBrl) || v * (num(p.cambioAplicado) || cx)
        recCount++
      } else if (p.status === 'PENDENTE') {
        pendente += v
        pendenteBrl += v * cx
        pendCount++
        if (isVencida(p)) atrasadasCount++
        if (
          !proximaPendente ||
          new Date(p.vencimento) < new Date(proximaPendente.vencimento)
        ) {
          proximaPendente = p
        }
      }
    }
    const total = receita.parcelas?.length || 0
    const pct = total > 0 ? (recCount / total) * 100 : 0
    return {
      recebido,
      recebidoBrl,
      pendente,
      pendenteBrl,
      recCount,
      pendCount,
      atrasadasCount,
      total,
      pct,
      proximaPendente,
      isQuit: total > 0 && recCount === total,
    }
  }, [receita.parcelas, cx])

  // ---- Action bar handlers ----
  async function handleExcluir() {
    const tinhaPaga = (receita.parcelas || []).some(
      (p) => p.status === 'RECEBIDA' || p.status === 'PAGA',
    )
    const aviso = tinhaPaga
      ? '\n\n⚠ ATENÇÃO: esta receita tem parcelas já recebidas. O cancelamento NÃO estorna os pagamentos — eles continuam contabilizados no histórico, mas a receita some da lista ativa.'
      : ''
    if (
      !window.confirm(
        `Cancelar a receita "${receita.descricao}" (${receita.codigo})?${aviso}\n\nEsta ação não pode ser desfeita.`,
      )
    ) {
      return
    }
    setExcluindo(true)
    setErroAcao(null)
    try {
      const res = await fetch(`/api/financeiro/receitas/${receita.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErroAcao(data?.error || `Falha ao excluir (HTTP ${res.status}).`)
        return
      }
      onExcluido()
    } catch (err) {
      console.error('[DetalhesReceitaPagina] excluir:', err)
      setErroAcao('Erro de conexão ao excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  function lancarParcela(p: ParcelaAPI) {
    onLancarParcela(
      {
        id: p.id,
        numero: p.numero,
        valor: num(p.valor),
        vencimento: p.vencimento,
      },
      {
        tipo: 'receita',
        descricao: receita.descricao,
        moeda: receita.moeda,
        fxRule: receita.fxRule,
        fxFixo: receita.fxFixo != null ? num(receita.fxFixo) : null,
        fxEstimado: num(receita.fxEstimado) || 1,
        totalParcelas: receita.nParcelas,
      },
    )
  }

  // ---- Render auxiliar: badge de status da parcela ----
  function badgeParcela(p: ParcelaAPI): React.ReactNode {
    if (p.status === 'RECEBIDA' || p.status === 'PAGA')
      return <span className="badge badge-recebida">Recebida</span>
    if (p.status === 'CANCELADA')
      return <span className="badge badge-pendente">Cancelada</span>
    if (isVencida(p))
      return <span className="badge badge-atrasada">Atrasada</span>
    return <span className="badge badge-pendente">Em aberto</span>
  }

  const fxBadge =
    receita.moeda === 'BRL' ? null : receita.fxRule === 'FIXO' ? (
      <span className="badge badge-fx-fixo">CÂMBIO FIXO</span>
    ) : (
      <span className="badge badge-fx-var">CÂMBIO VARIÁVEL</span>
    )

  return (
    <div className="fpag-page">
      {/* ============ Breadcrumb ============ */}
      <div className="breadcrumb">
        <a onClick={onVoltar} style={{ cursor: 'pointer' }}>
          Financeiro
        </a>
        <span className="breadcrumb-sep">›</span>
        <a onClick={onVoltar} style={{ cursor: 'pointer' }}>
          Receitas
        </a>
        <span className="breadcrumb-sep">›</span>
        <span>Detalhes</span>
      </div>

      {/* ============ Header ============ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{receita.descricao}</h1>
          <div className="page-subtitle">
            {CATEGORIA_LABEL[receita.categoria]} · {receita.codigo}
          </div>
        </div>
        <button type="button" className="btn-outline" onClick={onVoltar}>
          ← Voltar
        </button>
      </div>

      {/* ============ Action bar ============ */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 20,
        }}
      >
        <button
          type="button"
          className="btn-outline"
          disabled
          title="Em desenvolvimento"
          style={{ opacity: 0.5, cursor: 'not-allowed' }}
        >
          📋 Gerar Fatura
        </button>
        <button
          type="button"
          className="btn-outline"
          disabled
          title="Em desenvolvimento"
          style={{ opacity: 0.5, cursor: 'not-allowed' }}
        >
          📑 Gerar Recibo
        </button>
        <button
          type="button"
          className="btn-outline"
          onClick={() => onEditar(receita)}
          disabled={excluindo}
        >
          ✏ Editar
        </button>
        <button
          type="button"
          className="btn-outline"
          style={{ color: '#dc2626', borderColor: '#fecaca' }}
          onClick={handleExcluir}
          disabled={excluindo}
        >
          {excluindo ? 'Excluindo...' : '🗑 Excluir'}
        </button>
      </div>

      {erroAcao && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <i className="alert-icon">⚠</i>
          <span>{erroAcao}</span>
        </div>
      )}

      {receita.status === 'RASCUNHO' && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <i className="alert-icon">📝</i>
          <span>
            <strong>Esta é uma receita em rascunho.</strong> As parcelas só são
            geradas quando ela for promovida pra ativa.
          </span>
        </div>
      )}

      {/* ============ Layout: principal + sidebar ============ */}
      <div className="detail-layout">
        <div>
          {/* ---- Card Regra de Câmbio (só se moeda !== BRL) ---- */}
          {receita.moeda !== 'BRL' && (
            <div
              className={`fx-rule-box ${receita.fxRule === 'FIXO' ? 'fixo' : 'variavel'}`}
              style={{ marginBottom: 16 }}
            >
              <div className="fx-rule-box-head">
                <div className="fx-rule-box-title">📑 Regra de câmbio</div>
                {fxBadge}
              </div>
              <div className="fx-rule-box-info">
                {receita.fxRule === 'FIXO' && receita.fxFixo ? (
                  <>
                    Câmbio fixado: {receita.moeda === 'EUR' ? '€' : 'US$'}1 ={' '}
                    {fmtBRL(num(receita.fxFixo))}
                    {receita.fxData ? (
                      <>
                        {' '}
                        · Fixado em {fmtDate(receita.fxData)}
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    Câmbio estimado: {receita.moeda === 'EUR' ? '€' : 'US$'}1 ={' '}
                    {fmtBRL(num(receita.fxEstimado))}
                    <br />
                    Valores reais a cada recebimento.
                  </>
                )}
              </div>
              <div
                style={{
                  marginTop: 12,
                  height: 6,
                  background: 'var(--fpag-gray-100, #f1f5f9)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${agg.pct}%`,
                    height: '100%',
                    background: 'var(--fpag-success, #10b981)',
                    transition: 'width .3s',
                  }}
                />
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  color: 'var(--fpag-gray-600, #475569)',
                  textAlign: 'right',
                }}
              >
                {agg.pct.toFixed(1)}%
              </div>
            </div>
          )}

          {/* ---- KPIs ---- */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div className="kpi">
              <div className="kpi-label">VALOR TOTAL</div>
              <div className="kpi-value">
                {fmtMoeda(valorTotal, receita.moeda)}
              </div>
              {receita.moeda !== 'BRL' && (
                <div className="kpi-sub">
                  {fmtBRL(valorTotalBrl)}
                  {receita.fxRule === 'VARIAVEL' && ' (est.)'}
                </div>
              )}
            </div>
            <div className="kpi">
              <div className="kpi-label">RECEBIDO</div>
              <div className="kpi-value pos">
                {fmtMoeda(agg.recebido, receita.moeda)}
              </div>
              {receita.moeda !== 'BRL' && (
                <div className="kpi-sub pos">{fmtBRL(agg.recebidoBrl)}</div>
              )}
            </div>
            <div className="kpi">
              <div className="kpi-label">PENDENTE</div>
              <div className="kpi-value">
                {fmtMoeda(agg.pendente, receita.moeda)}
              </div>
              {receita.moeda !== 'BRL' && (
                <div className="kpi-sub">
                  {fmtBRL(agg.pendenteBrl)}
                  {receita.fxRule === 'VARIAVEL' && ' (est.)'}
                </div>
              )}
            </div>
          </div>

          {/* ---- Tabela de Parcelas ---- */}
          <div className="form-card">
            <div
              className="form-card-title"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>📋 Parcelas</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--fpag-gray-600, #475569)',
                }}
              >
                {agg.recCount} de {agg.total} recebidas
              </span>
            </div>

            {(receita.parcelas || []).length === 0 ? (
              <div className="empty-state">
                Nenhuma parcela gerada ainda.
                {receita.status === 'RASCUNHO' &&
                  ' Promova o rascunho pra receita ativa pra gerar as parcelas.'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>Vencimento</th>
                      <th>Valor ({receita.moeda})</th>
                      <th>Câmbio aplicado</th>
                      <th>Valor (BRL)</th>
                      <th>Pagamento</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {receita.parcelas.map((p) => {
                      const v = num(p.valor)
                      const cxAplicado =
                        p.cambioAplicado != null ? num(p.cambioAplicado) : null
                      const vBrl =
                        p.valorBrl != null
                          ? num(p.valorBrl)
                          : v * (cxAplicado ?? cx)
                      const isPaga =
                        p.status === 'RECEBIDA' || p.status === 'PAGA'
                      const podeLancar = p.status === 'PENDENTE'
                      return (
                        <tr key={p.id}>
                          <td>{p.numero}</td>
                          <td>{fmtDate(p.vencimento)}</td>
                          <td>{fmtMoeda(v, receita.moeda)}</td>
                          <td>
                            {cxAplicado != null ? (
                              fmtFX(cxAplicado)
                            ) : receita.moeda === 'BRL' ? (
                              <span className="muted">—</span>
                            ) : (
                              <span className="muted">
                                {fmtFX(cx)}
                                <span className="muted-xs">(prev.)</span>
                              </span>
                            )}
                          </td>
                          <td className="brl">
                            {receita.moeda === 'BRL' ? (
                              fmtBRL(v)
                            ) : (
                              <>
                                {fmtBRL(vBrl)}
                                {!isPaga && receita.fxRule === 'VARIAVEL' && (
                                  <span className="muted-xs">(est.)</span>
                                )}
                              </>
                            )}
                          </td>
                          <td>
                            {p.dataPagamento ? (
                              <>
                                {fmtDate(p.dataPagamento)}
                                {p.formaPagamento && (
                                  <span className="muted-xs">
                                    {FORMA_LABEL[p.formaPagamento]}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>{badgeParcela(p)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {podeLancar ? (
                              <button
                                type="button"
                                className="btn-link-sm"
                                onClick={() => lancarParcela(p)}
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
              </div>
            )}
          </div>

          {/* ---- Requerentes (se houver) ---- */}
          {receita.requerentes && receita.requerentes.length > 0 && (
            <div className="form-card">
              <div className="form-card-title">👥 Requerentes</div>
              <table style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Percentual</th>
                    <th style={{ textAlign: 'right' }}>
                      Valor ({receita.moeda})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {receita.requerentes.map((r) => {
                    const pct = num(r.percentual)
                    const vReq = (valorTotal * pct) / 100
                    return (
                      <tr key={r.id}>
                        <td>
                          {r.requerente?.nome || r.nome || 'Requerente'}
                        </td>
                        <td>
                          {r.statusFamiliar === 'Menor' ? (
                            <span className="badge badge-pendente">Menor</span>
                          ) : (
                            <span className="badge badge-fx-fixo-sm">
                              Adulto
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {pct.toFixed(2)}%
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {fmtMoeda(vReq, receita.moeda)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ---- Observações ---- */}
          {receita.observacoes && (
            <div className="form-card">
              <div className="form-card-title">📝 Observações</div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--fpag-gray-700, #334155)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5,
                }}
              >
                {receita.observacoes}
              </div>
            </div>
          )}
        </div>

        {/* ============ Sidebar ============ */}
        <aside>
          <div className="sidebar-resumo">
            <div className="sidebar-resumo-title">
              Situação do Recebimento
            </div>
            <div className="resumo-row">
              <span>Status geral</span>
              <strong>
                {agg.isQuit ? (
                  <span style={{ color: 'var(--fpag-success-dark, #047857)' }}>
                    Quitada
                  </span>
                ) : agg.atrasadasCount > 0 ? (
                  <span style={{ color: '#b91c1c' }}>Em atraso</span>
                ) : (
                  'Em aberto'
                )}
              </strong>
            </div>
            <div className="resumo-row">
              <span>Parcelas recebidas</span>
              <strong>
                {agg.recCount}/{agg.total}
              </strong>
            </div>
            <div className="resumo-row">
              <span>Parcelas pendentes</span>
              <strong>{agg.pendCount}</strong>
            </div>
            {agg.atrasadasCount > 0 && (
              <div className="resumo-row">
                <span>Parcelas atrasadas</span>
                <strong style={{ color: '#b91c1c' }}>
                  {agg.atrasadasCount}
                </strong>
              </div>
            )}
            {agg.proximaPendente && (
              <div className="resumo-row">
                <span>Próximo vencimento</span>
                <strong>{fmtDate(agg.proximaPendente.vencimento)}</strong>
              </div>
            )}
            <div className="resumo-row">
              <span>Moeda</span>
              <strong>{receita.moeda}</strong>
            </div>
            <div className="resumo-row">
              <span>Tipo</span>
              <strong>{CATEGORIA_LABEL[receita.categoria]}</strong>
            </div>

            {agg.atrasadasCount > 0 && (
              <div
                className="alert alert-warning mb-0"
                style={{ marginTop: 14 }}
              >
                <i className="alert-icon">⚠</i>
                <span>
                  <strong>
                    {agg.atrasadasCount}{' '}
                    {agg.atrasadasCount === 1 ? 'parcela' : 'parcelas'}{' '}
                    atrasada{agg.atrasadasCount === 1 ? '' : 's'}.
                  </strong>
                  <br />
                  Considere registrar uma cobrança ou lançar o pagamento.
                </span>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

export default DetalhesReceitaPagina