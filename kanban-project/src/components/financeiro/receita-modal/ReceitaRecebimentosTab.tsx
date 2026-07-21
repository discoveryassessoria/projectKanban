// src/components/financeiro/receita-modal/ReceitaRecebimentosTab.tsx
// ============================================================================
// Recebimentos efetivados, com menu contextual por linha (editar, comprovante,
// estorno). Derivados das parcelas quitadas — o recebimento usa o fluxo
// financeiro oficial; não há caixa paralelo no Processo.
// ============================================================================
'use client'

import {
  fmtBRL,
  fmtData,
  fmtMoeda,
  num,
  parcelaQuitada,
  type Moeda,
  type ParcelaView,
  type TotaisLancamento,
} from '@/lib/financeiro/apresentacao-lancamento'
import { recebimentoConciliado, type ResultadoAcoes } from '@/lib/financeiro/acoes-lancamento'
import { ReceitaMenuLinha } from './ReceitaMenuLinha'
import type { Detalhe } from './tipos'

export interface ReceitaRecebimentosTabProps {
  detalhe: Detalhe
  acoes: ResultadoAcoes
  totais: TotaisLancamento
  moeda: Moeda
  parcelaAlvo: ParcelaView | null
  onRegistrarRecebimento: (parcela: ParcelaView) => void
  onEditarRecebimento: (parcela: ParcelaView) => void
  onEstornar: () => void
}

const FORMA_ROTULO: Record<string, string> = {
  PIX: 'PIX',
  TRANSFERENCIA: 'Transferência',
  BOLETO: 'Boleto',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
  DINHEIRO: 'Dinheiro',
  CHEQUE: 'Cheque',
  OUTRO: 'Outro',
}

export function ReceitaRecebimentosTab({
  detalhe,
  acoes,
  totais,
  moeda,
  parcelaAlvo,
  onRegistrarRecebimento,
  onEditarRecebimento,
  onEstornar,
}: ReceitaRecebimentosTabProps) {
  const recebimentos = (detalhe.receita.parcelas ?? []).filter(parcelaQuitada)
  const podeReceber = acoes.lancamento.registrarRecebimento.disponivel && parcelaAlvo != null

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
            <button type="button" className="rfm-btn" onClick={() => onRegistrarRecebimento(parcelaAlvo)}>
              Registrar recebimento
            </button>
          </div>
        )}
        {acoes.quitado && (
          <div className="rfm-tabela-topo-acao"><span className="rfm-selo ok">Lançamento quitado</span></div>
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
                <th>Forma</th>
                <th>Conta</th>
                <th>Conciliação</th>
                <th>Comprovante</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {recebimentos.map((p) => {
                const ap = acoes.parcela(p)
                const conciliado = recebimentoConciliado(p)
                return (
                  <tr key={p.id}>
                    <td className="forte">{fmtData(p.dataPagamento)}</td>
                    <td>{p.numero}</td>
                    <td className="forte">
                      {fmtMoeda(num(p.valor), moeda)}
                      {p.valorBrl ? <span className="rfm-linha-detalhe">{fmtBRL(num(p.valorBrl))}</span> : null}
                    </td>
                    <td>{moeda}</td>
                    <td>{p.formaPagamento ? (FORMA_ROTULO[p.formaPagamento] ?? p.formaPagamento) : '—'}</td>
                    <td>{p.banco ?? '—'}</td>
                    <td>
                      <span className={`rfm-pill${conciliado ? ' ok' : ''}`}>
                        {conciliado ? 'Conciliado' : 'Não conciliado'}
                      </span>
                    </td>
                    <td>
                      {p.comprovanteUrl ? (
                        <a className="rfm-btn-txt" href={p.comprovanteUrl} target="_blank" rel="noreferrer">
                          📎 {p.comprovanteNome ?? 'Abrir'}
                        </a>
                      ) : '—'}
                    </td>
                    <td><span className="rfm-pill ok">Recebido</span></td>
                    <td>
                      <ReceitaMenuLinha
                        rotulo={`Ações do recebimento da parcela ${p.numero}`}
                        itens={[
                          {
                            chave: 'editar',
                            rotulo: 'Editar recebimento',
                            acao: ap.editarRecebimento,
                            onClick: () => onEditarRecebimento(p),
                          },
                          {
                            chave: 'ver',
                            rotulo: 'Abrir comprovante',
                            acao: ap.verComprovante,
                            onClick: () => { if (p.comprovanteUrl) window.open(p.comprovanteUrl, '_blank', 'noopener') },
                          },
                          {
                            chave: 'trocar',
                            rotulo: p.comprovanteUrl ? 'Substituir comprovante' : 'Anexar comprovante',
                            acao: ap.substituirComprovante,
                            onClick: () => onEditarRecebimento(p),
                          },
                          {
                            chave: 'estorno',
                            rotulo: 'Estornar',
                            acao: ap.estornar,
                            perigo: true,
                            onClick: onEstornar,
                          },
                          {
                            chave: 'excluir',
                            rotulo: 'Excluir recebimento',
                            acao: ap.excluir,
                            explicarBloqueio: true,
                            onClick: () => {},
                          },
                        ]}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ReceitaRecebimentosTab
