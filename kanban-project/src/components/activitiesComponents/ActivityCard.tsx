"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { CalendarDays, Clock, User, Building2 } from "lucide-react"
import { classifyByDeadline, getUrgencyColor } from "@/src/utils/prazoUtils"

interface Usuario {
  nome: string
  email: string
}

interface Projeto {
  id?: number
  nome: string
  descricao: string | null
}

interface Status {
  id?: number
  nome: string
}

interface UserAtv {
  usuario: Usuario
}

interface Atividade {
  id: number
  nome: string
  descricao: string | null
  data_termino: string | null
  data_criacao: string
  projeto: Projeto
  status: Status
  usuarios: UserAtv[]
}

interface ActivityCardProps {
  activity: Atividade
  onClick?: (activity: Atividade) => void
  isDragging?: boolean
}

export default function ActivityCard({ activity, onClick, isDragging = false }: ActivityCardProps) {
  const classification = classifyByDeadline(activity.data_termino)
  const urgencyColor = getUrgencyColor(classification.category)

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null
    
    const date = new Date(dateString)
    const now = new Date()
    
    // Resetar horas para comparação apenas de datas
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const deadlineDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    
    const diffTime = deadlineDate.getTime() - today.getTime()
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays < 0) {
      return `Venceu há ${Math.abs(diffDays)} dia(s)`
    } else if (diffDays === 0) {
      return 'Vence hoje'
    } else if (diffDays === 1) {
      return 'Vence amanhã'
    } else {
      return `Vence em ${diffDays} dia(s)`
    }
  }

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return 'Sem prazo'
    
    const date = new Date(dateString)
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getInitials = (nome: string) => {
    return nome
      .split(' ')
      .map(word => word.charAt(0))
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }

  const deadlineInfo = formatDate(activity.data_termino)
  const isUrgent = classification.category === 'vencido' || classification.category === 'hoje'

  return (
    <Card 
      className={`
        cursor-pointer transition-all duration-200 hover:shadow-md
        ${urgencyColor}
        ${isUrgent ? 'ring-2 ring-red-200' : ''}
        ${isDragging ? 'shadow-2xl ring-1 ring-gray-300 rotate-3 scale-105' : ''}
      `}
      onClick={() => onClick?.(activity)}
    >
      <CardContent className="p-3 space-y-3">
        {/* Header com nome da atividade */}
        <div className="space-y-1">
          <h4 className="font-medium text-sm leading-tight">
            {activity.nome}
          </h4>
          {activity.descricao && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {activity.descricao}
            </p>
          )}
        </div>

        {/* Projeto */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="h-3 w-3" />
          <span className="truncate">{activity.projeto.nome}</span>
        </div>

        {/* Prazo */}
        {activity.data_termino && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs">
              <CalendarDays className="h-3 w-3" />
              <span className={`
                ${isUrgent ? 'font-medium' : ''}
              `}>
                {formatDateTime(activity.data_termino)}
              </span>
            </div>
            {deadlineInfo && (
              <div className="flex items-center gap-1.5 text-xs">
                <Clock className="h-3 w-3" />
                <span className={`
                  ${classification.category === 'vencido' ? 'text-red-600 font-medium' : ''}
                  ${classification.category === 'hoje' ? 'text-orange-600 font-medium' : ''}
                `}>
                  {deadlineInfo}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Status */}
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="text-xs">
            {activity.status.nome}
          </Badge>
          
          {/* Responsáveis */}
          {activity.usuarios && activity.usuarios.length > 0 && (
            <div className="flex items-center gap-1">
              <User className="h-3 w-3 text-muted-foreground" />
              <div className="flex -space-x-1">
                {activity.usuarios.slice(0, 3).map((userAtv, index) => (
                  <Avatar key={index} className="h-5 w-5 border border-background">
                    <AvatarFallback className="text-xs">
                      {getInitials(userAtv.usuario.nome)}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {activity.usuarios.length > 3 && (
                  <div className="h-5 w-5 rounded-full bg-muted border border-background flex items-center justify-center">
                    <span className="text-xs font-medium">
                      +{activity.usuarios.length - 3}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}