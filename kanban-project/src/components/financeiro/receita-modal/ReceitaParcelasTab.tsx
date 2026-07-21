// src/components/financeiro/receita-modal/ReceitaParcelasTab.tsx
// ============================================================================
// Tabela operacional das parcelas. O TOTAL CONTRATUAL é invariante: reparcelar
// apenas redistribui (endpoint existente PATCH /receitas/[id]/parcelas).
// ============================================================================
'use client'

import { useState } from 'react'
import {
  fmtData,
  fmtMoeda,
  num,
  parcelaQuitada,
  parcelaVencida,
  type ParcelaView,
  type TotaisLancamento,
  type Moeda,
} from '@/lib/financeiro/apresentacao-lancamento'
import type { Detalhe } from './tipos'

export interface ReceitaParcelasTabProps {
  detalhe: Detalhe
  totais: TotaisLancamento
  moeda: Moeda
  salvando: boolean
  onReparcelar: (nParcelas: number) => void
  onAlterarVencimento: (parcela: ParcelaView, valorIso: string) => void
  onRegistrarRecebimento: (parcela: ParcelaView) => void
}

export function ReceitaParcelasTab({
  detalhe,
  totais,
  moeda,
  salvando,
  onReparcelar,
  onAlterarVencimento,
  onRegistrarRecebimento,
}: ReceitaParcelasTabProps) {
  const parcelas = (detalhe.receita.parcelas ?? []).filter((p) => p.status !== 'CANCELADA')
  const [reparcelando, setReparcelando] = useState(false)
  const [n, setN] = useState(parcelas.length || 1)

  return (
    <div>
      <div className="rfm-tabela-topo">
        <div className="rfm-tabela-topo-item">
          <div className="rfm-tabela-topo-rotulo">Parcelas</div>
          <div className="rfm-tabela-topo-valor">{parcelas.length}</div>
        </div>
        <div className="rfm-tabela-topo-item">
          <div className="rfm-tabela-topo-rotulo">Total contratado</div>
          <div className="rfm-tabela-topo-valor">{fmtMoeda(totais.contratado, moeda)}</div>
        </div>
        <div className="rfm-tabela-topo-item">
          <div className="rfm-tabela-topo-rotulo">Saldo total</div>
          <div className="rfm-tabela-topo-valor">{fmtMoeda(totais.saldo, moeda)}</div>
        </div>
        {detalhe.acoes.podeEditarParcelas && (
          <div className="rfm-tabela-topo-acao">
            <button type="button" className="rfm-btn-sec" onClick={() => setReparcelando((v) => !v)}>
              {reparcelando ? 'Cancelar' : 'Alterar parcelamento'}
            </button>
          </div>
        )}
      </div>

      {detalhe.acoes.motivoBloqueioParcelas && (
        <p className="rfm-bloqueio" style={{ marginBottom: 18 }}>{detalhe.acoes.motivoBloqueioParcelas}</p>
      )}

      {reparcelando && (
        <div className="rfm-proxima" style={{ marginBottom: 22, alignItems: 'flex-end' }}>
          <div className="rfm-campo" style={{ margin: 0, maxWidth: 160 }}>
            <label className="rfm-campo-rotulo" htmlFor="rfm-nparcelas">Número de parcelas</label>
            <input
              id="rfm-nparcelas"
              type="number"
              min={1}
              max={120}
              value={n}
              onChange={(e) => setN(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
            />
          </div>
          <button
            type="button"
            className="rfm-btn"
            disabled={salvando}
            onClick={() => { onReparcelar(n); setReparcelando(false) }}
          >
            Redistribuir {fmtMoeda(totais.contratado, moeda)}
          </button>
          <p className="rfm-nota" style={{ flexBasis: '100%', marginTop: 0 }}>
            O total contratual não muda — apenas a divisão. A última parcela absorve o arredondamento.
          </p>
        </div>
      )}

      {parcelas.length === 0 ? (
        <p className="rfm-vazio">Nenhuma parcela gerada.</p>
      ) : (
        <div className="rfm-tabela-wrap">
          <table className="rfm-tabela">
            <thead>
              <tr>
                <th>Parcela</th>
                <th>Vencimento</th>
                <th>Valor</th>
                <th>Recebido</th>
                <th>Saldo</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {parcelas.map((p) => {
                const quitada = parcelaQuitada(p)
                const vencida = parcelaVencida(p)
                const valor = num(p.valor)
                const editavel = p.status === 'PENDENTE' && detalhe.acoes.podeEditarParcelas
                return (
                  <tr key={p.id}>
                    <td className="forte">{p.numero} de {parcelas.length}</td>
                    <td>
                      {editavel ? (
                        <input
                          type="date"
                          className="rfm-data-input"
                          aria-label={`Vencimento da parcela ${p.numero}`}
                          defaultValue={p.vencimento ? String(p.vencimento).slice(0, 10) : ''}
                          disabled={salvando}
                          onChange={(e) => { if (e.target.value) onAlterarVencimento(p, e.target.value) }}
                        />
                      ) : (
                        fmtData(p.vencimento)
                      )}
                    </td>
                    <td className="forte">{fmtMoeda(valor, moeda)}</td>
                    <td>{quitada ? fmtMoeda(valor, moeda) : fmtMoeda(0, moeda)}</td>
                    <td>{quitada ? fmtMoeda(0, moeda) : fmtMoeda(valor, moeda)}</td>
                    <td>
                      <span className={`rfm-pill${quitada ? ' ok' : vencida ? ' danger' : !p.vencimento ? ' warn' : ''}`}>
                        {quitada ? 'Recebida' : vencida ? 'Vencida' : p.vencimento ? 'A vencer' : 'Sem vencimento'}
                      </span>
                    </td>
                    <td>
                      <span className="rfm-tabela-acoes">
                        {!quitada && detalhe.acoes.podeRegistrarRecebimento && (
                          <button
                            type="button"
                            className="rfm-btn-sec"
                            disabled={salvando}
                            onClick={() => onRegistrarRecebimento(p)}
                          >
                            Registrar recebimento
                          </button>
                        )}
                        {quitada && <span className="rfm-nota" style={{ margin: 0 }}>{fmtData(p.dataPagamento)}</span>}
                      </span>
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

export default ReceitaParcelasTab
