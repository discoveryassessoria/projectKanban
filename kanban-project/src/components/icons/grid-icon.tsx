import React from "react"

interface GridIconProps {
  className?: string
  filled?: boolean
}

export function GridIcon({ className = "h-5 w-5", filled = false }: GridIconProps) {
  if (filled) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Borda externa superior */}
        <path
          d="M4 4H20C20.55 4 21 4.45 21 5V10H3V5C3 4.45 3.45 4 4 4Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        {/* Preenchimento superior com recorte do puxador */}
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M4 4H20C20.55 4 21 4.45 21 5V10H3V5C3 4.45 3.45 4 4 4ZM8.1 6.1H15.9V7.9H8.1V6.1Z"
          fill="currentColor"
        />
        {/* Borda externa inferior */}
        <path
          d="M3 14H21V19C21 19.55 20.55 20 20 20H4C3.45 20 3 19.55 3 19V14Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        {/* Preenchimento inferior com recorte do puxador */}
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M3 14H21V19C21 19.55 20.55 20 20 20H4C3.45 20 3 19.55 3 19V14ZM8.1 16.1H15.9V17.9H8.1V16.1Z"
          fill="currentColor"
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
      {/* Gaveta de arquivo */}
      <path
        d="M4 4H20C20.55 4 21 4.45 21 5V19C21 19.55 20.55 20 20 20H4C3.45 20 3 19.55 3 19V5C3 4.45 3.45 4 4 4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Linha divisória horizontal */}
      <path
        d="M3 12H21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* Puxador superior */}
      <path
        d="M9 8H15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* Puxador inferior */}
      <path
        d="M9 16H15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}