// src/components/kanban/ProcessoFinanceiro.tsx
//
// 🔧 v4: PLUGADO Lote 3 visual.
// Os 2 placeholders (Custos e Extrato) agora apontam pros componentes reais.
// Estrutura de scroll v3 mantida (funciona perfeito).
//
// Sub-abas:
//   • Visão Geral  — KPIs + donuts + projeção (Lote 2)
//   • Receitas     — KPIs de fatura + lista de faturas (Lote 2)
//   • Custos       — TabelaCustos + Outros Custos visual (Lote 3)
//   • Extrato      — Timeline cronológica visual (Lote 3)

'use client'

import { useState } from 'react'
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  List,
} from 'lucide-react'

import '@/src/styles/financeiro.css'

import { VisaoGeral } from '@/src/components/financeiro/subabas/VisaoGeral'
import { Receitas } from '@/src/components/financeiro/subabas/Receitas'
import { Custos } from '@/src/components/financeiro/subabas/Custos'
import { Extrato } from '@/src/components/financeiro/subabas/Extrato'

// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------
export interface ProcessoFinanceiroProps {
  processoId: number
  nomeFamilia?: string
  onUpdate?: () => void
}

type SubAba = 'visao' | 'receitas' | 'custos' | 'extrato'

const SUBABAS: {
  key: SubAba
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { key: 'visao', label: 'Visão Geral', icon: LayoutDashboard },
  { key: 'receitas', label: 'Receitas', icon: TrendingUp },
  { key: 'custos', label: 'Custos', icon: TrendingDown },
  { key: 'extrato', label: 'Extrato', icon: List },
]

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export function ProcessoFinanceiro({
  processoId,
  nomeFamilia,
  onUpdate,
}: ProcessoFinanceiroProps) {
  const [aba, setAba] = useState<SubAba>('visao')
  const [refreshKey, setRefreshKey] = useState(0)

  const handleUpdate = () => {
    setRefreshKey((k) => k + 1)
    onUpdate?.()
  }

  return (
    <div className="fin-root fin-wrapper">
      {/* Sub-abas FIXAS no topo (não rolam) */}
      <div className="fin-tabs-bar">
        <div className="fin-tabs" role="tablist" aria-label="Sub-abas do Financeiro">
          {SUBABAS.map(({ key, label, icon: Icon }) => {
            const isActive = aba === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`fin-tab ${isActive ? 'active' : ''}`}
                onClick={() => setAba(key)}
              >
                <Icon className="fin-tab__icon" />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Conteúdo da sub-aba selecionada — ESSA É A PARTE QUE ROLA */}
      <div className="fin-body-scroll">
        {aba === 'visao' && (
          <VisaoGeral
            processoId={processoId}
            nomeFamilia={nomeFamilia}
            refreshKey={refreshKey}
          />
        )}

        {aba === 'receitas' && (
          <Receitas
            processoId={processoId}
            nomeFamilia={nomeFamilia}
            onUpdate={handleUpdate}
          />
        )}

        {aba === 'custos' && (
          <Custos processoId={processoId} nomeFamilia={nomeFamilia} />
        )}

        {aba === 'extrato' && (
          <Extrato processoId={processoId} nomeFamilia={nomeFamilia} />
        )}
      </div>

      <style jsx>{`
        .fin-wrapper {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .fin-tabs-bar {
          flex-shrink: 0;
          padding: 16px 24px 0;
        }
        :global(.fin-tab) {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        :global(.fin-tab__icon) {
          width: 16px;
          height: 16px;
        }
        .fin-body-scroll {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 16px 24px 24px;
        }
      `}</style>
    </div>
  )
}

export default ProcessoFinanceiro