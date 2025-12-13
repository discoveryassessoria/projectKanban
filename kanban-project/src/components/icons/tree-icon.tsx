import React from "react"

interface TreeIconProps {
  className?: string
  filled?: boolean
}

export function TreeIcon({ className = "h-5 w-5", filled = false }: TreeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Copa da árvore - 3 camadas estilo pinheiro */}
      <path
        d="M12 2L6 8H8L4 13H8L5 18H19L16 13H20L16 8H18L12 2Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Tronco */}
      <path
        d="M10 18V22H14V18"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}