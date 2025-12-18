"use client"

interface PersonIconProps {
  gender?: string | null
  size?: number
  className?: string
}

export function PersonIcon({ gender, size = 40, className = "" }: PersonIconProps) {
  const isMale = gender?.toLowerCase() === 'masculino' || gender?.toLowerCase() === 'male' || gender?.toLowerCase() === 'm'
  const isFemale = gender?.toLowerCase() === 'feminino' || gender?.toLowerCase() === 'female' || gender?.toLowerCase() === 'f'
  
  // Cores estilo FamilySearch
  const bgColor = isMale ? '#0284c7' : isFemale ? '#be185d' : '#6b7280' // sky-600 / pink-700 / gray-500
  const skinColor = isMale ? '#38bdf8' : isFemale ? '#f472b6' : '#9ca3af' // sky-400 / pink-400 / gray-400
  
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 40 40" 
      className={`flex-shrink-0 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Fundo circular */}
      <circle cx="20" cy="20" r="20" fill={bgColor} />
      
      {/* Cabeça */}
      <circle cx="20" cy="13" r="7" fill={skinColor} />
      
      {/* Corpo/ombros */}
      <ellipse cx="20" cy="38" rx="14" ry="14" fill={skinColor} />
    </svg>
  )
}