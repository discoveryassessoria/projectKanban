import React from "react"

interface ScrollIconProps {
  className?: string
  filled?: boolean
}

/**
 * Pergaminho — a Revisão Registral trabalha sobre CERTIDÕES.
 * Mesmo contrato dos demais ícones da barra lateral: `className` para o tamanho,
 * `filled` para o estado ativo, traço em `currentColor` (a cor vem do DS, nunca
 * daqui).
 */
export function ScrollIcon({ className = "h-5 w-5", filled = false }: ScrollIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      {/* Corpo do documento */}
      <path
        d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Linhas de texto do registro */}
      <path
        d="M8.5 8h7M8.5 12h7M8.5 16h4"
        fill="none"
        stroke={filled ? "var(--accent-ink, #0a0a0b)" : "currentColor"}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
