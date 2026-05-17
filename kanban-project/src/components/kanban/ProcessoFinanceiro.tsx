// src/components/kanban/ProcessoFinanceiro.tsx
//
// 🆕 Fase 3 v2.2 — adiciona um SEGUNDO indicador de câmbio (USD) ao lado
// do EUR. Ambos são placeholders fixos hoje (EUR=5,50 / USD=5,40); quando
// existir o endpoint de cotação real, basta descomentar o useEffect e
// trocar pelo retorno da API.
//
// Estrutura da barra de tabs (clone visual do .fin-tabs do HTML mestre):
//   [Visão Geral] [Receitas] [Custos] [Extrato]
//                                        ┊
//   [• €1 = R$ 5,50 (hoje)] [• $1 = R$ 5,40 (hoje)]
//                                        ┊
//   [⚠ Inadimplência] [📁 Documentos] [📄 Timeline] [💼 Carteira]

'use client'

import '@/src/styles/financeiro-paginas.css'
import { useEffect, useState } from 'react'
import { Receitas } from '@/src/components/financeiro/subabas/Receitas'
import { Custos } from '@/src/components/financeiro/subabas/Custos'

// ⚠️ Ajuste estes imports se os caminhos forem outros no seu projeto:
import { VisaoGeral } from '@/src/components/financeiro/subabas/VisaoGeral'
import { Extrato } from '@/src/components/financeiro/subabas/Extrato'
import { Inadimplencia } from '@/src/components/financeiro/subabas/Inadimplencia'
import { Documentos } from '@/src/components/financeiro/subabas/Documentos'
import { Timeline } from '@/src/components/financeiro/subabas/Timeline'
import { Carteira } from '@/src/components/financeiro/subabas/Carteira'
import { CotacaoCard } from '@/src/components/financeiro/CotacaoCard'

// ============================================================================
// Tipos
// ============================================================================

type Aba =
  | 'visao-geral'
  | 'receitas'
  | 'custos'
  | 'extrato'
  | 'inadimplencia'
  | 'documentos'
  | 'timeline'
  | 'carteira'

export interface ProcessoFinanceiroProps {
  processoId: number
  nomeFamilia?: string
  codigoProcesso?: string
  onUpdate?: () => void
}

// ============================================================================
// Helpers
// ============================================================================

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// ============================================================================
// Componente
// ============================================================================

export function ProcessoFinanceiro({
  processoId,
  nomeFamilia,
  codigoProcesso,
  onUpdate,
}: ProcessoFinanceiroProps) {
  const [aba, setAba] = useState<Aba>('visao-geral')

  // Cotações de hoje — placeholders até existir endpoint real
  const [cambio, setCambio] = useState({
    eur: 5.5,
    usd: 5.4,
    eurVar: 0,
    usdVar: 0,
    eurPct: 0,
    usdPct: 0,
    eurHist: [] as number[],
    usdHist: [] as number[],
    atualizadoEm: null as string | null,
  })

  useEffect(() => {
    let cancelado = false
    fetch('/api/cambio')
      .then((r) => r.json())
      .then((d) => {
        if (cancelado) return
        setCambio({
          eur: Number(d.eur) || 5.5,
          usd: Number(d.usd) || 5.4,
          eurVar: Number(d.eurVar) || 0,
          usdVar: Number(d.usdVar) || 0,
          eurPct: Number(d.eurPct) || 0,
          usdPct: Number(d.usdPct) || 0,
          eurHist: Array.isArray(d.eurHist) ? d.eurHist : [],
          usdHist: Array.isArray(d.usdHist) ? d.usdHist : [],
          atualizadoEm: d.atualizadoEm ?? null,
        })
      })
      .catch((err) => console.error('[cambio] erro:', err))
    return () => { cancelado = true }
  }, [])

  return (
    <div
      className="processo-financeiro-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        // height: 100% só funciona se o pai for flex/grid com altura definida.
        // Se o pai não limitar altura, o scroll volta a ser do modal pai (ok).
        // Se o pai limitar altura, o overflow-y abaixo funciona como fallback.
        height: '100%',
        maxHeight: '100%',
      }}
    >
      {/* ============ Barra de sub-abas (clone visual do .fin-tabs) ============ */}
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          padding: '0 32px',
          display: 'flex',
          gap: 0,
          alignItems: 'center',
          flexWrap: 'wrap',
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          zIndex: 5,
        }}
      >
        <FinTab
          active={aba === 'visao-geral'}
          onClick={() => setAba('visao-geral')}
          label="📖 Visão Geral"
        />
        <FinTab
          active={aba === 'receitas'}
          onClick={() => setAba('receitas')}
          label="📑 Receitas"
        />
        <FinTab
          active={aba === 'custos'}
          onClick={() => setAba('custos')}
          label="📋 Custos"
        />
        <FinTab
          active={aba === 'extrato'}
          onClick={() => setAba('extrato')}
          label="📊 Extrato"
        />

        {/* Espaçador que empurra os indicadores e atalhos pra direita */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CotacaoCard
            simbolo="$"
            codigo="USD"
            nome="Dólar americano"
            valor={cambio.usd}
            variacao={cambio.usdVar}
            variacaoPct={cambio.usdPct}
            historico={cambio.usdHist}
            atualizadoEm={cambio.atualizadoEm}
          />
          <CotacaoCard
            simbolo="€"
            codigo="EUR"
            nome="Euro"
            valor={cambio.eur}
            variacao={cambio.eurVar}
            variacaoPct={cambio.eurPct}
            historico={cambio.eurHist}
            atualizadoEm={cambio.atualizadoEm}
          />
        </div>

        <FinTab
          active={aba === 'inadimplencia'}
          onClick={() => setAba('inadimplencia')}
          label="⚠ Inadimplência"
        />
        <FinTab
          active={aba === 'documentos'}
          onClick={() => setAba('documentos')}
          label="📁 Documentos"
        />
        <FinTab
          active={aba === 'timeline'}
          onClick={() => setAba('timeline')}
          label="📄 Timeline"
        />
        <FinTab
          active={aba === 'carteira'}
          onClick={() => setAba('carteira')}
          label="💼 Carteira"
        />
      </div>

      {/* ============ Conteúdo (com scroll interno) ============ */}
      <div
        style={{
          padding: '24px 32px',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        {aba === 'visao-geral' && (
          <VisaoGeral processoId={processoId} nomeFamilia={nomeFamilia} />
        )}
        {aba === 'receitas' && (
          <Receitas
            processoId={processoId}
            nomeFamilia={nomeFamilia}
            onUpdate={onUpdate}
            fxHoje={cambio.eur}
          />
        )}
        {aba === 'custos' && (
          <Custos
            processoId={processoId}
            nomeFamilia={nomeFamilia}
            onUpdate={onUpdate}
            fxHoje={cambio.eur}
          />
        )}
        {aba === 'extrato' && <Extrato processoId={processoId} fxHoje={cambio.eur} />}

        {aba === 'inadimplencia' && (
          <Inadimplencia
            processoId={processoId}
            nomeFamilia={nomeFamilia}
            fxHoje={cambio.eur}
          />
        )}
        {aba === 'documentos' && (
          <Documentos
            processoId={processoId}
            codigoProcesso={codigoProcesso}
            fxHoje={cambio.eur}
          />
        )}
        {aba === 'timeline' && (
          <Timeline processoId={processoId} fxHoje={cambio.eur} />
        )}
        {aba === 'carteira' && (
          <Carteira processoId={processoId} fxHoje={cambio.eur} fxUsdHoje={cambio.usd} />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// FinTab subcomponente
// ============================================================================

function FinTab({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '14px 18px',
        fontSize: 14,
        color: active ? '#5b3fff' : '#4b5563',
        fontWeight: active ? 600 : 500,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        transition: 'all 0.2s',
        background: 'none',
        border: 'none',
        borderBottomWidth: 2,
        borderBottomStyle: 'solid',
        borderBottomColor: active ? '#5b3fff' : 'transparent',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

// ============================================================================
// Placeholder das 4 telas pendentes
// ============================================================================

function PlaceholderPagina({
  icone,
  titulo,
  subtitulo,
}: {
  icone: string
  titulo: string
  subtitulo: string
}) {
  return (
    <div className="fpag-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <span style={{ marginRight: 8 }}>{icone}</span>
            {titulo}
          </h1>
          <div className="page-subtitle">{subtitulo}</div>
        </div>
      </div>

      <div className="form-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{icone}</div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--fpag-gray-700)',
            marginBottom: 8,
          }}
        >
          Tela em construção
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--fpag-gray-500)',
            maxWidth: 480,
            margin: '0 auto',
            lineHeight: 1.5,
          }}
        >
          O conteúdo desta tela será clonado em rodada separada do HTML mestre.
        </div>
      </div>
    </div>
  )
}

export default ProcessoFinanceiro