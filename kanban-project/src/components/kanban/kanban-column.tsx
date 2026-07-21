// ESTE ARQUIVO VAI EM: src/components/kanban/kanban-column.tsx
//
// Coluna do kanban = FASE do Workflow Macro (motor).
// Colunas são definidas no GERENCIAMENTO → sem editar/excluir/adicionar aqui.
// O "+" de criar processo saiu da coluna: processo novo nasce na 1ª fase,
// pelo botão "+ Novo processo" do board.

"use client"

import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { useDroppable } from "@dnd-kit/core"
import { useMemo } from "react"
import { KanbanCard } from "./kanban-card"
import type { Processo } from "@/src/types/kanban"

interface KanbanColumnProps {
  faseKey: string
  title: string
  processos: Processo[]
  headerColor?: string
  isLast?: boolean
  onProcessoClick?: (processo: Processo) => void
}

export function KanbanColumn({
  faseKey,
  title,
  processos,
  headerColor = "#3f3f46",
  isLast,
  onProcessoClick,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${faseKey}`,
    data: {
      type: "Column",
      faseKey,
    },
  })

  const processosIds = useMemo(() => processos.map((p) => `card-${p.id}`), [processos])

  return (
    <div
      ref={setNodeRef}
      className={`
        flex flex-col h-full w-full
        ${!isLast ? 'border-r-2 border-dashed border-white/20' : ''}
        ${isOver ? 'bg-blue-500/10' : 'bg-transparent'}
        transition-colors duration-200
      `}
    >
      {/* Header compacto - altura fixa */}
      <div
        className="px-2 py-2 border-b border-white/10 h-10 flex items-center"
        style={{ backgroundColor: `${headerColor}40` }}
      >
        <div className="flex items-center gap-1.5 min-w-0 w-full">
          <h3 className="font-medium text-xs text-white truncate">{title}</h3>
          <span className="text-xs text-white/70 flex-shrink-0">
            ({processos.length})
          </span>
        </div>
      </div>

      {/* Área de cards com scroll interno */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
        <SortableContext items={processosIds} strategy={verticalListSortingStrategy}>
          {processos.map((processo) => (
            <KanbanCard
              key={processo.id}
              processo={processo}
              onClick={() => onProcessoClick?.(processo)}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}