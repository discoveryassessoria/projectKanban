// src/components/financeiro/subabas/Custos.tsx
//
// Sub-aba "Custos" do Financeiro.
//
// Estrutura:
//   1. 🆕 LOTE 4 BLOCO 2: Cards "Custos por Tipo" (Certidões, Apostilamentos,
//      Traduções, Outros, Total Geral) — em cima, pedido do Marco. Os dados
//      vêm da TabelaCustos via callback `onTotaisChange`, então quando o
//      usuário edita um valor na planilha, os cards atualizam AO VIVO.
//   2. TabelaCustos (planilha de custos por pessoa) — INTACTA, do Lote 2.
//      Agora recebe um `onTotaisChange` opcional.
//   3. Bloco "Outros Custos" — VISUAL completo, dados ainda mockados.

'use client'

import { useState } from 'react'
import { Plus, Lock, Wallet } from 'lucide-react'
import { TabelaCustos } from '@/src/components/kanban/TabelaCustos'
import { fmtBRL } from '@/src/lib/financeiro/helpers'
import {
  OutroCustoCard,
  type OutroCustoData,
} from '@/src/components/financeiro/cards/OutroCustoCard'
import { CustosPorTipoCards } from '@/src/components/financeiro/cards/CustosPorTipoCards'

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
  // 🆕 Estado que reflete os totais atuais da TabelaCustos em tempo real
  const [servicos, setServicos] = useState<TipoServico[]>([])
  const [totaisPorServico, setTotaisPorServico] = useState<
    Record<number, number>
  >({})
  const [totalGeralTabela, setTotalGeralTabela] = useState(0)
  const [custosLoading, setCustosLoading] = useState(true)

  // Callback disparado pela TabelaCustos sempre que os valores mudam
  // (no mount inicial e a cada edição de célula)
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

  // ⚠️ DADOS MOCKADOS — no Lote 4, vão vir da API /api/processos/:id/outros-custos
  const outrosCustos: OutroCustoData[] = []

  // KPIs derivados (todos zero por enquanto, com placeholders informativos)
  const totalARepassar = outrosCustos
    .filter((c) => c.natureza === 'REPASSAR' && !c.pago && !c.interno)
    .reduce((s, c) => s + c.valor, 0)

  const totalRepassado = outrosCustos
    .filter((c) => c.natureza === 'REPASSAR' && c.pago)
    .reduce((s, c) => s + c.valor, 0)

  const totalInternos = outrosCustos
    .filter((c) => c.interno === true)
    .reduce((s, c) => s + c.valor, 0)

  const totalGeral = outrosCustos.reduce((s, c) => s + c.valor, 0)

  return (
    <div className="cs-root">
      {/* ===== 🆕 Bloco novo (Lote 4 Bloco 2): Cards por tipo de documento ===== */}
      {/* Atualiza AO VIVO quando o user edita valores na TabelaCustos abaixo */}
      <CustosPorTipoCards
        servicos={servicos}
        totaisPorServico={totaisPorServico}
        totalGeral={totalGeralTabela}
        loading={custosLoading}
      />

      {/* ===== Bloco 1: TabelaCustos (intacta, do Lote 2) ===== */}
      {/* 🆕 Passa o callback pra os cards acima atualizarem ao vivo */}
      <TabelaCustos
        processoId={processoId}
        nomeFamilia={nomeFamilia}
        onTotaisChange={handleTotaisChange}
      />

      {/* ===== Bloco 2: Outros Custos (visual do Lote 3, dados no Lote 4) ===== */}
      <div className="cs-outros">
        {/* Header com título + botão "+ Novo Custo" desabilitado */}
        <div className="cs-outros__header">
          <div className="cs-outros__titulo">
            <div className="cs-outros__icone">
              <Wallet />
            </div>
            <div>
              <h3 className="cs-outros__h3">Outros Custos</h3>
              <p className="cs-outros__sub">
                Custos avulsos do processo (advogado, cartório, taxas, etc.)
              </p>
            </div>
          </div>

          <button
            type="button"
            className="cs-outros__btn-novo"
            disabled
            title="Funcionalidade chegando no próximo lote"
          >
            <Lock className="cs-outros__btn-icon" />
            <span>Novo Custo</span>
            <span className="cs-outros__badge-soon">Em breve</span>
          </button>
        </div>

        {/* 4 KPIs */}
        <div className="fin-kpi-grid">
          <div className="fin-card fin-card--red">
            <div className="fin-kpi">
              <span className="fin-kpi__label">A Repassar</span>
              <span className="fin-kpi__value fin-kpi__value--red">
                {fmtBRL(totalARepassar)}
              </span>
              <span className="fin-kpi__hint">
                Custos a pagar a terceiros
              </span>
            </div>
          </div>

          <div className="fin-card fin-card--green">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Já Repassado</span>
              <span className="fin-kpi__value fin-kpi__value--green">
                {fmtBRL(totalRepassado)}
              </span>
              <span className="fin-kpi__hint">
                Pagamentos já efetuados
              </span>
            </div>
          </div>

          <div className="fin-card fin-card--blue">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Custos Internos</span>
              <span className="fin-kpi__value fin-kpi__value--blue">
                {fmtBRL(totalInternos)}
              </span>
              <span className="fin-kpi__hint">
                Não repassados ao cliente
              </span>
            </div>
          </div>

          <div className="fin-card fin-card--purple">
            <div className="fin-kpi">
              <span className="fin-kpi__label">Total Geral</span>
              <span className="fin-kpi__value fin-kpi__value--purple">
                {fmtBRL(totalGeral)}
              </span>
              <span className="fin-kpi__hint">
                {outrosCustos.length}{' '}
                {outrosCustos.length === 1 ? 'lançamento' : 'lançamentos'}
              </span>
            </div>
          </div>
        </div>

        {/* Lista de custos OU empty state */}
        {outrosCustos.length === 0 ? (
          <div className="cs-empty">
            <div className="cs-empty__icone">📋</div>
            <h4 className="cs-empty__titulo">Nenhum custo lançado</h4>
            <p className="cs-empty__hint">
              Quando a funcionalidade for liberada, você poderá registrar aqui
              custos de advogado, cartório, taxas consulares, traduções extras,
              deslocamentos e outros gastos do processo. Cada lançamento poderá
              ter pagamentos parciais, comprovantes e ser repassado ao cliente.
            </p>
            <div className="cs-empty__lote">
              <span className="cs-empty__badge">Lote 4</span>
              <span>CRUD completo + integração com Recibos e Extrato</span>
            </div>
          </div>
        ) : (
          <div className="cs-lista">
            {outrosCustos.map((custo) => (
              <OutroCustoCard key={custo.id} custo={custo} />
            ))}
          </div>
        )}
      </div>

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
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 500;
          background: var(--fin-bg-soft);
          color: var(--fin-ink-3);
          border: 1px solid var(--fin-line);
          border-radius: var(--fin-radius-sm);
          cursor: not-allowed;
          opacity: 0.7;
        }
        .cs-outros__btn-icon {
          width: 14px;
          height: 14px;
        }
        .cs-outros__badge-soon {
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--fin-purple-600);
          background: var(--fin-purple-50);
          border-radius: 999px;
        }

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
        .cs-empty__lote {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--fin-ink-3);
        }
        .cs-empty__badge {
          padding: 2px 10px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--fin-purple-600);
          background: var(--fin-purple-50);
          border-radius: 999px;
        }

        .cs-lista {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 12px;
        }
      `}</style>
    </div>
  )
}

export default Custos