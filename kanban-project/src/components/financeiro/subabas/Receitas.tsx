// src/components/financeiro/subabas/Receitas.tsx
//
// 🆕 LOTE 5 BLOCO F-2: Receitas reformada conforme decisões do Marco (29/04/2026):
//   1. Pasta Documental NÃO entra mais nas Receitas (já removido em rodada anterior)
//   2. ✨ FATURAS removidas da aba Receitas — Marco: "deve sair esse 'incluir
//      fatura' porque os custos devem ser lançados somente na parte 'custos'"
//      → Receitas agora trata apenas de Honorários Discovery e serviços
//        (Outros Custos COBRAR). Faturas permanecem sendo gerenciadas no
//        componente ProcessoFaturas (kanban) onde já existem e funcionam.
//
// Estrutura:
//   1. 4 KPIs: Total Cobrado / Recebido / A Receber / Vencido
//      (todos calculados a partir de Outros Custos COBRAR)
//   2. Card "🔔 Próximos vencimentos" (honorários vencendo em 7d)
//   3. Header "Receitas do processo · N itens · Recebimentos do cliente"
//      com busca, select de ordenação e dropdowns Recibos/Relatórios
//   4. Label "💼 Honorários Discovery e serviços (N)"
//   5. Lista de OutroCustoCard

"use client"

import { useState, useEffect, useMemo } from "react"
import {
  FileText,
  FileDown,
  Search,
  Bell,
} from "lucide-react"
import { fmtBRL } from "@/src/lib/financeiro/helpers"
import { OutroCustoCard } from "@/src/components/financeiro/cards/OutroCustoCard"
import { NovoOutroCustoModal } from "@/src/components/financeiro/modals/NovoOutroCustoModal"
import type {
  OutroCustoData,
  TotaisOutrosCustos,
} from "@/src/types/outros-custos"
import {
  filtrarPorBusca,
  ordenarOutrosCustos,
  type OrdemOutroCusto,
} from "@/src/lib/financeiro/outros-custos-helpers"

// ========================================
// TYPES
// ========================================
interface ReceitasProps {
  processoId: number
  nomeFamilia?: string
  onUpdate?: () => void
}

// ========================================
// COMPONENT
// ========================================
export function Receitas({ processoId, onUpdate }: ReceitasProps) {
  // ---- ESTADO OUTROS CUSTOS (COBRAR) ----
  const [outrosCustos, setOutrosCustos] = useState<OutroCustoData[]>([])
  const [totaisOC, setTotaisOC] = useState<TotaisOutrosCustos | null>(null)
  const [loading, setLoading] = useState(true)
  const [modalNovoCobrarAberto, setModalNovoCobrarAberto] = useState(false)
  const [buscaOC, setBuscaOC] = useState('')
  const [ordemOC, setOrdemOC] = useState<OrdemOutroCusto>('vencimento')

  // ---- DROPDOWNS Recibos / Relatórios ----
  const [dropdownAberto, setDropdownAberto] = useState<null | 'recibos' | 'relatorios'>(null)

  // ========================================
  // COMPUTED VALUES
  // ========================================
  const honorariosFiltrados = useMemo(() => {
    let lista = outrosCustos.filter((oc) => oc.natureza === 'COBRAR')
    lista = filtrarPorBusca(lista, buscaOC)
    lista = ordenarOutrosCustos(lista, ordemOC)
    return lista
  }, [outrosCustos, buscaOC, ordemOC])

  const honorariosTotal = outrosCustos.filter((oc) => oc.natureza === 'COBRAR').length

  // KPIs CONSOLIDADOS — agora apenas Honorários COBRAR
  const kpisConsolidados = useMemo(() => {
    const honTotal = totaisOC?.totalCobrarBRL ?? 0
    const honPago = totaisOC?.totalRecebidoBRL ?? 0
    const honPendente = totaisOC?.totalARecebidoBRL ?? 0

    // Calcula vencido a partir das datas dos Outros Custos COBRAR
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    let vencido = 0
    let qtdVencidas = 0
    outrosCustos
      .filter((oc) => oc.natureza === 'COBRAR' && oc.vencimento)
      .forEach((oc) => {
        const venc = new Date(oc.vencimento as string)
        venc.setHours(0, 0, 0, 0)
        if (venc.getTime() >= hoje.getTime()) return
        const cambio = oc.moeda === 'BRL' ? 1 : oc.cambio ? Number(oc.cambio) : 1
        const pagos =
          (
            oc as unknown as {
              pagamentos?: Array<{
                valor?: number | null
                estornado?: boolean
              }>
            }
          ).pagamentos
            ?.filter((p) => !p.estornado)
            .reduce((s, p) => s + Number(p.valor || 0), 0) || 0
        const restanteOriginal = Number(oc.valor || 0) - pagos
        if (restanteOriginal <= 0.005) return
        vencido += restanteOriginal * cambio
        qtdVencidas += 1
      })

    const qtdPendentes = outrosCustos
      .filter((oc) => oc.natureza === 'COBRAR')
      .filter((oc) => {
        const pagos =
          (
            oc as unknown as {
              pagamentos?: Array<{
                valor?: number | null
                estornado?: boolean
              }>
            }
          ).pagamentos
            ?.filter((p) => !p.estornado)
            .reduce((s, p) => s + Number(p.valor || 0), 0) || 0
        return Number(oc.valor || 0) - pagos > 0.005
      }).length

    return {
      total: honTotal,
      pago: honPago,
      pendente: honPendente,
      vencido,
      qtdItens: honorariosTotal,
      qtdPendentes,
      qtdVencidas,
    }
  }, [totaisOC, outrosCustos, honorariosTotal])

  const pctRecebido =
    kpisConsolidados.total > 0
      ? (kpisConsolidados.pago / kpisConsolidados.total) * 100
      : 0

  // Próximos vencimentos (honorários COBRAR vencendo em 7d)
  const proximosVencimentos = useMemo(() => {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const lista: { nome: string; dias: number; valor: number; moeda: string }[] = []

    outrosCustos
      .filter((oc) => oc.natureza === 'COBRAR' && oc.vencimento)
      .forEach((oc) => {
        const venc = new Date(oc.vencimento as string)
        venc.setHours(0, 0, 0, 0)
        const dias = Math.ceil((venc.getTime() - hoje.getTime()) / 86400000)
        if (dias < 0 || dias > 7) return
        const pagos =
          (
            oc as unknown as {
              pagamentos?: Array<{
                valor?: number | null
                estornado?: boolean
              }>
            }
          ).pagamentos
            ?.filter((p) => !p.estornado)
            .reduce((s, p) => s + Number(p.valor || 0), 0) || 0
        const restante = Number(oc.valor || 0) - pagos
        if (restante <= 0.005) return
        lista.push({
          nome: oc.descricao || oc.tipo,
          dias,
          valor: restante,
          moeda: oc.moeda,
        })
      })

    lista.sort((a, b) => a.dias - b.dias)
    return lista
  }, [outrosCustos])

  // ========================================
  // DATA LOADING
  // ========================================
  useEffect(() => {
    carregarOutrosCustos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processoId])

  // Fecha dropdowns ao clicar fora
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.rc-dropdown')) {
        setDropdownAberto(null)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  async function carregarOutrosCustos() {
    try {
      setLoading(true)
      const res = await fetch(`/api/processos/${processoId}/outros-custos`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      })
      if (!res.ok) return
      const data = await res.json()
      setOutrosCustos(data.outrosCustos || [])
      setTotaisOC(data.totais || null)
    } catch (err) {
      console.error('[Receitas] erro ao carregar outros custos:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleNovoHonorario(novo: OutroCustoData) {
    setOutrosCustos((atuais) => [novo, ...atuais])
    carregarOutrosCustos()
    onUpdate?.()
  }

  function handleAtualizarOutroCusto(atualizado: OutroCustoData) {
    setOutrosCustos((atuais) =>
      atuais.map((oc) => (oc.id === atualizado.id ? atualizado : oc)),
    )
    carregarOutrosCustos()
    onUpdate?.()
  }

  function handleExcluirOutroCusto(id: number) {
    setOutrosCustos((atuais) => atuais.filter((oc) => oc.id !== id))
    carregarOutrosCustos()
    onUpdate?.()
  }

  // ========================================
  // FORMATTERS
  // ========================================
  const formatarMoeda = (valor: number, moeda: string = 'BRL') => {
    return valor.toLocaleString('pt-BR', {
      style: 'currency',
      currency: moeda === 'BRL' ? 'BRL' : moeda,
    })
  }

  // Stub pra "Detalhar →" — placeholder até Lote 6
  function abrirDetalhesKPI(qual: string) {
    alert(`Detalhar KPI "${qual}" — em breve.`)
  }

  // ========================================
  // RENDER
  // ========================================
  return (
    <div className="flex flex-col bg-gray-50">
      {/* ========================================================== */}
      {/* KPIs CONSOLIDADOS                                            */}
      {/* ========================================================== */}
      <div className="px-6 pt-6">
        <div className="fin-kpi-grid">
          <div className="fin-card fin-card--purple rc-card-wrap">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Total Cobrado</span>
              <span className="fin-kpi__value fin-kpi__value--purple">
                {fmtBRL(kpisConsolidados.total)}
              </span>
              <span className="fin-kpi__hint">
                {kpisConsolidados.qtdItens} {kpisConsolidados.qtdItens === 1 ? 'lançamento' : 'lançamentos'}
              </span>
            </div>
            <button
              type="button"
              className="rc-card-detalhar"
              onClick={() => abrirDetalhesKPI('totalCobrado')}
            >
              Detalhar →
            </button>
          </div>

          <div className="fin-card fin-card--green rc-card-wrap">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Recebido</span>
              <span className="fin-kpi__value fin-kpi__value--green">
                {fmtBRL(kpisConsolidados.pago)}
              </span>
              <span className="fin-kpi__hint">
                {pctRecebido.toFixed(0)}% do total
              </span>
            </div>
            <button
              type="button"
              className="rc-card-detalhar"
              onClick={() => abrirDetalhesKPI('recebido')}
            >
              Detalhar →
            </button>
          </div>

          <div className="fin-card fin-card--yellow rc-card-wrap">
            <div className="fin-kpi">
              <span className="fin-kpi__label">A Receber</span>
              <span className="fin-kpi__value fin-kpi__value--yellow">
                {fmtBRL(kpisConsolidados.pendente)}
              </span>
              <span className="fin-kpi__hint">
                {kpisConsolidados.qtdPendentes} {kpisConsolidados.qtdPendentes === 1 ? 'item pendente' : 'itens pendentes'}
              </span>
            </div>
            <button
              type="button"
              className="rc-card-detalhar"
              onClick={() => abrirDetalhesKPI('aReceber')}
            >
              Detalhar →
            </button>
          </div>

          <div className="fin-card fin-card--red rc-card-wrap">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Vencido</span>
              <span className="fin-kpi__value fin-kpi__value--red">
                {fmtBRL(kpisConsolidados.vencido)}
              </span>
              <span className="fin-kpi__hint">
                {kpisConsolidados.qtdVencidas} {kpisConsolidados.qtdVencidas === 1 ? 'item em atraso' : 'itens em atraso'}
              </span>
            </div>
            <button
              type="button"
              className="rc-card-detalhar"
              onClick={() => abrirDetalhesKPI('vencido')}
            >
              Detalhar →
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================== */}
      {/* Próximos vencimentos (7d)                                   */}
      {/* ========================================================== */}
      {proximosVencimentos.length > 0 && (
        <div className="px-6 pt-4">
          <div className="rc-proxvenc-card">
            <div className="rc-proxvenc-head">
              <Bell className="h-4 w-4 text-amber-600" />
              <span>Próximos vencimentos ({proximosVencimentos.length})</span>
            </div>
            <div className="rc-proxvenc-list">
              {proximosVencimentos.slice(0, 3).map((v, i) => (
                <div key={i} className="rc-proxvenc-item">
                  <span className="rc-proxvenc-nome">
                    <strong>{v.nome}</strong> · {formatarMoeda(v.valor, v.moeda)}
                  </span>
                  <span className={`rc-proxvenc-dias ${v.dias <= 1 ? 'urgente' : ''}`}>
                    {v.dias === 0 ? 'Hoje' : v.dias === 1 ? 'Amanhã' : `${v.dias} dias`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* Header: "Receitas do processo" + busca + dropdowns          */}
      {/* ========================================================== */}
      <div className="px-6 pt-4">
        <div className="rc-listagem-head">
          <div>
            <div className="rc-titulo">Receitas do processo</div>
            <div className="rc-sub">
              {kpisConsolidados.qtdItens} {kpisConsolidados.qtdItens === 1 ? 'item' : 'itens'} · Recebimentos do cliente
            </div>
          </div>
          <div className="rc-topbar-acoes">
            <div className="rc-busca-wrap">
              <Search className="rc-busca-icon" />
              <input
                type="text"
                value={buscaOC}
                onChange={(e) => setBuscaOC(e.target.value)}
                placeholder="Buscar..."
                className="rc-busca"
              />
            </div>
            <select
              value={ordemOC}
              onChange={(e) => setOrdemOC(e.target.value as OrdemOutroCusto)}
              className="rc-ordem"
            >
              <option value="vencimento">Vencimento</option>
              <option value="valor">Valor</option>
              <option value="criacao">Mais recentes</option>
            </select>

            <div className="rc-dropdown">
              <button
                type="button"
                className="rc-dropdown-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setDropdownAberto(dropdownAberto === 'recibos' ? null : 'recibos')
                }}
              >
                <FileText className="h-4 w-4" />
                Recibos ▾
              </button>
              {dropdownAberto === 'recibos' && (
                <div className="rc-dropdown-menu">
                  <button onClick={() => alert('Em breve')}>Gerar recibo individual</button>
                  <button onClick={() => alert('Em breve')}>Por requerente</button>
                  <button onClick={() => alert('Em breve')}>Recibo consolidado do processo</button>
                  <button onClick={() => alert('Em breve')}>Histórico emitidos</button>
                </div>
              )}
            </div>

            <div className="rc-dropdown">
              <button
                type="button"
                className="rc-dropdown-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setDropdownAberto(dropdownAberto === 'relatorios' ? null : 'relatorios')
                }}
              >
                <FileDown className="h-4 w-4" />
                Relatórios ▾
              </button>
              {dropdownAberto === 'relatorios' && (
                <div className="rc-dropdown-menu">
                  <button onClick={() => alert('Em breve')}>Extrato de Receitas (PDF)</button>
                  <button onClick={() => alert('Em breve')}>Extrato por Requerente (PDF)</button>
                  <button onClick={() => alert('Em breve')}>Relatório de Inadimplência (PDF)</button>
                  <button onClick={() => alert('Em breve')}>Export CSV</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================== */}
      {/* 🚫 Seção FATURAS removida (Marco 29/04/2026)                */}
      {/*    Faturas continuam sendo gerenciadas em ProcessoFaturas   */}
      {/*    no kanban. Aqui em Receitas ficam apenas honorários.    */}
      {/* ========================================================== */}

      {/* ========================================================== */}
      {/* SEÇÃO: HONORÁRIOS DISCOVERY                                  */}
      {/*                                                              */}
      {/* 🚫 Estado vazio "Nenhum honorário lançado" e botão           */}
      {/*    "+ Novo Lançamento" removidos (Marco 29/04/2026):         */}
      {/*    "Nem esse novo lançamento". A criação de honorários       */}
      {/*    acontece em outra aba; aqui é apenas visualização.        */}
      {/* ========================================================== */}
      {honorariosTotal > 0 && (
        <div className="px-6 pt-4">
          <div className="rc-secao-lbl">💼 Honorários Discovery e serviços ({honorariosTotal})</div>
        </div>
      )}

      <div className="flex flex-col">
        <div className="px-6 pb-6 pt-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64">
              <div className="animate-spin h-8 w-8 border-2 border-gray-200 border-t-purple-500 rounded-full mb-3" />
              <p className="text-gray-500 text-sm">Carregando lançamentos...</p>
            </div>
          ) : honorariosTotal > 0 ? (
            <div className="space-y-3">
              {honorariosFiltrados.map((oc) => (
                <OutroCustoCard
                  key={oc.id}
                  outroCusto={oc}
                  onAtualizar={handleAtualizarOutroCusto}
                  onExcluir={handleExcluirOutroCusto}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* ========================================================== */}
      {/* MODAIS                                                       */}
      {/*                                                              */}
      {/* O modal NovoOutroCustoModal foi mantido aqui pra que outras  */}
      {/* partes do sistema (ou ações futuras de pagamento dentro do  */}
      {/* OutroCustoCard, como estornos) continuem funcionando sem    */}
      {/* quebrar. Não é mais aberto por nenhum botão dentro desta    */}
      {/* aba — fica apenas como "garagem" técnica.                   */}
      {/* ========================================================== */}
      <NovoOutroCustoModal
        processoId={processoId}
        isOpen={modalNovoCobrarAberto}
        onClose={() => setModalNovoCobrarAberto(false)}
        onSuccess={handleNovoHonorario}
        naturezaPadrao="COBRAR"
      />

      {/* CSS dos elementos novos */}
      <style jsx>{`
        /* Detalhar nos KPIs */
        .rc-card-wrap { position: relative; }
        .rc-card-detalhar {
          position: absolute;
          top: 12px;
          right: 14px;
          background: transparent;
          border: none;
          padding: 0;
          font-size: 11px;
          font-weight: 500;
          color: #6b7280;
          cursor: pointer;
          transition: color 0.15s;
        }
        .rc-card-detalhar:hover {
          color: #18181b;
          text-decoration: underline;
        }

        /* Próximos vencimentos */
        .rc-proxvenc-card {
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 12px;
          padding: 14px 18px;
        }
        .rc-proxvenc-head {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 700;
          color: #92400e;
          margin-bottom: 10px;
        }
        .rc-proxvenc-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .rc-proxvenc-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 6px 10px;
          background: rgba(255, 255, 255, 0.5);
          border-radius: 6px;
          font-size: 13px;
          color: #78350f;
        }
        .rc-proxvenc-nome { flex: 1; min-width: 0; }
        .rc-proxvenc-dias {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          background: #fde68a;
          color: #78350f;
          flex-shrink: 0;
        }
        .rc-proxvenc-dias.urgente {
          background: #fecaca;
          color: #991b1b;
        }

        /* Header listagem */
        .rc-listagem-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          padding: 12px 0;
        }
        .rc-titulo {
          font-size: 18px;
          font-weight: 700;
          color: #18181b;
        }
        .rc-sub {
          font-size: 12px;
          color: #71717a;
          margin-top: 2px;
        }
        .rc-topbar-acoes {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .rc-busca-wrap {
          position: relative;
        }
        .rc-busca-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          width: 16px;
          height: 16px;
          color: #9ca3af;
          pointer-events: none;
        }
        .rc-busca {
          padding: 10px 14px 10px 38px;
          font-size: 14px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #fff;
          color: #18181b;
          font-family: inherit;
          outline: none;
          width: 220px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .rc-busca::placeholder { color: #9ca3af; }
        .rc-busca:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.1); }
        .rc-ordem {
          padding: 10px 32px 10px 14px;
          font-size: 14px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #fff;
          color: #18181b;
          font-family: inherit;
          cursor: pointer;
          outline: none;
          appearance: none;
          background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e");
          background-repeat: no-repeat;
          background-position: right 12px center;
          background-size: 12px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          min-width: 140px;
        }
        .rc-dropdown {
          position: relative;
        }
        .rc-dropdown-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          background: #fff;
          color: #4b5563;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .rc-dropdown-btn:hover { background: #f9fafb; }
        .rc-dropdown-menu {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          min-width: 240px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
          padding: 6px;
          z-index: 30;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .rc-dropdown-menu button {
          text-align: left;
          padding: 8px 12px;
          background: transparent;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          color: #18181b;
          cursor: pointer;
          font-family: inherit;
        }
        .rc-dropdown-menu button:hover { background: #f3f4f6; }

        /* Labels de seção */
        .rc-secao-lbl {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #6b7280;
          padding: 16px 0 8px;
          border-bottom: 1px solid #e5e7eb;
          margin-bottom: 12px;
        }
      `}</style>
    </div>
  )
}

export default Receitas