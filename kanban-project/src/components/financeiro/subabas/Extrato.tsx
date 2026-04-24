// src/components/financeiro/subabas/Extrato.tsx
//
// Sub-aba "Extrato" do Financeiro.
//
// 🆕 LOTE 4 BLOCO 3 (reforma completa pro mockup do Marco):
//
//   - Gráfico "Saldo progressivo do processo" no topo (linha verde
//     acumulada ao longo do tempo).
//   - Header de filtros com: tipo, pagador, intervalo de datas (de/até),
//     botão Limpar, botão Exportar PDF (placeholder).
//   - Timeline agrupada por DIA, com header "22 DE ABRIL" + saldo do dia
//     à direita.
//   - Eventos mais ricos:
//       🟣 Lançamento criado (fatura emitida) — descrição + categoria + moeda
//       🟢 Pagamento recebido — valor em destaque grande, pagador, forma
//       🔴 Atrasado — faturas vencidas com "Venceu DD/MM/YYYY · X dias em atraso"
//
// Os custos da aba Custos não aparecem aqui ainda porque a TabelaCustos
// não guarda data por lançamento (só o total). No Lote 5 quando OutrosCustos
// entrar em produção, esses eventos também virão pra cá.

'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  Filter,
  Users,
  FileText,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Inbox,
  X as XIcon,
  FileDown,
} from 'lucide-react'
import { fmtBRL, fmtBRLCompact, fmtDataBR } from '@/src/lib/financeiro/helpers'
import { MiniLinhaSVG } from '@/src/components/financeiro/charts/MiniLinhaSVG'

// ============================================================================
// Tipos
// ============================================================================

type TipoEvento = 'fatura' | 'pagamento' | 'atrasado' | 'custo' | 'estorno'

interface Pagador {
  id: number
  nome: string
}

interface EventoExtrato {
  id: string
  tipo: TipoEvento
  data: string // ISO
  titulo: string
  descricao?: string
  valor: number
  moeda?: 'BRL' | 'EUR' | 'USD'
  meta?: string
  pagador?: string
  parcelado?: boolean
  diasAtraso?: number
  categoria?: string
}

interface PagamentoApi {
  id: number
  valor?: number | null
  valorOriginal?: number | null
  cambio?: number | null
  data?: string | null
  formaPagamento?: string | null
  destinatarios?: Pagador[]
}

interface FaturaApi {
  id: number
  descricao?: string | null
  valor?: number | null
  valorPago?: number | null
  valorRestante?: number | null
  moeda?: 'BRL' | 'EUR' | 'USD' | null
  cambio?: number | null
  status?: string | null
  dataEmissao?: string | null
  dataVencimento?: string | null
  createdAt?: string | null
  parcelas?: number | null
  metodoPagamento?: string | null
  pagamentos?: PagamentoApi[]
  destinatarios?: Pagador[]
}

export interface ExtratoProps {
  processoId: number
  nomeFamilia?: string
}

// ============================================================================
// Visual helpers
// ============================================================================

const META_TIPO: Record<
  TipoEvento,
  {
    label: string
    cor: string
    bg: string
    border: string
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  fatura: {
    label: 'Lançamento criado',
    cor: '#7c3aed',
    bg: '#faf5ff',
    border: '#e9d5ff',
    icon: FileText,
  },
  pagamento: {
    label: 'Pagamento recebido',
    cor: '#15803d',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    icon: CheckCircle2,
  },
  atrasado: {
    label: 'Atrasado',
    cor: '#b91c1c',
    bg: '#fef2f2',
    border: '#fecaca',
    icon: AlertCircle,
  },
  custo: {
    label: 'Custo lançado',
    cor: '#ca8a04',
    bg: '#fefce8',
    border: '#fef08a',
    icon: RotateCcw,
  },
  estorno: {
    label: 'Estorno',
    cor: '#b91c1c',
    bg: '#fef2f2',
    border: '#fecaca',
    icon: RotateCcw,
  },
}

// ============================================================================
// Helpers de data
// ============================================================================

function toDateOnly(isoString: string): Date {
  const d = new Date(isoString)
  d.setHours(0, 0, 0, 0)
  return d
}

function dataKey(isoString: string): string {
  const d = toDateOnly(isoString)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

function formatDiaExtenso(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00')
  const meses = [
    'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
    'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
  ]
  return `${d.getDate()} DE ${meses[d.getMonth()]}`
}

function diasEntre(a: Date, b: Date): number {
  const MS_DIA = 1000 * 60 * 60 * 24
  return Math.floor((b.getTime() - a.getTime()) / MS_DIA)
}

// ============================================================================
// Componente
// ============================================================================

export function Extrato({ processoId }: ExtratoProps) {
  const [faturas, setFaturas] = useState<FaturaApi[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Filtros
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')
  const [filtroPagador, setFiltroPagador] = useState<string>('todos')
  const [dataInicio, setDataInicio] = useState<string>('')
  const [dataFim, setDataFim] = useState<string>('')

  // ========================================================================
  // Fetch
  // ========================================================================
  useEffect(() => {
    let cancelado = false

    async function load() {
      try {
        setLoading(true)
        setErro(null)
        const res = await fetch(`/api/processos/${processoId}/faturas`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
        })

        if (cancelado) return

        if (!res.ok) {
          console.warn(`[Extrato] /faturas respondeu ${res.status}`)
          setErro('Não foi possível carregar o extrato.')
          setFaturas([])
          return
        }

        const data = await res.json()
        if (cancelado) return

        // 🐛 FIX: A API retorna { faturas: [...], totais: {...} }, não um array direto
        const lista = data?.faturas ?? (Array.isArray(data) ? data : [])
        setFaturas(lista)
      } catch (err) {
        console.error('[Extrato] erro carregando faturas:', err)
        if (!cancelado) {
          setErro('Não foi possível se conectar ao servidor.')
          setFaturas([])
        }
      } finally {
        if (!cancelado) setLoading(false)
      }
    }

    load()
    return () => {
      cancelado = true
    }
  }, [processoId])

  // ========================================================================
  // Construção dos eventos
  // ========================================================================
  const { eventos, pagadoresUnicos } = useMemo(() => {
    const lista: EventoExtrato[] = []
    const pagadoresSet = new Set<string>()
    const hoje = toDateOnly(new Date().toISOString())

    for (const f of faturas) {
      const valorBRL =
        f.moeda === 'BRL' || !f.moeda
          ? Number(f.valor ?? 0)
          : f.cambio
          ? Number(f.valor ?? 0) * Number(f.cambio)
          : Number(f.valor ?? 0)

      // ---- Evento: Lançamento criado (fatura) ----
      const dataEmissao = f.dataEmissao || f.createdAt
      if (dataEmissao) {
        lista.push({
          id: `fatura-${f.id}`,
          tipo: 'fatura',
          data: dataEmissao,
          titulo: f.descricao || `Fatura #${f.id}`,
          descricao: 'Honorários',
          valor: valorBRL,
          moeda: (f.moeda ?? 'BRL') as 'BRL' | 'EUR' | 'USD',
          meta: `Fatura #${f.id}`,
          categoria: f.moeda && f.moeda !== 'BRL' ? f.moeda : undefined,
        })
      }

      // ---- Eventos: Pagamentos recebidos ----
      for (const p of f.pagamentos ?? []) {
        if (!p.data) continue

        const valorPagBRL = p.valorOriginal
          ? Number(p.valorOriginal)
          : p.cambio
          ? Number(p.valor ?? 0) * Number(p.cambio)
          : Number(p.valor ?? 0)

        // Determina o nome do pagador (primeiro destinatário, se houver)
        let nomePagador: string | undefined
        if (p.destinatarios && p.destinatarios.length > 0) {
          nomePagador = p.destinatarios[0].nome
          p.destinatarios.forEach((d) => pagadoresSet.add(d.nome))
        } else if (f.destinatarios && f.destinatarios.length > 0) {
          nomePagador = f.destinatarios[0].nome
          f.destinatarios.forEach((d) => pagadoresSet.add(d.nome))
        }

        const eParcelado = (f.parcelas ?? 1) > 1

        lista.push({
          id: `pag-${p.id}`,
          tipo: 'pagamento',
          data: p.data,
          titulo: 'Pagamento recebido',
          descricao: f.descricao || `Referente à Fatura #${f.id}`,
          valor: valorPagBRL,
          moeda: 'BRL',
          meta: p.formaPagamento || undefined,
          pagador: nomePagador,
          parcelado: eParcelado,
        })
      }

      // ---- Evento: Atrasado (fatura vencida com saldo em aberto) ----
      if (
        f.dataVencimento &&
        (f.status === 'VENCIDO' ||
          (f.status !== 'PAGO' &&
            Number(f.valorRestante ?? 0) > 0 &&
            toDateOnly(f.dataVencimento).getTime() < hoje.getTime()))
      ) {
        const dataVenc = toDateOnly(f.dataVencimento)
        const dias = diasEntre(dataVenc, hoje)

        // Mostra o evento "Atrasado" com data = hoje (pra aparecer no topo
        // quando o user olha o extrato), mas com a info do vencimento no texto.
        // Usamos a data de vencimento como chave do grupo pra ficar junto
        // com o que aconteceu naquele dia.
        lista.push({
          id: `atraso-${f.id}`,
          tipo: 'atrasado',
          data: f.dataVencimento,
          titulo: f.descricao || `Fatura #${f.id}`,
          descricao: `Venceu ${fmtDataBR(f.dataVencimento)}`,
          valor: Number(f.valorRestante ?? 0),
          moeda: 'BRL',
          diasAtraso: dias,
        })
      }
    }

    // Ordena: mais recentes primeiro
    lista.sort(
      (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime(),
    )

    return {
      eventos: lista,
      pagadoresUnicos: Array.from(pagadoresSet).sort(),
    }
  }, [faturas])

  // ========================================================================
  // Filtros aplicados
  // ========================================================================
  const eventosFiltrados = useMemo(() => {
    let r = eventos

    if (filtroTipo !== 'todos') {
      r = r.filter((e) => e.tipo === filtroTipo)
    }

    if (filtroPagador !== 'todos') {
      r = r.filter((e) => e.pagador === filtroPagador)
    }

    if (dataInicio) {
      const ini = new Date(dataInicio + 'T00:00:00').getTime()
      r = r.filter((e) => new Date(e.data).getTime() >= ini)
    }

    if (dataFim) {
      const fim = new Date(dataFim + 'T23:59:59').getTime()
      r = r.filter((e) => new Date(e.data).getTime() <= fim)
    }

    return r
  }, [eventos, filtroTipo, filtroPagador, dataInicio, dataFim])

  // ========================================================================
  // Saldo progressivo (todos os pagamentos recebidos, acumulado por dia)
  // ========================================================================
  const pontosSaldo = useMemo(() => {
    const pagamentos = eventos
      .filter((e) => e.tipo === 'pagamento')
      .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())

    if (pagamentos.length === 0) return []

    // Agrupa por dia, somando
    const porDia = new Map<string, number>()
    pagamentos.forEach((p) => {
      const chave = dataKey(p.data)
      porDia.set(chave, (porDia.get(chave) || 0) + p.valor)
    })

    // Converte pra pontos acumulados
    let acumulado = 0
    const pontos: { x: string; y: number }[] = []
    Array.from(porDia.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([chave, valor]) => {
        acumulado += valor
        const d = new Date(chave + 'T00:00:00')
        const label = `${d.getDate().toString().padStart(2, '0')}/${(
          d.getMonth() + 1
        )
          .toString()
          .padStart(2, '0')}`
        pontos.push({ x: label, y: acumulado })
      })

    return pontos
  }, [eventos])

  const saldoAtual = pontosSaldo[pontosSaldo.length - 1]?.y ?? 0

  // ========================================================================
  // Agrupamento por dia
  // ========================================================================
  const eventosAgrupados = useMemo(() => {
    const grupos = new Map<string, EventoExtrato[]>()

    eventosFiltrados.forEach((ev) => {
      const chave = dataKey(ev.data)
      if (!grupos.has(chave)) grupos.set(chave, [])
      grupos.get(chave)!.push(ev)
    })

    // Ordena por data decrescente
    return Array.from(grupos.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [eventosFiltrados])

  // Saldo do dia = soma dos pagamentos - estornos desse dia
  function saldoDoDia(eventos: EventoExtrato[]): number {
    return eventos.reduce((acc, ev) => {
      if (ev.tipo === 'pagamento') return acc + ev.valor
      if (ev.tipo === 'estorno') return acc - ev.valor
      return acc
    }, 0)
  }

  // ========================================================================
  // Helpers de render
  // ========================================================================
  function limparFiltros() {
    setFiltroTipo('todos')
    setFiltroPagador('todos')
    setDataInicio('')
    setDataFim('')
  }

  const temFiltrosAtivos =
    filtroTipo !== 'todos' ||
    filtroPagador !== 'todos' ||
    !!dataInicio ||
    !!dataFim

  // ========================================================================
  // Render
  // ========================================================================
  return (
    <div className="ex-root">
      {/* ===== Header da seção ===== */}
      <div className="ex-header">
        <div className="ex-titulo">
          <h3 className="ex-h3">
            <span className="ex-h3__icon" aria-hidden>📋</span>
            Extrato Cronológico
          </h3>
          <p className="ex-sub">
            Timeline de todos os eventos financeiros
          </p>
        </div>
        <button
          type="button"
          className="ex-header__btn"
          disabled
          title="Em breve"
        >
          <FileDown className="ex-header__btn-icon" />
          Relatórios ▾
        </button>
      </div>

      {/* ===== Filtros ===== */}
      <div className="ex-filtros-bar">
        <div className="ex-filtro">
          <Filter className="ex-filtro__icon" />
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="ex-filtro__select"
          >
            <option value="todos">
              Todos os tipos ({eventos.length})
            </option>
            <option value="fatura">Faturas</option>
            <option value="pagamento">Pagamentos</option>
            <option value="atrasado">Atrasados</option>
          </select>
        </div>

        <div className="ex-filtro">
          <Users className="ex-filtro__icon" />
          <select
            value={filtroPagador}
            onChange={(e) => setFiltroPagador(e.target.value)}
            className="ex-filtro__select"
          >
            <option value="todos">
              Todos os pagadores ({pagadoresUnicos.length})
            </option>
            {pagadoresUnicos.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="ex-filtro">
          <Calendar className="ex-filtro__icon" />
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="ex-filtro__date"
            placeholder="De"
          />
          <span className="ex-filtro__sep">até</span>
          <input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="ex-filtro__date"
            placeholder="Até"
          />
        </div>

        {temFiltrosAtivos && (
          <button
            type="button"
            onClick={limparFiltros}
            className="ex-filtro__limpar"
            title="Limpar filtros"
          >
            <XIcon className="ex-filtro__icon" />
            Limpar
          </button>
        )}

        <button
          type="button"
          className="ex-filtro__export"
          disabled
          title="Em breve"
        >
          <FileDown className="ex-filtro__icon" />
          Exportar PDF
        </button>
      </div>

      {/* ===== Gráfico de saldo progressivo ===== */}
      {!loading && !erro && pontosSaldo.length > 0 && (
        <div className="fin-card ex-saldo-card">
          <div className="ex-saldo-header">
            <div>
              <h4 className="ex-saldo-title">Saldo progressivo do processo</h4>
              <p className="ex-saldo-sub">
                Evolução entradas menos saídas acumulado no tempo
              </p>
            </div>
            <div className="ex-saldo-valor">
              <span className="ex-saldo-valor__label">SALDO ATUAL</span>
              <span className="ex-saldo-valor__num">
                +{fmtBRL(saldoAtual)}
              </span>
            </div>
          </div>

          <div className="ex-saldo-grafico">
            <MiniLinhaSVG
              points={pontosSaldo}
              width={720}
              height={180}
              color="#16a34a"
              formatY={(v) => fmtBRLCompact(v)}
              ariaLabel="Gráfico de saldo progressivo"
            />
          </div>
          <p className="ex-saldo-zero">zero</p>
        </div>
      )}

      {/* ===== Timeline ===== */}
      {loading ? (
        <div className="ex-state">
          <div className="ex-state__spinner" />
          <p>Carregando extrato...</p>
        </div>
      ) : erro ? (
        <div className="ex-error">
          <AlertCircle className="ex-error__icon" />
          <p>{erro}</p>
        </div>
      ) : eventosFiltrados.length === 0 ? (
        <div className="ex-state">
          <Inbox className="ex-state__icon" />
          <p className="ex-state__titulo">Nenhum evento encontrado</p>
          <p className="ex-state__hint">
            {eventos.length === 0
              ? 'Quando houver faturas, pagamentos ou lançamentos, eles aparecerão aqui.'
              : 'Ajuste os filtros para ver mais eventos.'}
          </p>
        </div>
      ) : (
        <div className="ex-timeline">
          {eventosAgrupados.map(([diaKey, eventosDia]) => {
            const saldo = saldoDoDia(eventosDia)
            return (
              <div key={diaKey} className="ex-dia">
                {/* Header do dia */}
                <div className="ex-dia__header">
                  <span className="ex-dia__label">
                    {formatDiaExtenso(diaKey)}
                  </span>
                  {saldo !== 0 && (
                    <span
                      className={`ex-dia__saldo ${
                        saldo >= 0 ? 'ex-dia__saldo--pos' : 'ex-dia__saldo--neg'
                      }`}
                    >
                      Saldo do dia: {saldo >= 0 ? '+' : ''}
                      {fmtBRL(saldo)}
                    </span>
                  )}
                </div>

                {/* Eventos do dia */}
                <div className="ex-dia__eventos">
                  {eventosDia.map((ev) => {
                    const meta = META_TIPO[ev.tipo]
                    const Icon = meta.icon
                    const destaque =
                      ev.tipo === 'pagamento' || ev.tipo === 'atrasado'
                    return (
                      <div
                        key={ev.id}
                        className={`ex-evento ex-evento--${ev.tipo}`}
                        style={{
                          borderLeftColor: meta.cor,
                          background: meta.bg,
                        }}
                      >
                        <div
                        className="ex-evento__dot"
                        aria-hidden
                        style={{ color: meta.cor }}
                        >
                        <Icon className="ex-evento__dot-icon" />
                        </div>

                        <div className="ex-evento__body">
                          <div className="ex-evento__linha1">
                            <span className="ex-evento__titulo">
                              {ev.tipo === 'fatura' && '↙ '}
                              {ev.tipo === 'pagamento' && '💰 '}
                              {ev.tipo === 'atrasado' && '⏰ '}
                              {meta.label} · {ev.titulo}
                            </span>
                            {ev.diasAtraso !== undefined &&
                              ev.diasAtraso > 0 && (
                                <span className="ex-evento__badge-atraso">
                                  {ev.diasAtraso === 1
                                    ? '1 dia em atraso'
                                    : `${ev.diasAtraso} dias em atraso`}
                                </span>
                              )}
                          </div>

                          {ev.descricao && (
                            <p className="ex-evento__desc">
                              {ev.descricao}
                              {ev.categoria && (
                                <>
                                  {' · '}
                                  <span className="ex-evento__tag">
                                    {ev.categoria}
                                  </span>
                                </>
                              )}
                              {ev.meta && (
                                <>
                                  {' · '}
                                  <span>{ev.meta}</span>
                                </>
                              )}
                            </p>
                          )}

                          {(ev.pagador || ev.parcelado) && (
                            <p className="ex-evento__meta">
                              {ev.pagador && (
                                <span>
                                  Pago por <strong>{ev.pagador}</strong>
                                </span>
                              )}
                              {ev.pagador && ev.parcelado && ' · '}
                              {ev.parcelado && <span>Parcelado</span>}
                            </p>
                          )}

                          {destaque && (
                            <div
                              className="ex-evento__valor-destaque"
                              style={{ color: meta.cor }}
                            >
                              {ev.tipo === 'pagamento' && '+'}
                              {fmtBRL(ev.valor)}
                            </div>
                          )}
                        </div>

                        {!destaque && (
                          <div className="ex-evento__valor">
                            {fmtBRL(ev.valor)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ===== CSS ===== */}
      <style jsx>{`
        .ex-root {
          display: flex;
          flex-direction: column;
          gap: 16px;
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
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .ex-h3__icon {
          font-size: 18px;
          line-height: 1;
        }
        .ex-sub {
          margin: 2px 0 0;
          font-size: 12px;
          color: var(--fin-ink-3);
        }
        .ex-header__btn {
          border: 1px solid var(--fin-line);
          background: var(--fin-bg);
          border-radius: 8px;
          padding: 6px 12px;
          font-size: 12px;
          color: var(--fin-ink-2);
          cursor: not-allowed;
          opacity: 0.6;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .ex-header__btn-icon {
          width: 14px;
          height: 14px;
        }

        /* === Filtros bar === */
        .ex-filtros-bar {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .ex-filtro {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: var(--fin-bg);
          border: 1px solid var(--fin-line);
          border-radius: 8px;
        }
        .ex-filtro__icon {
          width: 14px;
          height: 14px;
          color: var(--fin-ink-3);
          flex-shrink: 0;
        }
        .ex-filtro__select,
        .ex-filtro__date {
          border: none;
          background: transparent;
          font-size: 13px;
          color: var(--fin-ink);
          outline: none;
          font-family: inherit;
        }
        .ex-filtro__select {
          cursor: pointer;
          padding-right: 4px;
        }
        .ex-filtro__date {
          width: 130px;
        }
        .ex-filtro__sep {
          font-size: 12px;
          color: var(--fin-ink-3);
        }
        .ex-filtro__limpar,
        .ex-filtro__export {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border: 1px solid var(--fin-line);
          background: var(--fin-bg);
          border-radius: 8px;
          font-size: 13px;
          color: var(--fin-ink-2);
          cursor: pointer;
          font-family: inherit;
        }
        .ex-filtro__limpar:hover {
          background: var(--fin-bg-soft);
        }
        .ex-filtro__export {
          cursor: not-allowed;
          opacity: 0.6;
        }

        /* === Saldo progressivo === */
        .ex-saldo-card {
          padding: 20px 24px;
        }
        .ex-saldo-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 12px;
        }
        .ex-saldo-title {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--fin-ink);
        }
        .ex-saldo-sub {
          margin: 2px 0 0;
          font-size: 12px;
          color: var(--fin-ink-3);
        }
        .ex-saldo-valor {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }
        .ex-saldo-valor__label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--fin-ink-3);
        }
        .ex-saldo-valor__num {
          font-size: 18px;
          font-weight: 700;
          color: #15803d;
          font-variant-numeric: tabular-nums;
        }
        .ex-saldo-grafico {
          overflow-x: auto;
          padding: 4px 0;
        }
        .ex-saldo-zero {
          margin: -4px 0 0;
          text-align: right;
          font-size: 10px;
          color: var(--fin-ink-3);
          letter-spacing: 0.04em;
        }

        /* === Loading / empty / erro === */
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
          border-top-color: var(--fin-purple-600, #7c3aed);
          border-radius: 50%;
          margin: 0 auto 12px;
          animation: ex-spin 1s linear infinite;
        }
        @keyframes ex-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .ex-error {
          padding: 24px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: var(--fin-radius);
          color: #991b1b;
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 14px;
        }
        .ex-error__icon {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
        }

        /* === Timeline === */
        .ex-timeline {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .ex-dia {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ex-dia__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          background: #faf5ff;
          border: 1px solid #e9d5ff;
          border-left: 4px solid #7c3aed;
          border-radius: 8px;
        }
        .ex-dia__label {
          font-size: 12px;
          font-weight: 700;
          color: #6b21a8;
          letter-spacing: 0.06em;
        }
        .ex-dia__saldo {
          font-size: 12px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .ex-dia__saldo--pos {
          color: #15803d;
        }
        .ex-dia__saldo--neg {
          color: #b91c1c;
        }
        .ex-dia__eventos {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-left: 12px;
        }

        /* === Evento === */
        .ex-evento {
          position: relative;
          display: flex;
          gap: 12px;
          padding: 12px 16px;
          border: 1px solid var(--fin-line);
          border-left: 4px solid;
          border-radius: 8px;
          align-items: flex-start;
        }
        .ex-evento__dot {
          flex-shrink: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .ex-evento__dot-icon {
          width: 16px;
          height: 16px;
        }
        .ex-evento__body {
          flex: 1;
          min-width: 0;
        }
        .ex-evento__linha1 {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 2px;
        }
        .ex-evento__titulo {
          font-size: 13px;
          font-weight: 600;
          color: var(--fin-ink);
        }
        .ex-evento__badge-atraso {
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 700;
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          border-radius: 999px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .ex-evento__desc {
          margin: 0;
          font-size: 12px;
          color: var(--fin-ink-2);
          line-height: 1.5;
        }
        .ex-evento__tag {
          display: inline-block;
          padding: 1px 6px;
          font-size: 10px;
          font-weight: 600;
          background: #eff6ff;
          color: #1d4ed8;
          border-radius: 4px;
        }
        .ex-evento__meta {
          margin: 4px 0 0;
          font-size: 11px;
          color: var(--fin-ink-3);
        }
        .ex-evento__valor {
          font-size: 14px;
          font-weight: 700;
          color: var(--fin-ink);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .ex-evento__valor-destaque {
          margin-top: 6px;
          font-size: 20px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  )
}

export default Extrato