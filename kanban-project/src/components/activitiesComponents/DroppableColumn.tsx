"use client"

import { useDroppable } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import StatusCard from "./StatusCard"
import { PrazoClassification } from "@/src/utils/prazoUtils"

interface Usuario {
  nome: string
  email: string
}

interface Projeto {
  id?: number
  nome: string
  descricao: string | null
}

interface Status {
  id?: number
  nome: string
}

interface UserAtv {
  usuario: Usuario
}

interface Atividade {
  id: number
  nome: string
  descricao: string | null
  data_termino: string | null
  data_criacao: string
  projeto: Projeto
  status: Status
  usuarios: UserAtv[]
}

interface DroppableColumnProps {
  id: string
  classification: PrazoClassification
  activities: Atividade[]
  children: React.ReactNode
}

export default function DroppableColumn({ 
  id, 
  classification, 
  activities, 
  children 
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

  return (
    <div
      ref={setNodeRef}
      className={`
        kanban-column transition-all duration-200
        ${isOver ? 'bg-blue-50/50 ring-2 ring-blue-300 shadow-lg' : ''}
      `}
    >
      <StatusCard
        classification={classification}
        activities={activities}
        canManage={false}
        isDropTarget={isOver}
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