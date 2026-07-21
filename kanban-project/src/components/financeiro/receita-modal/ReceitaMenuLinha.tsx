// src/components/financeiro/receita-modal/ReceitaMenuLinha.tsx
// ============================================================================
// Menu contextual de uma LINHA de tabela (parcela ou recebimento).
// Recebe ações já resolvidas: renderiza apenas as disponíveis — nunca decide.
// ============================================================================
'use client'

import { useEffect, useRef, useState } from 'react'
import type { Acao } from '@/lib/financeiro/acoes-lancamento'

export interface ItemMenuLinha {
  chave: string
  rotulo: string
  acao: Acao
  perigo?: boolean
  /** Mostra o motivo do bloqueio como nota (para ações que valem explicar). */
  explicarBloqueio?: boolean
  onClick: () => void
}

export interface ReceitaMenuLinhaProps {
  itens: ItemMenuLinha[]
  rotulo?: string
}

export function ReceitaMenuLinha({ itens, rotulo = 'Ações da linha' }: ReceitaMenuLinhaProps) {
  const [aberto, setAberto] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setAberto(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAberto(false) } }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc, true)
    }
  }, [aberto])

  const visiveis = itens.filter((i) => i.acao.disponivel)
  const explicados = itens.filter((i) => !i.acao.disponivel && i.explicarBloqueio && i.acao.motivo)
  if (visiveis.length === 0 && explicados.length === 0) return null

  return (
    <div className="rfm-menu-wrap" ref={wrap}>
      <button
        type="button"
        className="rfm-icone-btn rfm-icone-btn-sm"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={rotulo}
        onClick={() => setAberto((v) => !v)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      {aberto && (
        <div className="rfm-menu abaixo" role="menu">
          {visiveis.map((i) => (
            <button
              key={i.chave}
              type="button"
              role="menuitem"
              className={`rfm-menu-item${i.perigo ? ' perigo' : ''}`}
              onClick={() => { setAberto(false); i.onClick() }}
            >
              {i.rotulo}
            </button>
          ))}
          {explicados.length > 0 && visiveis.length > 0 && <div className="rfm-menu-sep" />}
          {explicados.map((i) => (
            <p className="rfm-menu-motivo" key={`m-${i.chave}`}>
              <strong>{i.rotulo}:</strong> {i.acao.motivo}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export default ReceitaMenuLinha
