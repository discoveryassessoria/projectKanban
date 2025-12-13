import React, { useId } from "react"

interface CheckIconProps {
  className?: string
  filled?: boolean
}

export function CheckIcon({ className = "h-5 w-5", filled = false }: CheckIconProps) {
  const maskId = useId()
  // Mesmo path do check para as duas versões
  const checkPath = "M7 12.5L10.5 16L17 9"

  if (filled) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="24" height="24" fill="white" />
            <path
              d={checkPath}
              fill="none"
              stroke="black"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </mask>
        </defs>
        {/* Borda externa */}
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        {/* Preenchimento com máscara */}
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="3"
          fill="currentColor"
          mask={`url(#${maskId})`}
        />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Quadrado com bordas arredondadas */}
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      {/* Check */}
      <path
        d={checkPath}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}