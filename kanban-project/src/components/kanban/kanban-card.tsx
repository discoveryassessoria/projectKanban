"use client"

import type React from "react"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Calendar, User, Clock, FileText } from "lucide-react"

interface KanbanCardProps {
  id: number
  nome: string
  descricao?: string | null
  data_termino?: string
  data_criacao?: string
  usuarios?: Array<{
    usuario: {
      id: number
      nome: string
      email: string
    }
  }>
  status?: {
    id: number
    nome: string
  }
  tags?: { texto: string; cor: string }[]
  onClick?: () => void
}

function formatDate(dateString: string) {
  const date = new Date(dateString)
  const now = new Date()
  const diffTime = now.getTime() - date.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Hoje"
  if (diffDays === 1) return "Ontem"
  if (diffDays < 7) return `${diffDays} dias atrás`
  if (diffDays < 30) return `${Math.ceil(diffDays / 7)} semanas atrás`
  
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

function getStatusColor(statusNome?: string) {
  if (!statusNome) return "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
  
  const status = statusNome.toLowerCase()
  if (status.includes('concluí') || status.includes('finaliz')) return "bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300"
  if (status.includes('andamento') || status.includes('progresso')) return "bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300"
  if (status.includes('pendente') || status.includes('aguard')) return "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300"
  if (status.includes('pausad') || status.includes('suspend')) return "bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-300"
  if (status.includes('cancelad') || status.includes('rejeit')) return "bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300"
  
  return "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
}

export function KanbanCard({
  id,
  nome,
  descricao,
  data_termino = "",
  data_criacao,
  usuarios = [],
  status,
  tags = [],
  onClick
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const handleCardClick = (e: React.MouseEvent) => {
    if (!isDragging && onClick) {
      onClick()
    }
  }

  const responsavel = usuarios?.[0]?.usuario

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card
        className={`mb-3 bg-white dark:bg-gray-800 border-l-4 border-l-blue-500 dark:border-l-blue-400 hover:border-l-blue-600 dark:hover:border-l-blue-300 transition-all cursor-grab active:cursor-grabbing ${isDragging ? "shadow-2xl ring-2 ring-indigo-500" : "shadow-sm hover:shadow-md"}`}
        onClick={handleCardClick}
      >
        <CardContent className="p-4 space-y-3">
          {/* Header com título e status */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 leading-tight line-clamp-2 flex-1">
              {nome}
            </h3>
            {status && (
              <Badge 
                variant="secondary" 
                className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${getStatusColor(status.nome)}`}
              >
                {status.nome}
              </Badge>
            )}
          </div>

          {/* Descrição se existir */}
          {descricao && (
            <div className="flex items-start gap-2">
              <FileText className="h-3 w-3 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 leading-relaxed">
                {descricao}
              </p>
            </div>
          )}

          {/* Responsável */}
          {responsavel && (
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 font-medium">
                  {responsavel.nome.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                  {responsavel.nome}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {responsavel.email}
                </p>
              </div>
            </div>
          )}

          {/* Datas */}
          <div className="space-y-1">
            {data_termino && (
              <div className="flex items-center gap-2 text-xs">
                <Calendar className="h-3 w-3 text-red-500 dark:text-red-400" />
                <span className="text-gray-600 dark:text-gray-400">Entrega:</span>
                <span className="font-medium text-red-600 dark:text-red-400">
                  {new Date(data_termino).toLocaleDateString('pt-BR')}
                </span>
              </div>
            )}
            
            {data_criacao && (
              <div className="flex items-center gap-2 text-xs">
                <Clock className="h-3 w-3 text-gray-400 dark:text-gray-500" />
                <span className="text-gray-500 dark:text-gray-400">
                  Criado {formatDate(data_criacao)}
                </span>
              </div>
            )}
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 3).map((tag, index) => (
                <Badge
                  key={index}
                  variant="outline"
                  className="text-xs px-2 py-0.5 rounded-full border-gray-200 dark:border-gray-700"
                  style={{
                    backgroundColor: `${tag.cor}20`,
                    borderColor: tag.cor,
                    color: tag.cor
                  }}
                >
                  {tag.texto}
                </Badge>
              ))}
              {tags.length > 3 && (
                <Badge variant="outline" className="text-xs px-2 py-0.5 rounded-full text-gray-500 dark:text-gray-400">
                  +{tags.length - 3}
                </Badge>
              )}
            </div>
          )}

          {/* Indicador de múltiplos usuários */}
          {usuarios.length > 1 && (
            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <User className="h-3 w-3" />
              <span>+{usuarios.length - 1} colaboradores</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
