"use client"

import type React from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Phone, Mail, MessageCircle, Users, CheckSquare } from "lucide-react"
import type { ProcessoWithStatus } from "@/src/types/kanban"

interface KanbanCardProps {
  processo: ProcessoWithStatus
  onClick?: () => void
  isDragging?: boolean // Prop para quando está no DragOverlay
}

export function KanbanCard({ processo, onClick, isDragging: isDraggingProp }: KanbanCardProps) {
  const { 
    id, 
    nome, 
    descricao, 
    contratantes = [], // Array de contratantes
    requerentes = [],
    tarefas = [],
    _count
  } = processo

  // Pegar o primeiro contratante para exibir dados de contato
  const contratante = contratantes[0] || null

  // ✅ CORREÇÃO: Usar ID com prefixo "card-" para evitar conflito com IDs de colunas
  const { 
    attributes, 
    listeners, 
    setNodeRef, 
    transform, 
    transition, 
    isDragging: isDraggingSortable 
  } = useSortable({ 
    id: `card-${id}`,
    data: {
      type: "Card",
      processo: processo,
      statusId: processo.statusId,
    },
  })

  // Usar prop isDragging se fornecida (DragOverlay), senão usar do useSortable
  const isDragging = isDraggingProp ?? isDraggingSortable

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Dados do contratante para contato
  const telefone = contratante?.telefone
  const email = contratante?.email

  // Contagem de tarefas
  const tarefasCount = _count?.tarefas ?? tarefas?.length ?? 0
  const tarefasConcluidas = tarefas?.filter(t => t.concluida)?.length ?? 0

  // Contagem de requerentes
  const requerentesCount = requerentes?.length ?? 0

  const handleCardClick = (e: React.MouseEvent) => {
    if (!isDragging && onClick) {
      onClick()
    }
  }

  const handlePhoneClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (telefone) {
      window.open(`tel:${telefone}`, '_blank')
    }
  }

  const handleEmailClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (email) {
      window.open(`mailto:${email}`, '_blank')
    }
  }

  const handleChatClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (telefone) {
      const whatsappNumber = telefone.replace(/\D/g, '')
      window.open(`https://wa.me/55${whatsappNumber}`, '_blank')
    }
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div
        className={`
          mb-3 bg-white rounded-lg shadow-sm border border-gray-200
          hover:shadow-md transition-all cursor-grab active:cursor-grabbing
          ${isDragging ? "shadow-xl ring-2 ring-blue-400/50" : ""}
        `}
        onClick={handleCardClick}
      >
        {/* Conteúdo principal */}
        <div className="p-3">
          {/* Header: Nome */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-medium text-sm text-gray-900 leading-tight flex-1">
              {nome}
            </h3>
          </div>

          {/* Contratante */}
          {contratante && (
            <p className="text-xs text-gray-500 mb-2 truncate">
              {contratante.nome}
            </p>
          )}

          {/* Badges: Requerentes e Tarefas */}
          <div className="flex items-center gap-2 mb-2">
            {requerentesCount > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-purple-100 text-purple-600 text-xs font-medium rounded">
                <Users className="h-3 w-3" />
                {requerentesCount}
              </span>
            )}
            {tarefasCount > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-600 text-xs font-medium rounded">
                <CheckSquare className="h-3 w-3" />
                {tarefasConcluidas}/{tarefasCount}
              </span>
            )}
          </div>

          {/* Ícones de ação */}
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={handlePhoneClick}
              className={`p-1.5 rounded hover:bg-gray-100 transition-colors ${telefone ? 'text-gray-500 hover:text-blue-600' : 'text-gray-300 cursor-not-allowed'}`}
              disabled={!telefone}
              title={telefone || 'Sem telefone'}
            >
              <Phone className="h-4 w-4" />
            </button>
            <button
              onClick={handleEmailClick}
              className={`p-1.5 rounded hover:bg-gray-100 transition-colors ${email ? 'text-gray-500 hover:text-blue-600' : 'text-gray-300 cursor-not-allowed'}`}
              disabled={!email}
              title={email || 'Sem email'}
            >
              <Mail className="h-4 w-4" />
            </button>
            <button
              onClick={handleChatClick}
              className={`p-1.5 rounded hover:bg-gray-100 transition-colors ${telefone ? 'text-gray-500 hover:text-green-600' : 'text-gray-300 cursor-not-allowed'}`}
              disabled={!telefone}
              title={telefone ? 'WhatsApp' : 'Sem telefone'}
            >
              <MessageCircle className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}