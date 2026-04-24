// src/components/financeiro/cards/CustosPorTipoCards.tsx
//
// Cards no topo da aba "Custos" que mostram o total gasto agrupado por
// tipo de serviço (Certidão / Apostilamento / Tradução / Outros) + um
// card destacado com o Total Geral.
//
// Pedido do Marco no feedback do Lote 4:
//   "Precisa em cima ter isso que calcula por documento. Exemplo:
//    Total de certidão somente, total de apostila somente. Total de
//    tradução somente. Etc. E ao lado o total geral de custos com a
//    calculadora automatica"
//
// 🔄 Versão 2 (Opção B): recebe os dados via PROPS em vez de fazer seu
// próprio fetch. A Custos.tsx (pai) controla os dados, e a TabelaCustos
// dispara atualizações via callback `onTotaisChange`. Resultado: quando
// o usuário edita um valor na planilha, os cards aqui recalculam na hora.
//
// 🔍 COMO FUNCIONA A CATEGORIZAÇÃO:
//
// Hoje o `TipoServico` tem só um campo `nome` livre (string) — não tem
// "categoria" estruturada. Então a gente categoriza por PALAVRA-CHAVE no
// nome: se contém "certidão" → Certidões, se contém "apostila" →
// Apostilamentos, etc. Qualquer coisa que não bater vai em "Outros".

'use client'

import { useMemo } from 'react'
import { fmtBRL } from '@/src/lib/financeiro/helpers'

// ============================================================================
// Tipos
// ============================================================================

interface TipoServico {
  id: number
  nome: string
  ordem: number
}

interface CategoriaAgrupada {
  id: string
  label: string
  total: number
  servicos: string[]
  icone: string
  tone: 'blue' | 'purple' | 'yellow' | 'gray'
}

export interface CustosPorTipoCardsProps {
  // Dados vêm do pai (Custos.tsx), que os recebe da TabelaCustos via callback
  servicos: TipoServico[]
  totaisPorServico: Record<number, number>
  totalGeral: number
  // Flag de loading pra mostrar skeleton no primeiro fetch
  loading?: boolean
}

// ============================================================================
// Configuração de categorias
// ============================================================================
//
// Cada categoria tem uma lista de palavras-chave (case-insensitive, sem
// acentos). Se o nome do TipoServico contém qualquer palavra-chave, entra
// nessa categoria. A ordem importa: a primeira que der match ganha.
//
// "Outros" é fallback automático — qualquer serviço que não bater com
// nenhuma categoria cai aqui.

const CATEGORIAS_CONFIG = [
  {
    id: 'certidoes',
    label: 'Certidões',
    keywords: ['certidao', 'certidão', 'inteiro teor', 'cit'],
    icone: '📄',
    tone: 'blue' as const,
  },
  {
    id: 'apostilamentos',
    label: 'Apostilamentos',
    keywords: ['apostila', 'apostilamento'],
    icone: '🏛️',
    tone: 'purple' as const,
  },
  {
    id: 'traducoes',
    label: 'Traduções',
    keywords: ['traducao', 'tradução', 'juramentada'],
    icone: '🌐',
    tone: 'yellow' as const,
  },
]

// ============================================================================
// Helpers
// ============================================================================

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function categorizarServico(nomeServico: string): string {
  const nomeNorm = normalizar(nomeServico)

  for (const cat of CATEGORIAS_CONFIG) {
    for (const kw of cat.keywords) {
      if (nomeNorm.includes(kw)) {
        return cat.id
      }
    }
  }

  return 'outros'
}

// ============================================================================
// Componente
// ============================================================================

export function CustosPorTipoCards({
  servicos,
  totaisPorServico,
  totalGeral,
  loading = false,
}: CustosPorTipoCardsProps) {
  // Agrupa serviços por categoria usando useMemo (reativo a mudanças)
  const categorias = useMemo<CategoriaAgrupada[]>(() => {
    const agrupamento = new Map<
      string,
      { total: number; servicos: string[] }
    >()

    // Inicializa todas as categorias canônicas com zero
    CATEGORIAS_CONFIG.forEach((cat) => {
      agrupamento.set(cat.id, { total: 0, servicos: [] })
    })
    agrupamento.set('outros', { total: 0, servicos: [] })

    // Categoriza e soma
    servicos.forEach((s) => {
      const categoriaId = categorizarServico(s.nome)
      const total = totaisPorServico[s.id] || 0

      const atual = agrupamento.get(categoriaId) || {
        total: 0,
        servicos: [],
      }
      atual.total += total
      if (total > 0) {
        atual.servicos.push(s.nome)
      }
      agrupamento.set(categoriaId, atual)
    })

    // Monta a lista final (sempre mostra as 3 principais, mesmo com zero,
    // pra consistência visual)
    const resultado: CategoriaAgrupada[] = []

    CATEGORIAS_CONFIG.forEach((cat) => {
      const info = agrupamento.get(cat.id)!
      resultado.push({
        id: cat.id,
        label: cat.label,
        total: info.total,
        servicos: info.servicos,
        icone: cat.icone,
        tone: cat.tone,
      })
    })

    // "Outros" só aparece se tiver algo > 0
    const outros = agrupamento.get('outros')!
    if (outros.total > 0) {
      resultado.push({
        id: 'outros',
        label: 'Outros',
        total: outros.total,
        servicos: outros.servicos,
        icone: '📦',
        tone: 'gray',
      })
    }

    return resultado
  }, [servicos, totaisPorServico])

  // ---- Render ----

  if (loading) {
    return (
      <div className="ctc-root ctc-root--loading">
        <div className="ctc-skeleton" />
        <div className="ctc-skeleton" />
        <div className="ctc-skeleton" />
        <div className="ctc-skeleton ctc-skeleton--total" />
        <style jsx>{`
          .ctc-root--loading {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
          }
          .ctc-skeleton {
            height: 88px;
            background: var(--fin-bg-soft);
            border: 1px solid var(--fin-line);
            border-radius: var(--fin-radius);
            animation: ctc-pulse 1.2s ease-in-out infinite;
          }
          .ctc-skeleton--total {
            background: linear-gradient(
              90deg,
              var(--fin-purple-50),
              var(--fin-bg-soft)
            );
          }
          @keyframes ctc-pulse {
            0%,
            100% {
              opacity: 1;
            }
            50% {
              opacity: 0.5;
            }
          }
        `}</style>
      </div>
    )
  }

  return (
    <div className="ctc-root">
      {/* Cards por categoria */}
      {categorias.map((cat) => (
        <div
          key={cat.id}
          className={`ctc-card ctc-card--${cat.tone}`}
          title={
            cat.servicos.length > 0
              ? `Inclui: ${cat.servicos.join(', ')}`
              : undefined
          }
        >
          <div className="ctc-card__header">
            <span className="ctc-card__icone" aria-hidden>
              {cat.icone}
            </span>
            <span className="ctc-card__label">Total em {cat.label}</span>
          </div>
          <span className="ctc-card__valor">{fmtBRL(cat.total)}</span>
          <span className="ctc-card__hint">
            {cat.servicos.length === 0
              ? 'Nenhum serviço'
              : cat.servicos.length === 1
              ? '1 serviço'
              : `${cat.servicos.length} serviços`}
          </span>
        </div>
      ))}

      {/* Card Total Geral (destacado) */}
      <div className="ctc-card ctc-card--total">
        <div className="ctc-card__header">
          <span className="ctc-card__icone" aria-hidden>
            💰
          </span>
          <span className="ctc-card__label">Total Geral</span>
        </div>
        <span className="ctc-card__valor">{fmtBRL(totalGeral)}</span>
        <span className="ctc-card__hint">
          Soma de todos os custos operacionais
        </span>
      </div>

      <style jsx>{`
        .ctc-root {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
        }

        .ctc-card {
          position: relative;
          border-radius: var(--fin-radius);
          border: 1px solid var(--fin-line);
          background: var(--fin-bg);
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-height: 92px;
          transition: background 0.2s ease, border-color 0.2s ease;
        }
        .ctc-card__header {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .ctc-card__icone {
          font-size: 14px;
          line-height: 1;
        }
        .ctc-card__label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--fin-ink-3);
        }
        .ctc-card__valor {
          font-size: 20px;
          font-weight: 700;
          line-height: 1.15;
          font-variant-numeric: tabular-nums;
          color: var(--fin-ink);
        }
        .ctc-card__hint {
          font-size: 11px;
          color: var(--fin-ink-3);
        }

        /* Variantes de cor */
        .ctc-card--blue {
          background: #eff6ff;
          border-color: #bfdbfe;
        }
        .ctc-card--blue .ctc-card__valor {
          color: #1d4ed8;
        }
        .ctc-card--blue .ctc-card__label {
          color: #1e40af;
        }

        .ctc-card--purple {
          background: #faf5ff;
          border-color: #e9d5ff;
        }
        .ctc-card--purple .ctc-card__valor {
          color: #7c3aed;
        }
        .ctc-card--purple .ctc-card__label {
          color: #6b21a8;
        }

        .ctc-card--yellow {
          background: #fffbeb;
          border-color: #fde68a;
        }
        .ctc-card--yellow .ctc-card__valor {
          color: #b45309;
        }
        .ctc-card--yellow .ctc-card__label {
          color: #92400e;
        }

        .ctc-card--gray {
          background: var(--fin-bg-soft);
          border-color: var(--fin-line);
        }
        .ctc-card--gray .ctc-card__valor {
          color: var(--fin-ink-2);
        }

        /* Total Geral — destaque */
        .ctc-card--total {
          background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%);
          border: 2px solid #c084fc;
          box-shadow: 0 2px 8px rgba(124, 58, 237, 0.12);
        }
        .ctc-card--total .ctc-card__valor {
          color: #6b21a8;
          font-size: 22px;
        }
        .ctc-card--total .ctc-card__label {
          color: #581c87;
        }
      `}</style>
    </div>
  )
}

export default CustosPorTipoCards