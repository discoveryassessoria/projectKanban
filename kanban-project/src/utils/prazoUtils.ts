// Utilitários para classificação de atividades por prazo

export type PrazoCategory = 
  | 'vencido' 
  | 'hoje' 
  | 'proximos-3-dias' 
  | 'proxima-semana' 
  | 'futuro' 
  | 'sem-prazo'

export interface PrazoClassification {
  category: PrazoCategory
  label: string
  color: string
  priority: number
  description: string
}

export const PRAZO_CATEGORIES: Record<PrazoCategory, PrazoClassification> = {
  'vencido': {
    category: 'vencido',
    label: 'Vencido',
    color: 'destructive',
    priority: 1,
    description: 'Atividades com prazo já expirado'
  },
  'hoje': {
    category: 'hoje',
    label: 'Hoje',
    color: 'orange',
    priority: 2,
    description: 'Atividades que vencem hoje'
  },
  'proximos-3-dias': {
    category: 'proximos-3-dias',
    label: 'Próximos 3 dias',
    color: 'yellow',
    priority: 3,
    description: 'Atividades que vencem nos próximos 3 dias'
  },
  'proxima-semana': {
    category: 'proxima-semana',
    label: 'Próxima semana',
    color: 'blue',
    priority: 4,
    description: 'Atividades que vencem na próxima semana'
  },
  'futuro': {
    category: 'futuro',
    label: 'Futuro',
    color: 'green',
    priority: 5,
    description: 'Atividades com prazo mais distante'
  },
  'sem-prazo': {
    category: 'sem-prazo',
    label: 'Sem prazo',
    color: 'secondary',
    priority: 6,
    description: 'Atividades sem data de término definida'
  }
}

/**
 * Classifica uma atividade baseada na proximidade do prazo
 */
export function classifyByDeadline(dataTermino: string | null | undefined): PrazoClassification {
  if (!dataTermino) {
    return PRAZO_CATEGORIES['sem-prazo']
  }

  const now = new Date()
  const deadline = new Date(dataTermino)
  
  // Resetar horas para comparação apenas de datas
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const deadlineDate = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate())
  
  const diffTime = deadlineDate.getTime() - today.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    return PRAZO_CATEGORIES['vencido']
  } else if (diffDays === 0) {
    return PRAZO_CATEGORIES['hoje']
  } else if (diffDays <= 3) {
    return PRAZO_CATEGORIES['proximos-3-dias']
  } else if (diffDays <= 7) {
    return PRAZO_CATEGORIES['proxima-semana']
  } else {
    return PRAZO_CATEGORIES['futuro']
  }
}

/**
 * Agrupa atividades por categoria de prazo
 */
export function groupActivitiesByDeadline<T extends { data_termino: string | null }>(
  activities: T[]
): Record<PrazoCategory, T[]> {
  const grouped: Record<PrazoCategory, T[]> = {
    'vencido': [],
    'hoje': [],
    'proximos-3-dias': [],
    'proxima-semana': [],
    'futuro': [],
    'sem-prazo': []
  }

  activities.forEach(activity => {
    const classification = classifyByDeadline(activity.data_termino)
    grouped[classification.category].push(activity)
  })

  return grouped
}

/**
 * Ordena atividades dentro de uma categoria por prioridade
 */
export function sortActivitiesInCategory<T extends { data_termino: string | null }>(
  activities: T[],
  category: PrazoCategory
): T[] {
  return activities.sort((a, b) => {
    // Para atividades vencidas, ordenar por mais antigas primeiro
    if (category === 'vencido') {
      if (!a.data_termino || !b.data_termino) return 0
      return new Date(a.data_termino).getTime() - new Date(b.data_termino).getTime()
    }
    
    // Para atividades com prazo, ordenar por prazo mais próximo primeiro
    if (category !== 'sem-prazo') {
      if (!a.data_termino || !b.data_termino) return 0
      return new Date(a.data_termino).getTime() - new Date(b.data_termino).getTime()
    }
    
    // Para atividades sem prazo, manter ordem original
    return 0
  })
}

/**
 * Calcula estatísticas de prazos
 */
export function calculateDeadlineStats<T extends { data_termino: string | null }>(
  activities: T[]
): Record<PrazoCategory, number> {
  const grouped = groupActivitiesByDeadline(activities)
  
  return Object.keys(grouped).reduce((stats, category) => {
    stats[category as PrazoCategory] = grouped[category as PrazoCategory].length
    return stats
  }, {} as Record<PrazoCategory, number>)
}

/**
 * Retorna a cor de urgência baseada na categoria
 */
export function getUrgencyColor(category: PrazoCategory): string {
  const colorMap = {
    'vencido': 'bg-red-100 border-red-200 text-red-800',
    'hoje': 'bg-orange-100 border-orange-200 text-orange-800',
    'proximos-3-dias': 'bg-yellow-100 border-yellow-200 text-yellow-800',
    'proxima-semana': 'bg-blue-100 border-blue-200 text-blue-800',
    'futuro': 'bg-green-100 border-green-200 text-green-800',
    'sem-prazo': 'bg-gray-100 border-gray-200 text-gray-800'
  }
  
  return colorMap[category] || colorMap['sem-prazo']
}