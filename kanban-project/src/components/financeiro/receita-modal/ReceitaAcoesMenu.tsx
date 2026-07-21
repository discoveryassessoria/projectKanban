// src/components/financeiro/receita-modal/ReceitaAcoesMenu.tsx
// ============================================================================
// "Mais ações" — ações secundárias e EXCEPCIONAIS. Cancelar e estornar vivem
// aqui, nunca como botão vermelho permanente na tela. Ação bloqueada mostra o
// motivo em vez de sumir sem explicação.
// ============================================================================
'use client'

import { useEffect, useRef, useState } from 'react'
import type { Detalhe } from './tipos'

export interface ReceitaAcoesMenuProps {
  detalhe: Detalhe | null
  posicao?: 'abaixo' | 'acima'
  rotulo?: string
  desabilitado?: boolean
  onAlterarParcelamento: () => void
  onAlterarVencimento: () => void
  onExportar: () => void
  onCopiarReferencia: () => void
  onCancelar: () => void
  onEstornar: () => void
  onRevogarSupressao: () => void
}

export function ReceitaAcoesMenu({
  detalhe,
  posicao = 'abaixo',
  rotulo = 'Mais ações',
  desabilitado,
  onAlterarParcelamento,
  onAlterarVencimento,
  onExportar,
  onCopiarReferencia,
  onCancelar,
  onEstornar,
  onRevogarSupressao,
}: ReceitaAcoesMenuProps) {
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

  const a = detalhe?.acoes
  const escolher = (fn: () => void) => () => { setAberto(false); fn() }

  return (
    <div className="rfm-menu-wrap" ref={wrap}>
      {posicao === 'abaixo' ? (
        <button
          type="button"
          className="rfm-icone-btn"
          aria-haspopup="menu"
          aria-expanded={aberto}
          aria-label={rotulo}
          disabled={desabilitado || !detalhe}
          onClick={() => setAberto((v) => !v)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          className="rfm-btn-sec"
          aria-haspopup="menu"
          aria-expanded={aberto}
          disabled={desabilitado || !detalhe}
          onClick={() => setAberto((v) => !v)}
        >
          {rotulo}
        </button>
      )}

      {aberto && a && (
        <div className={`rfm-menu ${posicao}`} role="menu">
          <button type="button" role="menuitem" className="rfm-menu-item" disabled={!a.podeEditarParcelas} onClick={escolher(onAlterarParcelamento)}>
            Alterar parcelamento
          </button>
          <button type="button" role="menuitem" className="rfm-menu-item" disabled={!a.podeEditarParcelas} onClick={escolher(onAlterarVencimento)}>
            Alterar vencimento
          </button>
          {!a.podeEditarParcelas && a.motivoBloqueioParcelas && (
            <p className="rfm-menu-motivo">{a.motivoBloqueioParcelas}</p>
          )}

          <div className="rfm-menu-sep" />
          <button type="button" role="menuitem" className="rfm-menu-item" onClick={escolher(onExportar)}>
            Exportar
          </button>
          <button type="button" role="menuitem" className="rfm-menu-item" onClick={escolher(onCopiarReferencia)}>
            Copiar referência
          </button>

          {(a.podeCancelar || a.podeEstornar || a.podeRevogarSupressao || a.motivoBloqueioCancelamento) && (
            <div className="rfm-menu-sep" />
          )}
          {a.podeRevogarSupressao && (
            <button type="button" role="menuitem" className="rfm-menu-item" onClick={escolher(onRevogarSupressao)}>
              Revogar supressão
            </button>
          )}
          {/* Estornar só existe quando há recebimento. */}
          {a.podeEstornar && (
            <button type="button" role="menuitem" className="rfm-menu-item perigo" onClick={escolher(onEstornar)}>
              Estornar
            </button>
          )}
          {a.podeCancelar ? (
            <button type="button" role="menuitem" className="rfm-menu-item perigo" onClick={escolher(onCancelar)}>
              Cancelar lançamento
            </button>
          ) : a.motivoBloqueioCancelamento ? (
            <>
              <button type="button" role="menuitem" className="rfm-menu-item" disabled>
                Cancelar lançamento
              </button>
              <p className="rfm-menu-motivo">{a.motivoBloqueioCancelamento}</p>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default ReceitaAcoesMenu
