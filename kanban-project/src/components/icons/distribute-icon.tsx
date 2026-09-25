import React, { useId } from "react"

interface DistributeIconProps {
  className?: string
  filled?: boolean
}

/** Um nó se ramificando em três — distribuir trabalho para a equipe (item próprio da barra lateral, 24/09/2026). */
export function DistributeIcon({ className = "h-5 w-5", filled = false }: DistributeIconProps) {
  const maskId = useId()
  const ramos = (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M8.2 7.1L15.8 10.9" fill="none" strokeLinecap="round" />
      <path d="M8.2 16.9L15.8 13.1" fill="none" strokeLinecap="round" />
    </>
  )

  if (filled) {
    return (
      <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="24" height="24" fill="white" />
            <circle cx="6" cy="6" r="1.3" fill="black" />
            <circle cx="6" cy="18" r="1.3" fill="black" />
            <circle cx="18" cy="12" r="1.3" fill="black" />
          </mask>
        </defs>
        <g fill="currentColor" stroke="currentColor" strokeWidth="1.6" mask={`url(#${maskId})`}>
          {ramos}
        </g>
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <g fill="none" stroke="currentColor" strokeWidth="1.6">
        {ramos}
      </g>
    </svg>
  )
}
