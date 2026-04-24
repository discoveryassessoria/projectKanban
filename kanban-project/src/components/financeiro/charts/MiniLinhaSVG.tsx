// src/components/financeiro/charts/MiniLinhaSVG.tsx
//
// Mini-gráfico de linha (sparkline) em SVG puro.
// Usado na Visão Geral pra mostrar projeção de recebimento ao longo do tempo.
//
// Uso:
//   <MiniLinhaSVG
//     points={[
//       { x: 'Jan', y: 1200 },
//       { x: 'Fev', y: 2400 },
//       { x: 'Mar', y: 3100 },
//       ...
//     ]}
//     width={400}
//     height={120}
//     color="var(--fin-purple)"
//   />

'use client'

import React from 'react'

// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------
export interface LinhaPoint {
  x: string // label (ex.: 'Jan', 'Fev', '01/11')
  y: number // valor
}

export interface MiniLinhaSVGProps {
  points: LinhaPoint[]
  width?: number // px (default 400)
  height?: number // px (default 120)
  color?: string // cor da linha (default roxo)
  fillArea?: boolean // preencher área sob a linha? (default true)
  showDots?: boolean // mostrar pontos? (default true)
  showLabels?: boolean // mostrar labels X e Y? (default true)
  formatY?: (v: number) => string // formatter pros valores de Y
  ariaLabel?: string
}

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export function MiniLinhaSVG({
  points,
  width = 400,
  height = 120,
  color = 'var(--fin-purple)',
  fillArea = true,
  showDots = true,
  showLabels = true,
  formatY,
  ariaLabel,
}: MiniLinhaSVGProps) {
  // Guard: sem pontos
  if (!points || points.length === 0) {
    return (
      <div
        className="fin-linha fin-linha--empty"
        style={{ width, height }}
        aria-label={ariaLabel || 'Sem dados'}
      >
        <span>Sem dados para exibir</span>
        <style jsx>{`
          .fin-linha--empty {
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--fin-bg-soft);
            border: 1px dashed var(--fin-line);
            border-radius: var(--fin-radius);
            color: var(--fin-ink-3);
            font-size: 13px;
          }
        `}</style>
      </div>
    )
  }

  // Padding interno pra dar espaço aos labels
  const padX = showLabels ? 40 : 8
  const padYTop = 12
  const padYBottom = showLabels ? 24 : 8

  const chartW = width - padX - 8
  const chartH = height - padYTop - padYBottom

  const ys = points.map((p) => p.y)
  const yMin = Math.min(...ys, 0) // inclui 0 no eixo Y
  const yMaxRaw = Math.max(...ys)
  const yMax = yMaxRaw === yMin ? yMin + 1 : yMaxRaw // evita divisão por zero

  // Escala
  const xStep = points.length > 1 ? chartW / (points.length - 1) : 0
  const scaleY = (v: number) => {
    const norm = (v - yMin) / (yMax - yMin)
    return padYTop + chartH - norm * chartH
  }
  const scaleX = (i: number) => padX + i * xStep

  // Path da linha
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i)} ${scaleY(p.y)}`)
    .join(' ')

  // Path da área (linha + fechamento até o eixo X de baixo)
  const areaPath = [
    linePath,
    `L ${scaleX(points.length - 1)} ${padYTop + chartH}`,
    `L ${scaleX(0)} ${padYTop + chartH}`,
    'Z',
  ].join(' ')

  // Y ticks (3 linhas horizontais de referência)
  const yTicks = [yMin, (yMin + yMax) / 2, yMax]

  // ID único pro gradient (evita conflito quando há múltiplos gráficos)
  const gradId = React.useId()

  return (
    <div className="fin-linha" aria-label={ariaLabel}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <linearGradient id={`fin-linha-grad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Linhas horizontais de referência */}
        {showLabels &&
          yTicks.map((t, i) => {
            const y = scaleY(t)
            return (
              <g key={i}>
                <line
                  x1={padX}
                  y1={y}
                  x2={width - 8}
                  y2={y}
                  stroke="var(--fin-line-2)"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
                <text
                  x={padX - 6}
                  y={y + 4}
                  fontSize="10"
                  fill="var(--fin-ink-3)"
                  textAnchor="end"
                >
                  {formatY ? formatY(t) : Math.round(t)}
                </text>
              </g>
            )
          })}

        {/* Área preenchida */}
        {fillArea && (
          <path d={areaPath} fill={`url(#fin-linha-grad-${gradId})`} />
        )}

        {/* Linha principal */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Pontos */}
        {showDots &&
          points.map((p, i) => (
            <circle
              key={i}
              cx={scaleX(i)}
              cy={scaleY(p.y)}
              r={3}
              fill="var(--fin-bg)"
              stroke={color}
              strokeWidth={2}
            />
          ))}

        {/* Labels do eixo X */}
        {showLabels &&
          points.map((p, i) => (
            <text
              key={i}
              x={scaleX(i)}
              y={height - 6}
              fontSize="10"
              fill="var(--fin-ink-3)"
              textAnchor="middle"
            >
              {p.x}
            </text>
          ))}
      </svg>

      <style jsx>{`
        .fin-linha {
          display: inline-block;
          font-family: inherit;
        }
      `}</style>
    </div>
  )
}

export default MiniLinhaSVG