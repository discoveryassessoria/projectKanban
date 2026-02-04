interface DollarIconProps {
  className?: string
  filled?: boolean
}

export function DollarIcon({ className = "h-5 w-5", filled = false }: DollarIconProps) {
  if (filled) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className}>
        <defs>
          <mask id="dollar-cutout">
            <rect width="24" height="24" fill="white" />
            <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 18V6" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </mask>
        </defs>
        <circle cx="12" cy="12" r="10" fill="currentColor" mask="url(#dollar-cutout)" />
      </svg>
    )
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
      <path d="M12 18V6" />
    </svg>
  )
}