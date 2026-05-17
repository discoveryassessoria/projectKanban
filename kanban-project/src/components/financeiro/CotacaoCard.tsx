'use client'

import { useState } from 'react'

interface CotacaoCardProps {
  simbolo: string // '$' ou '€'
  codigo: 'USD' | 'EUR'
  nome: string   // 'Dólar americano' ou 'Euro'
  valor: number
  variacao: number
  variacaoPct: number
  historico: number[]
  atualizadoEm: string | null
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function MiniSpark({ values, color }: { values: number[]; color: string }) {
  if (!values.length) return null
  const w = 260, h = 60
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const step = w / (values.length - 1 || 1)
  let path = ''
  values.forEach((v, i) => {
    const x = i * step
    const y = h - ((v - min) / range) * (h - 6) - 3
    path += (i === 0 ? 'M' : 'L') + ` ${x.toFixed(1)} ${y.toFixed(1)} `
  })
  const area = path + `L ${w} ${h} L 0 ${h} Z`
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={area} fill={color + '20'} />
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  )
}

function fmtDataHora(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso.replace(' ', 'T'))
    return (
      d.toLocaleDateString('pt-BR') +
      ' às ' +
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    )
  } catch {
    return '—'
  }
}

export function CotacaoCard({
  simbolo, codigo, nome,
  valor, variacao, variacaoPct,
  historico, atualizadoEm,
}: CotacaoCardProps) {
  const [hover, setHover] = useState(false)
  const subindo = variacao >= 0
  const cor = subindo ? '#10b981' : '#ef4444'

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="fpag-fx-indicator" style={{ cursor: 'pointer' }}>
        <span className="fpag-fx-indicator-dot" />
        <span>{simbolo}1 = {fmtBRL(valor)} (hoje)</span>
      </div>

      {hover && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 16,
            minWidth: 280,
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            zIndex: 100,
          }}
        >
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>
            1 {nome} igual a
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#111827', lineHeight: 1.1 }}>
            {fmtBRL(valor)}
          </div>
          <div style={{ fontSize: 13, color: cor, marginTop: 4, fontWeight: 500 }}>
            {subindo ? '▲' : '▼'} {Math.abs(variacao).toFixed(4).replace('.', ',')}
            {' '}({subindo ? '+' : ''}{variacaoPct.toFixed(2).replace('.', ',')}%)
            <span style={{ color: '#9ca3af', fontWeight: 400 }}> no dia</span>
          </div>

          {historico.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <MiniSpark values={historico} color={cor} />
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 10, color: '#9ca3af', marginTop: 4,
              }}>
                <span>30 dias atrás</span>
                <span>hoje</span>
              </div>
            </div>
          )}

          <div style={{
            fontSize: 11, color: '#9ca3af',
            marginTop: 14, paddingTop: 10,
            borderTop: '1px solid #f1f5f9', lineHeight: 1.5,
          }}>
            Atualizado em {fmtDataHora(atualizadoEm)}<br />
            Fonte: AwesomeAPI · Cotação BCB
          </div>
        </div>
      )}
    </div>
  )
}