// src/components/financeiro/subabas/VisaoGeral.tsx
//
// Sub-aba "Visão Geral" do Financeiro.
// Mostra consolidado do processo: 4 KPIs + 2 donuts + mini-linha de projeção.
//
// Dados: busca as faturas da mesma API que o ProcessoFaturas/Receitas usa
// (/api/processos/:id/faturas) pra evitar divergência de totais.
//
// 🔧 v2: Tratamento de erro mais gracioso. Em vez de "throw new Error",
// capturamos o status HTTP e mostramos uma mensagem amigável na própria
// sub-aba. Isso evita que um 500 na API derrube a página inteira.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { DonutSVG } from '@/src/components/financeiro/charts/DonutSVG'
import { MiniLinhaSVG } from '@/src/components/financeiro/charts/MiniLinhaSVG'
import { fmtBRL, fmtBRLCompact } from '@/src/lib/financeiro/helpers'

// ----------------------------------------------------------------------------
// Tipos (compatíveis com a API atual que ProcessoFaturas já consome)
// ----------------------------------------------------------------------------
interface FaturaAPI {
  id: number
  descricao: string
  moeda: 'BRL' | 'EUR' | 'USD'
  cambio: number | null
  valor: number
  valorPago: number
  valorRestante: number
  status: 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'PARCIAL'
  dataEmissao: string
  dataVencimento: string | null
}

interface TotaisGeralBRL {
  total: number
  pago: number
  pendente: number
  vencido: number
}

export interface VisaoGeralProps {
  processoId: number
  nomeFamilia?: string
  // Opcional: chave de refresh pra forçar re-fetch quando o Receitas salva algo
  refreshKey?: number
}

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export function VisaoGeral({ processoId, refreshKey = 0 }: VisaoGeralProps) {
  const [faturas, setFaturas] = useState<FaturaAPI[]>([])
  const [totaisGeralBRL, setTotaisGeralBRL] = useState<TotaisGeralBRL>({
    total: 0,
    pago: 0,
    pendente: 0,
    vencido: 0,
  })
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [erroStatus, setErroStatus] = useState<number | null>(null)

  // ---- Carregar dados ------------------------------------------------------
  useEffect(() => {
    let cancelado = false

    async function carregar() {
      // Reset de estado
      setLoading(true)
      setErro(null)
      setErroStatus(null)

      try {
        const res = await fetch(`/api/processos/${processoId}/faturas`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
        })

        if (cancelado) return

        // ✅ Sem throw — tratamos o status HTTP como estado do componente,
        // não como exceção que derruba a árvore de componentes.
        if (!res.ok) {
          console.warn(
            `[VisaoGeral] API /api/processos/${processoId}/faturas respondeu ${res.status}`,
          )
          setErroStatus(res.status)
          setErro(
            res.status === 500
              ? 'O servidor não conseguiu responder. Isso geralmente acontece quando a conexão com o banco de dados está indisponível.'
              : res.status === 404
              ? 'Processo não encontrado.'
              : res.status === 401 || res.status === 403
              ? 'Sem permissão para ver o financeiro deste processo.'
              : `A API respondeu com erro (HTTP ${res.status}).`,
          )
          setFaturas([])
          setTotaisGeralBRL({ total: 0, pago: 0, pendente: 0, vencido: 0 })
          return
        }

        const data = await res.json()
        if (cancelado) return

        setFaturas(data.faturas || [])
        setTotaisGeralBRL(
          data.totaisGeralBRL || {
            total: 0,
            pago: 0,
            pendente: 0,
            vencido: 0,
          },
        )
      } catch (e) {
        // Aqui só cai em erro de rede (sem internet, CORS, etc)
        if (!cancelado) {
          console.error('[VisaoGeral] Erro de rede:', e)
          setErro(
            'Não foi possível se conectar ao servidor. Verifique sua conexão e tente novamente.',
          )
        }
      } finally {
        if (!cancelado) setLoading(false)
      }
    }

    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId, refreshKey])

  // ---- Métricas derivadas --------------------------------------------------
  const totalCobrado = totaisGeralBRL.total
  const recebido = totaisGeralBRL.pago
  const aReceber = totaisGeralBRL.pendente
  const vencido = totaisGeralBRL.vencido

  const qtdFaturas = faturas.length
  const qtdVencidas = faturas.filter((f) => f.status === 'VENCIDO').length
  const qtdPendentes = faturas.filter(
    (f) => f.status === 'PENDENTE' || f.status === 'PARCIAL',
  ).length
  const pctRecebido = totalCobrado > 0 ? (recebido / totalCobrado) * 100 : 0

  // ---- Donut 1: distribuição de valores (Recebido / A Receber / Vencido) ---
  const slicesValores = useMemo(
    () => [
      {
        label: 'Recebido',
        value: recebido,
        color: 'var(--fin-green)',
      },
      {
        label: 'A Receber',
        value: Math.max(aReceber - vencido, 0),
        color: 'var(--fin-yellow)',
      },
      {
        label: 'Vencido',
        value: vencido,
        color: 'var(--fin-red)',
      },
    ],
    [recebido, aReceber, vencido],
  )

  // ---- Donut 2: quantidade de faturas por status ---------------------------
  const slicesStatus = useMemo(() => {
    const pagas = faturas.filter((f) => f.status === 'PAGO').length
    const parciais = faturas.filter((f) => f.status === 'PARCIAL').length
    const pendentes = faturas.filter((f) => f.status === 'PENDENTE').length
    const vencidas = faturas.filter((f) => f.status === 'VENCIDO').length

    return [
      { label: 'Pagas', value: pagas, color: 'var(--fin-green)' },
      { label: 'Parciais', value: parciais, color: 'var(--fin-blue)' },
      { label: 'Pendentes', value: pendentes, color: 'var(--fin-yellow)' },
      { label: 'Vencidas', value: vencidas, color: 'var(--fin-red)' },
    ]
  }, [faturas])

  // ---- Mini-linha: projeção de vencimentos (acumulado por mês) -------------
  const pontosProjecao = useMemo(() => {
    const map = new Map<string, number>()

    faturas.forEach((f) => {
      if (!f.dataVencimento) return
      const d = new Date(f.dataVencimento)
      if (isNaN(d.getTime())) return

      const chave = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
        2,
        '0',
      )}`

      const valorBRL =
        f.moeda === 'BRL'
          ? f.valor
          : f.cambio
          ? f.valor * f.cambio
          : f.valor

      map.set(chave, (map.get(chave) || 0) + valorBRL)
    })

    const entries = Array.from(map.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    )

    let acc = 0
    return entries.map(([chave, v]) => {
      acc += v
      const [ano, mes] = chave.split('-')
      const nomesMeses = [
        'Jan',
        'Fev',
        'Mar',
        'Abr',
        'Mai',
        'Jun',
        'Jul',
        'Ago',
        'Set',
        'Out',
        'Nov',
        'Dez',
      ]
      const label = `${nomesMeses[parseInt(mes, 10) - 1]}/${ano.slice(2)}`
      return { x: label, y: acc }
    })
  }, [faturas])

  // ---- Render --------------------------------------------------------------
  if (loading) {
    return (
      <div className="vg-root">
        <div className="vg-loading">
          <div className="vg-spinner" />
          <p>Carregando visão geral...</p>
        </div>
        <style jsx>{`
          .vg-loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 80px 24px;
            gap: 12px;
            color: var(--fin-ink-3);
            font-size: 14px;
          }
          .vg-spinner {
            width: 32px;
            height: 32px;
            border: 3px solid var(--fin-line);
            border-top-color: var(--fin-purple);
            border-radius: 50%;
            animation: vg-spin 0.8s linear infinite;
          }
          @keyframes vg-spin {
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </div>
    )
  }

  if (erro) {
    return (
      <div className="vg-root">
        <div className="vg-error-card">
          <div className="vg-error-icon" aria-hidden>⚠️</div>
          <h3 className="vg-error-title">
            Não foi possível carregar a Visão Geral
          </h3>
          <p className="vg-error-msg">{erro}</p>
          {erroStatus !== null && (
            <p className="vg-error-status">
              Código do servidor: <code>HTTP {erroStatus}</code>
            </p>
          )}
          <p className="vg-error-hint">
            Você ainda pode usar as outras abas (Receitas, Custos, Extrato)
            normalmente enquanto isso é resolvido.
          </p>
        </div>
        <style jsx>{`
          .vg-error-card {
            background: var(--fin-red-50);
            border: 1px solid #fecaca;
            border-radius: var(--fin-radius);
            padding: 32px 28px;
            text-align: center;
            max-width: 560px;
            margin: 24px auto;
          }
          .vg-error-icon {
            font-size: 36px;
            line-height: 1;
            margin-bottom: 12px;
          }
          .vg-error-title {
            margin: 0 0 8px;
            font-size: 16px;
            font-weight: 600;
            color: #991b1b;
          }
          .vg-error-msg {
            margin: 0 0 10px;
            font-size: 14px;
            line-height: 1.5;
            color: #7f1d1d;
          }
          .vg-error-status {
            margin: 0 0 12px;
            font-size: 12px;
            color: #9f1239;
          }
          .vg-error-status code {
            background: rgba(220, 38, 38, 0.12);
            padding: 1px 6px;
            border-radius: 4px;
            font-family: ui-monospace, monospace;
          }
          .vg-error-hint {
            margin: 0;
            font-size: 12px;
            color: var(--fin-ink-3);
          }
        `}</style>
      </div>
    )
  }

  if (qtdFaturas === 0) {
    return (
      <div className="vg-root">
        <div className="fin-empty">
          <p className="fin-empty__title">Sem dados ainda</p>
          <p className="fin-empty__hint">
            Cadastre faturas na aba &quot;Receitas&quot; pra começar a ver a visão geral do
            processo.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="vg-root">
      {/* ===== 4 KPIs ===== */}
      <div className="fin-kpi-grid">
        <div className="fin-card fin-card--purple">
          <div className="fin-kpi">
            <span className="fin-kpi__label">Total Cobrado</span>
            <span className="fin-kpi__value fin-kpi__value--purple">
              {fmtBRL(totalCobrado)}
            </span>
            <span className="fin-kpi__hint">
              {qtdFaturas} {qtdFaturas === 1 ? 'lançamento' : 'lançamentos'}
            </span>
          </div>
        </div>

        <div className="fin-card fin-card--green">
          <div className="fin-kpi">
            <span className="fin-kpi__label">Recebido</span>
            <span className="fin-kpi__value fin-kpi__value--green">
              {fmtBRL(recebido)}
            </span>
            <span className="fin-kpi__hint">
              {pctRecebido.toFixed(0)}% do total
            </span>
          </div>
        </div>

        <div className="fin-card fin-card--yellow">
          <div className="fin-kpi">
            <span className="fin-kpi__label">A Receber</span>
            <span className="fin-kpi__value fin-kpi__value--yellow">
              {fmtBRL(aReceber)}
            </span>
            <span className="fin-kpi__hint">
              {qtdPendentes} {qtdPendentes === 1 ? 'item pendente' : 'itens pendentes'}
            </span>
          </div>
        </div>

        <div className="fin-card fin-card--red">
          <div className="fin-kpi">
            <span className="fin-kpi__label">Vencido</span>
            <span className="fin-kpi__value fin-kpi__value--red">
              {fmtBRL(vencido)}
            </span>
            <span className="fin-kpi__hint">
              {qtdVencidas} {qtdVencidas === 1 ? 'item em atraso' : 'itens em atraso'}
            </span>
          </div>
        </div>
      </div>

      {/* ===== 2 Donuts ===== */}
      <div className="vg-donuts">
        <div className="fin-card">
          <div className="fin-section__header">
            <h3 className="fin-section__title">Distribuição de valores</h3>
          </div>
          <div className="vg-donut-wrap">
            <DonutSVG
              slices={slicesValores}
              size={180}
              thickness={26}
              centerLabel="Total"
              centerValue={fmtBRLCompact(totalCobrado)}
              formatLegendValue={(v) => fmtBRL(v)}
              ariaLabel="Distribuição de valores do processo"
            />
          </div>
        </div>

        <div className="fin-card">
          <div className="fin-section__header">
            <h3 className="fin-section__title">Faturas por status</h3>
          </div>
          <div className="vg-donut-wrap">
            <DonutSVG
              slices={slicesStatus}
              size={180}
              thickness={26}
              centerLabel="Faturas"
              centerValue={String(qtdFaturas)}
              formatLegendValue={(v) => `${v}`}
              ariaLabel="Quantidade de faturas por status"
            />
          </div>
        </div>
      </div>

      {/* ===== Projeção ===== */}
      {pontosProjecao.length > 0 && (
        <div className="fin-card">
          <div className="fin-section__header">
            <h3 className="fin-section__title">
              Projeção acumulada de vencimentos
            </h3>
          </div>
          <div className="vg-linha-wrap">
            <MiniLinhaSVG
              points={pontosProjecao}
              width={720}
              height={160}
              color="var(--fin-purple)"
              formatY={(v) => fmtBRLCompact(v)}
              ariaLabel="Projeção acumulada de vencimentos no tempo"
            />
          </div>
        </div>
      )}

      <style jsx>{`
        .vg-donuts {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 16px;
        }
        .vg-donut-wrap {
          display: flex;
          justify-content: center;
          padding: 12px 0 4px;
        }
        .vg-linha-wrap {
          overflow-x: auto;
          padding: 8px 0 4px;
        }
      `}</style>
    </div>
  )
}

export default VisaoGeral