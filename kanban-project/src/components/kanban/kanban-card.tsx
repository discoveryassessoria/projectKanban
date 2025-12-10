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
  
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  
  const diffTime = nowOnly.getTime() - dateOnly.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Hoje"
  if (diffDays === 1) return "Ontem"
  if (diffDays < 7) return `${diffDays} dias atrás`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} semanas atrás`
  
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

function getStatusColor(statusNome?: string) {
  if (!statusNome) return "bg-white/10 text-white/80"
  
  const status = statusNome.toLowerCase()
  if (status.includes('concluí') || status.includes('finaliz')) return "bg-green-500/20 text-green-300"
  if (status.includes('andamento') || status.includes('progresso')) return "bg-blue-500/20 text-blue-300"
  if (status.includes('pendente') || status.includes('aguard')) return "bg-yellow-500/20 text-yellow-300"
  if (status.includes('pausad') || status.includes('suspend')) return "bg-orange-500/20 text-orange-300"
  if (status.includes('cancelad') || status.includes('rejeit')) return "bg-red-500/20 text-red-300"
  
  return "bg-white/10 text-white/80"
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ 
    id: id,
    data: {
      type: "Card",
      atividade: { id, nome, descricao, data_termino, data_criacao, usuarios, status, tags },
    },
  })

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
        className={`mb-3 bg-white/10 backdrop-blur-md border border-white/20 hover:bg-white/15 hover:border-white/30 transition-all cursor-grab active:cursor-grabbing ${isDragging ? "shadow-2xl ring-2 ring-blue-400/50 rotate-2" : "shadow-md hover:shadow-lg"}`}
        onClick={handleCardClick}
      >
        <CardContent className="p-3 space-y-2.5">
          {/* Header com título e status */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm text-white leading-tight line-clamp-2 flex-1">
              {nome}
            </h3>
            {status && (
              <Badge 
                variant="secondary" 
                className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap backdrop-blur-sm ${getStatusColor(status.nome)}`}
              >
                {status.nome}
              </Badge>
            )}
          </div>

          {/* Descrição se existir */}
          {descricao && (
            <div className="flex items-start gap-2">
              <FileText className="h-3 w-3 text-white/60 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-white/80 line-clamp-2 leading-relaxed">
                {descricao}
              </p>
            </div>
          )}

          {/* Responsável */}
          {responsavel && (
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6 border border-white/20">
                <AvatarFallback className="text-xs bg-blue-500/30 text-blue-200 font-medium backdrop-blur-sm">
                  {responsavel.nome.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">
                  {responsavel.nome}
                </p>
                <p className="text-xs text-white/70 truncate">
                  {responsavel.email}
                </p>
              </div>
            </div>
          )}

          {/* Datas */}
          <div className="space-y-1">
            {data_termino && (
              <div className="flex items-center gap-2 text-xs">
                <Calendar className="h-3 w-3 text-red-400" />
                <span className="text-white/70">Entrega:</span>
                <span className="font-medium text-red-300">
                  {new Date(data_termino).toLocaleDateString('pt-BR')}
                </span>
              </div>
            )}
            
            {data_criacao && (
              <div className="flex items-center gap-2 text-xs">
                <Clock className="h-3 w-3 text-white/60" />
                <span className="text-white/70">
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
                  className="text-xs px-2 py-0.5 rounded-full backdrop-blur-sm"
                  style={{
                    backgroundColor: `${tag.cor}30`,
                    borderColor: `${tag.cor}80`,
                    color: tag.cor
                  }}
                >
                  {tag.texto}
                </Badge>
              ))}
              {tags.length > 3 && (
                <Badge variant="outline" className="text-xs px-2 py-0.5 rounded-full text-white/70 bg-white/10 backdrop-blur-sm">
                  +{tags.length - 3}
                </Badge>
              )}
            </div>
          )}

          {/* Indicador de múltiplos usuários */}
          {usuarios.length > 1 && (
            <div className="flex items-center gap-1 text-xs text-white/70">
              <User className="h-3 w-3" />
              <span>+{usuarios.length - 1} colaboradores</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}