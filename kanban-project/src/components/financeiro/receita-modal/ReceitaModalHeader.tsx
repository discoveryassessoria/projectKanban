// src/components/financeiro/receita-modal/ReceitaModalHeader.tsx
// ============================================================================
// Cabeçalho do modal — identidade, contexto e ações globais. Fixo no scroll.
// Sem IDs técnicos, sem cadeados, sem texto explicativo longo.
// ============================================================================
'use client'

import type { ReactNode } from 'react'
import { STATUS_LABEL, type StatusLancamento } from '@/lib/financeiro/apresentacao-lancamento'
import { STATUS_TOM, type Detalhe } from './tipos'

export interface ReceitaModalHeaderProps {
  detalhe: Detalhe | null
  status: StatusLancamento | null
  tituloFallback: string
  menu: ReactNode
  onClose: () => void
  natureza?: 'RECEITA' | 'CUSTO'
}

export function ReceitaModalHeader({ detalhe, status, tituloFallback, menu, onClose, natureza = 'RECEITA' }: ReceitaModalHeaderProps) {
  const r = detalhe?.receita
  const origem = detalhe?.origem
  const contexto = [
    origem?.processo?.codigo ?? origem?.processo?.nome ?? null,
    origem?.faseLabel ?? null,
    r?.origem === 'motor' ? 'Gerado automaticamente' : null,
  ].filter(Boolean).join(' · ')

  return (
    <header className="rfm-head">
      <span className="rfm-head-icone" aria-hidden="true">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-3-2V4a1 1 0 0 1 1-1Z" />
          <path d="M9 8h6M9 12h6" />
        </svg>
      </span>

      <div className="rfm-head-texto">
        <h2 className="rfm-head-titulo" id="rfm-titulo">{r?.descricao ?? tituloFallback}</h2>
        {contexto && <div className="rfm-head-sub">{contexto}</div>}
        <div className="rfm-head-badges">
          <span className="rfm-badge rfm-badge-tipo">{natureza === 'CUSTO' ? 'Custo' : 'Receita'}</span>
          {r && <span className="rfm-badge rfm-badge-moeda">{r.moeda}</span>}
          {status && (
            <span className="rfm-badge rfm-badge-status" style={{ background: STATUS_TOM[status] }}>
              {STATUS_LABEL[status]}
            </span>
          )}
          {detalhe?.supressao?.ativa && <span className="rfm-badge rfm-badge-alerta">Supressão ativa</span>}
        </div>
      </div>

      <div className="rfm-head-acoes">
        {menu}
        <button type="button" className="rfm-icone-btn" onClick={onClose} aria-label="Fechar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </header>
  )
}

export default ReceitaModalHeader
