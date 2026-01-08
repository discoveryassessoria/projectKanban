// src/components/ui/bandeira-pais.tsx

"use client"

import { Pais } from "@/src/types/kanban"

interface BandeiraPaisProps {
  pais: Pais
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
}

const TAMANHOS = {
  sm: { width: 16, height: 12 },
  md: { width: 24, height: 18 },
  lg: { width: 32, height: 24 },
  xl: { width: 48, height: 36 },
}

// SVGs das bandeiras
const BandeiraAlemanha = ({ width, height }: { width: number; height: number }) => (
  <svg width={width} height={height} viewBox="0 0 5 3" xmlns="http://www.w3.org/2000/svg">
    <rect width="5" height="1" y="0" fill="#000000" />
    <rect width="5" height="1" y="1" fill="#DD0000" />
    <rect width="5" height="1" y="2" fill="#FFCE00" />
  </svg>
)

const BandeiraEspanha = ({ width, height }: { width: number; height: number }) => (
  <svg width={width} height={height} viewBox="0 0 750 500" xmlns="http://www.w3.org/2000/svg">
    <rect width="750" height="500" fill="#c60b1e" />
    <rect width="750" height="250" y="125" fill="#ffc400" />
  </svg>
)

const BandeiraItalia = ({ width, height }: { width: number; height: number }) => (
  <svg width={width} height={height} viewBox="0 0 3 2" xmlns="http://www.w3.org/2000/svg">
    <rect width="1" height="2" x="0" fill="#009246" />
    <rect width="1" height="2" x="1" fill="#ffffff" />
    <rect width="1" height="2" x="2" fill="#ce2b37" />
  </svg>
)

const BandeiraPortugal = ({ width, height }: { width: number; height: number }) => (
  <svg width={width} height={height} viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg">
    <rect width="600" height="400" fill="#FF0000" />
    <rect width="240" height="400" fill="#006600" />
    <circle cx="240" cy="200" r="60" fill="#FFFF00" />
    <circle cx="240" cy="200" r="45" fill="#FF0000" />
    <circle cx="240" cy="200" r="30" fill="#FFFFFF" />
  </svg>
)

const BANDEIRAS_MAP: Record<Pais, React.FC<{ width: number; height: number }>> = {
  [Pais.ALEMANHA]: BandeiraAlemanha,
  [Pais.ESPANHA]: BandeiraEspanha,
  [Pais.ITALIA]: BandeiraItalia,
  [Pais.PORTUGAL]: BandeiraPortugal,
}

export function BandeiraPais({ pais, size = "md", className = "" }: BandeiraPaisProps) {
  const { width, height } = TAMANHOS[size]
  const BandeiraComponent = BANDEIRAS_MAP[pais]

  if (!BandeiraComponent) {
    return <span className={className}>🏳️</span>
  }

  return (
    <span 
      className={`inline-flex items-center justify-center overflow-hidden rounded-sm ${className}`}
      style={{ width, height }}
    >
      <BandeiraComponent width={width} height={height} />
    </span>
  )
}

// Exportar também como default para facilitar imports
export default BandeiraPais