interface HouseIconProps {
  className?: string
  filled?: boolean
}

export function HouseIcon({ className = "", filled = false }: HouseIconProps) {
  if (filled) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Casa preenchida com porta vazada */}
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 2L3 10V20C3 21.1 3.9 22 5 22H19C20.1 22 21 21.1 21 20V10L12 2ZM10 20V14H14V20H10Z"
          fill="currentColor"
        />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Casa só com contorno */}
      <path d="M3 10L12 2L21 10V20C21 21.1 20.1 22 19 22H5C3.9 22 3 21.1 3 20V10Z" />
      <path d="M10 22V14H14V22" />
    </svg>
  )
}