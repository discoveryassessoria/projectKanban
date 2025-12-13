import React, { useId } from "react"

interface ShieldIconProps {
  className?: string
  filled?: boolean
}

export function ShieldIcon({ className = "h-5 w-5", filled = false }: ShieldIconProps) {
  const maskId = useId()
  
  // Path do escudo
  const shieldPath = "M12 2L4 5V11.09C4 16.14 7.41 20.85 12 22C16.59 20.85 20 16.14 20 11.09V5L12 2Z"
  
  // Path do check
  const checkPath = "M9 12L11 14L15 10"

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
            {/* Check transparente */}
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
        <path
          d={shieldPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Preenchimento com máscara */}
        <path
          d={shieldPath}
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
      {/* Escudo */}
      <path
        d={shieldPath}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
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