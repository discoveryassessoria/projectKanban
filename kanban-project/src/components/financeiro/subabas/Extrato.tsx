// src/components/financeiro/subabas/Extrato.tsx
//
// Sub-aba "Extrato" do Financeiro.
//
// Mostra uma TIMELINE CRONOLÓGICA com todos os eventos financeiros do processo:
//   🟣 Faturas emitidas    — DADOS REAIS (lê de /api/processos/:id/faturas)
//   🟢 Pagamentos recebidos — DADOS REAIS (lê dos pagamentos das faturas)
//   🟡 Custos lançados      — placeholder informativo (Lote 4)
//   🔴 Estornos             — placeholder informativo (Lote 4)
//
// Header tem filtros visuais (Período, Tipo, Buscar) — sem lógica por enquanto.

'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  Filter,
  Search,
  FileText,
  CheckCircle2,
  TrendingDown,
  RotateCcw,
  Inbox,
} from 'lucide-react'
import { fmtBRL, fmtDataBR } from '@/src/lib/financeiro/helpers'

// ----------------------------------------------------------------------------
// Tipos locais
// ----------------------------------------------------------------------------
type TipoEvento = 'fatura' | 'pagamento' | 'custo' | 'estorno'

interface EventoExtrato {
  id: string
  tipo: TipoEvento
  data: string // ISO
  titulo: string
  descricao?: string
  valor: number
  moeda?: 'BRL' | 'EUR' | 'USD'
  meta?: string // ex: "Fatura #45", "PIX", etc.
}

interface FaturaApi {
  id: number
  descricao?: string | null
  valorParcela?: number | null
  valor?: number | null
  moeda?: 'BRL' | 'EUR' | 'USD' | null
  status?: string | null
  createdAt?: string | null
  pagamentos?: PagamentoApi[]
}

interface PagamentoApi {
  id: number
  valor?: number | null
  data?: string | null
  forma?: string | null
}

export interface ExtratoProps {
  processoId: number
  nomeFamilia?: string
}

// ----------------------------------------------------------------------------
// Visual helpers
// ----------------------------------------------------------------------------
const META_TIPO: Record<
  TipoEvento,
  { label: string; cor: string; bg: string; icon: React.ComponentType<{ className?: string }> }
> = {
  fatura: { label: 'Fatura emitida', cor: 'var(--fin-purple-600)', bg: 'var(--fin-purple-50)', icon: FileText },
  pagamento: { label: 'Pagamento recebido', cor: 'var(--fin-green)', bg: 'var(--fin-green-50)', icon: CheckCircle2 },
  custo: { label: 'Custo lançado', cor: 'var(--fin-yellow)', bg: 'var(--fin-yellow-50)', icon: TrendingDown },
  estorno: { label: 'Estorno', cor: 'var(--fin-red)', bg: 'var(--fin-red-50)', icon: RotateCcw },
}

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export function Extrato({ processoId }: ExtratoProps) {
  const [faturas, setFaturas] = useState<FaturaApi[]>([])
  const [loading, setLoading] = useState(true)

  // Estados visuais dos filtros (não fazem nada por enquanto, só pra mostrar o layout)
  const [filtroPeriodo, setFiltroPeriodo] = useState<string>('todos')
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')
  const [busca, setBusca] = useState('')

  // Carrega faturas pra construir a timeline
  useEffect(() => {
    let cancelado = false
    async function load() {
      try {
        setLoading(true)
        const res = await fetch(`/api/processos/${processoId}/faturas`)
        if (!res.ok) throw new Error('Falha ao carregar faturas')
        const data = await res.json()
        if (!cancelado) setFaturas(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error('[Extrato] erro carregando faturas:', err)
        if (!cancelado) setFaturas([])
      } finally {
        if (!cancelado) setLoading(false)
      }
    }
    load()
    return () => {
      cancelado = true
    }
  }, [processoId])

  // Constrói a lista de eventos (faturas + pagamentos), ordenada por data DESC
  const eventos = useMemo<EventoExtrato[]>(() => {
    const lista: EventoExtrato[] = []

    for (const f of faturas) {
      const valor = Number(f.valor ?? f.valorParcela ?? 0)
      const moeda = (f.moeda ?? 'BRL') as 'BRL' | 'EUR' | 'USD'

      // Evento: fatura emitida
      if (f.createdAt) {
        lista.push({
          id: `fatura-${f.id}`,
          tipo: 'fatura',
          data: f.createdAt,
          titulo: f.descricao || `Fatura #${f.id}`,
          descricao: 'Cobrança gerada para o cliente',
          valor,
          moeda,
          meta: `Fatura #${f.id}`,
        })
      }

      // Eventos: pagamentos da fatura
      for (const p of f.pagamentos ?? []) {
        if (!p.data) continue
        lista.push({
          id: `pag-${p.id}`,
          tipo: 'pagamento',
          data: p.data,
          titulo: 'Pagamento recebido',
          descricao: f.descricao || `Referente à Fatura #${f.id}`,
          valor: Number(p.valor ?? 0),
          moeda,
          meta: p.forma ? `via ${p.forma}` : `Fatura #${f.id}`,
        })
      }
    }

    // Ordena: mais recentes primeiro
    return lista.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
  }, [faturas])

  // Filtro visual de tipo (funciona pra demonstração)
  const eventosFiltrados = useMemo(() => {
    let r = eventos
    if (filtroTipo !== 'todos') {
      r = r.filter((e) => e.tipo === filtroTipo)
    }
    if (busca.trim()) {
      const q = busca.toLowerCase()
      r = r.filter(
        (e) =>
          e.titulo.toLowerCase().includes(q) ||
          e.descricao?.toLowerCase().includes(q) ||
          e.meta?.toLowerCase().includes(q)
      )
    }
    return r
  }, [eventos, filtroTipo, busca])

  return (
    <div className="ex-root">
      {/* ===== Header com filtros ===== */}
      <div className="ex-header">
        <div className="ex-titulo">
          <h3 className="ex-h3">Linha do tempo financeira</h3>
          <p className="ex-sub">
            Todos os lançamentos do processo em ordem cronológica
          </p>
        </div>

        <div className="ex-filtros">
          <div className="ex-filtro">
            <Calendar className="ex-filtro__icon" />
            <select
              value={filtroPeriodo}
              onChange={(e) => setFiltroPeriodo(e.target.value)}
              className="ex-filtro__select"
            >
              <option value="todos">Todo o período</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="90d">Últimos 90 dias</option>
              <option value="ano">Este ano</option>
            </select>
          </div>

          <div className="ex-filtro">
            <Filter className="ex-filtro__icon" />
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              className="ex-filtro__select"
            >
              <option value="todos">Todos os tipos</option>
              <option value="fatura">Faturas</option>
              <option value="pagamento">Pagamentos</option>
              <option value="custo">Custos</option>
              <option value="estorno">Estornos</option>
            </select>
          </div>

          <div className="ex-filtro ex-filtro--busca">
            <Search className="ex-filtro__icon" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar..."
              className="ex-filtro__input"
            />
          </div>
        </div>
      </div>

      {/* ===== Timeline ===== */}
      {loading ? (
        <div className="ex-state">
          <div className="ex-state__spinner" />
          <p>Carregando linha do tempo...</p>
        </div>
      ) : eventosFiltrados.length === 0 ? (
        <div className="ex-state">
          <Inbox className="ex-state__icon" />
          <p className="ex-state__titulo">Nenhum evento encontrado</p>
          <p className="ex-state__hint">
            {eventos.length === 0
              ? 'Quando houver faturas, pagamentos ou custos lançados, eles aparecerão aqui.'
              : 'Ajuste os filtros para ver mais eventos.'}
          </p>
        </div>
      ) : (
        <div className="ex-timeline">
          {/* Linha vertical conectando os eventos */}
          <div className="ex-timeline__line" aria-hidden />

          {eventosFiltrados.map((ev) => {
            const meta = META_TIPO[ev.tipo]
            const Icon = meta.icon
            return (
              <div key={ev.id} className="ex-evento">
                {/* Bolinha colorida */}
                <div
                  className="ex-evento__dot"
                  style={{ background: meta.bg, borderColor: meta.cor }}
                >
                  <Icon className="ex-evento__icon" />
                </div>

                {/* Card do evento */}
                <div className="ex-evento__card fin-card">
                  <div className="ex-evento__top">
                    <div className="ex-evento__topL">
                      <span
                        className="ex-evento__tag"
                        style={{ color: meta.cor, background: meta.bg }}
                      >
                        {meta.label}
                      </span>
                      <span className="ex-evento__data">{fmtDataBR(ev.data)}</span>
                    </div>
                    <div
                      className="ex-evento__valor"
                      style={{
                        color:
                          ev.tipo === 'pagamento'
                            ? 'var(--fin-green)'
                            : ev.tipo === 'estorno'
                              ? 'var(--fin-red)'
                              : 'var(--fin-ink)',
                      }}
                    >
                      {ev.tipo === 'pagamento' ? '+ ' : ''}
                      {fmtBRL(ev.valor)}
                    </div>
                  </div>

                  <p className="ex-evento__titulo">{ev.titulo}</p>
                  {ev.descricao && (
                    <p className="ex-evento__desc">{ev.descricao}</p>
                  )}
                  {ev.meta && <p className="ex-evento__meta">{ev.meta}</p>}
                </div>
              </div>
            )
          })}

          {/* Aviso final: itens não exibidos ainda */}
          <div className="ex-aviso">
            <span className="ex-aviso__badge">Em breve</span>
            <span>
              No Lote 4, o Extrato também vai exibir <b>custos lançados</b> e{' '}
              <b>estornos de pagamento</b> em tempo real.
            </span>
          </div>
        </div>
      )}

      <style jsx>{`
        .ex-root {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        /* === Header === */
        .ex-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          flex-wrap: wrap;
        }
        .ex-titulo {
          display: flex;
          flex-direction: column;
        }
        .ex-h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--fin-ink);
        }
        .ex-sub {
          margin: 2px 0 0;
          font-size: 13px;
          color: var(--fin-ink-3);
        }
        .ex-filtros {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .ex-filtro {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: white;
          border: 1px solid var(--fin-line);
          border-radius: var(--fin-radius-sm);
        }
        .ex-filtro--busca {
          min-width: 160px;
        }
        .ex-filtro__icon {
          width: 14px;
          height: 14px;
          color: var(--fin-ink-3);
          flex-shrink: 0;
        }
        .ex-filtro__select,
        .ex-filtro__input {
          border: none;
          background: transparent;
          font-size: 13px;
          color: var(--fin-ink);
          outline: none;
          font-family: inherit;
          width: 100%;
        }
        .ex-filtro__select {
          cursor: pointer;
          padding-right: 4px;
        }

        /* === Empty / loading === */
        .ex-state {
          padding: 48px 24px;
          text-align: center;
          background: var(--fin-bg-soft);
          border: 1px dashed var(--fin-line);
          border-radius: var(--fin-radius);
          color: var(--fin-ink-3);
        }
        .ex-state__icon {
          width: 36px;
          height: 36px;
          margin: 0 auto 8px;
          color: var(--fin-ink-3);
        }
        .ex-state__titulo {
          margin: 0 0 4px;
          font-weight: 600;
          color: var(--fin-ink);
        }
        .ex-state__hint {
          margin: 0;
          font-size: 13px;
          max-width: 420px;
          margin-inline: auto;
        }
        .ex-state__spinner {
          width: 24px;
          height: 24px;
          border: 2px solid var(--fin-line);
          border-top-color: var(--fin-purple-600);
          border-radius: 50%;
          margin: 0 auto 12px;
          animation: ex-spin 1s linear infinite;
        }
        @keyframes ex-spin {
          to {
            transform: rotate(360deg);
          }
        }

        /* === Timeline === */
        .ex-timeline {
          position: relative;
          padding-left: 28px;
        }
        .ex-timeline__line {
          position: absolute;
          left: 11px;
          top: 8px;
          bottom: 80px;
          width: 2px;
          background: var(--fin-line);
        }

        .ex-evento {
          position: relative;
          margin-bottom: 16px;
          padding-left: 24px;
        }
        .ex-evento__dot {
          position: absolute;
          left: -28px;
          top: 12px;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 2px solid;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1;
        }
        .ex-evento__icon {
          width: 12px;
          height: 12px;
          color: inherit;
        }
        .ex-evento__card {
          padding: 14px 16px;
        }
        .ex-evento__top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 6px;
        }
        .ex-evento__topL {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .ex-evento__tag {
          padding: 2px 8px;
          font-size: 11px;
          font-weight: 600;
          border-radius: 999px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .ex-evento__data {
          font-size: 12px;
          color: var(--fin-ink-3);
          font-variant-numeric: tabular-nums;
        }
        .ex-evento__valor {
          font-size: 15px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .ex-evento__titulo {
          margin: 0 0 2px;
          font-size: 14px;
          font-weight: 600;
          color: var(--fin-ink);
        }
        .ex-evento__desc {
          margin: 0 0 2px;
          font-size: 13px;
          color: var(--fin-ink-2);
        }
        .ex-evento__meta {
          margin: 4px 0 0;
          font-size: 12px;
          color: var(--fin-ink-3);
        }

        .ex-aviso {
          margin-top: 24px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          color: var(--fin-ink-3);
          background: var(--fin-bg-soft);
          border: 1px dashed var(--fin-line);
          border-radius: var(--fin-radius-sm);
        }
        .ex-aviso__badge {
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--fin-purple-600);
          background: var(--fin-purple-50);
          border-radius: 999px;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  )
}

export default Extrato