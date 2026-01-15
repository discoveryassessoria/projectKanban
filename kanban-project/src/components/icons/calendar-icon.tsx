import React, { useId } from "react"

interface CalendarIconProps {
  className?: string
  filled?: boolean
}

export function CalendarIcon({ className = "", filled = false }: CalendarIconProps) {
  const maskId = useId()

  if (filled) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="24" height="24" fill="white" />
            {/* Recorte dos pinos */}
            <line x1="16" y1="2" x2="16" y2="6" stroke="black" strokeWidth="3" strokeLinecap="round" />
            <line x1="8" y1="2" x2="8" y2="6" stroke="black" strokeWidth="3" strokeLinecap="round" />
          </mask>
        </defs>
        
        {/* Contorno completo */}
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        
        {/* Preenchimento do header com máscara */}
        <rect 
          x="3" 
          y="4" 
          width="18" 
          height="6" 
          rx="2" 
          ry="2" 
          fill="currentColor" 
          stroke="none"
          mask={`url(#${maskId})`}
        />
      </svg>
    )
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}