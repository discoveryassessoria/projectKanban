// src/components/financeiro/receita-modal/ReceitaParcelasTab.tsx
// ============================================================================
// CENTRAL DE GERENCIAMENTO DAS PARCELAS.
//
// Cada linha tem menu contextual (ver, vencimento, receber, editar recebimento,
// comprovante, estorno) e a tabela suporta SELEÇÃO EM LOTE para vencimento,
// recebimento e exportação. Toda ação vem resolvida de
// resolveAvailableFinancialActions — nenhuma condicional local.
//
// O TOTAL CONTRATUAL é invariante: reparcelar apenas redistribui.
// ============================================================================
'use client'

import { useMemo, useState } from 'react'
import {
  fmtData,
  fmtMoeda,
  num,
  parcelaEmAberto,
  parcelaQuitada,
  parcelaVencida,
  type Moeda,
  type ParcelaView,
  type TotaisLancamento,
} from '@/lib/financeiro/apresentacao-lancamento'
import type { ResultadoAcoes } from '@/lib/financeiro/acoes-lancamento'
import { ReceitaMenuLinha } from './ReceitaMenuLinha'
import type { Detalhe } from './tipos'

export interface ReceitaParcelasTabProps {
  detalhe: Detalhe
  acoes: ResultadoAcoes
  totais: TotaisLancamento
  moeda: Moeda
  salvando: boolean
  reparcelarAberto: boolean
  onToggleReparcelar: (aberto: boolean) => void
  onReparcelar: (nParcelas: number) => void
  onAlterarVencimento: (parcela: ParcelaView) => void
  onRegistrarRecebimento: (parcela: ParcelaView) => void
  onEditarRecebimento: (parcela: ParcelaView) => void
  onEstornar: () => void
  onVencimentoEmLote: (parcelas: ParcelaView[]) => void
  onRecebimentoEmLote: (parcelas: ParcelaView[]) => void
  onExportarSelecionadas: (parcelas: ParcelaView[]) => void
}

export function ReceitaParcelasTab({
  detalhe,
  acoes,
  totais,
  moeda,
  salvando,
  reparcelarAberto,
  onToggleReparcelar,
  onReparcelar,
  onAlterarVencimento,
  onRegistrarRecebimento,
  onEditarRecebimento,
  onEstornar,
  onVencimentoEmLote,
  onRecebimentoEmLote,
  onExportarSelecionadas,
}: ReceitaParcelasTabProps) {
  const parcelas = useMemo(
    () => (detalhe.receita.parcelas ?? []).filter((p) => p.status !== 'CANCELADA'),
    [detalhe.receita.parcelas],
  )
  const [n, setN] = useState(parcelas.length || 1)
  const [selecao, setSelecao] = useState<number[]>([])

  const selecionaveis = acoes.lote.selecionar.disponivel
  const selecionadas = parcelas.filter((p) => selecao.includes(p.id))
  const todasMarcadas = selecionadas.length > 0 && selecionadas.length === parcelas.length

  const alternar = (id: number) =>
    setSelecao((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const alternarTodas = () => setSelecao(todasMarcadas ? [] : parcelas.map((p) => p.id))

  // Lote só opera sobre parcelas em que a ação é individualmente válida.
  const loteVencimento = selecionadas.filter((p) => acoes.parcela(p).alterarVencimento.disponivel)
  const loteRecebimento = selecionadas.filter((p) => acoes.parcela(p).registrarRecebimento.disponivel)

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
        {acoes.lancamento.alterarParcelamento.disponivel && (
          <div className="rfm-tabela-topo-acao">
            <button type="button" className="rfm-btn-sec" onClick={() => onToggleReparcelar(!reparcelarAberto)}>
              {reparcelarAberto ? 'Cancelar' : 'Alterar parcelamento'}
            </button>
          </div>
        )}
      </div>

      {!acoes.lancamento.alterarParcelamento.disponivel && acoes.lancamento.alterarParcelamento.motivo && (
        <p className="rfm-bloqueio" style={{ marginBottom: 18 }}>
          {acoes.lancamento.alterarParcelamento.motivo}
        </p>
      )}

      {reparcelarAberto && acoes.lancamento.alterarParcelamento.disponivel && (
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
          <button type="button" className="rfm-btn" disabled={salvando} onClick={() => onReparcelar(n)}>
            Redistribuir {fmtMoeda(totais.contratado, moeda)}
          </button>
          <p className="rfm-nota" style={{ flexBasis: '100%', marginTop: 0 }}>
            O total contratual não muda — apenas a divisão. A última parcela absorve o arredondamento.
          </p>
        </div>
      )}

      {/* ── barra de ações em lote ── */}
      {selecionaveis && selecionadas.length > 0 && (
        <div className="rfm-lote" role="region" aria-label="Ações em lote">
          <span className="rfm-lote-contagem">
            {selecionadas.length} {selecionadas.length === 1 ? 'parcela selecionada' : 'parcelas selecionadas'}
          </span>
          {acoes.lote.alterarVencimentos.disponivel && loteVencimento.length > 0 && (
            <button type="button" className="rfm-btn-sec" disabled={salvando} onClick={() => onVencimentoEmLote(loteVencimento)}>
              Alterar vencimentos ({loteVencimento.length})
            </button>
          )}
          {acoes.lote.registrarRecebimentos.disponivel && loteRecebimento.length > 0 && (
            <button type="button" className="rfm-btn-sec" disabled={salvando} onClick={() => onRecebimentoEmLote(loteRecebimento)}>
              Registrar recebimentos ({loteRecebimento.length})
            </button>
          )}
          {acoes.lote.exportarSelecionadas.disponivel && (
            <button type="button" className="rfm-btn-sec" onClick={() => onExportarSelecionadas(selecionadas)}>
              Exportar selecionadas
            </button>
          )}
          <button type="button" className="rfm-btn-txt" onClick={() => setSelecao([])}>Limpar seleção</button>
        </div>
      )}

      {parcelas.length === 0 ? (
        <p className="rfm-vazio">Nenhuma parcela gerada.</p>
      ) : (
        <div className="rfm-tabela-wrap">
          <table className="rfm-tabela">
            <thead>
              <tr>
                {selecionaveis && (
                  <th className="rfm-col-check">
                    <input
                      type="checkbox"
                      checked={todasMarcadas}
                      onChange={alternarTodas}
                      aria-label="Selecionar todas as parcelas"
                    />
                  </th>
                )}
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
                const ap = acoes.parcela(p)
                return (
                  <tr key={p.id} className={selecao.includes(p.id) ? 'rfm-linha-marcada' : undefined}>
                    {selecionaveis && (
                      <td className="rfm-col-check">
                        <input
                          type="checkbox"
                          checked={selecao.includes(p.id)}
                          onChange={() => alternar(p.id)}
                          aria-label={`Selecionar parcela ${p.numero}`}
                        />
                      </td>
                    )}
                    <td className="forte">{p.numero} de {parcelas.length}</td>
                    <td>{fmtData(p.vencimento)}</td>
                    <td className="forte">{fmtMoeda(valor, moeda)}</td>
                    <td>{quitada ? fmtMoeda(valor, moeda) : fmtMoeda(0, moeda)}</td>
                    <td>{quitada ? fmtMoeda(0, moeda) : fmtMoeda(valor, moeda)}</td>
                    <td>
                      <span className={`rfm-pill${quitada ? ' ok' : vencida ? ' danger' : !p.vencimento ? ' warn' : ''}`}>
                        {quitada ? 'Recebida' : vencida ? 'Vencida' : p.vencimento ? 'A vencer' : 'Sem vencimento'}
                      </span>
                      {p.comprovanteUrl && (
                        <span className="rfm-clipe" title="Comprovante anexado" aria-label="Comprovante anexado"> 📎</span>
                      )}
                    </td>
                    <td>
                      <ReceitaMenuLinha
                        rotulo={`Ações da parcela ${p.numero}`}
                        itens={[
                          {
                            chave: 'receber',
                            rotulo: 'Registrar recebimento',
                            acao: ap.registrarRecebimento,
                            onClick: () => onRegistrarRecebimento(p),
                          },
                          {
                            chave: 'vencimento',
                            rotulo: 'Alterar vencimento',
                            acao: ap.alterarVencimento,
                            onClick: () => onAlterarVencimento(p),
                          },
                          {
                            chave: 'editar',
                            rotulo: 'Editar recebimento',
                            acao: ap.editarRecebimento,
                            onClick: () => onEditarRecebimento(p),
                          },
                          {
                            chave: 'comprovante',
                            rotulo: 'Abrir comprovante',
                            acao: ap.verComprovante,
                            onClick: () => { if (p.comprovanteUrl) window.open(p.comprovanteUrl, '_blank', 'noopener') },
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
                            explicarBloqueio: quitada,
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

      {parcelas.some(parcelaEmAberto) && acoes.somenteLeitura && acoes.motivoSomenteLeitura && (
        <p className="rfm-bloqueio" style={{ marginTop: 18 }}>{acoes.motivoSomenteLeitura}</p>
      )}
    </div>
  )
}

export default ReceitaParcelasTab
