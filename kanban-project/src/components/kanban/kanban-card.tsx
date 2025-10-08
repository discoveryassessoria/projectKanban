"use client"

import type React from "react"

import { Card, CardContent } from "@/components/ui/card"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Calendar, User } from "lucide-react"

interface KanbanCardProps {
  id: number
  nome: string
  data_termino?: string
  usuarios?: Array<{
    usuario: {
      id: number
      nome: string
      email: string
    }
  }>
  tags?: { texto: string; cor: string }[]
  onClick?: () => void
}

export function KanbanCard({ id, nome, data_termino = "", usuarios = [], tags = [], onClick }: KanbanCardProps) {
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

  // Pegar o primeiro usuário como responsável principal
  const responsavel = usuarios?.[0]?.usuario?.nome

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card
        className={`mb-3 bg-white border-gray-200 hover:border-gray-300 transition-all cursor-grab active:cursor-grabbing ${isDragging ? "shadow-2xl ring-2 ring-indigo-500" : "shadow-md hover:shadow-lg"}`}
        onClick={handleCardClick}
      >
        <CardContent className="p-4">
          <h3 className="font-semibold text-sm text-gray-900 leading-snug mb-3">{nome}</h3>

          {(data_termino || responsavel) && (
            <div className="space-y-2 mb-3">
              {data_termino && (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{new Date(data_termino).toLocaleDateString("pt-BR")}</span>
                </div>
              )}
              {responsavel && (
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <User className="h-3.5 w-3.5" />
                  <span>{responsavel}</span>
                </div>
              )}
            </div>
          )}

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag, index) => (
                <span
                  key={index}
                  className="px-2 py-1 text-xs font-medium rounded-md"
                  style={{
                    backgroundColor: tag.cor + "20",
                    color: tag.cor,
                    border: `1px solid ${tag.cor}40`,
                  }}
                >
                  {tag.texto}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
