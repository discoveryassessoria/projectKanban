// src/components/financeiro/cards/PastaDocumentalCard.tsx
//
// Card resumo da Pasta Documental do processo.
// Mostra quanto já foi pago da planilha de custos por pessoa (total vs pago).
//
// ⚠️ Este componente ainda não é usado em lugar nenhum do Lote 2 — fica pronto
// pro Lote 3 (onde vamos integrar com a sub-aba "Custos" e a sub-aba
// "Visão Geral").
//
// 🔧 Auto-contido: este card define seu próprio tipo de dados em vez de
// importar de @/src/types/financeiro. Isso desacopla do resto do módulo
// e evita que uma mudança no financeiro.ts quebre o card.

'use client'

import React from 'react'
import { fmtBRL } from '@/src/lib/financeiro/helpers'

// ----------------------------------------------------------------------------
// Tipos — definidos localmente (sem import do financeiro.ts)
// ----------------------------------------------------------------------------

/** Um item individual da planilha de custos por pessoa */
export interface PastaItem {
  pessoaId?: number
  pessoaNome?: string
  tipoServicoNome?: string
  valor: number
  pago?: boolean
}

/** Shape esperado pela prop `pasta` do card */
export interface PastaData {
  /** Soma total dos custos (em BRL) */
  total: number
  /** Total já pago (em BRL) */
  pago: number
  /** Lista de itens da planilha (opcional — usado só pra contar itens pagos) */
  detalhes?: PastaItem[]
}

export interface PastaDocumentalCardProps {
  pasta: PastaData
  onClick?: () => void
}

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export function PastaDocumentalCard({ pasta, onClick }: PastaDocumentalCardProps) {
  // Quantos itens existem e quantos já estão pagos
  const itens: PastaItem[] = pasta.detalhes ?? []
  const totalItens = itens.length
  const itensPagos = itens.filter((i: PastaItem) => i.pago === true).length

  // Totais em BRL
  const totalBRL = pasta.total ?? 0
  const pagoBRL = pasta.pago ?? 0
  const restanteBRL = Math.max(totalBRL - pagoBRL, 0)

  // % pago (usa valores em BRL, não contagem de itens — mais fiel ao dinheiro)
  const pct = totalBRL > 0 ? Math.round((pagoBRL / totalBRL) * 100) : 0

  const clickable = typeof onClick === 'function'

  return (
    <div
      className={`fin-card fin-card--blue ${clickable ? 'fin-card--interactive' : ''}`}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick!()
              }
            }
          : undefined
      }
    >
      <div className="pasta-card__header">
        <div>
          <p className="pasta-card__title">Pasta Documental</p>
          <p className="pasta-card__subtitle">
            {totalItens === 0
              ? 'Nenhum item lançado'
              : `${itensPagos} de ${totalItens} ${totalItens === 1 ? 'item pago' : 'itens pagos'}`}
          </p>
        </div>
        <span className="pasta-card__pct">{pct}%</span>
      </div>

      <div className="pasta-card__bar" aria-hidden>
        <div
          className="pasta-card__bar-fill"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      <div className="pasta-card__body">
        <div className="pasta-card__row">
          <span className="pasta-card__row-label">Custo total</span>
          <span className="pasta-card__row-value">{fmtBRL(totalBRL)}</span>
        </div>
        <div className="pasta-card__row">
          <span className="pasta-card__row-label">Já pago</span>
          <span className="pasta-card__row-value pasta-card__row-value--green">
            {fmtBRL(pagoBRL)}
          </span>
        </div>
        <div className="pasta-card__row">
          <span className="pasta-card__row-label">Restante</span>
          <span className="pasta-card__row-value pasta-card__row-value--yellow">
            {fmtBRL(restanteBRL)}
          </span>
        </div>
      </div>

      <style jsx>{`
        .pasta-card__header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }
        .pasta-card__title {
          font-size: 15px;
          font-weight: 600;
          color: var(--fin-ink);
          margin: 0 0 2px;
        }
        .pasta-card__subtitle {
          font-size: 12px;
          color: var(--fin-ink-3);
          margin: 0;
        }
        .pasta-card__pct {
          font-size: 22px;
          font-weight: 700;
          color: var(--fin-blue);
          font-variant-numeric: tabular-nums;
          line-height: 1;
        }
        .pasta-card__bar {
          width: 100%;
          height: 6px;
          background: var(--fin-line-2);
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 12px;
        }
        .pasta-card__bar-fill {
          height: 100%;
          background: var(--fin-blue);
          transition: width 0.3s ease;
        }
        .pasta-card__body {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding-top: 10px;
          border-top: 1px solid var(--fin-line-2);
        }
        .pasta-card__row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
        }
        .pasta-card__row-label {
          color: var(--fin-ink-3);
        }
        .pasta-card__row-value {
          font-weight: 600;
          color: var(--fin-ink);
          font-variant-numeric: tabular-nums;
        }
        .pasta-card__row-value--green {
          color: var(--fin-green);
        }
        .pasta-card__row-value--yellow {
          color: var(--fin-yellow);
        }
      `}</style>
    </div>
  )
}

export default PastaDocumentalCard