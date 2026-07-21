// src/components/financeiro/receita-modal/ReceitaRecebimentosTab.tsx
// ============================================================================
// Recebimentos efetivados. Derivados das parcelas quitadas — o recebimento usa
// o fluxo financeiro oficial; não há caixa paralelo no Processo.
// ============================================================================
'use client'

import {
  fmtBRL,
  fmtData,
  fmtMoeda,
  num,
  parcelaQuitada,
  type ParcelaView,
  type TotaisLancamento,
  type Moeda,
} from '@/lib/financeiro/apresentacao-lancamento'
import type { Detalhe } from './tipos'

export interface ReceitaRecebimentosTabProps {
  detalhe: Detalhe
  totais: TotaisLancamento
  moeda: Moeda
  proximaParcela: ParcelaView | null
  onRegistrarRecebimento: (parcela: ParcelaView) => void
}

export function ReceitaRecebimentosTab({
  detalhe,
  totais,
  moeda,
  proximaParcela,
  onRegistrarRecebimento,
}: ReceitaRecebimentosTabProps) {
  const recebimentos = (detalhe.receita.parcelas ?? []).filter(parcelaQuitada)
  const podeReceber = detalhe.acoes.podeRegistrarRecebimento && totais.saldo > 0.004 && proximaParcela != null

  return (
    <div>
      <div className="rfm-tabela-topo">
        <div className="rfm-tabela-topo-item">
          <div className="rfm-tabela-topo-rotulo">Total recebido</div>
          <div className="rfm-tabela-topo-valor">{fmtMoeda(totais.recebido, moeda)}</div>
        </div>
        <div className="rfm-tabela-topo-item">
          <div className="rfm-tabela-topo-rotulo">Saldo</div>
          <div className="rfm-tabela-topo-valor">{fmtMoeda(totais.saldo, moeda)}</div>
        </div>
        <div className="rfm-tabela-topo-item">
          <div className="rfm-tabela-topo-rotulo">Percentual recebido</div>
          <div className="rfm-tabela-topo-valor">{totais.percentualRecebido.toFixed(0)}%</div>
        </div>
        {podeReceber && (
          <div className="rfm-tabela-topo-acao">
            <button type="button" className="rfm-btn" onClick={() => onRegistrarRecebimento(proximaParcela)}>
              Registrar recebimento
            </button>
          </div>
        )}
      </div>

      {recebimentos.length === 0 ? (
        <p className="rfm-vazio">Nenhum recebimento registrado.</p>
      ) : (
        <div className="rfm-tabela-wrap">
          <table className="rfm-tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Parcela</th>
                <th>Valor</th>
                <th>Moeda</th>
                <th>Forma de pagamento</th>
                <th>Conta</th>
                <th>Conciliação</th>
                <th>Comprovante</th>
                <th>Responsável</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recebimentos.map((p) => (
                <tr key={p.id}>
                  <td className="forte">{fmtData(p.dataPagamento)}</td>
                  <td>{p.numero}</td>
                  <td className="forte">
                    {fmtMoeda(num(p.valor), moeda)}
                    {p.valorBrl ? <div className="rfm-linha-detalhe">{fmtBRL(num(p.valorBrl))}</div> : null}
                  </td>
                  <td>{moeda}</td>
                  <td>{p.formaPagamento ?? '—'}</td>
                  <td>{p.banco ?? '—'}</td>
                  <td>{p.banco ? 'Conciliado' : '—'}</td>
                  <td>
                    {p.comprovanteUrl ? (
                      <a className="rfm-btn-txt" href={p.comprovanteUrl} target="_blank" rel="noreferrer">
                        {p.comprovanteNome ?? 'Abrir'}
                      </a>
                    ) : '—'}
                  </td>
                  {/* O responsável não é congelado na parcela pelo contrato atual. */}
                  <td>{p.observacoes ?? '—'}</td>

                  <td><span className="rfm-pill ok">Recebido</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ReceitaRecebimentosTab
