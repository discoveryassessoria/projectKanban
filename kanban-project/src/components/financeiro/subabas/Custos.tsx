// src/components/financeiro/subabas/Custos.tsx
//
// Sub-aba "Custos" do Financeiro — VERSÃO LOTE 5 (funcional completa).
//
// Estrutura:
//   1. Cards "Custos por Tipo" — do Lote 4 (Certidões/Apostilamentos/etc.)
//   2. TabelaCustos — do Lote 2, intacta
//   3. 🆕 LOTE 5: Bloco "Outros Lançamentos" FUNCIONAL:
//      - Header com busca + ordenação + botão "+ Novo Lançamento"
//      - 4 KPIs reais (A Repassar / Já Pago / Internos / Total)
//      - Lista de OutroCustoCard (apenas REPASSAR)
//      - Empty state amigável
//      - Modal "Novo Lançamento" pra criar
//      - Cada card abre seu próprio modal de edição/pagamento

'use client'

import { useEffect, useState, useMemo } from 'react'
import { Plus, Wallet, AlertCircle, Search } from 'lucide-react'
import { TabelaCustos } from '@/src/components/kanban/TabelaCustos'
import { fmtBRL } from '@/src/lib/financeiro/helpers'
import { OutroCustoCard } from '@/src/components/financeiro/cards/OutroCustoCard'
import { CustosPorTipoCards } from '@/src/components/financeiro/cards/CustosPorTipoCards'
import { NovoOutroCustoModal } from '@/src/components/financeiro/modals/NovoOutroCustoModal'
import type {
  OutroCustoData,
  TotaisOutrosCustos,
} from '@/src/types/outros-custos'
import {
  filtrarPorBusca,
  ordenarOutrosCustos,
  type OrdemOutroCusto,
} from '@/src/lib/financeiro/outros-custos-helpers'

// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------
export interface CustosProps {
  processoId: number
  nomeFamilia?: string
}

interface TipoServico {
  id: number
  nome: string
  ordem: number
}

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export function Custos({ processoId, nomeFamilia }: CustosProps) {
  // ===== Estado dos cards "Custos por Tipo" (Lote 4) =====
  const [servicos, setServicos] = useState<TipoServico[]>([])
  const [totaisPorServico, setTotaisPorServico] = useState<
    Record<number, number>
  >({})
  const [totalGeralTabela, setTotalGeralTabela] = useState(0)
  const [custosLoading, setCustosLoading] = useState(true)

  const handleTotaisChange = (dados: {
    servicos: TipoServico[]
    totaisPorServico: Record<number, number>
    totalGeral: number
  }) => {
    setServicos(dados.servicos)
    setTotaisPorServico(dados.totaisPorServico)
    setTotalGeralTabela(dados.totalGeral)
    setCustosLoading(false)
  }

  // ===== 🆕 LOTE 5: Estado dos OutrosCustos =====
  const [outrosCustos, setOutrosCustos] = useState<OutroCustoData[]>([])
  const [totais, setTotais] = useState<TotaisOutrosCustos | null>(null)
  const [loadingOutros, setLoadingOutros] = useState(true)
  const [erroOutros, setErroOutros] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<OrdemOutroCusto>('vencimento')
  const [modalNovoAberto, setModalNovoAberto] = useState(false)

  // ===== Carrega OutrosCustos =====
  useEffect(() => {
    let cancelado = false

    async function carregar() {
      try {
        setLoadingOutros(true)
        setErroOutros(null)
        const res = await fetch(
          `/api/processos/${processoId}/outros-custos`,
          {
            headers: {
              Authorization: `Bearer ${
                localStorage.getItem('authToken') || ''
              }`,
            },
          },
        )

        if (cancelado) return

        if (!res.ok) {
          setErroOutros(
            `Não foi possível carregar os lançamentos (${res.status}).`,
          )
          setOutrosCustos([])
          setTotais(null)
          return
        }

        const data = await res.json()
        if (cancelado) return

        setOutrosCustos(data.outrosCustos || [])
        setTotais(data.totais || null)
      } catch (err) {
        console.error('[Custos] erro ao carregar outros custos:', err)
        if (!cancelado) {
          setErroOutros('Erro de conexão ao carregar lançamentos.')
          setOutrosCustos([])
          setTotais(null)
        }
      } finally {
        if (!cancelado) setLoadingOutros(false)
      }
    }

    carregar()
    return () => {
      cancelado = true
    }
  }, [processoId])

  // ===== Lista filtrada (apenas REPASSAR) =====
  const repassesFiltrados = useMemo(() => {
    let lista = outrosCustos.filter((oc) => oc.natureza === 'REPASSAR')
    lista = filtrarPorBusca(lista, busca)
    lista = ordenarOutrosCustos(lista, ordem)
    return lista
  }, [outrosCustos, busca, ordem])

  // ===== Handlers de atualização =====
  function handleNovoLancamento(novo: OutroCustoData) {
    setOutrosCustos((atuais) => [novo, ...atuais])
    // Após criar, recarrega totais (ou recalcula localmente — vamos refazer fetch)
    recarregarOutrosCustos()
  }

  function handleAtualizarOutroCusto(atualizado: OutroCustoData) {
    setOutrosCustos((atuais) =>
      atuais.map((oc) => (oc.id === atualizado.id ? atualizado : oc)),
    )
    recarregarOutrosCustos()
  }

  function handleExcluirOutroCusto(id: number) {
    setOutrosCustos((atuais) => atuais.filter((oc) => oc.id !== id))
    recarregarOutrosCustos()
  }

  async function recarregarOutrosCustos() {
    try {
      const res = await fetch(`/api/processos/${processoId}/outros-custos`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })
      if (!res.ok) return
      const data = await res.json()
      setOutrosCustos(data.outrosCustos || [])
      setTotais(data.totais || null)
    } catch (err) {
      console.error('[Custos] erro ao recarregar:', err)
    }
  }

  // ===== KPIs (vindos da API ou calculados localmente como fallback) =====
  const totalARepassar = totais?.totalAPagarBRL ?? 0
  const totalJaPago = totais?.totalPagoBRL ?? 0
  const totalInternos = totais?.totalInternoBRL ?? 0
  const totalGeralOutros = totais?.totalRepassarBRL ?? 0
  const contagemRepasses = repassesFiltrados.length
  const contagemTotal = outrosCustos.filter(
    (oc) => oc.natureza === 'REPASSAR',
  ).length

  // ===== Render =====
  return (
    <div className="cs-root">
      {/* Bloco 1: Cards por tipo de documento (Lote 4) */}
      <CustosPorTipoCards
        servicos={servicos}
        totaisPorServico={totaisPorServico}
        totalGeral={totalGeralTabela}
        loading={custosLoading}
      />

      {/* Bloco 2: TabelaCustos (Lote 2) */}
      <TabelaCustos
        processoId={processoId}
        nomeFamilia={nomeFamilia}
        onTotaisChange={handleTotaisChange}
      />

      {/* Bloco 3: 🆕 Outros Lançamentos (Lote 5 — funcional!) */}
      <div className="cs-outros">
        {/* Header */}
        <div className="cs-outros__header">
          <div className="cs-outros__titulo">
            <div className="cs-outros__icone">
              <Wallet />
            </div>
            <div>
              <h3 className="cs-outros__h3">Outros Lançamentos</h3>
              <p className="cs-outros__sub">
                Advogado, cartório, taxas consulares, deslocamentos e outros
                custos a repassar
              </p>
            </div>
          </div>

          <button
            type="button"
            className="cs-outros__btn-novo"
            onClick={() => setModalNovoAberto(true)}
          >
            <Plus className="cs-outros__btn-icon" />
            <span>Novo Lançamento</span>
          </button>
        </div>

        {/* 4 KPIs reais */}
        <div className="fin-kpi-grid">
          <div className="fin-card fin-card--red">
            <div className="fin-kpi">
              <span className="fin-kpi__label">A Pagar</span>
              <span className="fin-kpi__value fin-kpi__value--red">
                {fmtBRL(totalARepassar)}
              </span>
              <span className="fin-kpi__hint">Pendente a terceiros</span>
            </div>
          </div>

          <div className="fin-card fin-card--green">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Já Pago</span>
              <span className="fin-kpi__value fin-kpi__value--green">
                {fmtBRL(totalJaPago)}
              </span>
              <span className="fin-kpi__hint">Pagamentos efetuados</span>
            </div>
          </div>

          <div className="fin-card fin-card--blue">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Custos Internos</span>
              <span className="fin-kpi__value fin-kpi__value--blue">
                {fmtBRL(totalInternos)}
              </span>
              <span className="fin-kpi__hint">Não repassados ao cliente</span>
            </div>
          </div>

          <div className="fin-card fin-card--purple">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Total Geral</span>
              <span className="fin-kpi__value fin-kpi__value--purple">
                {fmtBRL(totalGeralOutros)}
              </span>
              <span className="fin-kpi__hint">
                {contagemTotal}{' '}
                {contagemTotal === 1 ? 'lançamento' : 'lançamentos'}
              </span>
            </div>
          </div>
        </div>

        {/* Erro (se houver) */}
        {erroOutros && (
          <div className="cs-outros__erro">
            <AlertCircle className="cs-outros__erro-icon" />
            <span>{erroOutros}</span>
          </div>
        )}

        {/* Filtros (só aparecem se tiver lançamentos) */}
        {!loadingOutros && contagemTotal > 0 && (
          <div className="cs-outros__filtros">
            <div className="cs-outros__busca-wrap">
              <Search className="cs-outros__busca-icon" />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por descrição, tipo, fornecedor..."
                className="cs-outros__busca"
              />
            </div>
            <select
              value={ordem}
              onChange={(e) => setOrdem(e.target.value as OrdemOutroCusto)}
              className="cs-outros__ordem"
            >
              <option value="vencimento">Ordenar por vencimento</option>
              <option value="valor">Ordenar por valor</option>
              <option value="criacao">Mais recentes primeiro</option>
            </select>
          </div>
        )}

        {/* Lista, loading ou empty state */}
        {loadingOutros ? (
          <div className="cs-outros__loading">
            <div className="cs-outros__spinner" />
            <p>Carregando lançamentos...</p>
          </div>
        ) : contagemTotal === 0 ? (
          <div className="cs-empty">
            <div className="cs-empty__icone">📋</div>
            <h4 className="cs-empty__titulo">Nenhum lançamento ainda</h4>
            <p className="cs-empty__hint">
              Registre aqui custos a pagar a terceiros: advogado em Roma,
              cartórios, taxas consulares, traduções extras, deslocamentos.
              Cada lançamento pode ter pagamentos parciais e ser repassado ao
              cliente.
            </p>
            <button
              type="button"
              onClick={() => setModalNovoAberto(true)}
              className="cs-empty__btn"
            >
              <Plus className="cs-outros__btn-icon" />
              Criar primeiro lançamento
            </button>
          </div>
        ) : repassesFiltrados.length === 0 ? (
          <div className="cs-outros__sem-resultados">
            Nenhum lançamento encontrado com esses filtros.
          </div>
        ) : (
          <div className="cs-lista">
            {repassesFiltrados.map((oc) => (
              <OutroCustoCard
                key={oc.id}
                outroCusto={oc}
                onAtualizar={handleAtualizarOutroCusto}
                onExcluir={handleExcluirOutroCusto}
              />
            ))}
          </div>
        )}

        {/* Contador no rodapé (se filtrado) */}
        {!loadingOutros &&
          contagemTotal > 0 &&
          contagemRepasses < contagemTotal && (
            <div className="cs-outros__contador">
              Mostrando {contagemRepasses} de {contagemTotal} lançamentos
            </div>
          )}
      </div>

      {/* Modal "Novo Lançamento" */}
      <NovoOutroCustoModal
        processoId={processoId}
        isOpen={modalNovoAberto}
        onClose={() => setModalNovoAberto(false)}
        onSuccess={handleNovoLancamento}
        naturezaPadrao="REPASSAR"
      />

      <style jsx>{`
        .cs-root {
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
        .cs-outros {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .cs-outros__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }
        .cs-outros__titulo {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cs-outros__icone {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--fin-purple-50);
          color: var(--fin-purple-600);
          border-radius: var(--fin-radius-sm);
        }
        .cs-outros__icone :global(svg) {
          width: 20px;
          height: 20px;
        }
        .cs-outros__h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--fin-ink);
        }
        .cs-outros__sub {
          margin: 2px 0 0;
          font-size: 13px;
          color: var(--fin-ink-3);
        }
        .cs-outros__btn-novo {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 16px;
          font-size: 14px;
          font-weight: 500;
          background: #d97706;
          color: #fff;
          border: 1px solid transparent;
          border-radius: var(--fin-radius-sm);
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s;
        }
        .cs-outros__btn-novo:hover {
          background: #b45309;
        }
        .cs-outros__btn-icon {
          width: 14px;
          height: 14px;
        }

        /* Erro */
        .cs-outros__erro {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 14px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #991b1b;
          font-size: 13px;
        }
        .cs-outros__erro-icon {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }

        /* Filtros */
        .cs-outros__filtros {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .cs-outros__busca-wrap {
          flex: 1;
          min-width: 200px;
          position: relative;
        }
        .cs-outros__busca-icon {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          width: 14px;
          height: 14px;
          color: #94a3b8;
          pointer-events: none;
        }
        .cs-outros__busca {
          width: 100%;
          padding: 8px 12px 8px 32px;
          font-size: 13px;
          border: 1px solid var(--fin-line);
          border-radius: 8px;
          background: #fff;
          color: var(--fin-ink);
          font-family: inherit;
          outline: none;
        }
        .cs-outros__busca:focus {
          border-color: var(--fin-purple-600);
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
        }
        .cs-outros__ordem {
          padding: 8px 12px;
          font-size: 13px;
          border: 1px solid var(--fin-line);
          border-radius: 8px;
          background: #fff;
          color: var(--fin-ink);
          font-family: inherit;
          outline: none;
          cursor: pointer;
        }

        /* Loading */
        .cs-outros__loading {
          padding: 40px 20px;
          text-align: center;
          color: var(--fin-ink-3);
        }
        .cs-outros__spinner {
          width: 24px;
          height: 24px;
          border: 2px solid var(--fin-line);
          border-top-color: var(--fin-purple-600);
          border-radius: 50%;
          margin: 0 auto 12px;
          animation: cs-spin 0.8s linear infinite;
        }
        @keyframes cs-spin {
          to {
            transform: rotate(360deg);
          }
        }

        /* Empty */
        .cs-empty {
          background: var(--fin-bg-soft);
          border: 1px dashed var(--fin-line);
          border-radius: var(--fin-radius);
          padding: 40px 32px;
          text-align: center;
        }
        .cs-empty__icone {
          font-size: 36px;
          margin-bottom: 12px;
        }
        .cs-empty__titulo {
          margin: 0 0 8px;
          font-size: 16px;
          font-weight: 600;
          color: var(--fin-ink);
        }
        .cs-empty__hint {
          margin: 0 auto 16px;
          max-width: 540px;
          font-size: 13px;
          line-height: 1.6;
          color: var(--fin-ink-3);
        }
        .cs-empty__btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 18px;
          font-size: 14px;
          font-weight: 500;
          background: #d97706;
          color: #fff;
          border: 1px solid transparent;
          border-radius: 8px;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s;
        }
        .cs-empty__btn:hover {
          background: #b45309;
        }

        /* Sem resultados */
        .cs-outros__sem-resultados {
          padding: 24px;
          text-align: center;
          background: var(--fin-bg-soft);
          border: 1px dashed var(--fin-line);
          border-radius: 8px;
          color: var(--fin-ink-3);
          font-size: 13px;
        }

        /* Lista */
        .cs-lista {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        /* Contador */
        .cs-outros__contador {
          text-align: center;
          font-size: 12px;
          color: var(--fin-ink-3);
        }
      `}</style>
    </div>
  )
}

export default Custos