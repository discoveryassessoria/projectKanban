// src/components/financeiro/paginas/DetalhesCustoPagina.tsx
//
// 🆕 Página de detalhes do custo — análoga à DetalhesReceitaPagina.
//
// Diferenças vs. receita:
//   - Não tem requerentes (custo não é dividido por pessoa)
//   - Tem tipo (SERVICO/IMPOSTO/DOCUMENTO/DESPESA) + categoria + fornecedor
//   - Usa `vencimento` (1ª parcela) em vez de `data1`
//   - Tem flags: custoOperacional, categoriaVinculada, percentualVinculado
//   - Parcelas pagas têm status PAGA (no schema é compartilhado, mas
//     convencionalmente 'PAGA' pra custos)
//   - Sidebar: "Situação do Pagamento" (em vez de "Recebimento")

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
type TipoCusto = 'SERVICO' | 'IMPOSTO' | 'DOCUMENTO' | 'DESPESA'
type CategoriaCusto =
  | 'TRADUCOES_JURAMENTACOES'
  | 'APOSTILAMENTOS'
  | 'HONORARIOS_ESCRITORIO'
  | 'TAXAS_CONSULARES'
  | 'OUTROS'
type CategoriaReceita =
  | 'HONORARIOS'
  | 'REEMBOLSO'
  | 'PASTA_DOCUMENTAL'
  | 'OUTROS'
type CustoStatus = 'ATIVA' | 'RASCUNHO' | 'CANCELADA'
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
  formaPagamento?: string | null
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
  status?: CustoStatus
  cancelado?: boolean
  custoOperacional?: boolean
  categoriaVinculada?: string | null
  percentualVinculado?: number | string | null
  formaPagamento?: string | null
  observacoes?: string | null
  parcelas: ParcelaAPI[]
}

export interface DetalhesCustoPaginaProps {
  custo: CustoAPI
  fxHoje?: number
  onVoltar: () => void
  onEditar: (custo: CustoAPI) => void
  onLancarParcela: (parcela: ParcelaLancavel, entidade: EntidadeLancavel) => void
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
const CAT_RECEITA_LABEL: Record<CategoriaReceita, string> = {
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

function cambioEfetivo(c: CustoAPI): number {
  if (c.moeda === 'BRL') return 1
  if (c.fxRule === 'FIXO' && c.fxFixo) return num(c.fxFixo)
  return num(c.fxEstimado) || 1
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

export function DetalhesCustoPagina({
  custo,
  fxHoje,
  onVoltar,
  onEditar,
  onLancarParcela,
  onExcluido,
}: DetalhesCustoPaginaProps) {
  const [excluindo, setExcluindo] = useState(false)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  const cx = cambioEfetivo(custo)
  const valorTotal = num(custo.valor)
  const valorTotalBrl = valorTotal * cx

  // ---- Agregações ----
  const agg = useMemo(() => {
    let pago = 0
    let pagoBrl = 0
    let pendente = 0
    let pendenteBrl = 0
    let pgCount = 0
    let pendCount = 0
    let atrasadasCount = 0
    let proximaPendente: ParcelaAPI | null = null
    for (const p of custo.parcelas || []) {
      const v = num(p.valor)
      if (p.status === 'PAGA' || p.status === 'RECEBIDA') {
        pago += v
        pagoBrl += num(p.valorBrl) || v * (num(p.cambioAplicado) || cx)
        pgCount++
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
    const total = custo.parcelas?.length || 0
    const pct = total > 0 ? (pgCount / total) * 100 : 0
    return {
      pago,
      pagoBrl,
      pendente,
      pendenteBrl,
      pgCount,
      pendCount,
      atrasadasCount,
      total,
      pct,
      proximaPendente,
      isQuit: total > 0 && pgCount === total,
    }
  }, [custo.parcelas, cx])

  // ---- Excluir ----
  async function handleExcluir() {
    const tinhaPaga = (custo.parcelas || []).some(
      (p) => p.status === 'PAGA' || p.status === 'RECEBIDA',
    )
    const aviso = tinhaPaga
      ? '\n\n⚠ ATENÇÃO: este custo tem parcelas já pagas. O cancelamento NÃO estorna os pagamentos — eles continuam contabilizados no histórico, mas o custo some da lista ativa.'
      : ''
    if (
      !window.confirm(
        `Cancelar o custo "${custo.descricao}" (${custo.codigo})?${aviso}\n\nEsta ação não pode ser desfeita.`,
      )
    ) {
      return
    }
    setExcluindo(true)
    setErroAcao(null)
    try {
      const res = await fetch(`/api/financeiro/custos/${custo.id}`, {
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
      console.error('[DetalhesCustoPagina] excluir:', err)
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
        tipo: 'custo',
        descricao: custo.descricao,
        fornecedor: custo.fornecedor,
        moeda: custo.moeda,
        fxRule: custo.fxRule,
        fxFixo: custo.fxFixo != null ? num(custo.fxFixo) : null,
        fxEstimado: num(custo.fxEstimado) || 1,
        totalParcelas: custo.nParcelas,
      },
    )
  }

  function badgeParcela(p: ParcelaAPI): React.ReactNode {
    if (p.status === 'PAGA' || p.status === 'RECEBIDA')
      return <span className="badge badge-recebida">Paga</span>
    if (p.status === 'CANCELADA')
      return <span className="badge badge-pendente">Cancelada</span>
    if (isVencida(p))
      return <span className="badge badge-atrasada">Atrasada</span>
    return <span className="badge badge-pendente">A pagar</span>
  }

  const fxBadge =
    custo.moeda === 'BRL' ? null : custo.fxRule === 'FIXO' ? (
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
          Custos
        </a>
        <span className="breadcrumb-sep">›</span>
        <span>Detalhes</span>
      </div>

      {/* ============ Header ============ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{custo.descricao}</h1>
          <div className="page-subtitle">
            {TIPO_LABEL[custo.tipo]} · {CAT_LABEL[custo.categoria]} ·{' '}
            {custo.codigo}
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
          📑 Gerar Comprovante
        </button>
        <button
          type="button"
          className="btn-outline"
          onClick={() => onEditar(custo)}
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

      {custo.status === 'RASCUNHO' && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <i className="alert-icon">📝</i>
          <span>
            <strong>Este é um custo em rascunho.</strong> As parcelas só são
            geradas quando ele for promovido pra ativo.
          </span>
        </div>
      )}

      {/* ============ Layout: principal + sidebar ============ */}
      <div className="detail-layout">
        <div>
          {/* ---- Card Regra de Câmbio ---- */}
          {custo.moeda !== 'BRL' && (
            <div
              className={`fx-rule-box ${custo.fxRule === 'FIXO' ? 'fixo' : 'variavel'}`}
              style={{ marginBottom: 16 }}
            >
              <div className="fx-rule-box-head">
                <div className="fx-rule-box-title">📑 Regra de câmbio</div>
                {fxBadge}
              </div>
              <div className="fx-rule-box-info">
                {custo.fxRule === 'FIXO' && custo.fxFixo ? (
                  <>
                    Câmbio fixado: {custo.moeda === 'EUR' ? '€' : 'US$'}1 ={' '}
                    {fmtBRL(num(custo.fxFixo))}
                    {custo.fxData ? <> · Fixado em {fmtDate(custo.fxData)}</> : null}
                  </>
                ) : (
                  <>
                    Câmbio estimado: {custo.moeda === 'EUR' ? '€' : 'US$'}1 ={' '}
                    {fmtBRL(num(custo.fxEstimado))}
                    <br />
                    Valores reais a cada pagamento.
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

          {/* ---- Dados do custo (tipo, fornecedor, vínculo) ---- */}
          <div className="form-card">
            <div className="form-card-title">📋 Dados do custo</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 12,
                fontSize: 13,
              }}
            >
              <div className="resumo-row" style={{ borderBottom: 'none' }}>
                <span>Tipo</span>
                <strong>{TIPO_LABEL[custo.tipo]}</strong>
              </div>
              <div className="resumo-row" style={{ borderBottom: 'none' }}>
                <span>Categoria</span>
                <strong>{CAT_LABEL[custo.categoria]}</strong>
              </div>
              <div className="resumo-row" style={{ borderBottom: 'none' }}>
                <span>Fornecedor</span>
                <strong>{custo.fornecedor || '—'}</strong>
              </div>
              <div className="resumo-row" style={{ borderBottom: 'none' }}>
                <span>Custo operacional?</span>
                <strong>{custo.custoOperacional ? 'Sim' : 'Não'}</strong>
              </div>
              {custo.categoriaVinculada && (
                <>
                  <div className="resumo-row" style={{ borderBottom: 'none' }}>
                    <span>Vinculado à receita</span>
                    <strong>
                      {CAT_RECEITA_LABEL[custo.categoriaVinculada as CategoriaReceita] || custo.categoriaVinculada}
                    </strong>
                  </div>
                  <div className="resumo-row" style={{ borderBottom: 'none' }}>
                    <span>Percentual vinculado</span>
                    <strong>
                      {custo.percentualVinculado != null
                        ? `${num(custo.percentualVinculado).toFixed(2)}%`
                        : '—'}
                    </strong>
                  </div>
                </>
              )}
              {custo.formaPagamento && (
                <div className="resumo-row" style={{ borderBottom: 'none' }}>
                  <span>Forma padrão de pagamento</span>
                  <strong>{FORMA_LABEL[custo.formaPagamento as FormaPagamento] || custo.formaPagamento}</strong>
                </div>
              )}
            </div>
          </div>

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
                {fmtMoeda(valorTotal, custo.moeda)}
              </div>
              {custo.moeda !== 'BRL' && (
                <div className="kpi-sub">
                  {fmtBRL(valorTotalBrl)}
                  {custo.fxRule === 'VARIAVEL' && ' (est.)'}
                </div>
              )}
            </div>
            <div className="kpi">
              <div className="kpi-label">PAGO</div>
              <div className="kpi-value pos">
                {fmtMoeda(agg.pago, custo.moeda)}
              </div>
              {custo.moeda !== 'BRL' && (
                <div className="kpi-sub pos">{fmtBRL(agg.pagoBrl)}</div>
              )}
            </div>
            <div className="kpi">
              <div className="kpi-label">A PAGAR</div>
              <div className="kpi-value">
                {fmtMoeda(agg.pendente, custo.moeda)}
              </div>
              {custo.moeda !== 'BRL' && (
                <div className="kpi-sub">
                  {fmtBRL(agg.pendenteBrl)}
                  {custo.fxRule === 'VARIAVEL' && ' (est.)'}
                </div>
              )}
            </div>
          </div>

          {/* ---- Parcelas ---- */}
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
                {agg.pgCount} de {agg.total} pagas
              </span>
            </div>

            {(custo.parcelas || []).length === 0 ? (
              <div className="empty-state">
                Nenhuma parcela gerada ainda.
                {custo.status === 'RASCUNHO' &&
                  ' Promova o rascunho pra custo ativo pra gerar as parcelas.'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>Vencimento</th>
                      <th>Valor ({custo.moeda})</th>
                      <th>Câmbio aplicado</th>
                      <th>Valor (BRL)</th>
                      <th>Pagamento</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {custo.parcelas.map((p) => {
                      const v = num(p.valor)
                      const cxAplicado =
                        p.cambioAplicado != null ? num(p.cambioAplicado) : null
                      const vBrl =
                        p.valorBrl != null
                          ? num(p.valorBrl)
                          : v * (cxAplicado ?? cx)
                      const isPaga =
                        p.status === 'PAGA' || p.status === 'RECEBIDA'
                      const podeLancar = p.status === 'PENDENTE'
                      return (
                        <tr key={p.id}>
                          <td>{p.numero}</td>
                          <td>{fmtDate(p.vencimento)}</td>
                          <td>{fmtMoeda(v, custo.moeda)}</td>
                          <td>
                            {cxAplicado != null ? (
                              fmtFX(cxAplicado)
                            ) : custo.moeda === 'BRL' ? (
                              <span className="muted">—</span>
                            ) : (
                              <span className="muted">
                                {fmtFX(cx)}
                                <span className="muted-xs">(prev.)</span>
                              </span>
                            )}
                          </td>
                          <td className="brl">
                            {custo.moeda === 'BRL' ? (
                              fmtBRL(v)
                            ) : (
                              <>
                                {fmtBRL(vBrl)}
                                {!isPaga && custo.fxRule === 'VARIAVEL' && (
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
                                    {FORMA_LABEL[p.formaPagamento as FormaPagamento] || p.formaPagamento}
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

          {/* ---- Observações ---- */}
          {custo.observacoes && (
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
                {custo.observacoes}
              </div>
            </div>
          )}
        </div>

        {/* ============ Sidebar ============ */}
        <aside>
          <div className="sidebar-resumo">
            <div className="sidebar-resumo-title">
              Situação do Pagamento
            </div>
            <div className="resumo-row">
              <span>Status geral</span>
              <strong>
                {agg.isQuit ? (
                  <span style={{ color: 'var(--fpag-success-dark, #047857)' }}>
                    Pago
                  </span>
                ) : agg.atrasadasCount > 0 ? (
                  <span style={{ color: '#b91c1c' }}>Em atraso</span>
                ) : (
                  'A pagar'
                )}
              </strong>
            </div>
            <div className="resumo-row">
              <span>Parcelas pagas</span>
              <strong>
                {agg.pgCount}/{agg.total}
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
              <strong>{custo.moeda}</strong>
            </div>
            <div className="resumo-row">
              <span>Tipo</span>
              <strong>{TIPO_LABEL[custo.tipo]}</strong>
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
                    {agg.atrasadasCount === 1 ? 'parcela' : 'parcelas'} em
                    atraso.
                  </strong>
                  <br />
                  Considere registrar o pagamento ou renegociar o vencimento.
                </span>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

export default DetalhesCustoPagina