// src/components/financeiro/receita-modal/ReceitaResumoExecutivo.tsx
// ============================================================================
// Faixa de leitura imediata: valor contratual dominante, conversão auxiliar,
// recebido, saldo, próximo vencimento, status e progresso.
// Composição horizontal contínua com divisores sutis — não são cards.
// ============================================================================
'use client'

import {
  STATUS_LABEL,
  fmtBRL,
  fmtData,
  fmtMoeda,
  type StatusLancamento,
  type TotaisLancamento,
  type Moeda,
} from '@/lib/financeiro/apresentacao-lancamento'

export interface ReceitaResumoExecutivoProps {
  totais: TotaisLancamento
  moeda: Moeda
  status: StatusLancamento
}

export function ReceitaResumoExecutivo({ totais, moeda, status }: ReceitaResumoExecutivoProps) {
  const pct = totais.percentualRecebido
  return (
    <section className="rfm-resumo" aria-label="Resumo do lançamento">
      <div className="rfm-resumo-faixa">
        <div className="rfm-resumo-principal">
          <div className="rfm-resumo-rotulo">Valor contratual</div>
          <div className="rfm-resumo-valor">{fmtMoeda(totais.contratado, moeda)}</div>
          {moeda !== 'BRL' && (
            <div className="rfm-resumo-conversao">
              ≈ {fmtBRL(totais.contratadoBrl)}
              {totais.conversaoEstimada ? ' (estimado)' : ''}
            </div>
          )}
        </div>

        <div className="rfm-resumo-itens">
          <div className="rfm-resumo-item">
            <div className="rfm-resumo-item-rotulo">Recebido</div>
            <div className={`rfm-resumo-item-valor${totais.recebido > 0 ? ' ok' : ''}`}>
              {fmtMoeda(totais.recebido, moeda)}
            </div>
          </div>
          <div className="rfm-resumo-item">
            <div className="rfm-resumo-item-rotulo">Saldo em aberto</div>
            <div className="rfm-resumo-item-valor">{fmtMoeda(totais.saldo, moeda)}</div>
          </div>
          <div className="rfm-resumo-item">
            <div className="rfm-resumo-item-rotulo">Próximo vencimento</div>
            <div className={`rfm-resumo-item-valor${totais.parcelasVencidas > 0 ? ' warn' : ''}`}>
              {totais.proximoVencimento ? fmtData(totais.proximoVencimento) : '—'}
            </div>
          </div>
          <div className="rfm-resumo-item">
            <div className="rfm-resumo-item-rotulo">Status</div>
            <div className="rfm-resumo-item-valor">{STATUS_LABEL[status]}</div>
          </div>
        </div>
      </div>

      <div className="rfm-progresso">
        <div
          className="rfm-progresso-trilha"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Percentual recebido"
        >
          <div className="rfm-progresso-barra" style={{ width: `${pct}%` }} />
        </div>
        <div className="rfm-progresso-texto">
          {pct.toFixed(0)}% recebido
          {totais.parcelasTotal > 0 && ` · ${totais.parcelasRecebidas} de ${totais.parcelasTotal} ${totais.parcelasTotal === 1 ? 'parcela' : 'parcelas'}`}
        </div>
      </div>
    </section>
  )
}

export default ReceitaResumoExecutivo
