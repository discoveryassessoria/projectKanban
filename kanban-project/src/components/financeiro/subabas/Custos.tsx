// src/components/financeiro/subabas/Custos.tsx
//
// 🆕 LOTE 5 BLOCO F-3: Custos reformada pra bater com o protótipo HTML
// (Marco 29/04/2026).
//
// Layout 2 colunas:
//   ESQUERDA (cs-main):
//     1. Card "📋 Pasta Documental"
//        - Header com título + total da pasta (azul grande)
//        - Filtros chip (Todas / Certidões / Traduções / Apostilamentos)
//          → visual por enquanto, lógica de esconder colunas vem em F-3.1
//        - TabelaCustos embutida (planilha funcional, intacta)
//     2. Bloco "Registrar"
//        - Header: título + busca + ordenação + dropdown Relatórios
//          + botão laranja "+ Criar Lançamento"
//        - Empty state com ilustração 💸 ou cards de Outros Custos REPASSAR
//
//   DIREITA (cs-aside):
//     1. Card "TOTAL DE CUSTOS"
//        - Total geral grande
//        - Breakdown: 📋 Pasta Documental + 💼 Outros Custos com mini-barras
//     2. Card "PAGAMENTO A FORNECEDORES"
//        - ✓ Pagos (verde) + ⏰ Pendentes (azul) com mini-barras
//
// Premissas (Marco 29/04/2026):
//   - Pasta Documental NÃO entra mais em RECEITA. Aqui em Custos, ela
//     aparece apenas como visualização do total da planilha (referência),
//     sem virar custo automático no resto do sistema.
//   - "Outros Lançamentos" virou "Registrar" no protótipo, com cara de
//     bloco separado da pasta.

'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  Plus,
  AlertCircle,
  Search,
  FileDown,
  ChevronDown,
} from 'lucide-react'
import { TabelaCustos } from '@/src/components/kanban/TabelaCustos'
import { fmtBRL } from '@/src/lib/financeiro/helpers'
import { OutroCustoCard } from '@/src/components/financeiro/cards/OutroCustoCard'
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

type FiltroPasta = 'todas' | 'cert' | 'trad' | 'apost'

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export function Custos({ processoId, nomeFamilia }: CustosProps) {
  // ===== Estado totais Planilha (vem da TabelaCustos via callback) =====
  const [servicosTabela, setServicosTabela] = useState<TipoServico[]>([])
  const [totaisPorServico, setTotaisPorServico] = useState<Record<number, number>>({})
  const [totalPasta, setTotalPasta] = useState(0)

  function handleTotaisChange(dados: {
    servicos: TipoServico[]
    totaisPorServico: Record<number, number>
    totalGeral: number
  }) {
    setServicosTabela(dados.servicos)
    setTotaisPorServico(dados.totaisPorServico)
    setTotalPasta(dados.totalGeral)
  }

  // ===== Filtro da Pasta Documental (visual por enquanto) =====
  const [filtroPasta, setFiltroPasta] = useState<FiltroPasta>('todas')

  // Calcula subtotal da pasta conforme filtro, usando heurística por nome
  // do serviço (igual fazíamos antes pra Pasta Documental nas receitas).
  // Quando Marco quiser filtro de coluna real (esconder colunas), implementamos
  // num próximo bloco passando esse filtro pra TabelaCustos.
  const subtotalPastaFiltrado = useMemo(() => {
    if (filtroPasta === 'todas') return totalPasta
    let soma = 0
    servicosTabela.forEach((s) => {
      const nome = (s.nome || '').toLowerCase()
      const valor = totaisPorServico[s.id] || 0
      if (filtroPasta === 'cert' && (nome.includes('cert') || nome.includes('desm') || nome.includes('retif'))) {
        soma += valor
      } else if (filtroPasta === 'trad' && nome.includes('trad') && !nome.includes('apost')) {
        soma += valor
      } else if (filtroPasta === 'apost' && nome.includes('apost')) {
        soma += valor
      }
    })
    return soma
  }, [filtroPasta, totalPasta, servicosTabela, totaisPorServico])

  // ===== Outros Custos (REPASSAR) =====
  const [outrosCustos, setOutrosCustos] = useState<OutroCustoData[]>([])
  const [totais, setTotais] = useState<TotaisOutrosCustos | null>(null)
  const [loadingOutros, setLoadingOutros] = useState(true)
  const [erroOutros, setErroOutros] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<OrdemOutroCusto>('vencimento')
  const [modalNovoAberto, setModalNovoAberto] = useState(false)
  const [dropdownRelAberto, setDropdownRelAberto] = useState(false)

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      try {
        setLoadingOutros(true)
        setErroOutros(null)
        const res = await fetch(`/api/processos/${processoId}/outros-custos`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
          },
        })
        if (cancelado) return
        if (!res.ok) {
          setErroOutros(`Não foi possível carregar os lançamentos (${res.status}).`)
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

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.cs-rel-dropdown')) {
        setDropdownRelAberto(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  // ===== Lista filtrada (apenas REPASSAR) =====
  const repassesFiltrados = useMemo(() => {
    let lista = outrosCustos.filter((oc) => oc.natureza === 'REPASSAR')
    lista = filtrarPorBusca(lista, busca)
    lista = ordenarOutrosCustos(lista, ordem)
    return lista
  }, [outrosCustos, busca, ordem])

  // ===== Handlers =====
  function handleNovoLancamento(novo: OutroCustoData) {
    setOutrosCustos((atuais) => [novo, ...atuais])
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

  // ===== KPIs do sidebar =====
  // 🆕 Marco 30/04/2026: Pasta Documental NÃO entra no financeiro do
  // processo (é simulação que ele exporta pro cliente — o valor real
  // vai ser lançado depois manualmente em COBRAR ou Outros Custos).
  // Por isso "TOTAL DE CUSTOS" do sidebar é apenas totalOutros.
  const totalOutros = totais?.totalRepassarBRL ?? 0

  // O card "PAGAMENTO A FORNECEDORES" reflete APENAS os Outros Custos
  // (lançamentos manuais a terceiros). Só aparece quando há pelo menos
  // 1 Outro Custo cadastrado (controlado por `contagemTotal > 0` no JSX).
  const pagoOutros = totais?.totalPagoBRL ?? 0
  const aPagarOutros = totais?.totalAPagarBRL ?? 0
  const pagoTotal = pagoOutros
  const pendenteTotal = aPagarOutros

  const contagemTotal = outrosCustos.filter((oc) => oc.natureza === 'REPASSAR').length
  const contagemRepasses = repassesFiltrados.length

  // Total usado pra calcular as proporções das mini-barras do card
  // de "PAGAMENTO A FORNECEDORES" (só Outros Custos).
  const totalPagFornecedores = pagoTotal + pendenteTotal

  // ===== Render =====
  const filtros = [
    { id: 'todas' as FiltroPasta, lbl: 'Todas as colunas', cor: '#3b82f6' },
    { id: 'cert' as FiltroPasta, lbl: 'Certidões', cor: '#22c55e' },
    { id: 'trad' as FiltroPasta, lbl: 'Traduções', cor: '#f59e0b' },
    { id: 'apost' as FiltroPasta, lbl: 'Apostilamentos', cor: '#a855f7' },
  ]
  const filtroAtual = filtros.find((f) => f.id === filtroPasta) || filtros[0]
  const labelTotal =
    filtroPasta === 'todas'
      ? 'TOTAL DA PASTA'
      : `SUBTOTAL ${filtroAtual.lbl.toUpperCase()}`

  return (
    <div className={`cs-layout ${contagemTotal === 0 ? 'cs-layout--solo' : ''}`}>
      {/* ================================================================ */}
      {/* COLUNA PRINCIPAL                                                  */}
      {/* ================================================================ */}
      <div className="cs-main">
        {/* Card Pasta Documental */}
        <div className="cs-card cs-card-pasta">
          <div className="cs-pasta-head">
            <div>
              <div className="cs-card-titulo">📋 Pasta Documental</div>
              <div className="cs-card-sub">
                Sobe automaticamente conforme você lança custos na planilha
                {' '}
                {nomeFamilia ? `· ${nomeFamilia}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="cs-pasta-lbl-total">{labelTotal}</div>
              <div
                className="cs-pasta-valor"
                style={{ color: filtroAtual.cor }}
              >
                {fmtBRL(subtotalPastaFiltrado)}
              </div>
            </div>
          </div>

          <div className="cs-pasta-filtros">
            {filtros.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`cs-filtro-btn ${filtroPasta === f.id ? 'ativo' : ''}`}
                style={{ ['--cor' as never]: f.cor } as React.CSSProperties}
                onClick={() => setFiltroPasta(f.id)}
              >
                {f.lbl}
              </button>
            ))}
          </div>

          <TabelaCustos
            processoId={processoId}
            nomeFamilia={nomeFamilia}
            onTotaisChange={handleTotaisChange}
          />
        </div>

        {/* Bloco Registrar (= Outros Lançamentos do código antigo) */}
        <div className="cs-registrar">
          <div className="oc-head">
            <div>
              <div className="oc-titulo">
                Registrar <span className="oc-badge">{contagemTotal}</span>
              </div>
              <div className="oc-sub">
                Advogado Itália, cartório, consulado, taxas consulares
              </div>
            </div>
            <div className="rc-topbar-acoes">
              <div className="cs-busca-wrap">
                <Search className="cs-busca-icon" />
                <input
                  type="text"
                  className="cs-busca"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar..."
                />
              </div>
              <select
                className="cs-ordem"
                value={ordem}
                onChange={(e) => setOrdem(e.target.value as OrdemOutroCusto)}
              >
                <option value="vencimento">Vencimento</option>
                <option value="valor">Valor</option>
                <option value="criacao">Mais recentes</option>
              </select>
              <div className="cs-rel-dropdown">
                <button
                  type="button"
                  className="cs-btn-ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDropdownRelAberto((v) => !v)
                  }}
                >
                  <FileDown className="h-4 w-4" />
                  Relatórios
                  <ChevronDown className="h-3 w-3" />
                </button>
                {dropdownRelAberto && (
                  <div className="cs-rel-menu">
                    <button onClick={() => alert('Em breve')}>Extrato de Custos (PDF)</button>
                    <button onClick={() => alert('Em breve')}>Análise por Etapa (PDF)</button>
                    <button onClick={() => alert('Em breve')}>Comparativo de Câmbio (PDF)</button>
                    <button onClick={() => alert('Em breve')}>Export CSV</button>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="cs-btn-laranja"
                onClick={() => setModalNovoAberto(true)}
              >
                <Plus className="h-4 w-4" />
                Criar Lançamento
              </button>
            </div>
          </div>

          {erroOutros && (
            <div className="cs-erro">
              <AlertCircle className="h-4 w-4" />
              <span>{erroOutros}</span>
            </div>
          )}

          {loadingOutros ? (
            <div className="cs-loading">
              <div className="cs-spinner" />
              <p>Carregando lançamentos...</p>
            </div>
          ) : contagemTotal === 0 ? (
            <div className="oc-vazio">
              <div className="oc-vazio-ico">💸</div>
              <div className="oc-vazio-titulo">
                Nenhum pagamento a terceiro cadastrado
              </div>
              <div className="oc-vazio-sub">
                Advogado Itália, cartório, consulado, taxas consulares,
                tribunal, comune
              </div>
              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="cs-btn-laranja"
                  onClick={() => setModalNovoAberto(true)}
                >
                  <Plus className="h-4 w-4" />
                  Criar Lançamento
                </button>
              </div>
            </div>
          ) : repassesFiltrados.length === 0 ? (
            <div className="cs-sem-resultados">
              Nenhum lançamento encontrado com esses filtros.
            </div>
          ) : (
            <>
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
              {contagemRepasses < contagemTotal && (
                <div className="cs-contador">
                  Mostrando {contagemRepasses} de {contagemTotal} lançamentos
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* SIDEBAR (DIREITA)                                                 */}
      {/* ================================================================ */}
      {/* 🆕 Marco 30/04/2026: regra unificada e simplificada do sidebar.
          A Pasta Documental é tratada como simulação interna (Marco
          calcula valores na planilha pra exportar pro cliente, mas o
          valor real cobrado/pago vai variar — ele lança depois
          manualmente em COBRAR ou Outros Custos REPASSAR). Por isso
          a Pasta NÃO entra em nenhum cálculo do sidebar.

          A sidebar inteira é condicionada à existência de Outros Custos
          lançados (contagemTotal > 0).

          Resumo:
            Sem Outros Custos    → sidebar some (independente da Pasta)
            Com Outros Custos    → sidebar aparece com:
              - Card TOTAL DE CUSTOS     → só linha 💼 Outros
              - Card PAGAMENTO A FORN.   → ✓ Pagos / ⏰ Pendentes
      */}
      {contagemTotal > 0 && (
        <div className="cs-aside">
          <div className="cs-aside-card">
            <div className="cs-aside-titulo">TOTAL DE CUSTOS</div>
            {/* 🆕 Marco 30/04/2026: Pasta Documental NÃO entra no financeiro
                do processo — é simulação que ele exporta pro cliente, e o
                valor real é lançado depois manualmente em COBRAR ou Outros
                Custos. Por isso o card mostra apenas o total de Outros
                Custos (totalOutros), sem somar a pasta. */}
            <div className="cs-aside-total-big">{fmtBRL(totalOutros)}</div>
            <div className="cs-aside-breakdown">
              <div className="cs-aside-row">
                <span>💼 Outros Custos</span>
                <span>{fmtBRL(totalOutros)}</span>
              </div>
              <div className="cs-aside-bar">
                <div
                  className="cs-aside-bar-fill"
                  style={{ width: '100%', background: '#a855f7' }}
                />
              </div>
            </div>
          </div>

          {/* 🆕 Marco 29/04/2026: card de Pagamento a Fornecedores. A
              condicional externa contagemTotal > 0 já garante que ele
              só renderiza quando há lançamentos, então aqui é incondicional. */}
          <div className="cs-aside-card">
            <div className="cs-aside-titulo">PAGAMENTO A FORNECEDORES</div>
            <div className="cs-aside-status">
              <div className="cs-aside-status-row">
                <span>✓ Pagos</span>
                <span style={{ color: '#22c55e' }}>{fmtBRL(pagoTotal)}</span>
              </div>
              <div className="cs-aside-bar">
                <div
                  className="cs-aside-bar-fill"
                  style={{
                    width: `${totalPagFornecedores ? (pagoTotal / totalPagFornecedores) * 100 : 0}%`,
                    background: '#22c55e',
                  }}
                />
              </div>
            </div>
            <div className="cs-aside-status">
              <div className="cs-aside-status-row">
                <span>⏰ Pendentes</span>
                <span style={{ color: '#3b82f6' }}>{fmtBRL(pendenteTotal)}</span>
              </div>
              <div className="cs-aside-bar">
                <div
                  className="cs-aside-bar-fill"
                  style={{
                    width: `${totalPagFornecedores ? (pendenteTotal / totalPagFornecedores) * 100 : 0}%`,
                    background: '#3b82f6',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal "Novo Lançamento" */}
      <NovoOutroCustoModal
        processoId={processoId}
        isOpen={modalNovoAberto}
        onClose={() => setModalNovoAberto(false)}
        onSuccess={handleNovoLancamento}
        naturezaPadrao="REPASSAR"
      />

      {/* CSS — copiado do protótipo HTML */}
      <style jsx>{`
        .cs-layout {
          display: grid;
          grid-template-columns: 1fr 320px;
          gap: 18px;
          align-items: start;
        }
        /* 🆕 Marco 30/04/2026: quando a sidebar inteira é ocultada
           (sem Outros Custos cadastrados), o conteúdo principal ocupa
           a tela toda em 1 coluna full width. */
        .cs-layout--solo {
          grid-template-columns: 1fr;
        }
        @media (max-width: 1100px) {
          .cs-layout { grid-template-columns: 1fr; }
        }
        .cs-main {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .cs-aside {
          display: flex;
          flex-direction: column;
          gap: 14px;
          position: sticky;
          top: 16px;
        }

        /* ===== Card Pasta Documental ===== */
        .cs-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 22px 24px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .cs-card-titulo {
          font-size: 14.5px;
          font-weight: 700;
          color: #18181b;
          letter-spacing: -0.015em;
        }
        .cs-card-sub {
          font-size: 12px;
          color: #71717a;
          margin-top: 2px;
          font-weight: 500;
        }
        .cs-pasta-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
          margin-bottom: 14px;
          padding-bottom: 14px;
          border-bottom: 1px solid #e5e7eb;
          flex-wrap: wrap;
        }
        .cs-pasta-lbl-total {
          font-size: 10.5px;
          font-weight: 700;
          color: #71717a;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .cs-pasta-valor {
          font-size: 26px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.028em;
        }
        .cs-pasta-filtros {
          display: flex;
          gap: 8px;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }
        .cs-filtro-btn {
          background: #fff;
          border: 1.5px solid #e5e7eb;
          color: #4b5563;
          padding: 8px 16px;
          border-radius: 999px;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          font-family: inherit;
        }
        .cs-filtro-btn:hover {
          border-color: var(--cor, #7c3aed);
          color: var(--cor, #7c3aed);
          background: #f9fafb;
        }
        .cs-filtro-btn.ativo {
          background: var(--cor, #7c3aed);
          color: #fff !important;
          border-color: var(--cor, #7c3aed);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        /* ===== Bloco Registrar ===== */
        .cs-registrar {
          background: transparent;
          margin-top: 8px;
        }
        .oc-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
          margin-bottom: 14px;
          padding-bottom: 14px;
          border-bottom: 2px solid #e5e7eb;
          flex-wrap: wrap;
        }
        .oc-titulo {
          font-size: 18px;
          font-weight: 800;
          color: #18181b;
          letter-spacing: -0.02em;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .oc-badge {
          background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
          color: #fff;
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
        }
        .oc-sub {
          font-size: 12.5px;
          color: #71717a;
          margin-top: 3px;
          font-weight: 500;
        }
        .rc-topbar-acoes {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .cs-busca-wrap {
          position: relative;
        }
        .cs-busca-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          width: 14px;
          height: 14px;
          color: #94a3b8;
          pointer-events: none;
        }
        .cs-busca {
          width: 200px;
          padding: 9px 14px 9px 36px;
          font-size: 13px;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          background: #fff;
          color: #18181b;
          font-family: inherit;
          outline: none;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .cs-busca:focus {
          border-color: #7c3aed;
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
        }
        .cs-ordem {
          padding: 9px 32px 9px 14px;
          font-size: 13px;
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
        }
        .cs-rel-dropdown {
          position: relative;
        }
        .cs-btn-ghost {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 14px;
          background: #fff;
          color: #4b5563;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .cs-btn-ghost:hover {
          background: #f9fafb;
        }
        .cs-rel-menu {
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
        .cs-rel-menu button {
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
        .cs-rel-menu button:hover {
          background: #f3f4f6;
        }
        .cs-btn-laranja {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 16px;
          font-size: 13px;
          font-weight: 600;
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: #fff;
          border: 1px solid transparent;
          border-radius: 10px;
          cursor: pointer;
          font-family: inherit;
          box-shadow: 0 2px 8px rgba(217, 119, 6, 0.25);
          transition: all 0.15s;
        }
        .cs-btn-laranja:hover {
          background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
          box-shadow: 0 4px 12px rgba(217, 119, 6, 0.35);
        }

        /* ===== Empty / Erro / Loading ===== */
        .oc-vazio {
          background: #fff;
          border: 2px dashed #d1d5db;
          border-radius: 16px;
          padding: 60px 30px;
          text-align: center;
        }
        .oc-vazio-ico {
          font-size: 56px;
          margin-bottom: 12px;
          opacity: 0.5;
        }
        .oc-vazio-titulo {
          font-size: 16px;
          font-weight: 700;
          color: #18181b;
          margin-bottom: 6px;
        }
        .oc-vazio-sub {
          font-size: 13px;
          color: #71717a;
          max-width: 480px;
          margin: 0 auto;
        }
        .cs-erro {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 14px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #991b1b;
          font-size: 13px;
          margin-bottom: 12px;
        }
        .cs-loading {
          padding: 40px 20px;
          text-align: center;
          color: #71717a;
        }
        .cs-spinner {
          width: 24px;
          height: 24px;
          border: 2px solid #e5e7eb;
          border-top-color: #7c3aed;
          border-radius: 50%;
          margin: 0 auto 12px;
          animation: cs-spin 0.8s linear infinite;
        }
        @keyframes cs-spin {
          to { transform: rotate(360deg); }
        }
        .cs-sem-resultados {
          padding: 24px;
          text-align: center;
          background: #f9fafb;
          border: 1px dashed #e5e7eb;
          border-radius: 8px;
          color: #71717a;
          font-size: 13px;
        }
        .cs-lista {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .cs-contador {
          text-align: center;
          font-size: 12px;
          color: #71717a;
          margin-top: 12px;
        }

        /* ===== Aside Cards ===== */
        .cs-aside-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 18px 20px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .cs-aside-titulo {
          font-size: 10.5px;
          font-weight: 700;
          color: #71717a;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 14px;
        }
        .cs-aside-total-big {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.028em;
          font-variant-numeric: tabular-nums;
          color: #18181b;
          margin: 4px 0 14px;
          line-height: 1.05;
        }
        .cs-aside-breakdown {
          margin-top: 10px;
        }
        .cs-aside-row {
          display: flex;
          justify-content: space-between;
          font-size: 12.5px;
          font-weight: 600;
          margin-bottom: 5px;
          color: #4b5563;
        }
        .cs-aside-row span:last-child {
          color: #18181b;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .cs-aside-bar {
          height: 6px;
          background: #f1f5f9;
          border-radius: 3px;
          overflow: hidden;
        }
        .cs-aside-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .cs-aside-status {
          margin-bottom: 10px;
        }
        .cs-aside-status-row {
          display: flex;
          justify-content: space-between;
          font-size: 12.5px;
          font-weight: 600;
          margin-bottom: 5px;
          color: #4b5563;
        }
        .cs-aside-status-row span:last-child {
          font-weight: 800;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  )
}

export default Custos