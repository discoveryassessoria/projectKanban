import React from "react"

interface ChatIconProps {
  className?: string
  filled?: boolean
}

/**
 * Balão de conversa — Leads (WhatsApp). Mesmo contrato dos demais ícones da barra lateral:
 * `className` dá o tamanho, `filled` marca o estado ativo, e o traço é `currentColor`.
 */
export function ChatIcon({ className = "h-5 w-5", filled = false }: ChatIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
