// src/components/financeiro/modals/LancarPagamentoOutroCustoModal.tsx
//
// 🆕 LOTE 5: Modal para registrar um pagamento parcial em um OutroCusto.
//
// POST /api/outros-custos/:id/pagamentos
//
// Layout:
//   1. Resumo do lançamento no topo (descrição, valor total, restante)
//   2. Valor do pagamento + Data
//   3. Forma de pagamento (PIX, transferência, etc.)
//   4. Pagador (nome livre por enquanto — Lote 6 vincula com requerentes)
//   5. Comprovante (URL e nome — futuro upload no Lote 7)
//   6. Observação

'use client'

import { useState, useEffect } from 'react'
import { X, DollarSign, AlertCircle } from 'lucide-react'
import {
  LABEL_FORMA_PAGAMENTO,
  type FormaPagamento,
  type OutroCustoData,
  type PagamentoOutroCustoData,
} from '@/src/types/outros-custos'
import {
  restanteOriginal,
  totalPagoOriginal,
} from '@/src/lib/financeiro/outros-custos-helpers'
import { fmtBRL } from '@/src/lib/financeiro/helpers'

// ============================================================================
// Props
// ============================================================================

export interface LancarPagamentoModalProps {
  outroCusto: OutroCustoData | null
  isOpen: boolean
  onClose: () => void
  onSuccess: (pagamento: PagamentoOutroCustoData) => void
}

// ============================================================================
// Componente
// ============================================================================

export function LancarPagamentoOutroCustoModal({
  outroCusto,
  isOpen,
  onClose,
  onSuccess,
}: LancarPagamentoModalProps) {
  const restante = outroCusto ? restanteOriginal(outroCusto) : 0
  const jaPago = outroCusto ? totalPagoOriginal(outroCusto) : 0
  const valorTotal = outroCusto ? Number(outroCusto.valor) : 0
  const moeda = outroCusto?.moeda || 'BRL'
  const simboloMoeda =
    moeda === 'BRL' ? 'R$' : moeda === 'EUR' ? '€' : 'US$'

  // ---- Estado do form ----
  const [valor, setValor] = useState<string>('')
  const [data, setData] = useState('')
  const [forma, setForma] = useState<FormaPagamento | ''>('')
  const [pagadorNome, setPagadorNome] = useState('')
  const [comprovanteNome, setComprovanteNome] = useState('')
  const [observacao, setObservacao] = useState('')

  // ---- UI ----
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // ---- Reset ao abrir ----
  useEffect(() => {
    if (!isOpen) return
    // Pré-preenche com o valor restante (caminho mais comum: "pagar tudo")
    setValor(restante > 0 ? String(restante) : '')
    setData(new Date().toISOString().slice(0, 10))
    setForma('PIX')
    setPagadorNome('')
    setComprovanteNome('')
    setObservacao('')
    setErro(null)
  }, [isOpen, restante])

  if (!isOpen || !outroCusto) return null

  // ---- Submit ----
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)

    const valorNum = Number(valor)
    if (isNaN(valorNum) || valorNum <= 0) {
      setErro('Informe um valor válido maior que zero.')
      return
    }

    if (valorNum > restante + 0.005) {
      setErro(
        `Valor maior que o restante (${simboloMoeda} ${restante.toFixed(2)}). ` +
          `Reduza o valor ou edite o lançamento.`,
      )
      return
    }

    setSalvando(true)
    try {
      const corpo = {
        valor: valorNum,
        data: data || undefined,
        forma: forma || undefined,
        pagadorTipo: pagadorNome.trim() ? 'OUTRO' : undefined,
        pagadorNome: pagadorNome.trim() || undefined,
        comprovanteNome: comprovanteNome.trim() || undefined,
        observacao: observacao.trim() || undefined,
      }

      const res = await fetch(
        `/api/outros-custos/${outroCusto!.id}/pagamentos`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${
              localStorage.getItem('authToken') || ''
            }`,
          },
          body: JSON.stringify(corpo),
        },
      )

      if (!res.ok) {
        const erroData = await res.json().catch(() => ({}))
        setErro(erroData?.erro || `Erro ${res.status}: falha ao registrar`)
        setSalvando(false)
        return
      }

      const respostaJson = await res.json()
      const novoPag: PagamentoOutroCustoData = respostaJson.pagamento
      onSuccess(novoPag)
      onClose()
    } catch (err) {
      console.error('[LancarPagamentoModal] erro:', err)
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="lp-modal-overlay" onClick={onClose}>
      <div
        className="lp-modal-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="lp-modal-header">
          <h2 className="lp-modal-title">
            <DollarSign className="lp-title-icon" />
            {outroCusto.natureza === 'COBRAR'
              ? 'Registrar recebimento'
              : 'Registrar pagamento'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="lp-modal-close"
            aria-label="Fechar"
          >
            <X />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="lp-modal-body">
          {/* Resumo do lançamento */}
          <div className="lp-resumo">
            <div className="lp-resumo-titulo">{outroCusto.descricao}</div>
            <div className="lp-resumo-tipo">
              {outroCusto.tipo}
              {outroCusto.fornecedor && ` · ${outroCusto.fornecedor}`}
            </div>
            <div className="lp-resumo-valores">
              <div>
                <span className="lp-resumo-lbl">Total</span>
                <span className="lp-resumo-valor">
                  {simboloMoeda}{' '}
                  {valorTotal.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div>
                <span className="lp-resumo-lbl">Já {outroCusto.natureza === 'COBRAR' ? 'recebido' : 'pago'}</span>
                <span className="lp-resumo-valor lp-resumo-valor--green">
                  {simboloMoeda}{' '}
                  {jaPago.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div>
                <span className="lp-resumo-lbl">Restante</span>
                <span
                  className={`lp-resumo-valor ${
                    restante > 0 ? 'lp-resumo-valor--orange' : ''
                  }`}
                >
                  {simboloMoeda}{' '}
                  {restante.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>
          </div>

          {erro && (
            <div className="lp-erro">
              <AlertCircle className="lp-erro__icon" />
              <span>{erro}</span>
            </div>
          )}

          {/* Valor + Data */}
          <div className="lp-grid-2">
            <div className="lp-form-row">
              <label className="lp-form-label">
                Valor ({simboloMoeda}){' '}
                <span className="lp-required">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="lp-form-input"
                autoFocus
              />
              {moeda !== 'BRL' && Number(valor) > 0 && outroCusto.cambio && (
                <span className="lp-form-hint">
                  ≈ R${' '}
                  {(Number(valor) * Number(outroCusto.cambio)).toLocaleString(
                    'pt-BR',
                    { minimumFractionDigits: 2 },
                  )}
                </span>
              )}
            </div>

            <div className="lp-form-row">
              <label className="lp-form-label">Data</label>
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="lp-form-input"
              />
            </div>
          </div>

          {/* Forma de pagamento */}
          <div className="lp-form-row">
            <label className="lp-form-label">Forma de pagamento</label>
            <select
              value={forma}
              onChange={(e) => setForma(e.target.value as FormaPagamento)}
              className="lp-form-input"
            >
              <option value="">Selecione...</option>
              {Object.entries(LABEL_FORMA_PAGAMENTO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          {/* Pagador */}
          <div className="lp-form-row">
            <label className="lp-form-label">
              {outroCusto.natureza === 'COBRAR'
                ? 'Quem pagou'
                : 'Quem recebeu'}{' '}
              <small>(opcional)</small>
            </label>
            <input
              type="text"
              value={pagadorNome}
              onChange={(e) => setPagadorNome(e.target.value)}
              placeholder={
                outroCusto.natureza === 'COBRAR'
                  ? 'Ex: Lucas Lima Pinto e Silva'
                  : 'Ex: Dr. Marco Bianchi'
              }
              className="lp-form-input"
            />
          </div>

          {/* Comprovante */}
          <div className="lp-form-row">
            <label className="lp-form-label">
              Comprovante <small>(opcional)</small>
            </label>
            <input
              type="text"
              value={comprovanteNome}
              onChange={(e) => setComprovanteNome(e.target.value)}
              placeholder="Ex: comprovante_pix_28abr.pdf"
              className="lp-form-input"
            />
            <span className="lp-form-hint">
              Em breve: upload de arquivo direto pelo modal.
            </span>
          </div>

          {/* Observação */}
          <div className="lp-form-row">
            <label className="lp-form-label">Observação</label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Notas internas sobre este pagamento..."
              rows={2}
              className="lp-form-input lp-form-textarea"
            />
          </div>

          {/* Footer */}
          <div className="lp-modal-footer">
            <button
              type="button"
              onClick={onClose}
              className="lp-btn lp-btn--ghost"
              disabled={salvando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`lp-btn ${
                outroCusto.natureza === 'COBRAR'
                  ? 'lp-btn--green'
                  : 'lp-btn--orange'
              }`}
              disabled={salvando}
            >
              {salvando
                ? 'Registrando...'
                : outroCusto.natureza === 'COBRAR'
                ? '💰 Registrar recebimento'
                : '💸 Registrar pagamento'}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .lp-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(2px);
          z-index: 1010;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 40px 20px;
          overflow-y: auto;
        }
        .lp-modal-box {
          background: #fff;
          border-radius: 12px;
          width: 100%;
          max-width: 540px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }
        .lp-modal-header {
          padding: 20px 24px 16px;
          border-bottom: 1px solid #f1f5f9;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .lp-modal-title {
          margin: 0;
          font-size: 17px;
          font-weight: 600;
          color: #1f2937;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .lp-title-icon {
          width: 18px;
          height: 18px;
          color: #16a34a;
        }
        .lp-modal-close {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          color: #64748b;
        }
        .lp-modal-close:hover {
          background: #f1f5f9;
          color: #1f2937;
        }
        .lp-modal-close :global(svg) {
          width: 18px;
          height: 18px;
        }
        .lp-modal-body {
          padding: 18px 24px 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        /* === Resumo === */
        .lp-resumo {
          padding: 14px 16px;
          background: linear-gradient(135deg, #faf5ff, #f3e8ff);
          border: 1px solid #e9d5ff;
          border-radius: 10px;
        }
        .lp-resumo-titulo {
          font-size: 14px;
          font-weight: 600;
          color: #1f2937;
        }
        .lp-resumo-tipo {
          font-size: 12px;
          color: #6b21a8;
          margin-top: 2px;
        }
        .lp-resumo-valores {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }
        .lp-resumo-valores > div {
          display: flex;
          flex-direction: column;
        }
        .lp-resumo-lbl {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #64748b;
        }
        .lp-resumo-valor {
          font-size: 14px;
          font-weight: 700;
          color: #1f2937;
          font-variant-numeric: tabular-nums;
          margin-top: 2px;
        }
        .lp-resumo-valor--green {
          color: #15803d;
        }
        .lp-resumo-valor--orange {
          color: #c2410c;
        }

        /* === Erro === */
        .lp-erro {
          padding: 10px 12px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #991b1b;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .lp-erro__icon {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }

        /* === Form === */
        .lp-form-row {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .lp-grid-2 {
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 10px;
        }
        @media (max-width: 500px) {
          .lp-grid-2 {
            grid-template-columns: 1fr;
          }
        }
        .lp-form-label {
          font-size: 12px;
          font-weight: 600;
          color: #475569;
        }
        .lp-form-label small {
          color: #94a3b8;
          font-weight: 400;
        }
        .lp-required {
          color: #dc2626;
        }
        .lp-form-hint {
          font-size: 11px;
          color: #94a3b8;
        }
        .lp-form-input {
          padding: 9px 12px;
          font-size: 14px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          background: #fff;
          color: #1f2937;
          font-family: inherit;
          outline: none;
        }
        .lp-form-input:focus {
          border-color: #7c3aed;
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
        }
        .lp-form-textarea {
          resize: vertical;
          min-height: 56px;
        }

        /* === Footer === */
        .lp-modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 12px;
          margin-top: 4px;
          border-top: 1px solid #f1f5f9;
        }
        .lp-btn {
          padding: 9px 18px;
          font-size: 14px;
          font-weight: 500;
          border-radius: 8px;
          cursor: pointer;
          border: 1px solid transparent;
          font-family: inherit;
        }
        .lp-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .lp-btn--ghost {
          background: #fff;
          border-color: #cbd5e1;
          color: #475569;
        }
        .lp-btn--ghost:hover:not(:disabled) {
          background: #f1f5f9;
        }
        .lp-btn--green {
          background: #16a34a;
          color: #fff;
        }
        .lp-btn--green:hover:not(:disabled) {
          background: #15803d;
        }
        .lp-btn--orange {
          background: #d97706;
          color: #fff;
        }
        .lp-btn--orange:hover:not(:disabled) {
          background: #b45309;
        }
      `}</style>
    </div>
  )
}

export default LancarPagamentoOutroCustoModal