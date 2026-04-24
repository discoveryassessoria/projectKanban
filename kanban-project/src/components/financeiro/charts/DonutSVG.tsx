// src/components/financeiro/charts/DonutSVG.tsx
//
// Gráfico donut em SVG puro (sem recharts, sem chart.js).
// Baseado no _renderDonut do mockup do Marco (grupo-discovery-sistema-TESTE.html).
//
// Uso:
//   <DonutSVG
//     size={160}
//     thickness={22}
//     slices={[
//       { label: 'Recebido',  value: 3200, color: 'var(--fin-green)' },
//       { label: 'A Receber', value: 5800, color: 'var(--fin-yellow)' },
//       { label: 'Vencido',   value: 1200, color: 'var(--fin-red)' },
//     ]}
//     centerLabel="Total"
//     centerValue="R$ 10.200"
//   />

'use client'

import React from 'react'

// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------
export interface DonutSlice {
  label: string
  value: number
  color: string // pode ser hex (#8b5cf6) ou var(--fin-purple)
}

export interface DonutSVGProps {
  slices: DonutSlice[]
  size?: number // diâmetro externo em px (default 160)
  thickness?: number // espessura do anel em px (default 22)
  centerLabel?: string
  centerValue?: string
  // Mostrar legenda abaixo? (default true)
  showLegend?: boolean
  // Formatter de valor pra legenda (opcional)
  formatLegendValue?: (value: number) => string
  // Título acessível
  ariaLabel?: string
}

// ----------------------------------------------------------------------------
// Helper: converte ângulo polar pra coordenada cartesiana
// ----------------------------------------------------------------------------
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  }
}

// Gera o "d" de um arco SVG entre dois ângulos (graus, 0 no topo, sentido horário)
function describeArc(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  const startOuter = polarToCartesian(cx, cy, rOuter, endAngle)
  const endOuter = polarToCartesian(cx, cy, rOuter, startAngle)
  const startInner = polarToCartesian(cx, cy, rInner, startAngle)
  const endInner = polarToCartesian(cx, cy, rInner, endAngle)

  const largeArc = endAngle - startAngle <= 180 ? '0' : '1'

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ')
}

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export function DonutSVG({
  slices,
  size = 160,
  thickness = 22,
  centerLabel,
  centerValue,
  showLegend = true,
  formatLegendValue,
  ariaLabel,
}: DonutSVGProps) {
  const total = slices.reduce((s, x) => s + (x.value || 0), 0)
  const cx = size / 2
  const cy = size / 2
  const rOuter = size / 2
  const rInner = rOuter - thickness

  // Se total for zero, desenhamos só um anel cinza
  if (total <= 0) {
    return (
      <div className="fin-donut" aria-label={ariaLabel || 'Gráfico vazio'}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
        >
          <circle
            cx={cx}
            cy={cy}
            r={(rOuter + rInner) / 2}
            fill="none"
            stroke="var(--fin-line)"
            strokeWidth={thickness}
          />
          {(centerLabel || centerValue) && (
            <g>
              {centerLabel && (
                <text
                  x={cx}
                  y={cy - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--fin-ink-3)"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
                >
                  {centerLabel}
                </text>
              )}
              {centerValue && (
                <text
                  x={cx}
                  y={cy + 14}
                  textAnchor="middle"
                  fontSize="16"
                  fontWeight={700}
                  fill="var(--fin-ink)"
                >
                  {centerValue}
                </text>
              )}
            </g>
          )}
        </svg>
        {showLegend && (
          <div className="fin-donut__legend">
            <span className="fin-donut__empty">Sem dados</span>
          </div>
        )}
        <style jsx>{`
          .fin-donut {
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
          }
          .fin-donut__legend {
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-size: 12px;
          }
          .fin-donut__empty {
            color: var(--fin-ink-3);
            font-style: italic;
          }
        `}</style>
      </div>
    )
  }

  // Geração das fatias
  let acc = 0
  const paths = slices.map((s, i) => {
    const pct = s.value / total
    const startAngle = acc * 360
    const endAngle = (acc + pct) * 360
    acc += pct

    // Ajuste: se for 1 fatia única (pct=1), SVG não desenha arco completo.
    // Nesse caso, desenhamos como um círculo com stroke.
    if (pct >= 0.9999) {
      return (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={(rOuter + rInner) / 2}
          fill="none"
          stroke={s.color}
          strokeWidth={thickness}
        />
      )
    }

    const d = describeArc(cx, cy, rOuter, rInner, startAngle, endAngle)
    return <path key={i} d={d} fill={s.color} />
  })

  return (
    <div className="fin-donut" aria-label={ariaLabel}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        {paths}
        {(centerLabel || centerValue) && (
          <g>
            {centerLabel && (
              <text
                x={cx}
                y={cy - 6}
                textAnchor="middle"
                fontSize="11"
                fill="var(--fin-ink-3)"
                style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                {centerLabel}
              </text>
            )}
            {centerValue && (
              <text
                x={cx}
                y={cy + 14}
                textAnchor="middle"
                fontSize="16"
                fontWeight={700}
                fill="var(--fin-ink)"
              >
                {centerValue}
              </text>
            )}
          </g>
        )}
      </svg>

      {showLegend && (
        <div className="fin-donut__legend">
          {slices.map((s, i) => {
            const pct = total > 0 ? (s.value / total) * 100 : 0
            return (
              <div key={i} className="fin-donut__row">
                <span
                  className="fin-donut__dot"
                  style={{ background: s.color }}
                  aria-hidden
                />
                <span className="fin-donut__label">{s.label}</span>
                <span className="fin-donut__value">
                  {formatLegendValue ? formatLegendValue(s.value) : s.value}
                  <span className="fin-donut__pct"> · {pct.toFixed(0)}%</span>
                </span>
              </div>
            )
          })}
        </div>
      )}

      <style jsx>{`
        .fin-donut {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .fin-donut__legend {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12px;
          min-width: 180px;
        }
        .fin-donut__row {
          display: grid;
          grid-template-columns: 10px 1fr auto;
          align-items: center;
          gap: 8px;
        }
        .fin-donut__dot {
          width: 10px;
          height: 10px;
          border-radius: 2px;
        }
        .fin-donut__label {
          color: var(--fin-ink-2);
        }
        .fin-donut__value {
          color: var(--fin-ink);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .fin-donut__pct {
          color: var(--fin-ink-3);
          font-weight: 400;
        }
      `}</style>
    </div>
  )
}

export default DonutSVG