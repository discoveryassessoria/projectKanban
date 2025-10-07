"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { PrazoClassification } from "@/src/utils/prazoUtils"

interface QuickAddButtonProps {
  classification: PrazoClassification
  onQuickAdd: () => void
  isVisible: boolean
  isExpanded: boolean
}

export default function QuickAddButton({ 
  classification, 
  onQuickAdd, 
  isVisible, 
  isExpanded 
}: QuickAddButtonProps) {
  const [isHovered, setIsHovered] = useState(false)

  // Botão sempre visível quando o componente é renderizado
  if (!isVisible) return null

  return (
    <div 
      className="relative transition-all duration-300 ease-in-out"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Button
        variant="outline"
        size="sm"
        className={`
          bg-white/95 backdrop-blur-sm border-2 shadow-lg hover:shadow-xl
          transition-all duration-300 ease-in-out
          ${isExpanded 
            ? 'px-4 py-2 h-auto border-blue-400 bg-blue-50/90 min-w-[180px]' 
            : 'w-8 h-8 p-0 border-gray-300 hover:border-blue-400'
          }
          ${isHovered ? 'scale-105' : ''}
          hover:bg-blue-50
        `}
        onClick={(e) => {
          e.stopPropagation()
          onQuickAdd()
        }}
      >
        <div className="flex items-center gap-2">
          <Plus className={`
            transition-transform duration-300 
            ${isExpanded ? 'h-4 w-4 rotate-90' : 'h-4 w-4'}
          `} />
          
          <span className={`
            whitespace-nowrap text-sm font-medium
            transition-all duration-300 ease-in-out
            ${isExpanded 
              ? 'opacity-100 max-w-[200px] translate-x-0' 
              : 'opacity-0 max-w-0 -translate-x-2 overflow-hidden'
            }
          `}>
            Adicionar tarefa rápida
          </span>
        </div>
      </Button>
    </div>
  )
}