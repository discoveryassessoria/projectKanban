"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import ActivityCard from "./ActivityCard"
import type { Atividade } from "@/src/hooks/useActivitiesData"

interface DraggableActivityCardProps {
  activity: Atividade
  onClick?: (activity: Atividade) => void
  isUpdating?: boolean
}

export default function DraggableActivityCard({ 
  activity, 
  onClick,
  isUpdating = false
}: DraggableActivityCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: activity.id.toString(),
    data: {
      type: "activity",
      activity,
    }
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`
        ${isDragging ? 'opacity-50 z-50' : ''} 
        ${isUpdating ? 'opacity-75 pointer-events-none' : ''}
        cursor-grab active:cursor-grabbing
        transition-opacity duration-200
        ${isUpdating ? 'animate-pulse' : ''}
        relative
      `}
    >
      <ActivityCard 
        activity={activity} 
        onClick={onClick}
        isDragging={isDragging}
      />
      
      {/* Indicador de loading */}
      {isUpdating && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-lg backdrop-blur-sm">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}