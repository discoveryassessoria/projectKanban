// src/components/financeiro/receita-modal/ReceitaAcoesMenu.tsx
// ============================================================================
// "Mais ações" — menu OPERACIONAL do lançamento: ações secundárias, saídas de
// dados e ações excepcionais (cancelar, estornar, revogar supressão).
//
// Nada é decidido aqui: todos os itens vêm resolvidos de
// resolveAvailableFinancialActions. Item indisponível por ESTADO pode explicar
// o motivo; item indisponível por PERMISSÃO simplesmente não existe.
// ============================================================================
'use client'

import { useEffect, useRef, useState } from 'react'
import type { Acao, ResultadoAcoes } from '@/lib/financeiro/acoes-lancamento'

export interface ReceitaAcoesMenuProps {
  acoes: ResultadoAcoes | null
  posicao?: 'abaixo' | 'acima'
  rotulo?: string
  desabilitado?: boolean
  onAlterarParcelamento: () => void
  onAlterarVencimento: () => void
  onEditarObservacoes: () => void
  onExportarCsv: () => void
  onImprimir: () => void
  onCopiarReferencia: () => void
  onCopiarId: () => void
  onVerRegra: () => void
  onVerServico: () => void
  onVerHistorico: () => void
  onCancelar: () => void
  onEstornar: () => void
  onRevogarSupressao: () => void
}

interface Grupo {
  chave: string
  itens: Array<{ chave: string; rotulo: string; acao: Acao; perigo?: boolean; explicar?: boolean; onClick: () => void }>
}

export function ReceitaAcoesMenu(props: ReceitaAcoesMenuProps) {
  const { acoes, posicao = 'abaixo', rotulo = 'Mais ações', desabilitado } = props
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

  const sempre: Acao = { disponivel: true, motivo: null }
  const grupos: Grupo[] = acoes
    ? [
        {
          chave: 'operacao',
          itens: [
            { chave: 'parcelamento', rotulo: 'Alterar parcelamento', acao: acoes.lancamento.alterarParcelamento, explicar: true, onClick: props.onAlterarParcelamento },
            { chave: 'vencimento', rotulo: 'Alterar vencimento', acao: acoes.lancamento.alterarVencimento, onClick: props.onAlterarVencimento },
            { chave: 'observacoes', rotulo: 'Editar observações', acao: acoes.lancamento.editarObservacoes, onClick: props.onEditarObservacoes },
          ],
        },
        {
          chave: 'dados',
          itens: [
            { chave: 'csv', rotulo: 'Exportar (CSV / Excel)', acao: acoes.lancamento.exportar, onClick: props.onExportarCsv },
            { chave: 'pdf', rotulo: 'Imprimir ou salvar em PDF', acao: acoes.lancamento.imprimir, onClick: props.onImprimir },
            { chave: 'ref', rotulo: 'Copiar referência', acao: acoes.lancamento.copiarReferencia, onClick: props.onCopiarReferencia },
            { chave: 'id', rotulo: 'Copiar ID interno', acao: acoes.lancamento.copiarId, onClick: props.onCopiarId },
          ],
        },
        {
          chave: 'navegacao',
          itens: [
            { chave: 'regra', rotulo: 'Abrir regra financeira', acao: sempre, onClick: props.onVerRegra },
            { chave: 'servico', rotulo: 'Abrir serviço e configuração', acao: sempre, onClick: props.onVerServico },
            { chave: 'logs', rotulo: 'Abrir histórico de eventos', acao: sempre, onClick: props.onVerHistorico },
          ],
        },
        {
          chave: 'excecao',
          itens: [
            { chave: 'revogar', rotulo: 'Revogar supressão', acao: acoes.lancamento.revogarSupressao, onClick: props.onRevogarSupressao },
            { chave: 'estornar', rotulo: 'Estornar', acao: acoes.lancamento.estornar, perigo: true, onClick: props.onEstornar },
            { chave: 'cancelar', rotulo: 'Cancelar lançamento', acao: acoes.lancamento.cancelar, perigo: true, explicar: true, onClick: props.onCancelar },
          ],
        },
      ]
    : []

  const gruposVisiveis = grupos
    .map((g) => ({
      ...g,
      visiveis: g.itens.filter((i) => i.acao.disponivel),
      explicados: g.itens.filter((i) => !i.acao.disponivel && i.explicar && i.acao.motivo),
    }))
    .filter((g) => g.visiveis.length > 0 || g.explicados.length > 0)

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
          disabled={desabilitado || !acoes}
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
          disabled={desabilitado || !acoes}
          onClick={() => setAberto((v) => !v)}
        >
          {rotulo}
        </button>
      )}

      {aberto && gruposVisiveis.length > 0 && (
        <div className={`rfm-menu ${posicao}`} role="menu">
          {gruposVisiveis.map((g, i) => (
            <div key={g.chave}>
              {i > 0 && <div className="rfm-menu-sep" />}
              {g.visiveis.map((item) => (
                <button
                  key={item.chave}
                  type="button"
                  role="menuitem"
                  className={`rfm-menu-item${item.perigo ? ' perigo' : ''}`}
                  onClick={escolher(item.onClick)}
                >
                  {item.rotulo}
                </button>
              ))}
              {g.explicados.map((item) => (
                <p className="rfm-menu-motivo" key={`m-${item.chave}`}>
                  <strong>{item.rotulo}:</strong> {item.acao.motivo}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ReceitaAcoesMenu
