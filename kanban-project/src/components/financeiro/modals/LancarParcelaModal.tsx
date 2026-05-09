// src/components/financeiro/modals/LancarParcelaModal.tsx
//
// 🆕 Fase 3 — Lançamento de pagamento/recebimento de parcela.
//
// Modal único que serve pros dois fluxos do HTML:
//   - #page-lancar-recebimento (parcela de Receita)
//   - #page-lancar-pagamento  (parcela de Custo)
//
// O endpoint é o mesmo: POST /api/financeiro/parcelas/:id/lancamento
//
// Schema Zod aceita: cambioAplicado, dataPagamento, formaPagamento,
//   banco, comprovanteUrl, comprovanteNome, observacoes.
// (NÃO aceita `valor` — o valor da parcela é fixo desde a criação.)

'use client'

import { useState, useEffect } from 'react'
import { X, Save, AlertCircle } from 'lucide-react'

// ============================================================================
// Tipos
// ============================================================================

type Moeda = 'BRL' | 'EUR' | 'USD'
type FxRule = 'FIXO' | 'VARIAVEL'
type FormaPagamento =
  | 'PIX'
  | 'CARTAO_CREDITO'
  | 'CARTAO_DEBITO'
  | 'BOLETO'
  | 'TRANSFERENCIA'
  | 'DINHEIRO'
  | 'CHEQUE'
  | 'OUTRO'

const FORMAS: { value: FormaPagamento; label: string }[] = [
  { value: 'TRANSFERENCIA', label: 'Transferência bancária' },
  { value: 'PIX', label: 'PIX' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de crédito' },
  { value: 'CARTAO_DEBITO', label: 'Cartão de débito' },
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OUTRO', label: 'Outro' },
]

export interface ParcelaLancavel {
  id: number
  numero: number
  /** Valor da parcela na moeda original (EUR/BRL/USD) */
  valor: number
  /** Data ISO do vencimento */
  vencimento: string
}

export interface EntidadeLancavel {
  /** 'receita' = recebimento; 'custo' = pagamento */
  tipo: 'receita' | 'custo'
  descricao: string
  moeda: Moeda
  fxRule: FxRule
  fxFixo: number | null
  fxEstimado: number
  fornecedor?: string | null
  totalParcelas?: number
}

export interface LancarParcelaModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (resposta: unknown) => void
  parcela: ParcelaLancavel | null
  entidade: EntidadeLancavel | null
}

// ============================================================================
// Helpers
// ============================================================================

function parseFloatBR(s: string): number {
  if (!s) return 0
  const limpo = s.toString().replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(limpo)
  return isFinite(n) ? n : 0
}
function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtMoeda(v: number, moeda: Moeda): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: moeda })
}
function moedaSimbolo(m: Moeda): string {
  return m === 'BRL' ? 'R$' : m === 'EUR' ? '€' : 'US$'
}
function fmtDateBR(iso: string): string {
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

export function LancarParcelaModal({
  isOpen,
  onClose,
  onSuccess,
  parcela,
  entidade,
}: LancarParcelaModalProps) {
  const ehReceita = entidade?.tipo === 'receita'
  const labelAcao = ehReceita ? 'Recebimento' : 'Pagamento'
  const labelEntidade = ehReceita ? 'Receita' : 'Custo'

  const [cambio, setCambio] = useState('')
  const [data, setData] = useState(todayISO())
  const [forma, setForma] = useState<FormaPagamento>('TRANSFERENCIA')
  const [banco, setBanco] = useState('')
  const [obs, setObs] = useState('')

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Reset / pré-preenchimento ao abrir
  useEffect(() => {
    if (!isOpen || !entidade) return
    // Pré-preenche o câmbio: FIXO → fxFixo, VARIAVEL → fxEstimado
    let cambioInicial = ''
    if (entidade.moeda === 'BRL') {
      cambioInicial = '1,00'
    } else if (entidade.fxRule === 'FIXO' && entidade.fxFixo) {
      cambioInicial = entidade.fxFixo.toFixed(4).replace('.', ',')
    } else {
      cambioInicial = entidade.fxEstimado.toFixed(4).replace('.', ',')
    }
    setCambio(cambioInicial)
    setData(todayISO())
    setForma('TRANSFERENCIA')
    setBanco('')
    setObs('')
    setErro(null)
  }, [isOpen, entidade])

  // ---- Computed ----
  const cambioNum = parseFloatBR(cambio) || 0
  const valorParcela = parcela?.valor ?? 0
  const valorBrl = valorParcela * cambioNum
  const valorBrlEstimado = entidade ? valorParcela * entidade.fxEstimado : 0
  const valorBrlFixo =
    entidade && entidade.fxFixo ? valorParcela * entidade.fxFixo : valorBrlEstimado
  const diff = valorBrl - (entidade?.fxRule === 'FIXO' ? valorBrlFixo : valorBrlEstimado)

  const showImpacto =
    entidade != null &&
    entidade.moeda !== 'BRL' &&
    entidade.fxRule === 'VARIAVEL' &&
    cambioNum > 0

  // ---- Submit ----
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!parcela || !entidade) return

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
        cambioAplicado: entidade.moeda === 'BRL' ? 1 : cambioNum,
        dataPagamento: data,
        formaPagamento: forma,
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
      onSuccess(resposta)
      onClose()
    } catch (err) {
      console.error('[LancarParcelaModal] erro submit:', err)
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  if (!isOpen || !parcela || !entidade) return null

  return (
    <div className="lp-overlay" onClick={onClose}>
      <div
        className="lp-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Lançar ${labelAcao}`}
      >
        <div className="lp-header">
          <div>
            <h2 className="lp-title">
              {ehReceita ? '↙' : '↗'} Lançar {labelAcao}
            </h2>
            <div className="lp-subtitle">
              {labelEntidade}: <strong>{entidade.descricao}</strong>
              {!ehReceita && entidade.fornecedor && (
                <>
                  {' '}
                  · <span>{entidade.fornecedor}</span>
                </>
              )}
            </div>
          </div>
          <button type="button" className="lp-close" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="lp-body">
          {erro && (
            <div className="lp-erro-geral">
              <AlertCircle className="lp-erro-icon" />
              <span>{erro}</span>
            </div>
          )}

          {/* Banner de regra de câmbio */}
          {entidade.moeda !== 'BRL' && (
            <div
              className={`lp-fxbanner lp-fxbanner--${entidade.fxRule.toLowerCase()}`}
            >
              {entidade.fxRule === 'FIXO' ? (
                <>
                  📑 Câmbio fixo: {moedaSimbolo(entidade.moeda)}1 ={' '}
                  {entidade.fxFixo ? fmtBRL(entidade.fxFixo) : '—'} — pré-preenchido
                  abaixo (editável se houver variação real).
                </>
              ) : (
                <>
                  📑 Câmbio variável — informe o câmbio aplicado neste{' '}
                  {labelAcao.toLowerCase()}.
                </>
              )}
            </div>
          )}

          <div className="lp-grid">
            {/* MAIN */}
            <div className="lp-main">
              <section className="lp-card">
                <h3 className="lp-card-title">Dados do {labelAcao}</h3>

                <div className="lp-row-2">
                  <div className="lp-field">
                    <label>Parcela</label>
                    <input
                      type="text"
                      readOnly
                      className="lp-readonly"
                      value={`${parcela.numero}${
                        entidade.totalParcelas ? `/${entidade.totalParcelas}` : ''
                      } · venc. ${fmtDateBR(parcela.vencimento)}`}
                    />
                  </div>
                  <div className="lp-field">
                    <label>Valor da parcela ({moedaSimbolo(entidade.moeda)})</label>
                    <input
                      type="text"
                      readOnly
                      className="lp-readonly"
                      value={fmtMoeda(valorParcela, entidade.moeda)}
                    />
                  </div>
                </div>

                {entidade.moeda !== 'BRL' && (
                  <div className="lp-row-2 lp-mt">
                    <div className="lp-field">
                      <label>Câmbio aplicado ({entidade.moeda} → BRL) *</label>
                      <input
                        type="text"
                        value={cambio}
                        onChange={(e) => setCambio(e.target.value)}
                        placeholder="0,0000"
                      />
                    </div>
                    <div className="lp-field">
                      <label>Valor em BRL</label>
                      <input
                        type="text"
                        readOnly
                        className="lp-readonly lp-brl"
                        value={fmtBRL(valorBrl)}
                      />
                    </div>
                  </div>
                )}

                <div className="lp-row-3 lp-mt">
                  <div className="lp-field">
                    <label>Data do {labelAcao.toLowerCase()} *</label>
                    <input
                      type="date"
                      value={data}
                      onChange={(e) => setData(e.target.value)}
                    />
                  </div>
                  <div className="lp-field">
                    <label>Forma de pagamento</label>
                    <select
                      value={forma}
                      onChange={(e) => setForma(e.target.value as FormaPagamento)}
                    >
                      {FORMAS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="lp-field">
                    <label>Banco / Conta</label>
                    <input
                      type="text"
                      value={banco}
                      onChange={(e) => setBanco(e.target.value)}
                      placeholder="Ex.: Itaú - 1234"
                    />
                  </div>
                </div>

                <div className="lp-mt">
                  <div className="lp-field">
                    <label>Observações</label>
                    <textarea
                      className="lp-textarea"
                      rows={3}
                      value={obs}
                      onChange={(e) => setObs(e.target.value)}
                      placeholder="Opcional"
                    />
                  </div>
                </div>
              </section>
            </div>

            {/* SIDEBAR */}
            <aside className="lp-aside">
              <div className="lp-aside-card">
                <h4 className="lp-aside-title">Resumo</h4>
                <div className="lp-resrow">
                  <span>Parcela</span>
                  <strong>
                    {parcela.numero}
                    {entidade.totalParcelas ? `/${entidade.totalParcelas}` : ''}
                  </strong>
                </div>
                <div className="lp-resrow">
                  <span>Vencimento</span>
                  <strong>{fmtDateBR(parcela.vencimento)}</strong>
                </div>
                <div className="lp-resrow">
                  <span>Valor ({moedaSimbolo(entidade.moeda)})</span>
                  <strong>{fmtMoeda(valorParcela, entidade.moeda)}</strong>
                </div>
                {entidade.moeda !== 'BRL' && (
                  <>
                    <div className="lp-resrow">
                      <span>Câmbio</span>
                      <strong>
                        {cambioNum > 0 ? cambioNum.toFixed(4).replace('.', ',') : '—'}
                      </strong>
                    </div>
                    <div className="lp-resrow">
                      <span>Valor (BRL)</span>
                      <strong className="lp-brl-text">{fmtBRL(valorBrl)}</strong>
                    </div>
                  </>
                )}

                {showImpacto && (
                  <div className="lp-impacto">
                    <small>IMPACTO CAMBIAL</small>
                    <div className="lp-impacto-row">
                      <span>Estimado</span>
                      <span>{fmtBRL(valorBrlEstimado)}</span>
                    </div>
                    <div className="lp-impacto-row">
                      <span>Realizado</span>
                      <span>{fmtBRL(valorBrl)}</span>
                    </div>
                    <div
                      className={`lp-impacto-row lp-impacto-diff ${
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

          <div className="lp-footer">
            <button
              type="button"
              className="lp-btn lp-btn--ghost"
              onClick={onClose}
              disabled={salvando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`lp-btn ${ehReceita ? 'lp-btn--green' : 'lp-btn--primary'}`}
              disabled={salvando}
            >
              <Save className="lp-btn-icon" />
              {salvando
                ? 'Confirmando...'
                : `Confirmar ${labelAcao}`}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .lp-overlay {
          position: fixed; inset: 0;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(2px);
          z-index: 1010;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 30px 20px;
          overflow-y: auto;
        }
        .lp-box {
          background: #fff;
          border-radius: 14px;
          width: 100%;
          max-width: 920px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .lp-header {
          padding: 18px 22px 14px;
          border-bottom: 1px solid #f1f5f9;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
        }
        .lp-title {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
          color: #18181b;
          letter-spacing: -0.02em;
        }
        .lp-subtitle {
          font-size: 12.5px;
          color: #71717a;
          margin-top: 2px;
        }
        .lp-subtitle strong { color: #18181b; }
        .lp-close {
          width: 32px; height: 32px;
          display: flex; align-items: center; justify-content: center;
          background: transparent; border: none;
          border-radius: 6px; cursor: pointer; color: #64748b;
          flex-shrink: 0;
        }
        .lp-close:hover { background: #f1f5f9; color: #18181b; }
        .lp-close :global(svg) { width: 18px; height: 18px; }
        .lp-body {
          padding: 16px 22px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          max-height: calc(100vh - 100px);
          overflow-y: auto;
        }

        .lp-erro-geral {
          padding: 11px 14px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #991b1b;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .lp-erro-icon { width: 16px; height: 16px; flex-shrink: 0; }

        .lp-fxbanner {
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 12.5px;
          line-height: 1.5;
        }
        .lp-fxbanner--fixo {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #14532d;
        }
        .lp-fxbanner--variavel {
          background: #fffbeb;
          border: 1px solid #fde68a;
          color: #92400e;
        }

        .lp-grid {
          display: grid;
          grid-template-columns: 1fr 280px;
          gap: 14px;
          align-items: start;
        }
        @media (max-width: 900px) { .lp-grid { grid-template-columns: 1fr; } }
        .lp-main { min-width: 0; }
        .lp-aside { position: sticky; top: 0; }

        .lp-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 16px 18px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        }
        .lp-card-title {
          margin: 0 0 12px;
          font-size: 14px;
          font-weight: 700;
          color: #18181b;
        }

        .lp-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .lp-row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .lp-mt { margin-top: 12px; }
        @media (max-width: 700px) {
          .lp-row-2, .lp-row-3 { grid-template-columns: 1fr; }
        }
        .lp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .lp-field label {
          font-size: 11.5px; font-weight: 600; color: #475569;
        }
        .lp-field input,
        .lp-field select,
        .lp-textarea {
          padding: 9px 12px;
          font-size: 13.5px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          background: #fff;
          color: #18181b;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .lp-field input:focus,
        .lp-field select:focus,
        .lp-textarea:focus {
          border-color: #7c3aed;
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
        }
        .lp-readonly { background: #f8fafc !important; color: #475569 !important; }
        .lp-brl { color: #15803d !important; font-weight: 700; }
        .lp-textarea { width: 100%; resize: vertical; min-height: 70px; }

        .lp-aside-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 14px 16px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        }
        .lp-aside-title {
          margin: 0 0 12px;
          font-size: 13px;
          font-weight: 700;
          color: #18181b;
        }
        .lp-resrow {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          padding: 6px 0;
          border-bottom: 1px dashed #f1f5f9;
        }
        .lp-resrow:last-child { border-bottom: none; }
        .lp-resrow span { color: #64748b; }
        .lp-resrow strong {
          color: #18181b;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .lp-brl-text { color: #15803d !important; }

        .lp-impacto {
          margin-top: 12px;
          padding: 10px 12px;
          background: #faf5ff;
          border: 1px solid #e9d5ff;
          border-radius: 8px;
        }
        .lp-impacto small {
          display: block;
          font-size: 10px;
          font-weight: 700;
          color: #6b21a8;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
        }
        .lp-impacto-row {
          display: flex;
          justify-content: space-between;
          font-size: 11.5px;
          padding: 3px 0;
          color: #475569;
          font-variant-numeric: tabular-nums;
        }
        .lp-impacto-diff { font-weight: 700; }
        .lp-impacto-diff.pos span:last-child { color: #15803d; }
        .lp-impacto-diff.neg span:last-child { color: #b91c1c; }

        .lp-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 12px;
          border-top: 1px solid #f1f5f9;
        }
        .lp-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 18px;
          font-size: 14px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          border: 1px solid transparent;
          font-family: inherit;
          transition: background 0.15s, opacity 0.15s;
        }
        .lp-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .lp-btn-icon { width: 14px; height: 14px; }
        .lp-btn--ghost {
          background: #fff;
          border-color: #cbd5e1;
          color: #475569;
        }
        .lp-btn--ghost:hover:not(:disabled) { background: #f1f5f9; }
        .lp-btn--primary {
          background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
          color: #fff;
          box-shadow: 0 2px 6px rgba(124, 58, 237, 0.3);
        }
        .lp-btn--primary:hover:not(:disabled) {
          background: linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%);
        }
        .lp-btn--green {
          background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
          color: #fff;
          box-shadow: 0 2px 6px rgba(22, 163, 74, 0.3);
        }
        .lp-btn--green:hover:not(:disabled) {
          background: linear-gradient(135deg, #15803d 0%, #14532d 100%);
        }
      `}</style>
    </div>
  )
}

export default LancarParcelaModal