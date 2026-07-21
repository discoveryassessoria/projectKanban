// src/components/financeiro/receita-modal/ReceitaVisaoGeral.tsx
// ============================================================================
// Aba inicial. Coluna principal (~65%): composição do contrato, próxima parcela,
// origem resumida e requerentes. Coluna lateral (~35%): situação, últimas
// movimentações e a ação principal.
// Nada técnico aqui — identificadores, chaves e vigências vivem na aba técnica.
// ============================================================================
'use client'

import {
  STATUS_LABEL,
  fmtCambio,
  fmtData,
  fmtMoeda,
  num,
  parcelaQuitada,
  parcelaVencida,
  type ParcelaView,
  type StatusLancamento,
  type TotaisLancamento,
} from '@/lib/financeiro/apresentacao-lancamento'
import { fmtDataHora, iniciais, type AbaId, type Detalhe } from './tipos'

export interface ReceitaVisaoGeralProps {
  detalhe: Detalhe
  totais: TotaisLancamento
  status: StatusLancamento
  proximaParcela: ParcelaView | null
  onIrParaAba: (aba: AbaId) => void
  onRegistrarRecebimento: (parcela: ParcelaView) => void
  onAlterarVencimento: (parcela: ParcelaView) => void
}

function statusDaParcela(p: ParcelaView): string {
  if (parcelaQuitada(p)) return 'Recebida'
  if (parcelaVencida(p)) return 'Vencida'
  return p.vencimento ? 'A vencer' : 'Vencimento não definido'
}

export function ReceitaVisaoGeral({
  detalhe,
  totais,
  status,
  proximaParcela,
  onIrParaAba,
  onRegistrarRecebimento,
  onAlterarVencimento,
}: ReceitaVisaoGeralProps) {
  const r = detalhe.receita
  const moeda = r.moeda
  const parcelas = r.parcelas ?? []
  const composicao = r.composicao
  const eventos = (r.eventos ?? []).slice(0, 5)
  const podeReceber = detalhe.acoes.podeRegistrarRecebimento && totais.saldo > 0.004

  return (
    <div className="rfm-grid">
      {/* ── COLUNA PRINCIPAL ─────────────────────────────────────────────── */}
      <div>
        <section className="rfm-bloco">
          <h3 className="rfm-bloco-titulo">Composição do contrato</h3>
          {composicao ? (
            <>
              <div className="rfm-linhas">
                {composicao.linhas.map((l, i) => (
                  <div className="rfm-linha" key={`${l.rotulo}-${i}`}>
                    <span className="rfm-linha-rotulo">
                      {l.rotulo}
                      {l.detalhe && <span className="rfm-linha-detalhe">{l.detalhe}</span>}
                    </span>
                    <span className="rfm-linha-valor">{fmtMoeda(l.valor, moeda)}</span>
                  </div>
                ))}
                <div className="rfm-linha total">
                  <span className="rfm-linha-rotulo">Total contratual</span>
                  <span className="rfm-linha-valor">{fmtMoeda(composicao.total, moeda)}</span>
                </div>
              </div>
              <p className="rfm-nota">Calculado automaticamente pelo FinanceRuleEngine.</p>
            </>
          ) : (
            <p className="rfm-vazio">O motor não registrou composição detalhada para este lançamento.</p>
          )}
        </section>

        <section className="rfm-bloco">
          <h3 className="rfm-bloco-titulo">Próxima parcela</h3>
          {proximaParcela ? (
            <>
              <div className="rfm-proxima">
                <div className="rfm-proxima-item">
                  <div className="rfm-proxima-rotulo">Parcela</div>
                  <div className="rfm-proxima-valor">{proximaParcela.numero} de {parcelas.length}</div>
                </div>
                <div className="rfm-proxima-item">
                  <div className="rfm-proxima-rotulo">Vencimento</div>
                  <div className="rfm-proxima-valor">{fmtData(proximaParcela.vencimento)}</div>
                </div>
                <div className="rfm-proxima-item">
                  <div className="rfm-proxima-rotulo">Valor</div>
                  <div className="rfm-proxima-valor">{fmtMoeda(num(proximaParcela.valor), moeda)}</div>
                </div>
                <div className="rfm-proxima-item">
                  <div className="rfm-proxima-rotulo">Saldo</div>
                  <div className="rfm-proxima-valor">{fmtMoeda(totais.saldo, moeda)}</div>
                </div>
                <div className="rfm-proxima-item">
                  <div className="rfm-proxima-rotulo">Status</div>
                  <div className="rfm-proxima-valor">{statusDaParcela(proximaParcela)}</div>
                </div>
              </div>
              <div className="rfm-proxima-acoes">
                <button type="button" className="rfm-btn-sec" onClick={() => onIrParaAba('parcelas')}>
                  Ver parcelas
                </button>
                {detalhe.acoes.podeEditarParcelas && (
                  <button type="button" className="rfm-btn-sec" onClick={() => onAlterarVencimento(proximaParcela)}>
                    Alterar vencimento
                  </button>
                )}
                {podeReceber && (
                  <button type="button" className="rfm-btn-sec" onClick={() => onRegistrarRecebimento(proximaParcela)}>
                    Registrar recebimento
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="rfm-vazio">
              {parcelas.length === 0
                ? 'Nenhuma parcela gerada para este lançamento.'
                : 'Todas as parcelas foram recebidas.'}
            </p>
          )}
        </section>

        <section className="rfm-bloco">
          <h3 className="rfm-bloco-titulo">Origem</h3>
          <div className="rfm-pares">
            <div>
              <div className="rfm-par-rotulo">Processo</div>
              <div className="rfm-par-valor">
                {detalhe.origem.processo?.codigo ?? detalhe.origem.processo?.nome ?? '—'}
              </div>
            </div>
            <div>
              <div className="rfm-par-rotulo">Fase</div>
              <div className="rfm-par-valor">{detalhe.origem.faseLabel ?? '—'}</div>
            </div>
            <div>
              <div className="rfm-par-rotulo">Serviço</div>
              <div className="rfm-par-valor">
                {detalhe.origem.servico ?? detalhe.origem.configuracaoFinanceira?.nome ?? '—'}
              </div>
            </div>
            <div>
              <div className="rfm-par-rotulo">Regra aplicada</div>
              <div className="rfm-par-valor">{detalhe.origem.regraFinanceira?.descricao ?? '—'}</div>
            </div>
          </div>
        </section>

        {detalhe.requerentesConsiderados.length > 0 && (
          <section className="rfm-bloco">
            <h3 className="rfm-bloco-titulo">Requerentes considerados</h3>
            <div className="rfm-pessoas">
              {detalhe.requerentesConsiderados.map((q) => (
                <div className="rfm-pessoa" key={q.id}>
                  <span className="rfm-avatar" aria-hidden="true">{iniciais(q.nome)}</span>
                  <span className="rfm-pessoa-nome">{q.nome}</span>
                  <span className="rfm-pessoa-tipo">{q.statusFamiliar === 'menor' ? 'Menor' : 'Adulto'}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── COLUNA LATERAL ───────────────────────────────────────────────── */}
      <aside className="rfm-lateral">
        <section>
          <h3 className="rfm-bloco-titulo">Situação atual</h3>
          <div className="rfm-situacao">
            <div className="rfm-situacao-linha">
              <span className="rfm-situacao-rotulo">Status</span>
              <span className="rfm-situacao-valor">{STATUS_LABEL[status]}</span>
            </div>
            <div className="rfm-situacao-linha">
              <span className="rfm-situacao-rotulo">Moeda contratual</span>
              <span className="rfm-situacao-valor">{moeda}</span>
            </div>
            {moeda !== 'BRL' && (
              <div className="rfm-situacao-linha">
                <span className="rfm-situacao-rotulo">Câmbio aplicado</span>
                <span className="rfm-situacao-valor">
                  1 {moeda} = R$ {fmtCambio(totais.cambio)}
                </span>
              </div>
            )}
            <div className="rfm-situacao-linha">
              <span className="rfm-situacao-rotulo">Parcelas</span>
              <span className="rfm-situacao-valor">{totais.parcelasTotal}</span>
            </div>
            <div className="rfm-situacao-linha">
              <span className="rfm-situacao-rotulo">Recebimentos</span>
              <span className="rfm-situacao-valor">{totais.parcelasRecebidas}</span>
            </div>
          </div>
        </section>

        <section>
          <h3 className="rfm-bloco-titulo">Últimas movimentações</h3>
          {eventos.length === 0 ? (
            <p className="rfm-vazio">Nenhuma movimentação registrada.</p>
          ) : (
            <ol className="rfm-timeline">
              {eventos.map((e) => (
                <li className="rfm-evento" key={e.id}>
                  <div className="rfm-evento-data">{fmtDataHora(e.createdAt)}</div>
                  <div className="rfm-evento-texto">{e.descricao}</div>
                </li>
              ))}
            </ol>
          )}
          {(r.eventos?.length ?? 0) > eventos.length && (
            <button type="button" className="rfm-btn-txt" onClick={() => onIrParaAba('historico')}>
              Ver histórico completo
            </button>
          )}
        </section>

        {podeReceber && proximaParcela && (
          <button
            type="button"
            className="rfm-btn rfm-btn-bloco"
            onClick={() => onRegistrarRecebimento(proximaParcela)}
          >
            Registrar recebimento
          </button>
        )}
      </aside>
    </div>
  )
}

export default ReceitaVisaoGeral
