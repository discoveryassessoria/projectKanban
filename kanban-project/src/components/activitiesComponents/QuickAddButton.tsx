"use client"

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
  // Botão sempre visível quando o componente é renderizado
  if (!isVisible) return null

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-8 h-8 p-0 bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white hover:border-white/50 transition-colors"
      onClick={(e) => {
        e.stopPropagation()
        onQuickAdd()
      }}
    >
      <Plus className="h-4 w-4" />
    </Button>
  )
}