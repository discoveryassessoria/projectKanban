"use client"

import type React from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Phone, Mail, MessageCircle } from "lucide-react"

interface KanbanCardProps {
  id: number
  nome: string
  descricao?: string | null
  data_termino?: string | null
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
  // Novos campos para o estilo Bitrix
  telefone?: string
  email?: string
  atividadesCount?: number
  onClick?: () => void
  onAddAtividade?: () => void
  // Campos adicionais que podem vir do AtividadeWithStatus
  pais?: string
  statusId?: number
  contratante?: any
  key?: number
}

export function KanbanCard({
  id,
  nome,
  descricao,
  data_termino,
  data_criacao,
  usuarios = [],
  status,
  tags = [],
  telefone,
  email,
  atividadesCount = 0,
  onClick,
  onAddAtividade
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

  const handleAddAtividade = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onAddAtividade) {
      onAddAtividade()
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
    // Futuro: integração com WhatsApp ou chat interno
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
          ${isDragging ? "shadow-xl ring-2 ring-blue-400/50 rotate-2" : ""}
        `}
        onClick={handleCardClick}
      >
        {/* Conteúdo principal */}
        <div className="p-3">
          {/* Header: Nome + Contador */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-medium text-sm text-gray-900 leading-tight flex-1">
              {nome}
            </h3>
            
            {/* Contador de atividades (estilo Bitrix) */}
            {atividadesCount > 0 && (
              <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 bg-blue-100 text-blue-600 text-xs font-medium rounded flex items-center justify-center">
                {atividadesCount}
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

        {/* Footer: + Atividade */}
        <div className="border-t border-gray-100">
          <button
            onClick={handleAddAtividade}
            className="w-full px-3 py-2 text-left text-sm text-gray-500 hover:text-blue-600 hover:bg-gray-50 transition-colors"
          >
            + Atividade
          </button>
        </div>
      </div>
    </div>
  )
}