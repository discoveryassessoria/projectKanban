import React from "react"

interface RadarIconProps {
  className?: string
  filled?: boolean
}

/** Torre de Controle — um radar: círculos concêntricos e o ponteiro de varredura. */
export function RadarIcon({ className = "h-5 w-5", filled = false }: RadarIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth={filled ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill={filled ? "currentColor" : "none"} fillOpacity={filled ? 0.18 : 0} />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <path d="M12 12L18.4 5.6" />
    </svg>
  )
}
