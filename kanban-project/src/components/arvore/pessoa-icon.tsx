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
  const bgColor = isMale ? '#1e88e5' : isFemale ? '#d81b60' : '#78909c'
  const silhouetteColor = isMale ? '#64b5f6' : isFemale ? '#f48fb1' : '#b0bec5'
  
  if (isMale) {
    return (
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 100 100" 
        className={`flex-shrink-0 ${className}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Fundo circular */}
        <circle cx="50" cy="50" r="50" fill={bgColor} />
        
        {/* Silhueta masculina - ajustada para caber no círculo */}
        <g fill={silhouetteColor}>
          {/* Cabeça */}
          <circle cx="50" cy="35" r="14" />
          
          {/* Corpo - ombros largos (masculino) */}
          <path d="M 22 85 
                   Q 22 65, 38 60 
                   L 45 55 
                   L 45 50 
                   L 55 50 
                   L 55 55 
                   L 62 60 
                   Q 78 65, 78 85 
                   Q 65 90, 50 90
                   Q 35 90, 22 85
                   Z" />
        </g>
      </svg>
    )
  }
  
  if (isFemale) {
    return (
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 100 100" 
        className={`flex-shrink-0 ${className}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Fundo circular */}
        <circle cx="50" cy="50" r="50" fill={bgColor} />
        
        {/* Silhueta feminina */}
        <g fill={silhouetteColor}>
          {/* Cabelo longo */}
          <path d="M 32 38 
                   Q 30 22, 50 18 
                   Q 70 22, 68 38 
                   L 68 58 
                   Q 66 65, 58 62 
                   L 58 48 
                   Q 58 40, 50 38 
                   Q 42 40, 42 48 
                   L 42 62 
                   Q 34 65, 32 58 
                   Z" />
          
          {/* Rosto */}
          <ellipse cx="50" cy="40" rx="10" ry="12" />
          
          {/* Corpo - ombros estreitos (feminino) */}
          <path d="M 28 85 
                   Q 30 68, 42 62 
                   L 46 58 
                   L 54 58 
                   L 58 62 
                   Q 70 68, 72 85 
                   Q 62 90, 50 90
                   Q 38 90, 28 85
                   Z" />
        </g>
      </svg>
    )
  }
  
  // Gênero desconhecido
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      className={`flex-shrink-0 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="50" cy="50" r="50" fill={bgColor} />
      
      <g fill={silhouetteColor}>
        <circle cx="50" cy="35" r="12" />
        
        <path d="M 28 85 
                 Q 28 65, 40 60 
                 L 45 55 
                 L 45 48 
                 L 55 48 
                 L 55 55 
                 L 60 60 
                 Q 72 65, 72 85 
                 Q 62 90, 50 90
                 Q 38 90, 28 85
                 Z" />
      </g>
    </svg>
  )
}