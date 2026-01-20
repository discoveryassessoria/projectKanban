import React, { useId } from "react"

interface BlogIconProps {
  className?: string
  filled?: boolean
}

export function BlogIcon({ className = "h-5 w-5", filled = false }: BlogIconProps) {
  const maskId = useId()
  
  // Path do documento (retângulo com canto dobrado)
  const docPath = "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
  const foldPath = "M14 2v6h6"
  
  // Paths das linhas de texto
  const line1 = "M8 13h8"
  const line2 = "M8 17h6"

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
            {/* Linhas de texto transparentes */}
            <path
              d={line1}
              fill="none"
              stroke="black"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={line2}
              fill="none"
              stroke="black"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Dobra do canto transparente */}
            <path
              d={foldPath}
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
          d={docPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Preenchimento com máscara */}
        <path
          d={docPath}
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
      {/* Documento */}
      <path
        d={docPath}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Dobra do canto */}
      <path
        d={foldPath}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Linhas de texto */}
      <path
        d={line1}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={line2}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}