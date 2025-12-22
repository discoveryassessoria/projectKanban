"use client"

import { useDroppable } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import StatusCard from "./StatusCard"
import QuickAddButton from "./QuickAddButton"
import { PrazoClassification } from "@/src/utils/prazoUtils"
import type { Atividade } from "@/src/hooks/useActivitiesData"

interface DroppableColumnProps {
  id: string
  classification: PrazoClassification
  activities: Atividade[]
  children: React.ReactNode
  onQuickAdd?: (category: string) => void
  onHover?: (columnId: string) => void
  onLeave?: () => void
  isExpanded?: boolean
}

export default function DroppableColumn({ 
  id, 
  classification, 
  activities, 
  children,
  onQuickAdd,
  onHover,
  onLeave,
  isExpanded = false
}: DroppableColumnProps) {
  const {
    isOver,
    setNodeRef,
  } = useDroppable({
    id,
    data: {
      type: "column",
      classification,
    }
  })

  const handleMouseEnter = () => {
    if (onHover) {
      onHover(id)
    }
  }

  const handleMouseLeave = () => {
    if (onLeave) {
      onLeave()
    }
  }

  const handleQuickAdd = () => {
    if (onQuickAdd) {
      onQuickAdd(id)
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={`
        kanban-column transition-all duration-200 relative
        ${isOver ? 'bg-white/10 ring-2 ring-white/30 shadow-lg' : ''}
      `}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <StatusCard
        classification={classification}
        activities={activities}
        canManage={false}
        isDropTarget={isOver}
        quickAddButton={
          onQuickAdd ? (
            <QuickAddButton
              classification={classification}
              onQuickAdd={handleQuickAdd}
              isVisible={true}
              isExpanded={isExpanded}
            />
          ) : null
        }
      >
        <SortableContext 
          items={activities.map(a => a.id.toString())}
          strategy={verticalListSortingStrategy}
        >
          {children}
        </SortableContext>
      </StatusCard>
    </div>
  )
}