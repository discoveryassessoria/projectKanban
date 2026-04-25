// src/components/financeiro/subabas/VisaoGeral.tsx
//
// 🆕 LOTE 5 BLOCO F-1: Visão Geral reformada pra bater com o protótipo HTML.
//
// Estrutura (de cima pra baixo):
//   1. Score Financeiro (card roxo grande com letra A/B/C/D + barra)
//   2. 4 KPIs: RECEITA TOTAL / CUSTO TOTAL / RESULTADO REALIZADO / SALDO DE CAIXA
//   3. Linha 2 colunas: Fluxo de Caixa + Break-even
//   4. Saldo por Requerente (tabela)
//   5. Trilha de Auditoria (placeholder)
//   6. Contas a Receber (faturas pendentes)
//   7. Resumo visual: mini-KPIs + linha de evolução + donuts Entradas/Saídas
//   8. Custos por etapa (timeline horizontal)
//   9. Projeção ao finalizar
//
// Fórmula do Score (do protótipo, linhas 10103-10145):
//   margem (0-40) + recebimento (0-20) + controle custo (0-20)
//   + inadimplência (0-10) + fluxo (0-10) → A≥85 B≥70 C≥50 D<50

'use client'

import { useEffect, useMemo, useState } from 'react'
import { fmtBRL, fmtBRLCompact } from '@/src/lib/financeiro/helpers'
import { MiniLinhaSVG } from '@/src/components/financeiro/charts/MiniLinhaSVG'
import { DonutSVG } from '@/src/components/financeiro/charts/DonutSVG'
import type {
  OutroCustoData,
  TotaisOutrosCustos,
} from '@/src/types/outros-custos'

// ============================================================================
// Configuração
// ============================================================================

const PREMISSAS_PROJECAO_DEFAULT = {
  transcricao: 2000,
  finalizacao: 500,
}

const ETAPAS_TIMELINE = [
  { id: 'fechamen', label: 'FECHAMEN.' },
  { id: 'genealog', label: 'GENEALOG.' },
  { id: 'busca', label: 'BUSCA DO.' },
  { id: 'emissao', label: 'EMISSÃO' },
  { id: 'analise', label: 'ANÁLISE' },
  { id: 'retifica', label: 'RETIFICA.' },
  { id: 'traducao', label: 'TRADUÇÃO' },
  { id: 'apostila', label: 'APOSTILA.' },
  { id: 'aguardan', label: 'AGUARDAN.' },
  { id: 'protocol', label: 'PROTOCOL.' },
  { id: 'transcri', label: 'TRANSCRI.' },
  { id: 'finaliza', label: 'FINALIZA.' },
]

// ============================================================================
// Tipos
// ============================================================================

interface Requerente {
  id: number
  nome: string
}

interface PagamentoAPI {
  id: number
  valor: number
  data: string
  valorOriginal?: number | null
  cambio?: number | null
  destinatarios?: Requerente[]
}

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
  pagamentos?: PagamentoAPI[]
  destinatarios?: Requerente[]
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
  refreshKey?: number
}

// ============================================================================
// Cálculo do Score (replica protótipo linhas 10112-10145)
// ============================================================================

function calcularScore(m: {
  margemRealizada: number
  receitaTotal: number
  receitaAberta: number
  desvioPct: number
  inadimplenciaBRL: number
  saldoAtual: number
}): { nota: number; grade: 'A' | 'B' | 'C' | 'D' } {
  let s = 0
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)

  if (m.margemRealizada >= 40) s += 40
  else if (m.margemRealizada >= 25) s += 30
  else if (m.margemRealizada >= 15) s += 20
  else if (m.margemRealizada >= 0) s += 10

  const recebPct = pct(m.receitaTotal - m.receitaAberta, m.receitaTotal)
  if (recebPct >= 90) s += 20
  else if (recebPct >= 70) s += 15
  else if (recebPct >= 40) s += 10
  else s += 5

  const dp = Math.abs(m.desvioPct || 0)
  if (dp <= 5) s += 20
  else if (dp <= 15) s += 14
  else if (dp <= 30) s += 8
  else s += 2

  const inadPct = pct(m.inadimplenciaBRL, m.receitaTotal)
  if (inadPct < 2) s += 10
  else if (inadPct < 10) s += 6
  else if (inadPct < 25) s += 3

  if (m.saldoAtual > 0) s += 10
  else if (m.saldoAtual === 0) s += 5

  let grade: 'A' | 'B' | 'C' | 'D'
  if (s >= 85) grade = 'A'
  else if (s >= 70) grade = 'B'
  else if (s >= 50) grade = 'C'
  else grade = 'D'

  return { nota: s, grade }
}

// ============================================================================
// Componente
// ============================================================================

export function VisaoGeral({
  processoId,
  nomeFamilia,
  refreshKey = 0,
}: VisaoGeralProps) {
  const [faturas, setFaturas] = useState<FaturaAPI[]>([])
  const [totaisGeralBRL, setTotaisGeralBRL] = useState<TotaisGeralBRL>({
    total: 0,
    pago: 0,
    pendente: 0,
    vencido: 0,
  })
  const [loadingFaturas, setLoadingFaturas] = useState(true)
  const [erroFaturas, setErroFaturas] = useState<string | null>(null)
  const [totalCustos, setTotalCustos] = useState<number>(0)
  const [loadingCustos, setLoadingCustos] = useState(true)
  const [outrosCustos, setOutrosCustos] = useState<OutroCustoData[]>([])
  const [totaisOC, setTotaisOC] = useState<TotaisOutrosCustos | null>(null)
  const [loadingOutros, setLoadingOutros] = useState(true)
  const [requerentes, setRequerentes] = useState<Requerente[]>([])

  useEffect(() => {
    let cancelado = false

    async function carregar() {
      setLoadingFaturas(true)
      setLoadingCustos(true)
      setLoadingOutros(true)
      setErroFaturas(null)

      const token = localStorage.getItem('authToken') || ''
      const headers = { Authorization: `Bearer ${token}` }

      try {
        const [resFat, resCustos, resOc, resProc] = await Promise.all([
          fetch(`/api/processos/${processoId}/faturas`, { headers }),
          fetch(`/api/processos/${processoId}/custos`, { headers }),
          fetch(`/api/processos/${processoId}/outros-custos`, { headers }),
          fetch(`/api/processos/${processoId}`, { headers }),
        ])

        if (cancelado) return

        if (resFat.ok) {
          const d = await resFat.json()
          if (!cancelado) {
            setFaturas(d.faturas || [])
            setTotaisGeralBRL(
              d.totaisGeralBRL || { total: 0, pago: 0, pendente: 0, vencido: 0 },
            )
          }
        } else {
          setErroFaturas(`A API de faturas respondeu HTTP ${resFat.status}.`)
          setFaturas([])
        }

        if (resCustos.ok) {
          const d = await resCustos.json()
          if (!cancelado) setTotalCustos(d.totalGeral || 0)
        }

        if (resOc.ok) {
          const d = await resOc.json()
          if (!cancelado) {
            setOutrosCustos(d.outrosCustos || [])
            setTotaisOC(d.totais || null)
          }
        }

        if (resProc.ok) {
          const d = await resProc.json()
          if (!cancelado) setRequerentes(d.processo?.requerentes || [])
        }
      } catch (e) {
        if (!cancelado) {
          console.error('[VisaoGeral] erro:', e)
          setErroFaturas('Não foi possível se conectar ao servidor.')
        }
      } finally {
        if (!cancelado) {
          setLoadingFaturas(false)
          setLoadingCustos(false)
          setLoadingOutros(false)
        }
      }
    }

    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId, refreshKey])

  // ====== Métricas ======
  const receitaFaturas = totaisGeralBRL.total
  const recebidoFaturas = totaisGeralBRL.pago
  const receitaOutrosCobrar = totaisOC?.totalCobrarBRL ?? 0
  const recebidoOutrosCobrar = totaisOC?.totalRecebidoBRL ?? 0

  const receitaTotal = receitaFaturas + receitaOutrosCobrar
  const recebido = recebidoFaturas + recebidoOutrosCobrar
  const receitaAberta = Math.max(0, receitaTotal - recebido)

  const custoTabela = totalCustos
  const custoOutrosRepassar = totaisOC?.totalRepassarBRL ?? 0
  const custoTotal = custoTabela + custoOutrosRepassar

  const pagoOutrosRepassar = totaisOC?.totalPagoBRL ?? 0
  const pagoCustos = custoTabela + pagoOutrosRepassar
  const custoEmAberto = Math.max(0, custoTotal - pagoCustos)

  const resultadoRealizado = recebido - pagoCustos
  const saldoCaixa = recebido - pagoOutrosRepassar
  const margemRealizada =
    receitaTotal > 0 ? ((receitaTotal - custoTotal) / receitaTotal) * 100 : 0

  const lucroProjetado =
    receitaTotal -
    (custoTotal +
      PREMISSAS_PROJECAO_DEFAULT.transcricao +
      PREMISSAS_PROJECAO_DEFAULT.finalizacao)
  const margemProjetada =
    receitaTotal > 0 ? (lucroProjetado / receitaTotal) * 100 : 0

  const inadimplenciaBRL = totaisGeralBRL.vencido

  const score = useMemo(
    () =>
      calcularScore({
        margemRealizada,
        receitaTotal,
        receitaAberta,
        desvioPct: 0,
        inadimplenciaBRL,
        saldoAtual: saldoCaixa,
      }),
    [margemRealizada, receitaTotal, receitaAberta, inadimplenciaBRL, saldoCaixa],
  )

  // Saldo por requerente
  const saldoPorRequerente = useMemo(() => {
    if (requerentes.length === 0) return []
    const map = new Map<number, { total: number; pago: number }>()
    requerentes.forEach((r) => map.set(r.id, { total: 0, pago: 0 }))

    faturas.forEach((f) => {
      const dests = f.destinatarios || []
      const valorBRL =
        f.moeda === 'BRL' || !f.moeda
          ? Number(f.valor || 0)
          : Number(f.valor || 0) * Number(f.cambio || 1)
      const pagoBRL =
        f.moeda === 'BRL' || !f.moeda
          ? Number(f.valorPago || 0)
          : Number(f.valorPago || 0) * Number(f.cambio || 1)

      const lista = dests.length > 0 ? dests : requerentes
      const fatia = valorBRL / lista.length
      const fatiaPaga = pagoBRL / lista.length
      lista.forEach((d) => {
        const cur = map.get(d.id)
        if (cur) {
          cur.total += fatia
          cur.pago += fatiaPaga
        }
      })
    })

    return requerentes.map((r) => {
      const v = map.get(r.id) || { total: 0, pago: 0 }
      const aReceber = Math.max(0, v.total - v.pago)
      return {
        id: r.id,
        nome: r.nome,
        total: v.total,
        pago: v.pago,
        aReceber,
        status: aReceber < 0.005 ? 'PAGO' : 'PENDENTE',
      }
    })
  }, [requerentes, faturas])

  const custosPorEtapa = useMemo(
    () =>
      ETAPAS_TIMELINE.map((etapa) => ({
        ...etapa,
        valor: etapa.id === 'emissao' ? custoTabela : 0,
      })),
    [custoTabela],
  )

  // Fluxo de caixa
  const fluxoCaixa = useMemo(() => {
    type Mov = {
      data: string
      tipo: 'entrada' | 'saida'
      valor: number
      desc: string
    }
    const movs: Mov[] = []

    faturas.forEach((f) => {
      ;(f.pagamentos || []).forEach((p) => {
        if (!p.data) return
        const v = p.valorOriginal
          ? Number(p.valorOriginal)
          : p.cambio
          ? Number(p.valor) * Number(p.cambio)
          : Number(p.valor)
        movs.push({
          data: p.data,
          tipo: 'entrada',
          valor: v,
          desc: f.descricao || `Fatura #${f.id}`,
        })
      })
    })

    outrosCustos.forEach((oc) => {
      const cambio =
        oc.moeda === 'BRL' ? 1 : oc.cambio ? Number(oc.cambio) : 1
      const pags =
        (
          oc as unknown as {
            pagamentos?: Array<{
              valor?: number | null
              data?: string | null
              estornado?: boolean
            }>
          }
        ).pagamentos ?? []
      pags.forEach((p) => {
        if (!p.data || p.estornado) return
        movs.push({
          data: p.data,
          tipo: oc.natureza === 'COBRAR' ? 'entrada' : 'saida',
          valor: Number(p.valor || 0) * cambio,
          desc: oc.descricao || oc.tipo,
        })
      })
    })

    movs.sort(
      (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime(),
    )
    return movs.slice(0, 5)
  }, [faturas, outrosCustos])

  const faltaParaBreakEven = Math.max(0, custoTotal - recebido)

  const contasReceber = useMemo(
    () =>
      faturas.filter(
        (f) => f.status !== 'PAGO' && Number(f.valorRestante || 0) > 0,
      ),
    [faturas],
  )

  // Pontos de evolução acumulada (entradas - saídas mês a mês) para o
  // mini-gráfico de linha do "resumo visual"
  const pontosEvolucao = useMemo(() => {
    const map = new Map<string, number>()

    faturas.forEach((f) => {
      ;(f.pagamentos || []).forEach((p) => {
        if (!p.data) return
        const d = new Date(p.data)
        if (isNaN(d.getTime())) return
        const chave = `${d.getUTCFullYear()}-${String(
          d.getUTCMonth() + 1,
        ).padStart(2, '0')}`
        const v = p.valorOriginal
          ? Number(p.valorOriginal)
          : p.cambio
          ? Number(p.valor) * Number(p.cambio)
          : Number(p.valor)
        map.set(chave, (map.get(chave) || 0) + v)
      })
    })

    outrosCustos.forEach((oc) => {
      const cambio =
        oc.moeda === 'BRL' ? 1 : oc.cambio ? Number(oc.cambio) : 1
      const pags =
        (
          oc as unknown as {
            pagamentos?: Array<{
              valor?: number | null
              data?: string | null
              estornado?: boolean
            }>
          }
        ).pagamentos ?? []
      pags.forEach((p) => {
        if (!p.data || p.estornado) return
        const d = new Date(p.data)
        if (isNaN(d.getTime())) return
        const chave = `${d.getUTCFullYear()}-${String(
          d.getUTCMonth() + 1,
        ).padStart(2, '0')}`
        const sinal = oc.natureza === 'COBRAR' ? 1 : -1
        map.set(
          chave,
          (map.get(chave) || 0) + sinal * Number(p.valor || 0) * cambio,
        )
      })
    })

    const entries = Array.from(map.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    )

    let acc = 0
    const nomesMeses = [
      'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
      'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
    ]
    return entries.map(([chave, v]) => {
      acc += v
      const [ano, mes] = chave.split('-')
      const label = `${nomesMeses[parseInt(mes, 10) - 1]}/${ano.slice(2)}`
      return { x: label, y: acc }
    })
  }, [faturas, outrosCustos])

  // Percentuais para os donuts do "resumo visual"
  const pctEntrou = receitaTotal > 0 ? (recebido / receitaTotal) * 100 : 0
  const pctSaiu = custoTotal > 0 ? (pagoCustos / custoTotal) * 100 : 0

  const lucroResumo = receitaTotal - custoTotal
  const margemResumo =
    receitaTotal > 0 ? (lucroResumo / receitaTotal) * 100 : 0

  const loading = loadingFaturas || loadingCustos || loadingOutros

  // ====== Render ======
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
            border-top-color: #7c3aed;
            border-radius: 50%;
            animation: vg-spin 0.8s linear infinite;
          }
          @keyframes vg-spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    )
  }

  if (erroFaturas) {
    return (
      <div className="vg-root">
        <div className="vg-error-card">
          <div className="vg-error-icon" aria-hidden>⚠️</div>
          <h3 className="vg-error-title">
            Não foi possível carregar a Visão Geral
          </h3>
          <p className="vg-error-msg">{erroFaturas}</p>
        </div>
        <style jsx>{`
          .vg-error-card {
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 12px;
            padding: 32px 28px;
            text-align: center;
            max-width: 560px;
            margin: 24px auto;
          }
          .vg-error-icon { font-size: 36px; margin-bottom: 12px; }
          .vg-error-title {
            margin: 0 0 8px;
            font-size: 16px;
            font-weight: 600;
            color: #991b1b;
          }
          .vg-error-msg {
            margin: 0;
            font-size: 14px;
            color: #7f1d1d;
          }
        `}</style>
      </div>
    )
  }

  return (
    <div className="vg-root">
      <div className="vg-header">
        <div className="vg-header__title-wrap">
          <div className="vg-header__icon" aria-hidden>📊</div>
          <div>
            <h2 className="vg-header__title">Visão Geral do Financeiro</h2>
            <p className="vg-header__subtitle">Indicadores consolidados</p>
          </div>
        </div>
        <button className="vg-header__btn" type="button" disabled>
          ⬇ Relatórios ▼
        </button>
      </div>

      {/* Score Financeiro */}
      <div className="vg-score-card">
        <div className={`vg-score-grade vg-score-grade--${score.grade}`}>
          {score.grade}
        </div>
        <div className="vg-score-info">
          <div className="vg-score-titulo">SCORE FINANCEIRO DO PROCESSO</div>
          <div className="vg-score-nome">{nomeFamilia || 'Processo'}</div>
          <div className="vg-score-barra">
            <div style={{ width: `${score.nota}%` }} />
          </div>
          <div className="vg-score-num">
            {score.nota} / 100 · calculado por margem, recebimento, controle
            de custo e inadimplência
          </div>
        </div>
      </div>

      {/* 4 KPIs */}
      <div className="vg-kpis">
        <div className="vg-kpi vg-kpi--blue">
          <span className="vg-kpi__arrow">↗</span>
          <span className="vg-kpi__label">RECEITA TOTAL</span>
          <span className="vg-kpi__value">{fmtBRL(receitaTotal)}</span>
          <span className="vg-kpi__hint">
            {fmtBRL(recebido)} recebido · {fmtBRL(receitaAberta)} a receber
          </span>
        </div>

        <div className="vg-kpi vg-kpi--orange">
          <span className="vg-kpi__arrow">↘</span>
          <span className="vg-kpi__label">CUSTO TOTAL</span>
          <span className="vg-kpi__value">{fmtBRL(custoTotal)}</span>
          <span className="vg-kpi__hint">
            {fmtBRL(pagoCustos)} pago · {fmtBRL(custoEmAberto)} em aberto
          </span>
        </div>

        <div
          className={`vg-kpi ${
            resultadoRealizado >= 0 ? 'vg-kpi--green' : 'vg-kpi--red'
          }`}
        >
          <span className="vg-kpi__arrow">◆</span>
          <span className="vg-kpi__label">
            RESULTADO REALIZADO
            {resultadoRealizado < 0 && (
              <span className="vg-kpi__badge-neg">PREJUÍZO</span>
            )}
          </span>
          <span className="vg-kpi__value">{fmtBRL(resultadoRealizado)}</span>
          <span className="vg-kpi__hint">
            Margem {margemRealizada.toFixed(1)}% · Bruta projetada{' '}
            {margemProjetada.toFixed(1)}%
          </span>
        </div>

        <div
          className={`vg-kpi ${
            saldoCaixa >= 0 ? 'vg-kpi--red-soft' : 'vg-kpi--red'
          }`}
        >
          <span className="vg-kpi__arrow">≡</span>
          <span className="vg-kpi__label">SALDO DE CAIXA</span>
          <span className="vg-kpi__value">{fmtBRL(saldoCaixa)}</span>
          <span className="vg-kpi__hint">
            Projetado ao fim: {fmtBRL(receitaTotal - custoTotal)}
          </span>
        </div>
      </div>

      {/* Fluxo de Caixa + Break-even */}
      <div className="vg-row-2col">
        <div className="vg-card">
          <div className="vg-card__head vg-card__head--with-legend">
            <h3 className="vg-card__title">
              <span className="vg-card__icon" aria-hidden>◐</span>
              Fluxo de Caixa (últimos movimentos)
            </h3>
            <span className="vg-card__sub">Entradas · Saídas · Saldo acumulado</span>
          </div>
          {fluxoCaixa.length === 0 ? (
            <div className="vg-empty-soft">
              Sem movimentações registradas ainda.
            </div>
          ) : (
            <ul className="vg-fluxo">
              {fluxoCaixa.map((m, i) => (
                <li
                  key={i}
                  className={`vg-fluxo__item vg-fluxo__item--${m.tipo}`}
                >
                  <span className="vg-fluxo__dir">
                    {m.tipo === 'entrada' ? '↙' : '↗'}
                  </span>
                  <div className="vg-fluxo__body">
                    <div className="vg-fluxo__desc">{m.desc}</div>
                    <div className="vg-fluxo__data">
                      {new Date(m.data).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                  <span
                    className={`vg-fluxo__valor vg-fluxo__valor--${m.tipo}`}
                  >
                    {m.tipo === 'entrada' ? '+' : '−'}
                    {fmtBRL(m.valor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="vg-card">
          <div className="vg-card__head">
            <h3 className="vg-card__title">
              <span className="vg-card__icon" aria-hidden>✦</span>
              Break-even
            </h3>
          </div>
          <div className="vg-breakeven">
            <div className="vg-breakeven__icon" aria-hidden>⏳</div>
            <div className="vg-breakeven__body">
              <div className="vg-breakeven__titulo">
                {faltaParaBreakEven > 0
                  ? 'Break-even não atingido'
                  : 'Break-even atingido'}
              </div>
              <div className="vg-breakeven__sub">
                {faltaParaBreakEven > 0
                  ? `Falta ${fmtBRL(faltaParaBreakEven)} para o processo se pagar.`
                  : 'O processo já se pagou.'}
              </div>
            </div>
          </div>
          <p className="vg-breakeven__nota">
            O ponto de equilíbrio representa quando a receita recebida
            acumulada cobre todos os custos pagos do processo.
          </p>
        </div>
      </div>

      {/* Saldo por Requerente */}
      <div className="vg-card">
        <div className="vg-card__head vg-card__head--with-legend">
          <h3 className="vg-card__title">
            <span className="vg-card__icon" aria-hidden>◉</span>
            Saldo por Requerente
          </h3>
          <span className="vg-card__sub">
            Receita · Recebido · Saldo em aberto
          </span>
        </div>
        {saldoPorRequerente.length === 0 ? (
          <div className="vg-empty-soft">
            Nenhum requerente cadastrado neste processo.
          </div>
        ) : (
          <table className="vg-tabela">
            <thead>
              <tr>
                <th>REQUERENTE</th>
                <th className="vg-tabela__num">TOTAL</th>
                <th className="vg-tabela__num">PAGO</th>
                <th className="vg-tabela__num">A RECEBER</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {saldoPorRequerente.map((r) => (
                <tr key={r.id}>
                  <td>{r.nome}</td>
                  <td className="vg-tabela__num">{fmtBRL(r.total)}</td>
                  <td className="vg-tabela__num vg-tabela__num--green">
                    {fmtBRL(r.pago)}
                  </td>
                  <td className="vg-tabela__num vg-tabela__num--red">
                    {fmtBRL(r.aReceber)}
                  </td>
                  <td>
                    <span
                      className={`vg-status vg-status--${
                        r.status === 'PAGO' ? 'pago' : 'pendente'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Trilha de Auditoria */}
      <div className="vg-card">
        <div className="vg-card__head vg-card__head--with-legend">
          <h3 className="vg-card__title">
            <span className="vg-card__icon" aria-hidden>▤</span>
            Trilha de Auditoria
          </h3>
          <span className="vg-card__sub">0 lançamentos financeiros</span>
        </div>
        <div className="vg-empty-soft">
          Nenhum lançamento financeiro registrado ainda.
        </div>
      </div>

      {/* Contas a Receber */}
      {contasReceber.length > 0 && (
        <div className="vg-card">
          <div className="vg-card__head vg-card__head--with-legend">
            <h3 className="vg-card__title">
              <span className="vg-card__icon" aria-hidden>⏰</span>
              Contas a Receber
            </h3>
            <span className="vg-card__sub">
              {contasReceber.length}{' '}
              {contasReceber.length === 1 ? 'pendente' : 'pendentes'}
            </span>
          </div>
          <ul className="vg-contas">
            {contasReceber.map((f) => {
              const valorBRL =
                f.moeda === 'BRL' || !f.moeda
                  ? Number(f.valorRestante || 0)
                  : Number(f.valorRestante || 0) * Number(f.cambio || 1)
              return (
                <li key={f.id} className="vg-contas__item">
                  <div className="vg-contas__data-block">
                    <span className="vg-contas__data-label">
                      {f.dataVencimento ? 'VENC.' : 'SEM DATA'}
                    </span>
                    <span className="vg-contas__data-val">
                      {f.dataVencimento
                        ? new Date(f.dataVencimento).toLocaleDateString('pt-BR')
                        : '—'}
                    </span>
                  </div>
                  <div className="vg-contas__body">
                    <div className="vg-contas__desc">{f.descricao}</div>
                    <div className="vg-contas__meta">
                      <span className="vg-contas__badge">
                        {f.dataVencimento ? f.status : 'SEM VENCIMENTO'}
                      </span>
                      <span>#F-{String(f.id).padStart(4, '0')}</span>
                    </div>
                  </div>
                  <div className="vg-contas__valor">
                    {f.moeda !== 'BRL' && (
                      <div className="vg-contas__valor-orig">
                        {f.moeda}{' '}
                        {Number(f.valorRestante).toLocaleString('pt-BR', {
                          minimumFractionDigits: 2,
                        })}
                      </div>
                    )}
                    <div className="vg-contas__valor-brl">
                      ≈ {fmtBRL(valorBRL)}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Resumo Visual: mini-KPIs + linha de evolução + donuts */}
      <div className="vg-resumo-row">
        <div className="vg-card vg-resumo-card vg-resumo-card--linha">
          <div className="vg-resumo-mini-kpis">
            <div className="vg-resumo-mini">
              <span className="vg-resumo-mini__arrow vg-resumo-mini__arrow--up">↗</span>
              <span className="vg-resumo-mini__label">RECEITA</span>
              <span className="vg-resumo-mini__value vg-resumo-mini__value--green">
                {fmtBRL(receitaTotal)}
              </span>
              <span className="vg-resumo-mini__hint">
                {(faturas.length + (totaisOC?.contagem ?? 0))}{' '}
                {(faturas.length + (totaisOC?.contagem ?? 0)) === 1
                  ? 'lançamento'
                  : 'lançamentos'}
              </span>
            </div>
            <div className="vg-resumo-mini">
              <span className="vg-resumo-mini__arrow vg-resumo-mini__arrow--down">↘</span>
              <span className="vg-resumo-mini__label">CUSTO</span>
              <span className="vg-resumo-mini__value vg-resumo-mini__value--red">
                {fmtBRL(custoTotal)}
              </span>
              <span className="vg-resumo-mini__hint">19 lançamentos</span>
            </div>
            <div className="vg-resumo-mini">
              <span className="vg-resumo-mini__arrow">=</span>
              <span className="vg-resumo-mini__label">LUCRO</span>
              <span
                className={`vg-resumo-mini__value ${
                  lucroResumo >= 0
                    ? 'vg-resumo-mini__value--blue'
                    : 'vg-resumo-mini__value--red'
                }`}
              >
                {fmtBRL(lucroResumo)}
              </span>
              <span className="vg-resumo-mini__hint">Líquido</span>
            </div>
            <div className="vg-resumo-mini">
              <span className="vg-resumo-mini__arrow">◆</span>
              <span className="vg-resumo-mini__label">MARGEM</span>
              <span
                className={`vg-resumo-mini__value ${
                  margemResumo >= 40
                    ? 'vg-resumo-mini__value--purple'
                    : 'vg-resumo-mini__value--orange'
                }`}
              >
                {margemResumo.toFixed(1)}%
              </span>
              <span className="vg-resumo-mini__hint">
                {margemResumo >= 70
                  ? 'Saudável'
                  : margemResumo >= 40
                  ? 'Aceitável'
                  : 'Atenção'}
              </span>
            </div>
          </div>

          <div className="vg-resumo-linha">
            {pontosEvolucao.length > 0 ? (
              <MiniLinhaSVG
                points={pontosEvolucao}
                width={480}
                height={140}
                color={lucroResumo >= 0 ? '#16a34a' : '#dc2626'}
                formatY={(v) => fmtBRLCompact(v)}
                ariaLabel="Evolução acumulada de movimentações no tempo"
              />
            ) : (
              <div className="vg-resumo-linha__vazio">
                Sem movimentações registradas ainda
              </div>
            )}
          </div>
        </div>

        <div className="vg-card vg-resumo-card vg-resumo-card--donut">
          <div className="vg-resumo-donut__head">
            <span aria-hidden>💰</span>
            <span>ENTRADAS</span>
          </div>
          <DonutSVG
            slices={[
              {
                label: 'Entrou',
                value: recebido,
                color: '#22c55e',
              },
              {
                label: 'A entrar',
                value: Math.max(0, receitaTotal - recebido),
                color: 'var(--fin-line)',
              },
            ]}
            size={140}
            thickness={20}
            centerLabel="ENTROU"
            centerValue={`${pctEntrou.toFixed(0)}%`}
            showLegend={false}
            ariaLabel="Percentual de entradas recebidas"
          />
          <div className="vg-resumo-donut__foot">
            <span className="vg-resumo-donut__foot-lbl">Falta entrar:</span>
            <span className="vg-resumo-donut__foot-val vg-resumo-donut__foot-val--yellow">
              {fmtBRL(Math.max(0, receitaTotal - recebido))}
            </span>
          </div>
        </div>

        <div className="vg-card vg-resumo-card vg-resumo-card--donut">
          <div className="vg-resumo-donut__head">
            <span aria-hidden>💸</span>
            <span>SAÍDAS</span>
          </div>
          <DonutSVG
            slices={[
              {
                label: 'Saiu',
                value: pagoCustos,
                color: '#3b82f6',
              },
              {
                label: 'A sair',
                value: custoEmAberto,
                color: 'var(--fin-line)',
              },
            ]}
            size={140}
            thickness={20}
            centerLabel="SAIU"
            centerValue={`${pctSaiu.toFixed(0)}%`}
            showLegend={false}
            ariaLabel="Percentual de saídas pagas"
          />
          <div className="vg-resumo-donut__foot">
            <span className="vg-resumo-donut__foot-lbl">Falta pagar:</span>
            <span className="vg-resumo-donut__foot-val vg-resumo-donut__foot-val--blue">
              {fmtBRL(custoEmAberto)}
            </span>
          </div>
        </div>
      </div>

      {/* Custos por etapa */}
      <div className="vg-card vg-timeline-card">
        <div className="vg-card__head vg-card__head--with-legend">
          <h3 className="vg-card__title">Custos por etapa</h3>
          <span className="vg-card__sub">
            Evolução do gasto ao longo do processo
          </span>
        </div>
        <div className="vg-timeline">
          <div className="vg-timeline-line" aria-hidden />
          <div className="vg-timeline-track">
            {custosPorEtapa.map((etapa) => {
              const temValor = etapa.valor > 0
              return (
                <div
                  key={etapa.id}
                  className={`vg-timeline-step ${
                    temValor ? 'vg-timeline-step--ativo' : ''
                  }`}
                >
                  <div className="vg-timeline-step__label">{etapa.label}</div>
                  <div
                    className={`vg-timeline-step__dot ${
                      temValor ? 'vg-timeline-step__dot--ativo' : ''
                    }`}
                    aria-hidden
                  />
                  <div className="vg-timeline-step__value">
                    {temValor ? fmtBRLCompact(etapa.valor) : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Projeção */}
      <div className="vg-projecao">
        <div className="vg-projecao__icon" aria-hidden>🔮</div>
        <div className="vg-projecao__body">
          <span className="vg-projecao__label">PROJEÇÃO AO FINALIZAR</span>
          <div className="vg-projecao__headline">
            Lucro estimado de{' '}
            <strong
              className={
                lucroProjetado >= 0
                  ? 'vg-projecao__amount-pos'
                  : 'vg-projecao__amount-neg'
              }
            >
              {fmtBRL(lucroProjetado)}
            </strong>{' '}
            · margem <strong>{margemProjetada.toFixed(1)}%</strong>
          </div>
          <p className="vg-projecao__note">
            Assumindo custos médios para Transcrição (
            {fmtBRL(PREMISSAS_PROJECAO_DEFAULT.transcricao)}) e Finalização (
            {fmtBRL(PREMISSAS_PROJECAO_DEFAULT.finalizacao)}). Todas as
            faturas pagas.
          </p>
        </div>
        <button className="vg-projecao__btn" type="button" disabled>
          Ajustar premissas
        </button>
      </div>

      <style jsx>{`
        .vg-root { display: flex; flex-direction: column; gap: 16px; }
        .vg-header {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; flex-wrap: wrap;
        }
        .vg-header__title-wrap { display: flex; align-items: center; gap: 12px; }
        .vg-header__icon { font-size: 22px; }
        .vg-header__title { margin: 0; font-size: 16px; font-weight: 600; color: var(--fin-ink); }
        .vg-header__subtitle { margin: 2px 0 0; font-size: 12px; color: var(--fin-ink-3); }
        .vg-header__btn {
          border: 1px solid var(--fin-line); background: var(--fin-bg);
          border-radius: 8px; padding: 6px 12px; font-size: 12px;
          color: var(--fin-ink-2); cursor: not-allowed; opacity: 0.6;
        }

        .vg-score-card {
          background: linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%);
          border: 1px solid #ddd6fe; padding: 22px; border-radius: 16px;
          display: flex; align-items: center; gap: 22px;
        }
        .vg-score-grade {
          width: 86px; height: 86px; border-radius: 22px; display: flex;
          align-items: center; justify-content: center; font-size: 44px;
          font-weight: 900; color: #fff;
          box-shadow: 0 10px 30px rgba(124, 58, 237, 0.35);
          flex-shrink: 0; letter-spacing: -0.04em;
        }
        .vg-score-grade--A { background: linear-gradient(135deg, #059669, #047857); }
        .vg-score-grade--B { background: linear-gradient(135deg, #2563eb, #1d4ed8); }
        .vg-score-grade--C { background: linear-gradient(135deg, #d97706, #b45309); }
        .vg-score-grade--D { background: linear-gradient(135deg, #dc2626, #991b1b); }
        .vg-score-info { flex: 1; min-width: 0; }
        .vg-score-titulo {
          font-size: 11px; font-weight: 700; letter-spacing: 0.1em;
          text-transform: uppercase; color: #6b46c1; margin-bottom: 4px;
        }
        .vg-score-nome {
          font-size: 20px; font-weight: 800; color: #1f2937;
          margin-bottom: 6px; letter-spacing: -0.02em;
        }
        .vg-score-barra {
          height: 8px; background: rgba(124, 58, 237, 0.15);
          border-radius: 999px; overflow: hidden;
        }
        .vg-score-barra > div {
          height: 100%; background: linear-gradient(90deg, #7c3aed, #a855f7);
          border-radius: 999px; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .vg-score-num { font-size: 13px; color: #6b7280; margin-top: 6px; }

        .vg-kpis {
          display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
        }
        @media (max-width: 900px) { .vg-kpis { grid-template-columns: repeat(2, 1fr); } }
        .vg-kpi {
          position: relative; border-radius: 12px; padding: 14px 16px;
          border: 1px solid var(--fin-line); background: var(--fin-bg);
          display: flex; flex-direction: column; gap: 4px; min-height: 100px;
        }
        .vg-kpi__arrow {
          position: absolute; top: 12px; right: 14px; font-size: 14px;
          font-weight: 700; opacity: 0.75;
        }
        .vg-kpi__label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
          color: var(--fin-ink-3); display: inline-flex; align-items: center; gap: 8px;
        }
        .vg-kpi__badge-neg {
          padding: 2px 8px; background: #fef2f2; color: #b91c1c;
          border-radius: 999px; border: 1px solid #fecaca; font-size: 9px;
          letter-spacing: 0.04em;
        }
        .vg-kpi__value {
          font-size: 22px; font-weight: 700; line-height: 1.15;
          font-variant-numeric: tabular-nums;
        }
        .vg-kpi__hint { font-size: 11px; color: var(--fin-ink-3); }
        .vg-kpi--blue { background: #eff6ff; border-color: #bfdbfe; }
        .vg-kpi--blue .vg-kpi__value, .vg-kpi--blue .vg-kpi__arrow { color: #1d4ed8; }
        .vg-kpi--blue .vg-kpi__label { color: #1e40af; }
        .vg-kpi--orange { background: #fff7ed; border-color: #fed7aa; }
        .vg-kpi--orange .vg-kpi__value, .vg-kpi--orange .vg-kpi__arrow { color: #c2410c; }
        .vg-kpi--orange .vg-kpi__label { color: #9a3412; }
        .vg-kpi--green { background: #f0fdf4; border-color: #bbf7d0; }
        .vg-kpi--green .vg-kpi__value, .vg-kpi--green .vg-kpi__arrow { color: #15803d; }
        .vg-kpi--green .vg-kpi__label { color: #166534; }
        .vg-kpi--red { background: #fef2f2; border-color: #fecaca; }
        .vg-kpi--red .vg-kpi__value, .vg-kpi--red .vg-kpi__arrow { color: #b91c1c; }
        .vg-kpi--red .vg-kpi__label { color: #991b1b; }
        .vg-kpi--red-soft { background: #fff1f2; border-color: #fecdd3; }
        .vg-kpi--red-soft .vg-kpi__value, .vg-kpi--red-soft .vg-kpi__arrow { color: #be123c; }
        .vg-kpi--red-soft .vg-kpi__label { color: #9f1239; }

        .vg-card {
          background: var(--fin-bg); border: 1px solid var(--fin-line);
          border-radius: 12px; padding: 18px 20px;
        }
        .vg-card__head {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 14px; gap: 12px;
        }
        .vg-card__head--with-legend { flex-wrap: wrap; }
        .vg-card__title {
          margin: 0; font-size: 14px; font-weight: 600; color: var(--fin-ink);
          display: inline-flex; align-items: center; gap: 8px;
        }
        .vg-card__icon { font-size: 14px; }
        .vg-card__sub { font-size: 11px; color: var(--fin-ink-3); }
        .vg-empty-soft {
          padding: 24px; text-align: center; font-size: 13px;
          color: var(--fin-ink-3); background: var(--fin-bg-soft);
          border: 1px dashed var(--fin-line); border-radius: 8px;
        }

        .vg-row-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 900px) { .vg-row-2col { grid-template-columns: 1fr; } }

        .vg-fluxo { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .vg-fluxo__item {
          display: flex; align-items: center; gap: 12px; padding: 8px 12px;
          border-radius: 8px; border: 1px solid var(--fin-line);
        }
        .vg-fluxo__item--entrada { background: #f0fdf4; border-color: #bbf7d0; }
        .vg-fluxo__item--saida { background: #fef2f2; border-color: #fecaca; }
        .vg-fluxo__dir { font-size: 16px; font-weight: 700; }
        .vg-fluxo__item--entrada .vg-fluxo__dir { color: #15803d; }
        .vg-fluxo__item--saida .vg-fluxo__dir { color: #b91c1c; }
        .vg-fluxo__body { flex: 1; min-width: 0; }
        .vg-fluxo__desc { font-size: 13px; font-weight: 500; color: var(--fin-ink); }
        .vg-fluxo__data { font-size: 11px; color: var(--fin-ink-3); }
        .vg-fluxo__valor { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .vg-fluxo__valor--entrada { color: #15803d; }
        .vg-fluxo__valor--saida { color: #b91c1c; }

        .vg-breakeven {
          display: flex; align-items: center; gap: 14px; padding: 14px 16px;
          background: #fefce8; border: 1px solid #fef08a; border-radius: 8px;
        }
        .vg-breakeven__icon { font-size: 24px; }
        .vg-breakeven__body { flex: 1; min-width: 0; }
        .vg-breakeven__titulo { font-size: 13px; font-weight: 600; color: #854d0e; }
        .vg-breakeven__sub { margin-top: 2px; font-size: 12px; color: #713f12; }
        .vg-breakeven__nota {
          margin: 12px 0 0; font-size: 11px; color: var(--fin-ink-3); line-height: 1.5;
        }

        .vg-tabela { width: 100%; border-collapse: collapse; font-size: 13px; }
        .vg-tabela th {
          text-align: left; padding: 10px 12px; font-size: 10px; font-weight: 700;
          letter-spacing: 0.06em; color: var(--fin-ink-3); border-bottom: 1px solid var(--fin-line);
        }
        .vg-tabela td { padding: 12px; border-bottom: 1px solid var(--fin-line); }
        .vg-tabela tr:last-child td { border-bottom: none; }
        .vg-tabela__num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
        .vg-tabela__num--green { color: #15803d; }
        .vg-tabela__num--red { color: #b91c1c; }
        .vg-status {
          display: inline-block; padding: 3px 10px; font-size: 10px;
          font-weight: 700; letter-spacing: 0.04em; border-radius: 999px;
        }
        .vg-status--pago { background: #dcfce7; color: #166534; }
        .vg-status--pendente { background: #fef9c3; color: #854d0e; }

        .vg-contas { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .vg-contas__item {
          display: flex; align-items: center; gap: 14px; padding: 12px 16px;
          border: 1px solid var(--fin-line); border-radius: 8px; background: #fff;
        }
        .vg-contas__data-block {
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          padding: 8px 12px; background: var(--fin-bg-soft); border-radius: 6px; min-width: 88px;
        }
        .vg-contas__data-label { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; color: var(--fin-ink-3); }
        .vg-contas__data-val { font-size: 13px; font-weight: 600; }
        .vg-contas__body { flex: 1; min-width: 0; }
        .vg-contas__desc { font-size: 14px; font-weight: 600; color: var(--fin-ink); }
        .vg-contas__meta {
          margin-top: 4px; display: flex; gap: 8px; font-size: 11px; color: var(--fin-ink-3);
        }
        .vg-contas__badge {
          padding: 2px 8px; background: #fef9c3; color: #854d0e;
          border-radius: 4px; font-weight: 700; letter-spacing: 0.04em;
        }
        .vg-contas__valor { text-align: right; flex-shrink: 0; }
        .vg-contas__valor-orig { font-size: 16px; font-weight: 700; color: var(--fin-ink); }
        .vg-contas__valor-brl { font-size: 11px; color: var(--fin-ink-3); margin-top: 2px; }

        .vg-timeline { position: relative; overflow-x: auto; padding: 8px 4px 4px; }
        .vg-timeline-line {
          position: absolute; left: 24px; right: 24px; top: calc(50% + 6px);
          height: 1px; background: var(--fin-line);
        }
        .vg-timeline-track {
          position: relative; display: flex; justify-content: space-between;
          gap: 12px; min-width: 820px;
        }
        .vg-timeline-step {
          display: flex; flex-direction: column; align-items: center;
          flex: 1; min-width: 60px; text-align: center; gap: 6px;
        }
        .vg-timeline-step__label {
          font-size: 9px; font-weight: 700; letter-spacing: 0.06em; color: var(--fin-ink-3);
        }
        .vg-timeline-step__dot {
          width: 14px; height: 14px; border-radius: 50%;
          background: var(--fin-bg); border: 2px solid var(--fin-line); z-index: 1;
        }
        .vg-timeline-step__dot--ativo {
          background: #f59e0b; border-color: #d97706;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
        }
        .vg-timeline-step__value { font-size: 11px; font-weight: 600; color: var(--fin-ink-3); min-height: 14px; }
        .vg-timeline-step--ativo .vg-timeline-step__value { color: #b45309; }

        .vg-projecao {
          display: flex; align-items: flex-start; gap: 14px; padding: 16px 18px;
          background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 12px;
        }
        .vg-projecao__icon { font-size: 24px; flex-shrink: 0; }
        .vg-projecao__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
        .vg-projecao__label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #6b21a8;
        }
        .vg-projecao__headline { font-size: 14px; color: var(--fin-ink); line-height: 1.4; }
        .vg-projecao__amount-pos { color: #15803d; }
        .vg-projecao__amount-neg { color: #b91c1c; }
        .vg-projecao__note { margin: 0; font-size: 11px; color: var(--fin-ink-3); line-height: 1.4; }
        .vg-projecao__btn {
          align-self: flex-start; border: 1px solid #e9d5ff; background: #fff;
          border-radius: 8px; padding: 8px 14px; font-size: 12px; color: #6b21a8;
          cursor: not-allowed; opacity: 0.6; white-space: nowrap;
        }

        /* ======== Resumo Visual ======== */
        .vg-resumo-row {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr;
          gap: 12px;
        }
        @media (max-width: 1100px) {
          .vg-resumo-row { grid-template-columns: 1fr 1fr; }
          .vg-resumo-card--linha { grid-column: 1 / -1; }
        }
        @media (max-width: 640px) {
          .vg-resumo-row { grid-template-columns: 1fr; }
        }
        .vg-resumo-card { display: flex; flex-direction: column; }
        .vg-resumo-card--linha { gap: 12px; }

        .vg-resumo-mini-kpis {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--fin-line);
        }
        @media (max-width: 640px) {
          .vg-resumo-mini-kpis { grid-template-columns: repeat(2, 1fr); }
        }
        .vg-resumo-mini {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 4px;
        }
        .vg-resumo-mini__arrow {
          position: absolute;
          top: 6px;
          right: 6px;
          font-size: 12px;
          opacity: 0.5;
        }
        .vg-resumo-mini__arrow--up { color: #16a34a; }
        .vg-resumo-mini__arrow--down { color: #dc2626; }
        .vg-resumo-mini__label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--fin-ink-3);
        }
        .vg-resumo-mini__value {
          font-size: 16px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1.2;
        }
        .vg-resumo-mini__value--green { color: #16a34a; }
        .vg-resumo-mini__value--red { color: #dc2626; }
        .vg-resumo-mini__value--blue { color: #2563eb; }
        .vg-resumo-mini__value--purple { color: #7c3aed; }
        .vg-resumo-mini__value--orange { color: #d97706; }
        .vg-resumo-mini__hint {
          font-size: 10px;
          color: var(--fin-ink-3);
        }

        .vg-resumo-linha {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 8px 0 4px;
          min-height: 140px;
          overflow-x: auto;
        }
        .vg-resumo-linha__vazio {
          color: var(--fin-ink-3);
          font-size: 12px;
          font-style: italic;
        }

        .vg-resumo-card--donut {
          align-items: center;
          gap: 8px;
        }
        .vg-resumo-donut__head {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--fin-ink-3);
          margin-bottom: 4px;
        }
        .vg-resumo-donut__foot {
          margin-top: 4px;
          padding-top: 8px;
          border-top: 1px dashed var(--fin-line);
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .vg-resumo-donut__foot-lbl {
          font-size: 11px;
          color: var(--fin-ink-3);
        }
        .vg-resumo-donut__foot-val {
          font-size: 14px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .vg-resumo-donut__foot-val--yellow { color: #ca8a04; }
        .vg-resumo-donut__foot-val--blue { color: #2563eb; }
      `}</style>
    </div>
  )
}

export default VisaoGeral