import React from "react"

interface ReportIconProps {
  className?: string
  filled?: boolean
}

/**
 * Barras — leitura da operação. Mesmo contrato dos demais ícones da barra
 * lateral: `className` dá o tamanho, `filled` marca o estado ativo, e o traço
 * é `currentColor` (a cor vem do DS, nunca daqui).
 */
export function ReportIcon({ className = "h-5 w-5", filled = false }: ReportIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 4v15a1 1 0 0 0 1 1h15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="7.5" y="11" width="2.8" height="6" rx="0.7" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" />
      <rect x="12" y="7.5" width="2.8" height="9.5" rx="0.7" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" />
      <rect x="16.5" y="13" width="2.8" height="4" rx="0.7" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
