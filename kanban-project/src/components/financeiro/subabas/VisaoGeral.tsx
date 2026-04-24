// src/components/financeiro/subabas/VisaoGeral.tsx
//
// Sub-aba "Visão Geral" do Financeiro.
//
// 🆕 LOTE 4 BLOCO 1 (reforma completa pro mockup do Marco):
//
//   - 4 KPIs: RECEITA / CUSTO / LUCRO / MARGEM (no lugar dos 4 antigos
//     Total Cobrado / Recebido / A Receber / Vencido).
//   - Gráfico de linha "Evolução" à esquerda + 2 donuts (Entradas / Saídas)
//     à direita, tudo na mesma linha.
//   - Timeline horizontal "Custos por etapa" (por enquanto só "Emissão"
//     recebe o total da TabelaCustos, até o Marco decidir como vincular
//     serviços a etapas do Kanban).
//   - Card "Projeção ao finalizar" com premissas (hardcoded por enquanto).
//
// Os dados vêm de duas APIs:
//   - /api/processos/:id/faturas  → receita, recebido, pendente, vencido
//   - /api/processos/:id/custos   → custo total do processo
//
// Se qualquer uma das duas falhar, a sub-aba continua utilizável — só
// mostra "—" onde falhou, sem quebrar o resto.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { DonutSVG } from '@/src/components/financeiro/charts/DonutSVG'
import { MiniLinhaSVG } from '@/src/components/financeiro/charts/MiniLinhaSVG'
import { fmtBRL, fmtBRLCompact } from '@/src/lib/financeiro/helpers'

// ============================================================================
// Configuração
// ============================================================================

// Premissas default pra projeção de lucro (pedido do Marco — mockup).
// Por enquanto não são editáveis; o botão "Ajustar premissas" é só visual.
// Quando o Marco validar, a gente decide se salva por processo / por país.
const PREMISSAS_PROJECAO_DEFAULT = {
  transcricao: 2000, // R$ médios para etapa Transcrição
  finalizacao: 500,  // R$ médios para etapa Finalização
}

// Etapas padrão do Kanban (abreviadas pro mockup do Marco).
// Cada país tem suas etapas reais no banco, mas pra timeline da Visão Geral
// o Marco usa sempre esses labels genéricos. Isso pode virar por-país depois.
const ETAPAS_TIMELINE = [
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

interface PagamentoAPI {
  id: number
  valor: number
  data: string
  valorOriginal?: number | null
  cambio?: number | null
}

interface FaturaComPagamentos extends FaturaAPI {
  pagamentos?: PagamentoAPI[]
}

export interface VisaoGeralProps {
  processoId: number
  nomeFamilia?: string
  refreshKey?: number
}

// ============================================================================
// Componente
// ============================================================================

export function VisaoGeral({ processoId, refreshKey = 0 }: VisaoGeralProps) {
  // ---- Faturas -----------------------------------------------------------
  const [faturas, setFaturas] = useState<FaturaComPagamentos[]>([])
  const [totaisGeralBRL, setTotaisGeralBRL] = useState<TotaisGeralBRL>({
    total: 0,
    pago: 0,
    pendente: 0,
    vencido: 0,
  })
  const [loadingFaturas, setLoadingFaturas] = useState(true)
  const [erroFaturas, setErroFaturas] = useState<string | null>(null)
  const [erroFaturasStatus, setErroFaturasStatus] = useState<number | null>(null)

  // ---- Custos ------------------------------------------------------------
  const [totalCustos, setTotalCustos] = useState<number>(0)
  const [qtdLancamentosCustos, setQtdLancamentosCustos] = useState<number>(0)
  const [loadingCustos, setLoadingCustos] = useState(true)
  const [erroCustos, setErroCustos] = useState<boolean>(false)

  // ========================================================================
  // Fetch de dados
  // ========================================================================
  useEffect(() => {
    let cancelado = false

    async function carregarFaturas() {
      setLoadingFaturas(true)
      setErroFaturas(null)
      setErroFaturasStatus(null)

      try {
        const res = await fetch(`/api/processos/${processoId}/faturas`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
        })
        if (cancelado) return

        if (!res.ok) {
          console.warn(
            `[VisaoGeral] /faturas respondeu ${res.status}`,
          )
          setErroFaturasStatus(res.status)
          setErroFaturas(
            res.status === 500
              ? 'Servidor indisponível ao buscar faturas.'
              : res.status === 404
              ? 'Processo não encontrado.'
              : res.status === 401 || res.status === 403
              ? 'Sem permissão para ver o financeiro deste processo.'
              : `A API respondeu HTTP ${res.status}.`,
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
        if (!cancelado) {
          console.error('[VisaoGeral] erro de rede faturas:', e)
          setErroFaturas(
            'Não foi possível se conectar ao servidor.',
          )
        }
      } finally {
        if (!cancelado) setLoadingFaturas(false)
      }
    }

    async function carregarCustos() {
      setLoadingCustos(true)
      setErroCustos(false)

      try {
        const res = await fetch(`/api/processos/${processoId}/custos`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
        })
        if (cancelado) return

        if (!res.ok) {
          console.warn(`[VisaoGeral] /custos respondeu ${res.status}`)
          setErroCustos(true)
          setTotalCustos(0)
          setQtdLancamentosCustos(0)
          return
        }

        const data = await res.json()
        if (cancelado) return

        setTotalCustos(data.totalGeral || 0)

        // Contabiliza "lançamentos": qualquer célula da planilha com valor > 0
        // é um lançamento. Se a API já devolver essa contagem, use-a; senão
        // deriva dos valores por pessoa×serviço.
        if (typeof data.qtdLancamentos === 'number') {
          setQtdLancamentosCustos(data.qtdLancamentos)
        } else {
          // Fallback: calcula localmente percorrendo linhas x serviços
          let count = 0
          const linhas = data.linhas || []
          linhas.forEach((l: any) => {
            const valores = l.valores || {}
            Object.values(valores).forEach((v) => {
              if (typeof v === 'number' && v > 0) count += 1
            })
          })
          setQtdLancamentosCustos(count)
        }
      } catch (e) {
        if (!cancelado) {
          console.error('[VisaoGeral] erro de rede custos:', e)
          setErroCustos(true)
          setTotalCustos(0)
          setQtdLancamentosCustos(0)
        }
      } finally {
        if (!cancelado) setLoadingCustos(false)
      }
    }

    carregarFaturas()
    carregarCustos()

    return () => {
      cancelado = true
    }
  }, [processoId, refreshKey])

  // ========================================================================
  // Métricas derivadas
  // ========================================================================

  // --- KPIs principais ---
  const receita = totaisGeralBRL.total
  const custo = totalCustos
  const lucro = receita - custo
  const margem = receita > 0 ? (lucro / receita) * 100 : 0

  // Classificação de margem (cor + label)
  const margemConfig = useMemo(() => {
    if (margem >= 70) {
      return { label: 'Saudável (>70%)', tone: 'positive' as const }
    }
    if (margem >= 40) {
      return { label: 'Regular (40–70%)', tone: 'neutral' as const }
    }
    return { label: 'Atenção (<40%)', tone: 'negative' as const }
  }, [margem])

  const qtdFaturas = faturas.length

  // --- Donut "Entradas" ---
  // Quanto da receita já entrou (pago) vs quanto falta entrar (pendente + vencido).
  const entradasPago = totaisGeralBRL.pago
  const entradasAFaltar = Math.max(receita - entradasPago, 0)
  const pctEntrou = receita > 0 ? (entradasPago / receita) * 100 : 0

  // --- Donut "Saídas" ---
  // Quanto do custo já saiu (pago a fornecedor) vs quanto falta sair.
  // HOJE: a TabelaCustos guarda só o valor previsto por serviço. Enquanto
  // OutrosCustos/pagamentos a fornecedor não está em produção (Lote 4),
  // consideramos que 100% dos custos já "saíram" (pressuposto conservador
  // do mockup do Marco que mostra "100% SAIU — Falta pagar R$ 0").
  const saidasPago = custo
  const saidasAFaltar = 0
  const pctSaiu = custo > 0 ? 100 : 0

  // --- Gráfico de linha "Evolução" ---
  // Saldo acumulado (pagamentos - custos) mês a mês.
  // Como a TabelaCustos não tem data por linha (só total), usamos só os
  // pagamentos reais pra linha de evolução. Se/quando OutrosCustos entrar,
  // a gente subtrai aqui também.
  const pontosEvolucao = useMemo(() => {
    const map = new Map<string, number>()

    faturas.forEach((f) => {
      const pagamentos = f.pagamentos || []
      pagamentos.forEach((p) => {
        if (!p.data) return
        const d = new Date(p.data)
        if (isNaN(d.getTime())) return

        const chave = `${d.getUTCFullYear()}-${String(
          d.getUTCMonth() + 1,
        ).padStart(2, '0')}`

        // Valor em BRL
        const valorBRL =
          f.moeda === 'BRL'
            ? p.valor
            : p.valorOriginal
            ? p.valorOriginal
            : p.cambio
            ? p.valor * p.cambio
            : p.valor

        map.set(chave, (map.get(chave) || 0) + valorBRL)
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
  }, [faturas])

  // --- Timeline "Custos por etapa" ---
  // Hoje não há vínculo TipoServico ↔ etapa do Kanban. Então colocamos o
  // total dos custos inteiramente na coluna "Emissão" (igual o mockup do
  // Marco, que só mostra "EMISSÃO R$ 3,2k"). Quando esse vínculo existir,
  // redistribuímos aqui.
  const custosPorEtapa = useMemo(() => {
    return ETAPAS_TIMELINE.map((etapa) => {
      const valor = etapa.id === 'emissao' ? totalCustos : 0
      return { ...etapa, valor }
    })
  }, [totalCustos])

  // --- Projeção ao finalizar ---
  // Assume: todas as faturas pagas + premissas fixas para etapas futuras.
  const premissas = PREMISSAS_PROJECAO_DEFAULT
  const custoProjetado =
    totalCustos + premissas.transcricao + premissas.finalizacao
  const lucroProjetado = receita - custoProjetado
  const margemProjetada =
    receita > 0 ? (lucroProjetado / receita) * 100 : 0

  // ========================================================================
  // Estados de loading / erro
  // ========================================================================

  const loading = loadingFaturas || loadingCustos

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

  // Se faturas falharam totalmente, não tem como calcular nada da visão geral.
  if (erroFaturas) {
    return (
      <div className="vg-root">
        <div className="vg-error-card">
          <div className="vg-error-icon" aria-hidden>⚠️</div>
          <h3 className="vg-error-title">
            Não foi possível carregar a Visão Geral
          </h3>
          <p className="vg-error-msg">{erroFaturas}</p>
          {erroFaturasStatus !== null && (
            <p className="vg-error-status">
              Código do servidor: <code>HTTP {erroFaturasStatus}</code>
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

  if (qtdFaturas === 0 && totalCustos === 0) {
    return (
      <div className="vg-root">
        <div className="fin-empty">
          <p className="fin-empty__title">Sem dados ainda</p>
          <p className="fin-empty__hint">
            Cadastre faturas na aba &quot;Receitas&quot; ou lance custos na aba
            &quot;Custos&quot; pra começar a ver a visão geral do processo.
          </p>
        </div>
      </div>
    )
  }

  // ========================================================================
  // Render principal
  // ========================================================================

  return (
    <div className="vg-root">
      {/* Header da seção */}
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

      {/* ============================= */}
      {/* 4 KPIs principais             */}
      {/* ============================= */}
      <div className="vg-kpis">
        <div className="vg-kpi vg-kpi--green">
          <span className="vg-kpi__arrow">↗</span>
          <span className="vg-kpi__label">RECEITA</span>
          <span className="vg-kpi__value">{fmtBRL(receita)}</span>
          <span className="vg-kpi__hint">
            {qtdFaturas} {qtdFaturas === 1 ? 'fatura emitida' : 'faturas emitidas'}
          </span>
        </div>

        <div className="vg-kpi vg-kpi--red">
          <span className="vg-kpi__arrow">↘</span>
          <span className="vg-kpi__label">CUSTO</span>
          <span className="vg-kpi__value">
            {erroCustos ? '—' : fmtBRL(custo)}
          </span>
          <span className="vg-kpi__hint">
            {erroCustos
              ? 'Erro ao carregar custos'
              : `${qtdLancamentosCustos} ${
                  qtdLancamentosCustos === 1 ? 'lançamento' : 'lançamentos'
                }`}
          </span>
        </div>

        <div className="vg-kpi vg-kpi--purple">
          <span className="vg-kpi__arrow">=</span>
          <span className="vg-kpi__label">LUCRO</span>
          <span className="vg-kpi__value">
            {erroCustos ? '—' : fmtBRL(lucro)}
          </span>
          <span className="vg-kpi__hint">Líquido</span>
        </div>

        <div
          className={`vg-kpi vg-kpi--margem vg-kpi--margem-${margemConfig.tone}`}
        >
          <span className="vg-kpi__arrow">◆</span>
          <span className="vg-kpi__label">MARGEM</span>
          <span className="vg-kpi__value">
            {erroCustos ? '—' : `${margem.toFixed(1)}%`}
          </span>
          <span className="vg-kpi__hint">
            {erroCustos ? 'Erro ao carregar' : margemConfig.label}
          </span>
        </div>
      </div>

      {/* ============================= */}
      {/* Linha de gráficos: evolução + 2 donuts */}
      {/* ============================= */}
      <div className="vg-charts-row">
        {/* Gráfico de linha "Evolução" */}
        <div className="fin-card vg-chart-card vg-chart-card--linha">
          <div className="fin-section__header">
            <h3 className="fin-section__title">Evolução</h3>
          </div>
          <div className="vg-linha-wrap">
            {pontosEvolucao.length > 0 ? (
              <MiniLinhaSVG
                points={pontosEvolucao}
                width={480}
                height={200}
                color="var(--fin-green)"
                formatY={(v) => fmtBRLCompact(v)}
                ariaLabel="Evolução acumulada de recebimentos no tempo"
              />
            ) : (
              <div className="vg-no-data">
                <span>Ainda não há pagamentos registrados</span>
              </div>
            )}
          </div>
        </div>

        {/* Donut "Entradas" */}
        <div className="fin-card vg-chart-card vg-chart-card--donut">
          <div className="fin-section__header">
            <h3 className="fin-section__title">
              <span className="vg-donut__title-icon" aria-hidden>💰</span>
              Entradas
            </h3>
          </div>
          <div className="vg-donut-wrap">
            <DonutSVG
              slices={[
                {
                  label: 'Entrou',
                  value: entradasPago,
                  color: 'var(--fin-green)',
                },
                {
                  label: 'A entrar',
                  value: entradasAFaltar,
                  color: 'var(--fin-line)',
                },
              ]}
              size={160}
              thickness={22}
              centerLabel="entrou"
              centerValue={`${pctEntrou.toFixed(0)}%`}
              showLegend={false}
              ariaLabel="Percentual de entradas recebidas"
            />
            <div className="vg-donut-footer">
              <span className="vg-donut-footer__label">Falta entrar:</span>
              <span className="vg-donut-footer__value vg-donut-footer__value--yellow">
                {fmtBRL(entradasAFaltar)}
              </span>
            </div>
          </div>
        </div>

        {/* Donut "Saídas" */}
        <div className="fin-card vg-chart-card vg-chart-card--donut">
          <div className="fin-section__header">
            <h3 className="fin-section__title">
              <span className="vg-donut__title-icon" aria-hidden>💸</span>
              Saídas
            </h3>
          </div>
          <div className="vg-donut-wrap">
            <DonutSVG
              slices={[
                {
                  label: 'Saiu',
                  value: saidasPago,
                  color: 'var(--fin-blue, #3b82f6)',
                },
                {
                  label: 'A sair',
                  value: saidasAFaltar,
                  color: 'var(--fin-line)',
                },
              ]}
              size={160}
              thickness={22}
              centerLabel="saiu"
              centerValue={`${pctSaiu.toFixed(0)}%`}
              showLegend={false}
              ariaLabel="Percentual de saídas pagas"
            />
            <div className="vg-donut-footer">
              <span className="vg-donut-footer__label">Falta pagar:</span>
              <span className="vg-donut-footer__value vg-donut-footer__value--blue">
                {fmtBRL(saidasAFaltar)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ============================= */}
      {/* Timeline "Custos por etapa" */}
      {/* ============================= */}
      <div className="fin-card vg-timeline-card">
        <div className="vg-timeline-header">
          <h3 className="fin-section__title">Custos por etapa</h3>
          <span className="vg-timeline-sub">
            Evolução do gasto ao longo do processo
          </span>
        </div>

        <div className="vg-timeline">
          {/* Linha horizontal base */}
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
                  <div className="vg-timeline-step__label">
                    {etapa.label}
                  </div>
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

      {/* ============================= */}
      {/* Projeção ao finalizar */}
      {/* ============================= */}
      <div className="vg-projecao">
        <div className="vg-projecao__icon" aria-hidden>🔮</div>
        <div className="vg-projecao__body">
          <span className="vg-projecao__label">PROJEÇÃO AO FINALIZAR</span>
          <div className="vg-projecao__headline">
            Lucro estimado de{' '}
            <strong className="vg-projecao__amount">
              {erroCustos ? '—' : fmtBRL(lucroProjetado)}
            </strong>
            {!erroCustos && (
              <>
                {' · '}margem{' '}
                <strong>{margemProjetada.toFixed(1)}%</strong>
              </>
            )}
          </div>
          <p className="vg-projecao__note">
            Assumindo custos médios para Transcrição ({fmtBRL(premissas.transcricao)})
            {' '}e Finalização ({fmtBRL(premissas.finalizacao)}). Todas as faturas pagas.
          </p>
        </div>
        <button
          className="vg-projecao__btn"
          type="button"
          title="Em breve — estamos fechando o Lote 4"
          disabled
        >
          Ajustar premissas
        </button>
      </div>

      <style jsx>{`
        /* ======== Header ======== */
        .vg-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
          gap: 16px;
          flex-wrap: wrap;
        }
        .vg-header__title-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .vg-header__icon {
          font-size: 22px;
          line-height: 1;
        }
        .vg-header__title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--fin-ink);
        }
        .vg-header__subtitle {
          margin: 2px 0 0;
          font-size: 12px;
          color: var(--fin-ink-3);
        }
        .vg-header__btn {
          border: 1px solid var(--fin-line);
          background: var(--fin-bg);
          border-radius: 8px;
          padding: 6px 12px;
          font-size: 12px;
          color: var(--fin-ink-2);
          cursor: not-allowed;
          opacity: 0.6;
        }

        /* ======== KPIs ======== */
        .vg-kpis {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }
        @media (max-width: 900px) {
          .vg-kpis {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        .vg-kpi {
          position: relative;
          border-radius: var(--fin-radius);
          padding: 14px 16px;
          border: 1px solid var(--fin-line);
          background: var(--fin-bg);
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-height: 92px;
        }
        .vg-kpi__arrow {
          position: absolute;
          top: 12px;
          right: 14px;
          font-size: 14px;
          font-weight: 700;
          opacity: 0.75;
        }
        .vg-kpi__label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--fin-ink-3);
        }
        .vg-kpi__value {
          font-size: 22px;
          font-weight: 700;
          line-height: 1.15;
          font-variant-numeric: tabular-nums;
        }
        .vg-kpi__hint {
          font-size: 11px;
          color: var(--fin-ink-3);
        }

        /* Variantes de cor */
        .vg-kpi--green {
          background: #f0fdf4;
          border-color: #bbf7d0;
        }
        .vg-kpi--green .vg-kpi__value,
        .vg-kpi--green .vg-kpi__arrow {
          color: #15803d;
        }
        .vg-kpi--green .vg-kpi__label {
          color: #166534;
        }

        .vg-kpi--red {
          background: #fef2f2;
          border-color: #fecaca;
        }
        .vg-kpi--red .vg-kpi__value,
        .vg-kpi--red .vg-kpi__arrow {
          color: #b91c1c;
        }
        .vg-kpi--red .vg-kpi__label {
          color: #991b1b;
        }

        .vg-kpi--purple {
          background: #faf5ff;
          border-color: #e9d5ff;
        }
        .vg-kpi--purple .vg-kpi__value,
        .vg-kpi--purple .vg-kpi__arrow {
          color: #7c3aed;
        }
        .vg-kpi--purple .vg-kpi__label {
          color: #6b21a8;
        }

        .vg-kpi--margem {
          background: #fff7ed;
          border-color: #fed7aa;
        }
        .vg-kpi--margem .vg-kpi__value,
        .vg-kpi--margem .vg-kpi__arrow {
          color: #c2410c;
        }
        .vg-kpi--margem .vg-kpi__label {
          color: #9a3412;
        }
        .vg-kpi--margem-positive .vg-kpi__value {
          color: #15803d;
        }
        .vg-kpi--margem-negative .vg-kpi__value {
          color: #b91c1c;
        }

        /* ======== Charts row ======== */
        .vg-charts-row {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr;
          gap: 12px;
          margin-bottom: 16px;
        }
        @media (max-width: 1100px) {
          .vg-charts-row {
            grid-template-columns: 1fr 1fr;
          }
          .vg-chart-card--linha {
            grid-column: 1 / -1;
          }
        }
        @media (max-width: 640px) {
          .vg-charts-row {
            grid-template-columns: 1fr;
          }
        }
        .vg-chart-card {
          display: flex;
          flex-direction: column;
        }
        .vg-linha-wrap {
          overflow-x: auto;
          padding: 8px 0 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 180px;
        }
        .vg-donut-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 12px 0 4px;
          gap: 10px;
        }
        .vg-donut-footer {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding-top: 4px;
          border-top: 1px dashed var(--fin-line);
          width: 100%;
          margin-top: 4px;
        }
        .vg-donut-footer__label {
          font-size: 11px;
          color: var(--fin-ink-3);
        }
        .vg-donut-footer__value {
          font-size: 15px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .vg-donut-footer__value--yellow {
          color: #ca8a04;
        }
        .vg-donut-footer__value--blue {
          color: #2563eb;
        }
        .vg-donut__title-icon {
          margin-right: 6px;
        }
        .vg-no-data {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 160px;
          color: var(--fin-ink-3);
          font-size: 13px;
          font-style: italic;
        }

        /* ======== Timeline ======== */
        .vg-timeline-card {
          margin-bottom: 16px;
        }
        .vg-timeline-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 18px;
        }
        .vg-timeline-sub {
          font-size: 11px;
          color: var(--fin-ink-3);
        }
        .vg-timeline {
          position: relative;
          overflow-x: auto;
          padding: 8px 4px 4px;
        }
        .vg-timeline-line {
          position: absolute;
          left: 24px;
          right: 24px;
          top: calc(50% + 6px);
          height: 1px;
          background: var(--fin-line);
        }
        .vg-timeline-track {
          position: relative;
          display: flex;
          justify-content: space-between;
          gap: 12px;
          min-width: 760px;
        }
        .vg-timeline-step {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
          min-width: 60px;
          text-align: center;
          gap: 6px;
        }
        .vg-timeline-step__label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: var(--fin-ink-3);
        }
        .vg-timeline-step__dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--fin-bg);
          border: 2px solid var(--fin-line);
          z-index: 1;
        }
        .vg-timeline-step__dot--ativo {
          background: #f59e0b;
          border-color: #d97706;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
        }
        .vg-timeline-step__value {
          font-size: 11px;
          font-weight: 600;
          color: var(--fin-ink-3);
          min-height: 14px;
        }
        .vg-timeline-step--ativo .vg-timeline-step__value {
          color: #b45309;
        }

        /* ======== Projeção ======== */
        .vg-projecao {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 16px 18px;
          background: #faf5ff;
          border: 1px solid #e9d5ff;
          border-radius: var(--fin-radius);
        }
        .vg-projecao__icon {
          font-size: 24px;
          line-height: 1;
          flex-shrink: 0;
        }
        .vg-projecao__body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .vg-projecao__label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #6b21a8;
        }
        .vg-projecao__headline {
          font-size: 14px;
          color: var(--fin-ink);
          line-height: 1.4;
        }
        .vg-projecao__amount {
          color: #15803d;
        }
        .vg-projecao__note {
          margin: 0;
          font-size: 11px;
          color: var(--fin-ink-3);
          line-height: 1.4;
        }
        .vg-projecao__btn {
          align-self: flex-start;
          border: 1px solid #e9d5ff;
          background: #fff;
          border-radius: 8px;
          padding: 8px 14px;
          font-size: 12px;
          color: #6b21a8;
          cursor: not-allowed;
          opacity: 0.6;
          white-space: nowrap;
        }
      `}</style>
    </div>
  )
}

export default VisaoGeral