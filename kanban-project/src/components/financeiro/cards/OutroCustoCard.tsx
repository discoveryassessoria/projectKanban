// src/components/financeiro/cards/OutroCustoCard.tsx
//
// 🆕 LOTE 5: Card funcional de OutroCusto.
// SUBSTITUI a versão placeholder do Lote 3.
//
// Mostra:
//   - Header: descrição, tipo, fornecedor, valor + status pago/pendente/vencido
//   - Barra de progresso colorida com % pago
//   - Histórico de pagamentos (com botões de estornar/excluir cada um)
//   - Botões de ação no rodapé:
//       + "Receber/Pagar mais" (abre LancarPagamentoModal)
//       + "Editar" (abre NovoOutroCustoModal em modo edição)
//       + "Excluir" (DELETE com confirmação)
//
// Recebe callbacks `onAtualizar` e `onExcluir` para que o pai (subaba Custos
// ou Receitas) recarregue a lista após mudanças.

'use client'

import { useState } from 'react'
import {
  Pencil,
  Trash2,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  RotateCcw,
  Paperclip,
  FileText,
  ExternalLink,
} from 'lucide-react'
import {
  type OutroCustoData,
  type PagamentoOutroCustoData,
  LABEL_FORMA_PAGAMENTO,
  SIMBOLO_MOEDA,
} from '@/src/types/outros-custos'
import {
  valorEmBRL,
  totalPagoOriginal,
  restanteOriginal,
  percentualPago,
  statusOutroCusto,
  diasEmAtraso,
} from '@/src/lib/financeiro/outros-custos-helpers'
import { fmtBRL, fmtDataBR } from '@/src/lib/financeiro/helpers'
import { LancarPagamentoOutroCustoModal } from '@/src/components/financeiro/modals/LancarPagamentoOutroCustoModal'
import { NovoOutroCustoModal } from '@/src/components/financeiro/modals/NovoOutroCustoModal'

// ============================================================================
// Props
// ============================================================================

export interface OutroCustoCardProps {
  outroCusto: OutroCustoData
  onAtualizar: (atualizado: OutroCustoData) => void
  onExcluir: (id: number) => void
}

// ============================================================================
// Componente
// ============================================================================

export function OutroCustoCard({
  outroCusto,
  onAtualizar,
  onExcluir,
}: OutroCustoCardProps) {
  const [modalPagamentoAberto, setModalPagamentoAberto] = useState(false)
  const [modalEdicaoAberto, setModalEdicaoAberto] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [estornandoId, setEstornandoId] = useState<number | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  // ---- Dados derivados ----
  const status = statusOutroCusto(outroCusto)
  const valorOriginal = Number(outroCusto.valor)
  const valorBRL = valorEmBRL(outroCusto)
  const pago = totalPagoOriginal(outroCusto)
  const restante = restanteOriginal(outroCusto)
  const pct = percentualPago(outroCusto)
  const dias = diasEmAtraso(outroCusto)
  const moedaSimbolo = SIMBOLO_MOEDA[outroCusto.moeda]
  const ehReceita = outroCusto.natureza === 'COBRAR'

  // Pagamentos não estornados primeiro, estornados depois
  const pagamentos = outroCusto.pagamentos || []
  const pagamentosAtivos = pagamentos.filter((p) => !p.estornado)
  const pagamentosEstornados = pagamentos.filter((p) => p.estornado)

  // ---- Handlers ----
  async function handleExcluir() {
    if (
      !confirm(
        `Excluir lançamento "${outroCusto.descricao}"?\n\n` +
          `Esta ação removerá o lançamento e todos seus ${pagamentos.length} pagamentos.\n` +
          `Não pode ser desfeita.`,
      )
    ) {
      return
    }

    setExcluindo(true)
    setErroAcao(null)
    try {
      const res = await fetch(`/api/outros-custos/${outroCusto.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErroAcao(data?.erro || `Erro ${res.status} ao excluir`)
        setExcluindo(false)
        return
      }

      onExcluir(outroCusto.id)
    } catch (err) {
      console.error('[OutroCustoCard] erro ao excluir:', err)
      setErroAcao('Erro de conexão.')
      setExcluindo(false)
    }
  }

  async function handleEstornarPagamento(pagamento: PagamentoOutroCustoData) {
    const motivo = prompt(
      `Motivo do estorno do pagamento de ${moedaSimbolo} ${Number(
        pagamento.valor,
      ).toFixed(2)}?\n(Opcional, deixe em branco para "Estorno manual")`,
    )

    if (motivo === null) return // cancelou

    setEstornandoId(pagamento.id)
    setErroAcao(null)
    try {
      const res = await fetch(
        `/api/pagamentos-outro-custo/${pagamento.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${
              localStorage.getItem('authToken') || ''
            }`,
          },
          body: JSON.stringify({
            estornado: true,
            estornoMotivo: motivo.trim() || undefined,
          }),
        },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErroAcao(data?.erro || `Erro ${res.status} ao estornar`)
        setEstornandoId(null)
        return
      }

      // Atualiza localmente: marca o pagamento como estornado
      const dataResp = await res.json()
      const pagAtualizado: PagamentoOutroCustoData = dataResp.pagamento
      const novosPagamentos = pagamentos.map((p) =>
        p.id === pagamento.id ? pagAtualizado : p,
      )
      onAtualizar({ ...outroCusto, pagamentos: novosPagamentos })
    } catch (err) {
      console.error('[OutroCustoCard] erro ao estornar:', err)
      setErroAcao('Erro de conexão.')
    } finally {
      setEstornandoId(null)
    }
  }

  function handlePagamentoCriado(novoPagamento: PagamentoOutroCustoData) {
    // Adiciona o novo pagamento à lista
    const novosPagamentos = [novoPagamento, ...pagamentos]
    onAtualizar({ ...outroCusto, pagamentos: novosPagamentos })
  }

  function handleEdicaoSalva(atualizado: OutroCustoData) {
    // A API retorna o OutroCusto com pagamentos. Mantemos a lista local
    // (que pode estar mais atualizada visualmente)
    onAtualizar({
      ...atualizado,
      pagamentos: atualizado.pagamentos ?? pagamentos,
    })
  }

  // ---- Cor da borda baseada em status ----
  const meta = METADADOS_STATUS[status]

  return (
    <>
      <div
        className={`oc-card oc-card--${status}`}
        style={{ borderLeftColor: meta.cor }}
      >
        {/* Header: descrição + status + valor */}
        <div className="oc-card__head">
          <div className="oc-card__head-left">
            <div className="oc-card__titulo-linha">
              <span className="oc-card__icon-natureza" aria-hidden>
                {ehReceita ? '↙' : '↗'}
              </span>
              <h4 className="oc-card__titulo">{outroCusto.descricao}</h4>
            </div>
            <p className="oc-card__sub">
              <span className="oc-card__tipo">{outroCusto.tipo}</span>
              {outroCusto.fornecedor && (
                <>
                  <span className="oc-card__sep">·</span>
                  <span>{outroCusto.fornecedor}</span>
                </>
              )}
              {outroCusto.moeda !== 'BRL' && (
                <>
                  <span className="oc-card__sep">·</span>
                  <span className="oc-card__moeda-tag">
                    {outroCusto.moeda}
                  </span>
                </>
              )}
              {outroCusto.interno && (
                <>
                  <span className="oc-card__sep">·</span>
                  <span className="oc-card__flag">Interno</span>
                </>
              )}
            </p>
          </div>

          <div className="oc-card__head-right">
            <div className="oc-card__valor">
              {moedaSimbolo}{' '}
              {valorOriginal.toLocaleString('pt-BR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            {outroCusto.moeda !== 'BRL' && (
              <div className="oc-card__valor-brl">
                ≈ {fmtBRL(valorBRL)}
              </div>
            )}
            <div
              className={`oc-card__status oc-card__status--${status}`}
              style={{ color: meta.cor, background: meta.bg }}
            >
              <meta.IconComponent className="oc-card__status-icon" />
              {meta.label}
              {dias > 0 && status !== 'pago' && (
                <span className="oc-card__atraso">
                  · {dias} dia{dias > 1 ? 's' : ''} em atraso
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Vencimento (se houver) */}
        {outroCusto.vencimento && (
          <div className="oc-card__vencimento">
            <Clock className="oc-card__vencimento-icon" />
            <span>
              Vencimento: <strong>{fmtDataBR(outroCusto.vencimento)}</strong>
            </span>
          </div>
        )}

        {/* Barra de progresso */}
        {pagamentos.length > 0 && (
          <div className="oc-card__progresso-wrap">
            <div className="oc-card__progresso">
              <div
                className="oc-card__progresso-fill"
                style={{
                  width: `${pct}%`,
                  background: status === 'pago' ? '#16a34a' : meta.cor,
                }}
              />
            </div>
            <div className="oc-card__progresso-info">
              <span>
                {ehReceita ? 'Recebido' : 'Pago'}{' '}
                <strong>
                  {moedaSimbolo} {pago.toFixed(2)}
                </strong>{' '}
                de {moedaSimbolo} {valorOriginal.toFixed(2)}
              </span>
              <span className="oc-card__progresso-pct">
                {pct.toFixed(0)}% · Restante {moedaSimbolo}{' '}
                {restante.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* Observação */}
        {outroCusto.observacao && (
          <div className="oc-card__obs">
            <FileText className="oc-card__obs-icon" />
            <span>{outroCusto.observacao}</span>
          </div>
        )}

        {/* Histórico de pagamentos */}
        {pagamentos.length > 0 && (
          <div className="oc-card__historico">
            <div className="oc-card__historico-titulo">
              Histórico de pagamentos ({pagamentosAtivos.length}
              {pagamentosEstornados.length > 0 &&
                ` · ${pagamentosEstornados.length} estornado${
                  pagamentosEstornados.length > 1 ? 's' : ''
                }`}
              )
            </div>
            {pagamentos.map((p) => (
              <div
                key={p.id}
                className={`oc-card__pag ${
                  p.estornado ? 'oc-card__pag--estornado' : ''
                }`}
              >
                <div className="oc-card__pag-info">
                  <div className="oc-card__pag-linha1">
                    <strong>{fmtDataBR(p.data)}</strong>
                    {p.forma && (
                      <span>
                        {' · '}
                        {LABEL_FORMA_PAGAMENTO[p.forma]}
                      </span>
                    )}
                    {p.comprovanteNome && (
                      <span>
                        {' · '}
                        <Paperclip className="oc-card__pag-icon-inline" />
                        {p.comprovanteNome}
                      </span>
                    )}
                  </div>
                  {(p.pagadorNome || p.observacao) && (
                    <div className="oc-card__pag-linha2">
                      {p.pagadorNome && <span>👤 {p.pagadorNome}</span>}
                      {p.pagadorNome && p.observacao && ' · '}
                      {p.observacao && <span>{p.observacao}</span>}
                    </div>
                  )}
                  {p.estornado && (
                    <div className="oc-card__pag-estorno-info">
                      ⚠ Estornado em{' '}
                      {p.estornadoEm ? fmtDataBR(p.estornadoEm) : '—'}
                      {p.estornoMotivo && ` · ${p.estornoMotivo}`}
                    </div>
                  )}
                </div>
                <div className="oc-card__pag-direita">
                  <strong
                    className={
                      p.estornado ? 'oc-card__pag-valor--estornado' : ''
                    }
                  >
                    {moedaSimbolo} {Number(p.valor).toFixed(2)}
                  </strong>
                  {p.comprovanteUrl && (
                    <a
                      href={p.comprovanteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="oc-card__pag-btn"
                      title="Ver comprovante"
                    >
                      <ExternalLink />
                    </a>
                  )}
                  {!p.estornado && (
                    <button
                      type="button"
                      onClick={() => handleEstornarPagamento(p)}
                      className="oc-card__pag-btn"
                      disabled={estornandoId === p.id}
                      title="Estornar pagamento"
                    >
                      <RotateCcw />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Erro de ação */}
        {erroAcao && (
          <div className="oc-card__erro">
            <AlertCircle className="oc-card__erro-icon" />
            <span>{erroAcao}</span>
          </div>
        )}

        {/* Botões de ação */}
        <div className="oc-card__acoes">
          {status !== 'pago' && (
            <button
              type="button"
              onClick={() => setModalPagamentoAberto(true)}
              className={`oc-card__btn ${
                ehReceita ? 'oc-card__btn--green' : 'oc-card__btn--orange'
              }`}
            >
              <Plus className="oc-card__btn-icon" />
              {ehReceita
                ? pago > 0
                  ? 'Receber mais'
                  : 'Lançar recebimento'
                : pago > 0
                ? 'Pagar mais'
                : 'Lançar pagamento'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setModalEdicaoAberto(true)}
            className="oc-card__btn oc-card__btn--ghost"
          >
            <Pencil className="oc-card__btn-icon" />
            Editar
          </button>
          <button
            type="button"
            onClick={handleExcluir}
            className="oc-card__btn oc-card__btn--danger"
            disabled={excluindo}
          >
            <Trash2 className="oc-card__btn-icon" />
            {excluindo ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>

        <style jsx>{`
          .oc-card {
            background: #fff;
            border: 1px solid #e2e8f0;
            border-left-width: 4px;
            border-radius: 10px;
            padding: 14px 16px;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .oc-card--vencido,
          .oc-card--vencido_parcial {
            background: linear-gradient(0deg, #fff 80%, #fef2f2 100%);
          }

          /* Header */
          .oc-card__head {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
          }
          .oc-card__head-left {
            flex: 1;
            min-width: 0;
          }
          .oc-card__titulo-linha {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 2px;
          }
          .oc-card__icon-natureza {
            font-size: 16px;
            line-height: 1;
            color: #94a3b8;
          }
          .oc-card__titulo {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: #1f2937;
          }
          .oc-card__sub {
            margin: 0;
            font-size: 12px;
            color: #64748b;
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            align-items: center;
          }
          .oc-card__tipo {
            color: #475569;
            font-weight: 500;
          }
          .oc-card__sep {
            color: #cbd5e1;
          }
          .oc-card__moeda-tag {
            display: inline-block;
            padding: 1px 6px;
            font-size: 10px;
            font-weight: 700;
            background: #faf5ff;
            color: #6b21a8;
            border-radius: 4px;
          }
          .oc-card__flag {
            display: inline-block;
            padding: 1px 6px;
            font-size: 10px;
            font-weight: 700;
            background: #f1f5f9;
            color: #475569;
            border-radius: 4px;
          }
          .oc-card__head-right {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 4px;
            flex-shrink: 0;
          }
          .oc-card__valor {
            font-size: 16px;
            font-weight: 700;
            color: #1f2937;
            font-variant-numeric: tabular-nums;
            line-height: 1;
          }
          .oc-card__valor-brl {
            font-size: 11px;
            color: #94a3b8;
          }
          .oc-card__status {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 10px;
            font-size: 11px;
            font-weight: 600;
            border-radius: 999px;
            white-space: nowrap;
          }
          .oc-card__status-icon {
            width: 12px;
            height: 12px;
          }
          .oc-card__atraso {
            font-weight: 500;
          }

          /* Vencimento */
          .oc-card__vencimento {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: #64748b;
          }
          .oc-card__vencimento-icon {
            width: 12px;
            height: 12px;
          }

          /* Progresso */
          .oc-card__progresso-wrap {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .oc-card__progresso {
            height: 8px;
            background: #f1f5f9;
            border-radius: 999px;
            overflow: hidden;
          }
          .oc-card__progresso-fill {
            height: 100%;
            transition: width 0.4s ease;
            border-radius: 999px;
          }
          .oc-card__progresso-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            font-size: 11.5px;
            color: #64748b;
          }
          .oc-card__progresso-pct {
            font-weight: 600;
            color: #475569;
          }

          /* Obs */
          .oc-card__obs {
            display: flex;
            gap: 6px;
            padding: 8px 10px;
            background: #f8fafc;
            border-radius: 6px;
            font-size: 12px;
            color: #475569;
          }
          .oc-card__obs-icon {
            width: 13px;
            height: 13px;
            flex-shrink: 0;
            margin-top: 1px;
            color: #94a3b8;
          }

          /* Histórico */
          .oc-card__historico {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 10px 12px;
            background: #fafafa;
            border: 1px solid #f1f5f9;
            border-radius: 8px;
          }
          .oc-card__historico-titulo {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: #64748b;
            margin-bottom: 2px;
          }
          .oc-card__pag {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
            padding: 8px 10px;
            background: #fff;
            border: 1px solid #f1f5f9;
            border-radius: 6px;
          }
          .oc-card__pag--estornado {
            opacity: 0.65;
            background: #fef2f2;
          }
          .oc-card__pag-info {
            flex: 1;
            min-width: 0;
            font-size: 12px;
            color: #475569;
          }
          .oc-card__pag-linha1 {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 2px;
          }
          .oc-card__pag-icon-inline {
            width: 11px;
            height: 11px;
            display: inline-block;
            vertical-align: middle;
            margin-right: 2px;
          }
          .oc-card__pag-linha2 {
            margin-top: 2px;
            font-size: 11px;
            color: #94a3b8;
          }
          .oc-card__pag-estorno-info {
            margin-top: 4px;
            font-size: 11px;
            color: #b91c1c;
          }
          .oc-card__pag-direita {
            display: flex;
            align-items: center;
            gap: 4px;
            font-variant-numeric: tabular-nums;
          }
          .oc-card__pag-valor--estornado {
            text-decoration: line-through;
            color: #94a3b8;
          }
          .oc-card__pag-btn {
            width: 24px;
            height: 24px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 4px;
            color: #94a3b8;
            cursor: pointer;
          }
          .oc-card__pag-btn:hover {
            background: #f1f5f9;
            color: #475569;
            border-color: #e2e8f0;
          }
          .oc-card__pag-btn :global(svg) {
            width: 12px;
            height: 12px;
          }
          .oc-card__pag-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }

          /* Erro */
          .oc-card__erro {
            padding: 8px 10px;
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 6px;
            color: #991b1b;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .oc-card__erro-icon {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
          }

          /* Botões */
          .oc-card__acoes {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            margin-top: 4px;
          }
          .oc-card__btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 7px 12px;
            font-size: 12.5px;
            font-weight: 500;
            border-radius: 6px;
            cursor: pointer;
            border: 1px solid transparent;
            font-family: inherit;
            transition: background 0.15s, opacity 0.15s;
          }
          .oc-card__btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .oc-card__btn-icon {
            width: 13px;
            height: 13px;
          }
          .oc-card__btn--green {
            background: #16a34a;
            color: #fff;
          }
          .oc-card__btn--green:hover:not(:disabled) {
            background: #15803d;
          }
          .oc-card__btn--orange {
            background: #d97706;
            color: #fff;
          }
          .oc-card__btn--orange:hover:not(:disabled) {
            background: #b45309;
          }
          .oc-card__btn--ghost {
            background: #fff;
            border-color: #cbd5e1;
            color: #475569;
          }
          .oc-card__btn--ghost:hover:not(:disabled) {
            background: #f1f5f9;
          }
          .oc-card__btn--danger {
            background: #fff;
            border-color: #fecaca;
            color: #b91c1c;
          }
          .oc-card__btn--danger:hover:not(:disabled) {
            background: #fef2f2;
          }
        `}</style>
      </div>

      {/* Modal: lançar pagamento */}
      <LancarPagamentoOutroCustoModal
        outroCusto={outroCusto}
        isOpen={modalPagamentoAberto}
        onClose={() => setModalPagamentoAberto(false)}
        onSuccess={handlePagamentoCriado}
      />

      {/* Modal: editar lançamento */}
      <NovoOutroCustoModal
        processoId={outroCusto.processoId}
        editando={outroCusto}
        isOpen={modalEdicaoAberto}
        onClose={() => setModalEdicaoAberto(false)}
        onSuccess={handleEdicaoSalva}
      />
    </>
  )
}

// ============================================================================
// Metadados visuais por status
// ============================================================================

const METADADOS_STATUS: Record<
  ReturnType<typeof statusOutroCusto>,
  {
    label: string
    cor: string
    bg: string
    IconComponent: React.ComponentType<{ className?: string }>
  }
> = {
  pago: {
    label: 'Pago',
    cor: '#15803d',
    bg: '#f0fdf4',
    IconComponent: CheckCircle2,
  },
  parcial: {
    label: 'Parcial',
    cor: '#0891b2',
    bg: '#ecfeff',
    IconComponent: Clock,
  },
  pendente: {
    label: 'Pendente',
    cor: '#ca8a04',
    bg: '#fefce8',
    IconComponent: Clock,
  },
  vencido: {
    label: 'Vencido',
    cor: '#b91c1c',
    bg: '#fef2f2',
    IconComponent: AlertCircle,
  },
  vencido_parcial: {
    label: 'Vencido (parcial)',
    cor: '#b91c1c',
    bg: '#fef2f2',
    IconComponent: AlertCircle,
  },
}

export default OutroCustoCard