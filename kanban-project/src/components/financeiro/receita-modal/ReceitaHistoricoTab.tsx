// src/components/financeiro/receita-modal/ReceitaHistoricoTab.tsx
// ============================================================================
// Histórico NAVEGÁVEL do lançamento. Nenhum evento nasce expandido: a linha
// mostra quem, quando e o que aconteceu; o detalhe técnico (valor, câmbio,
// valor em BRL e o payload `dados` gravado pelo motor) abre sob demanda.
// ============================================================================
'use client'

import { useState } from 'react'
import { fmtBRL, fmtCambio, fmtMoeda, num, type Moeda } from '@/lib/financeiro/apresentacao-lancamento'
import { fmtDataHora, type Detalhe, type EventoReceita } from './tipos'

export interface ReceitaHistoricoTabProps {
  detalhe: Detalhe
  moeda: Moeda
}

/** Rótulo humano da ação a partir do tipo do evento (fallback: o próprio tipo). */
function rotuloAcao(tipo: string): string {
  const t = tipo.toUpperCase()
  const mapa: Record<string, string> = {
    CRIACAO: 'Lançamento criado',
    CRIADO: 'Lançamento criado',
    GERACAO_AUTOMATICA: 'Geração automática',
    REGRA_APLICADA: 'Regra aplicada',
    CALCULO: 'Cálculo aplicado',
    CAMBIO: 'Câmbio registrado',
    PARCELAMENTO: 'Parcelamento definido',
    PARCELAS_ALTERADAS: 'Parcelamento alterado',
    VENCIMENTO_ALTERADO: 'Vencimento alterado',
    EDICAO: 'Edição operacional',
    RECEBIMENTO: 'Recebimento registrado',
    PAGAMENTO: 'Pagamento registrado',
    CONCILIACAO: 'Conciliação',
    CANCELAMENTO: 'Cancelamento',
    SUPRESSAO: 'Supressão registrada',
    REVOGACAO_SUPRESSAO: 'Supressão revogada',
    ESTORNO: 'Estorno',
    RECONCILIACAO: 'Reconciliação executada',
    ATUALIZACAO: 'Atualização',
  }
  return mapa[t] ?? t.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())
}

function Evento({ e, moeda }: { e: EventoReceita; moeda: Moeda }) {
  const [aberto, setAberto] = useState(false)
  const temTecnico = e.valor != null || e.cambio != null || e.valorBrl != null || e.dados != null

  return (
    <li className="rfm-evento">
      <div className="rfm-evento-data">{fmtDataHora(e.createdAt)}</div>
      <div className="rfm-evento-texto">
        <strong style={{ fontWeight: 600 }}>{rotuloAcao(e.tipo)}</strong>
        {e.descricao ? ` — ${e.descricao}` : ''}
      </div>
      <div className="rfm-evento-meta">
        Por {e.usuario?.nome ?? 'Sistema'}
        {e.valor != null ? ` · ${fmtMoeda(num(e.valor), moeda)}` : ''}
      </div>

      {temTecnico && (
        <button
          type="button"
          className="rfm-btn-txt"
          aria-expanded={aberto}
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? 'Ocultar detalhes' : 'Ver detalhes'}
        </button>
      )}

      {aberto && (
        <div className="rfm-evento-detalhe">
          <div className="rfm-pares">
            <div>
              <div className="rfm-par-rotulo">Evento</div>
              <div className="rfm-par-valor rfm-mono">{e.tipo} · #{e.id}</div>
            </div>
            <div>
              <div className="rfm-par-rotulo">Responsável</div>
              <div className="rfm-par-valor">{e.usuario?.nome ?? 'Sistema'}</div>
            </div>
            <div>
              <div className="rfm-par-rotulo">Registrado em</div>
              <div className="rfm-par-valor">{fmtDataHora(e.createdAt)}</div>
            </div>
            {e.valor != null && (
              <div>
                <div className="rfm-par-rotulo">Valor</div>
                <div className="rfm-par-valor">{fmtMoeda(num(e.valor), moeda)}</div>
              </div>
            )}
            {e.cambio != null && (
              <div>
                <div className="rfm-par-rotulo">Câmbio</div>
                <div className="rfm-par-valor">{fmtCambio(num(e.cambio))}</div>
              </div>
            )}
            {e.valorBrl != null && (
              <div>
                <div className="rfm-par-rotulo">Valor em BRL</div>
                <div className="rfm-par-valor">{fmtBRL(num(e.valorBrl))}</div>
              </div>
            )}
          </div>
          {e.dados != null && (
            <pre className="rfm-json" style={{ marginTop: 14 }}>{JSON.stringify(e.dados, null, 2)}</pre>
          )}
        </div>
      )}
    </li>
  )
}

export function ReceitaHistoricoTab({ detalhe, moeda }: ReceitaHistoricoTabProps) {
  const eventos = detalhe.receita.eventos ?? []
  if (eventos.length === 0) return <p className="rfm-vazio">Nenhum evento registrado.</p>
  return (
    <ol className="rfm-timeline">
      {eventos.map((e) => <Evento key={e.id} e={e} moeda={moeda} />)}
    </ol>
  )
}

export default ReceitaHistoricoTab
