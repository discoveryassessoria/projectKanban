// src/components/financeiro/receita-modal/ReceitaHistoricoTab.tsx
// ============================================================================
// Timeline completa do lançamento: geração, regra, cálculo, câmbio, parcelas,
// vencimento, recebimento, conciliação, cancelamento, supressão, revogação,
// estorno e reconciliação. Detalhe técnico expande por evento.
// ============================================================================
'use client'

import { useState } from 'react'
import { fmtMoeda, num, type Moeda } from '@/lib/financeiro/apresentacao-lancamento'
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
    RECEBIMENTO: 'Recebimento registrado',
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
  return (
    <li className="rfm-evento">
      <div className="rfm-evento-data">{fmtDataHora(e.createdAt)}</div>
      <div className="rfm-evento-texto">
        <strong style={{ fontWeight: 600 }}>{rotuloAcao(e.tipo)}</strong>
        {e.descricao ? ` — ${e.descricao}` : ''}
      </div>
      <div className="rfm-evento-meta">
        {e.usuario?.nome ?? 'Sistema'}
        {e.valor != null ? ` · ${fmtMoeda(num(e.valor), moeda)}` : ''}
      </div>
      <button type="button" className="rfm-btn-txt" onClick={() => setAberto((v) => !v)}>
        {aberto ? 'Ocultar detalhe técnico' : 'Detalhe técnico'}
      </button>
      {aberto && (
        <div className="rfm-evento-detalhe rfm-mono">
          tipo: {e.tipo} · evento #{e.id}
          {e.valor != null ? ` · valor: ${String(e.valor)}` : ''}
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
