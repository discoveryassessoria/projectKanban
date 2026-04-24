// src/components/financeiro/cards/FaturaCard.tsx
//
// Card visual de fatura no estilo do mockup do Marco (_renderFaturaCard).
//
// ⚠️ IMPORTANTE:
// Este card NÃO substitui a renderização de fatura que existe hoje no
// ProcessoFaturas.tsx (agora renomeado como Receitas.tsx). Aquela renderização
// continua intacta pra não quebrar modais de pagamento, parcelas de boleto,
// câmbio, edição, etc.
//
// Este FaturaCard é uma versão MAIS COMPACTA pra ser usada em lugares onde
// a gente só precisa mostrar a fatura "em modo resumo" (ex.: Visão Geral,
// Extrato, listas de referência). Ainda não é usado em lugar nenhum no
// Lote 2 — fica pronto pro Lote 3.

'use client'

import React from 'react'
import type { FaturaFinanceira } from '@/src/types/financeiro'
import { fmtBRL, fmtDataBR } from '@/src/lib/financeiro/helpers'

// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------
export interface FaturaCardProps {
  fatura: FaturaFinanceira
  onClick?: (fatura: FaturaFinanceira) => void
  // Mostrar botão "Ver detalhes"? (default false)
  showAction?: boolean
  actionLabel?: string
}

// ----------------------------------------------------------------------------
// Mapeia status → classe de badge e label
// ----------------------------------------------------------------------------
const STATUS_MAP: Record<
  string,
  { label: string; badgeClass: string }
> = {
  PAGO: { label: 'Pago', badgeClass: 'fin-badge--pago' },
  PENDENTE: { label: 'Pendente', badgeClass: 'fin-badge--pendente' },
  VENCIDO: { label: 'Vencido', badgeClass: 'fin-badge--vencido' },
  PARCIAL: { label: 'Parcial', badgeClass: 'fin-badge--parcial' },
}

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export function FaturaCard({
  fatura,
  onClick,
  showAction = false,
  actionLabel = 'Ver detalhes →',
}: FaturaCardProps) {
  const statusInfo = STATUS_MAP[fatura.status] || {
    label: fatura.status,
    badgeClass: 'fin-badge--pendente',
  }

  const clickable = typeof onClick === 'function'

  return (
    <div
      className={`fin-card fin-card--purple ${clickable ? 'fin-card--interactive' : ''}`}
      onClick={clickable ? () => onClick!(fatura) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick!(fatura)
              }
            }
          : undefined
      }
    >
      <div className="fat-card__header">
        <div className="fat-card__title">
          <p className="fat-card__desc">{fatura.descricao}</p>
          {fatura.dataVencimento && (
            <p className="fat-card__venc">
              Vencimento: {fmtDataBR(fatura.dataVencimento)}
            </p>
          )}
        </div>
        <span className={`fin-badge ${statusInfo.badgeClass}`}>
          {statusInfo.label}
        </span>
      </div>

      <div className="fat-card__body">
        <div className="fat-card__valor">
          <span className="fat-card__valor-label">Valor</span>
          <span className="fat-card__valor-num">{fmtBRL(fatura.valor)}</span>
        </div>
        {fatura.valorPago > 0 && (
          <div className="fat-card__valor">
            <span className="fat-card__valor-label">Pago</span>
            <span className="fat-card__valor-num fat-card__valor-num--green">
              {fmtBRL(fatura.valorPago)}
            </span>
          </div>
        )}
        {fatura.valorRestante > 0 && (
          <div className="fat-card__valor">
            <span className="fat-card__valor-label">Restante</span>
            <span className="fat-card__valor-num fat-card__valor-num--yellow">
              {fmtBRL(fatura.valorRestante)}
            </span>
          </div>
        )}
      </div>

      {showAction && (
        <div className="fat-card__footer">
          <span className="fat-card__action">{actionLabel}</span>
        </div>
      )}

      <style jsx>{`
        .fat-card__header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }
        .fat-card__title {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
          flex: 1;
        }
        .fat-card__desc {
          font-size: 15px;
          font-weight: 600;
          color: var(--fin-ink);
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fat-card__venc {
          font-size: 12px;
          color: var(--fin-ink-3);
          margin: 0;
        }
        .fat-card__body {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 12px;
          padding-top: 10px;
          border-top: 1px solid var(--fin-line-2);
        }
        .fat-card__valor {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .fat-card__valor-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--fin-ink-3);
          font-weight: 600;
        }
        .fat-card__valor-num {
          font-size: 16px;
          font-weight: 700;
          color: var(--fin-ink);
          font-variant-numeric: tabular-nums;
        }
        .fat-card__valor-num--green {
          color: var(--fin-green);
        }
        .fat-card__valor-num--yellow {
          color: var(--fin-yellow);
        }
        .fat-card__footer {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid var(--fin-line-2);
        }
        .fat-card__action {
          font-size: 13px;
          font-weight: 600;
          color: var(--fin-purple-600);
        }
      `}</style>
    </div>
  )
}

export default FaturaCard