// src/components/financeiro/paginas/LancarParcelaPagina.tsx
//
// 🆕 Fase 3 v2 — Clone FIEL de #page-lancar-recebimento e #page-lancar-pagamento.
//
// Um único componente parametrizado por `tipo: 'receita' | 'custo'`.
// Substitui o LancarParcelaModal v1.

'use client'

import { useState, useEffect } from 'react'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type FormaLabel = 'Transferência bancária' | 'PIX' | 'Boleto' | 'Cartão'

const FORMA_TO_ENUM: Record<FormaLabel, string> = {
  'Transferência bancária': 'TRANSFERENCIA',
  'PIX': 'PIX',
  'Boleto': 'BOLETO',
  'Cartão': 'CARTAO_CREDITO',
}

export interface ParcelaLancavel {
  id: number
  numero: number
  valor: number
  vencimento: string
}

export interface EntidadeLancavel {
  tipo: 'receita' | 'custo'
  descricao: string
  fornecedor?: string | null
  moeda: Moeda
  fxRule: FxRule
  fxFixo: number | null
  fxEstimado: number
  totalParcelas?: number
}

export interface LancarParcelaPaginaProps {
  parcela: ParcelaLancavel
  entidade: EntidadeLancavel
  fxHoje: number
  onVoltar: () => void
  onLancado: (resposta: unknown) => void
}

// ============================================================================
// Helpers
// ============================================================================

function parseFloatBR(s: string): number {
  if (!s) return 0
  const limpo = String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(limpo)
  return isFinite(n) ? n : 0
}
function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtMoeda(v: number, m: Moeda): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: m })
}
function moedaSimbolo(m: Moeda): string {
  return m === 'BRL' ? 'R$' : m === 'EUR' ? '€' : 'US$'
}
function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00')
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

// ============================================================================
// Componente
// ============================================================================

export function LancarParcelaPagina({
  parcela,
  entidade,
  fxHoje,
  onVoltar,
  onLancado,
}: LancarParcelaPaginaProps) {
  const ehReceita = entidade.tipo === 'receita'
  const labelAcao = ehReceita ? 'Recebimento' : 'Pagamento'
  const labelEntidade = ehReceita ? 'Receita' : 'Custo'
  const tabAlvo = ehReceita ? 'Receitas' : 'Custos'

  const [valorPago, setValorPago] = useState(parcela.valor.toFixed(2).replace('.', ','))
  const [cambio, setCambio] = useState(() => {
    if (entidade.moeda === 'BRL') return '1,00'
    if (entidade.fxRule === 'FIXO' && entidade.fxFixo)
      return entidade.fxFixo.toFixed(4).replace('.', ',')
    return (entidade.fxEstimado || fxHoje).toFixed(4).replace('.', ',')
  })
  const [data, setData] = useState(todayISO())
  const [forma, setForma] = useState<FormaLabel>('Transferência bancária')
  const [banco, setBanco] = useState('')
  const [obs, setObs] = useState('')

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // ---- Computed ----
  const valorPagoNum = parseFloatBR(valorPago) || parcela.valor
  const cambioNum = parseFloatBR(cambio) || 0
  const valorBrl = valorPagoNum * cambioNum
  const fxRefForImpacto =
    entidade.fxRule === 'FIXO' && entidade.fxFixo
      ? entidade.fxFixo
      : entidade.fxEstimado
  const valorBrlReferencia = valorPagoNum * fxRefForImpacto
  const diff = valorBrl - valorBrlReferencia

  // Mostra impacto cambial apenas em VARIAVEL (= câmbio realmente flutua entre lançamentos)
  const showImpacto =
    entidade.moeda !== 'BRL' && entidade.fxRule === 'VARIAVEL' && cambioNum > 0

  // ---- Submit ----
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)

    if (entidade.moeda !== 'BRL' && cambioNum <= 0) {
      setErro('Câmbio aplicado deve ser maior que zero.')
      return
    }
    if (!data) {
      setErro(`Data do ${labelAcao.toLowerCase()} é obrigatória.`)
      return
    }

    setSalvando(true)
    try {
      const body = {
        // Schema atual da API NÃO aceita `valor` — o valor da parcela é fixo.
        // Se o backend for atualizado pra aceitar pagamento parcial, basta
        // adicionar `valor: valorPagoNum` aqui.
        cambioAplicado: entidade.moeda === 'BRL' ? 1 : cambioNum,
        dataPagamento: data,
        formaPagamento: FORMA_TO_ENUM[forma],
        banco: banco.trim() || null,
        observacoes: obs.trim() || null,
      }
      const res = await fetch(`/api/financeiro/parcelas/${parcela.id}/lancamento`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg =
          data?.error ||
          data?.details?.issues?.[0]?.message ||
          `Erro ${res.status}: falha ao registrar ${labelAcao.toLowerCase()}.`
        setErro(msg)
        return
      }
      const resposta = await res.json()
      onLancado(resposta)
    } catch (err) {
      console.error('[LancarParcelaPagina] erro:', err)
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fpag-page">
      <div className="breadcrumb">
        <a onClick={onVoltar}>Financeiro</a>
        <span className="breadcrumb-sep">›</span>
        <a onClick={onVoltar}>{tabAlvo}</a>
        <span className="breadcrumb-sep">›</span>
        <span>Lançar {labelAcao}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Lançar {labelAcao}</h1>
          <div className="page-subtitle">
            {labelEntidade}: <strong>{entidade.descricao}</strong>
            {!ehReceita && entidade.fornecedor && (
              <>
                {' • '}
                <span>{entidade.fornecedor}</span>
              </>
            )}
          </div>
        </div>
        <button type="button" className="btn-outline" onClick={onVoltar}>
          ← Cancelar
        </button>
      </div>

      {erro && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <i className="alert-icon">⚠</i>
          <span>{erro}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="detail-layout">
          <div>
            {/* FX Banner */}
            {entidade.moeda !== 'BRL' && (
              <div
                className={`fx-banner ${entidade.fxRule === 'FIXO' ? 'fx-banner-fixo' : 'fx-banner-var'}`}
              >
                {entidade.fxRule === 'FIXO' ? (
                  <>
                    📑 <strong>Câmbio fixo</strong>: {moedaSimbolo(entidade.moeda)}1 ={' '}
                    {entidade.fxFixo ? fmtBRL(entidade.fxFixo) : '—'} — pré-preenchido abaixo
                    (editável se houver variação real).
                  </>
                ) : (
                  <>
                    📑 <strong>Câmbio variável</strong> — informe o câmbio aplicado neste{' '}
                    {labelAcao.toLowerCase()}.
                  </>
                )}
              </div>
            )}

            <div className="form-card">
              <div className="form-card-title">Dados do {labelAcao}</div>
              <div className="form-grid">
                <div className="form-field form-field-full">
                  <label className="form-label">Parcela</label>
                  <input
                    className="form-input form-input-readonly"
                    readOnly
                    value={`${parcela.numero}${
                      entidade.totalParcelas ? `/${entidade.totalParcelas}` : ''
                    } — venc. ${fmtDate(parcela.vencimento)} — ${fmtMoeda(parcela.valor, entidade.moeda)}`}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">
                    Valor {ehReceita ? 'recebido' : 'pago'} ({entidade.moeda})
                  </label>
                  <input
                    className="form-input"
                    type="text"
                    value={valorPago}
                    onChange={(e) => setValorPago(e.target.value)}
                  />
                </div>

                {entidade.moeda !== 'BRL' ? (
                  <div className="form-field">
                    <label className="form-label">Câmbio aplicado (EUR → BRL)</label>
                    <input
                      className="form-input"
                      type="text"
                      value={cambio}
                      onChange={(e) => setCambio(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="form-field">
                    <label className="form-label">Moeda</label>
                    <input className="form-input form-input-readonly" readOnly value="BRL" />
                  </div>
                )}

                <div className="form-field">
                  <label className="form-label">Valor em BRL</label>
                  <input
                    className="form-input form-input-readonly"
                    readOnly
                    value={fmtBRL(valorBrl)}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">Data do {labelAcao.toLowerCase()}</label>
                  <input
                    className="form-input"
                    type="date"
                    value={data}
                    onChange={(e) => setData(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">Forma de pagamento</label>
                  <select
                    className="form-select"
                    value={forma}
                    onChange={(e) => setForma(e.target.value as FormaLabel)}
                  >
                    <option>Transferência bancária</option>
                    <option>PIX</option>
                    <option>Boleto</option>
                    <option>Cartão</option>
                  </select>
                </div>

                <div className="form-field">
                  <label className="form-label">Banco / Conta</label>
                  <input
                    className="form-input"
                    value={banco}
                    onChange={(e) => setBanco(e.target.value)}
                    placeholder="Ex.: Itaú - 1234"
                  />
                </div>

                <div className="form-field form-field-full">
                  <label className="form-label">Observações</label>
                  <textarea
                    className="form-textarea"
                    value={obs}
                    onChange={(e) => setObs(e.target.value)}
                    placeholder="Opcional"
                  />
                </div>
              </div>

              <div className="actions-bar">
                <button type="button" className="btn-outline" onClick={onVoltar}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={salvando}>
                  {salvando ? 'Confirmando...' : `✓ Confirmar ${labelAcao}`}
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <aside>
            <div className="sidebar-resumo">
              <div className="sidebar-resumo-title">Resumo</div>
              <div className="resumo-row">
                <span>Parcela</span>
                <strong>
                  {parcela.numero}
                  {entidade.totalParcelas ? `/${entidade.totalParcelas}` : ''}
                </strong>
              </div>
              <div className="resumo-row">
                <span>Valor ({entidade.moeda})</span>
                <strong>{fmtMoeda(valorPagoNum, entidade.moeda)}</strong>
              </div>
              <div className="resumo-row">
                <span>Câmbio</span>
                <strong>
                  {cambioNum > 0 ? cambioNum.toFixed(4).replace('.', ',') : '—'}
                </strong>
              </div>
              <div className="resumo-row">
                <span>Valor (BRL)</span>
                <strong className="brl">{fmtBRL(valorBrl)}</strong>
              </div>

              {showImpacto && (
                <div className="impact-box">
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--fpag-gray-600)',
                      marginBottom: 6,
                    }}
                  >
                    IMPACTO CAMBIAL
                  </div>
                  <div className="impact-box-row">
                    <span>Estimado</span>
                    <span>{fmtBRL(valorBrlReferencia)}</span>
                  </div>
                  <div className="impact-box-row">
                    <span>Realizado</span>
                    <span>{fmtBRL(valorBrl)}</span>
                  </div>
                  <div
                    className={`impact-box-row imp-diff ${
                      Math.abs(diff) < 0.01 ? '' : diff > 0 ? 'pos' : 'neg'
                    }`}
                  >
                    <span>Diferença</span>
                    <span>
                      {diff > 0 ? '+' : ''}
                      {fmtBRL(diff)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </form>
    </div>
  )
}

export default LancarParcelaPagina