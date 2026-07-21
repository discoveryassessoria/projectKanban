// src/components/financeiro/receita-modal/ReceitaAcoesRapidas.tsx
// ============================================================================
// Faixa de AÇÕES RÁPIDAS logo abaixo do resumo executivo. Nada de menu
// escondido: o que pode ser feito agora está visível.
//
// A lista NÃO decide nada — ela renderiza exatamente o que
// resolveAvailableFinancialActions() devolveu como disponível.
// ============================================================================
'use client'

import type { ResultadoAcoes } from '@/lib/financeiro/acoes-lancamento'

export interface ReceitaAcoesRapidasProps {
  acoes: ResultadoAcoes
  onRegistrarRecebimento: () => void
  onAlterarParcelamento: () => void
  onAlterarVencimento: () => void
  onEditarObservacoes: () => void
  onExportar: () => void
  onImprimir: () => void
  onCopiarReferencia: () => void
}

export function ReceitaAcoesRapidas({
  acoes,
  onRegistrarRecebimento,
  onAlterarParcelamento,
  onAlterarVencimento,
  onEditarObservacoes,
  onExportar,
  onImprimir,
  onCopiarReferencia,
}: ReceitaAcoesRapidasProps) {
  const a = acoes.lancamento
  const itens: Array<{ chave: string; rotulo: string; principal?: boolean; onClick: () => void; mostrar: boolean }> = [
    { chave: 'receber', rotulo: 'Registrar recebimento', principal: true, onClick: onRegistrarRecebimento, mostrar: a.registrarRecebimento.disponivel },
    { chave: 'parcelamento', rotulo: 'Alterar parcelamento', onClick: onAlterarParcelamento, mostrar: a.alterarParcelamento.disponivel },
    { chave: 'vencimento', rotulo: 'Alterar vencimento', onClick: onAlterarVencimento, mostrar: a.alterarVencimento.disponivel },
    { chave: 'observacoes', rotulo: 'Editar observações', onClick: onEditarObservacoes, mostrar: a.editarObservacoes.disponivel },
    { chave: 'exportar', rotulo: 'Exportar', onClick: onExportar, mostrar: a.exportar.disponivel },
    { chave: 'imprimir', rotulo: 'Imprimir', onClick: onImprimir, mostrar: a.imprimir.disponivel },
    { chave: 'copiar', rotulo: 'Copiar referência', onClick: onCopiarReferencia, mostrar: a.copiarReferencia.disponivel },
  ]
  const visiveis = itens.filter((i) => i.mostrar)
  if (visiveis.length === 0 && !acoes.quitado && !acoes.somenteLeitura) return null

  return (
    <section className="rfm-rapidas" aria-label="Ações rápidas">
      {acoes.quitado && <span className="rfm-selo ok">Lançamento quitado</span>}
      {acoes.somenteLeitura && acoes.motivoSomenteLeitura && (
        <span className="rfm-selo warn">{acoes.motivoSomenteLeitura}</span>
      )}
      {visiveis.map((i) => (
        <button
          key={i.chave}
          type="button"
          className={i.principal ? 'rfm-btn' : 'rfm-btn-sec'}
          onClick={i.onClick}
        >
          {i.rotulo}
        </button>
      ))}
    </section>
  )
}

export default ReceitaAcoesRapidas
