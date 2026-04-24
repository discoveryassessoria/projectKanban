// src/components/financeiro/cards/OutroCustoCard.tsx
//
// Card visual de um OutroCusto (custo avulso do processo).
// Por enquanto é só visual — no Lote 4 a gente conecta com a tabela
// OutroCusto que já criamos no banco.

'use client'

import React from 'react'
import { fmtBRL, fmtDataBR } from '@/src/lib/financeiro/helpers'

// ----------------------------------------------------------------------------
// Tipos (espelham o model OutroCusto do schema, mas autocontido)
// ----------------------------------------------------------------------------
export type NaturezaOutroCusto = 'COBRAR' | 'REPASSAR'

export interface OutroCustoData {
  id: number
  natureza: NaturezaOutroCusto
  tipo: string // "Honorários Discovery", "Advogado", "Cartório", etc.
  descricao: string
  fornecedor?: string | null
  valor: number
  moeda?: 'BRL' | 'EUR' | 'USD'
  vencimento?: string | null
  interno?: boolean
  repassado?: boolean
  pago?: boolean
}

export interface OutroCustoCardProps {
  custo: OutroCustoData
  onClick?: (custo: OutroCustoData) => void
  onEdit?: (custo: OutroCustoData) => void
  onDelete?: (custo: OutroCustoData) => void
}

// ----------------------------------------------------------------------------
// Helpers visuais
// ----------------------------------------------------------------------------
function getStatusBadge(custo: OutroCustoData): { label: string; className: string } {
  if (custo.pago) return { label: 'Pago', className: 'fin-badge--pago' }
  if (custo.natureza === 'COBRAR') {
    return custo.repassado
      ? { label: 'Repassado', className: 'fin-badge--parcial' }
      : { label: 'A Cobrar', className: 'fin-badge--cobrar' }
  }
  // REPASSAR
  return custo.interno
    ? { label: 'Interno', className: 'fin-badge--parcial' }
    : { label: 'A Repassar', className: 'fin-badge--repassar' }
}

function getCorBorda(custo: OutroCustoData): string {
  if (custo.pago) return 'fin-card--green'
  if (custo.natureza === 'COBRAR') return 'fin-card--purple'
  return 'fin-card--red'
}

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export function OutroCustoCard({
  custo,
  onClick,
  onEdit,
  onDelete,
}: OutroCustoCardProps) {
  const status = getStatusBadge(custo)
  const corBorda = getCorBorda(custo)
  const clickable = typeof onClick === 'function'

  return (
    <div
      className={`fin-card ${corBorda} ${clickable ? 'fin-card--interactive' : ''}`}
      onClick={clickable ? () => onClick!(custo) : undefined}
    >
      <div className="oc-card__header">
        <div className="oc-card__title">
          <p className="oc-card__tipo">{custo.tipo}</p>
          <p className="oc-card__desc">{custo.descricao}</p>
          {custo.fornecedor && (
            <p className="oc-card__forn">Fornecedor: {custo.fornecedor}</p>
          )}
        </div>
        <span className={`fin-badge ${status.className}`}>{status.label}</span>
      </div>

      <div className="oc-card__body">
        <div className="oc-card__valor-wrap">
          <span className="oc-card__valor-label">Valor</span>
          <span className="oc-card__valor-num">{fmtBRL(custo.valor)}</span>
        </div>

        {custo.vencimento && (
          <div className="oc-card__valor-wrap">
            <span className="oc-card__valor-label">Vencimento</span>
            <span className="oc-card__valor-data">{fmtDataBR(custo.vencimento)}</span>
          </div>
        )}
      </div>

      {(onEdit || onDelete) && (
        <div className="oc-card__actions">
          {onEdit && (
            <button
              type="button"
              className="oc-card__btn"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(custo)
              }}
            >
              Editar
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="oc-card__btn oc-card__btn--danger"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(custo)
              }}
            >
              Excluir
            </button>
          )}
        </div>
      )}

      <style jsx>{`
        .oc-card__header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }
        .oc-card__title {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
          flex: 1;
        }
        .oc-card__tipo {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--fin-ink-3);
          margin: 0;
        }
        .oc-card__desc {
          font-size: 15px;
          font-weight: 600;
          color: var(--fin-ink);
          margin: 0;
        }
        .oc-card__forn {
          font-size: 12px;
          color: var(--fin-ink-3);
          margin: 2px 0 0;
        }
        .oc-card__body {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 12px;
          padding-top: 10px;
          border-top: 1px solid var(--fin-line-2);
        }
        .oc-card__valor-wrap {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .oc-card__valor-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--fin-ink-3);
          font-weight: 600;
        }
        .oc-card__valor-num {
          font-size: 16px;
          font-weight: 700;
          color: var(--fin-ink);
          font-variant-numeric: tabular-nums;
        }
        .oc-card__valor-data {
          font-size: 14px;
          font-weight: 500;
          color: var(--fin-ink-2);
        }
        .oc-card__actions {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--fin-line-2);
        }
        .oc-card__btn {
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 500;
          background: transparent;
          color: var(--fin-ink-2);
          border: 1px solid var(--fin-line);
          border-radius: var(--fin-radius-sm);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .oc-card__btn:hover {
          background: var(--fin-bg-soft);
        }
        .oc-card__btn--danger {
          color: var(--fin-red);
          border-color: var(--fin-red-50);
        }
        .oc-card__btn--danger:hover {
          background: var(--fin-red-50);
        }
      `}</style>
    </div>
  )
}

export default OutroCustoCard