"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, RefreshCw } from "lucide-react"
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  useSensors,
  useSensor,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
} from "@dnd-kit/core"
import {
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable"
import { 
  PRAZO_CATEGORIES, 
  groupActivitiesByDeadline, 
  sortActivitiesInCategory,
  PrazoCategory 
} from "@/src/utils/prazoUtils"
import ActivityCard from "./ActivityCard"
import DraggableActivityCard from "./DraggableActivityCard"
import DroppableColumn from "./DroppableColumn"
import QuickAddModal, { QuickAddFormData } from "./QuickAddModal"
import { useActivityOperations } from "@/src/hooks/useActivityOperations"
import { useQuickAddActivity } from "@/src/hooks/useQuickAddActivity"
import { useActivities, useContratantes, useRequerentes, invalidateActivities } from "@/src/hooks/useActivitiesData"
import type { Atividade, Usuario, Status } from "@/src/hooks/useActivitiesData"
import { TarefaDetailModal } from "@/src/components/kanban/TarefaDetailModal"
import { useUsers } from "@/src/hooks/useActivitiesData"
import type { Contratante, Requerente } from "@/src/types/kanban"
import "@/src/styles/kanban.css"
import { useRouter } from "next/navigation"

interface UserAtv {
  usuario: Usuario
}

interface PrazoActivitiesProps {
  filters?: any
}

export default function PrazoActivities({ filters }: PrazoActivitiesProps) {
  const router = useRouter()
  // Usar hook de cache para buscar todas as atividades
  const { activities = [], isLoading, error, mutate } = useActivities(filters)
  const { contratantes = [] } = useContratantes()
  const { requerentes = [] } = useRequerentes()
  
  const [selectedActivity, setSelectedActivity] = useState<Atividade | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  
  // Filtrar apenas atividades não concluídas para o kanban
  const atividades = (activities || []).filter((activity: Atividade) => {
    const statusNome = activity.status?.nome?.toLowerCase() || ''
    return statusNome !== 'concluída' && statusNome !== 'concluida'
  })
  
  // Estados para drag and drop
  const [draggedActivity, setDraggedActivity] = useState<Atividade | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  
  // Estados para Quick Add
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false)
  const [quickAddCategory, setQuickAddCategory] = useState<PrazoCategory | null>(null)
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null)

  const { users = [] } = useUsers()
  
  // Hook para operações de atividade
  const { updateDeadline, isUpdating, error: updateError, clearError } = useActivityOperations()
  
  // Hook para criação rápida
  const { createQuickActivity, isLoading: isCreatingActivity, error: createError, clearError: clearCreateError } = useQuickAddActivity({
    onSuccess: () => {
      invalidateActivities()
      mutate()
      setIsQuickAddOpen(false)
    },
    onError: (error: string) => {
      console.error('Erro ao criar atividade:', error)
    }
  })
  
  // Estado para controlar qual atividade está sendo atualizada
  const [updatingActivityId, setUpdatingActivityId] = useState<number | null>(null)

  // Sensores para diferentes tipos de input
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleActivityClick = async (activity: Atividade) => {
    if (activity.processo?.id) {
      const pais = activity.processo.pais || activity.pais || 'PORTUGAL'
      router.push(`/kanban?processoId=${activity.processo.id}&tab=tarefas&pais=${pais}&atividadeId=${activity.id}`)
    } else if (activity.tarefaPai?.id) {
      try {
        const response = await fetch(`/api/tarefas/${activity.tarefaPai.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        })
        if (response.ok) {
          const data = await response.json()
          const pai = data.tarefa
          setSelectedActivity({
            ...activity,
            id: pai.id,
            nome: pai.titulo,
            descricao: pai.descricao,
            concluida: pai.concluida,
            prioridade: pai.prioridade,
            data_termino: pai.dataPrazo,
            data_criacao: pai.createdAt,
            responsavel: pai.responsavel,
            observacoes: pai.observacoes,
            tarefaPai: undefined,
          } as any)
          setIsDetailsModalOpen(true)
        }
      } catch (error) {
        console.error('Erro ao buscar tarefa pai:', error)
      }
    } else {
      setSelectedActivity(activity)
      setIsDetailsModalOpen(true)
    }
  }

  const handleAtividadeSave = () => {
    mutate()
    invalidateActivities()
    setIsDetailsModalOpen(false)
  }

  const handleQuickAdd = (category: string) => {
    setQuickAddCategory(category as PrazoCategory)
    setIsQuickAddOpen(true)
  }

  const handleColumnHover = (columnId: string) => {
    setHoveredColumn(columnId)
  }

  const handleColumnLeave = () => {
    setHoveredColumn(null)
  }

  const handleQuickAddSubmit = async (formData: QuickAddFormData) => {
    await createQuickActivity(formData)
  }

  const handleQuickAddClose = () => {
    setIsQuickAddOpen(false)
    setQuickAddCategory(null)
    clearCreateError()
  }

  // Handlers de drag and drop
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const activity = atividades.find((a: Atividade) => a.id === Number(active.id))
    setDraggedActivity(activity || null)
    setIsDragging(true)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    
    setDraggedActivity(null)
    setIsDragging(false)
    
    if (!over || active.id === over.id) return

    const activeId = Number(active.id)
    const overId = over.id as string
    
    // Encontrar a atividade sendo movida
    const draggedActivityItem = atividades.find((a: Atividade) => a.id === activeId)
    if (!draggedActivityItem) return

    // Calcular nova data baseada na categoria de destino
    const newDate = calculateNewDateForCategory(overId as PrazoCategory)
    
    // Optimistic Update - atualizar cache imediatamente
    mutate(
      atividades.map((activity: Atividade) => 
        activity.id === activeId 
          ? { ...activity, data_termino: newDate }
          : activity
      ),
      { revalidate: false }
    )

    // Indicar que está atualizando
    setUpdatingActivityId(activeId)

    try {
      // Chamar API para persistir mudança
      const success = await updateDeadline(activeId, newDate)
      
      if (!success) {
        // Reverter mudança em caso de erro
        mutate(
          atividades.map((activity: Atividade) => 
            activity.id === activeId 
              ? { ...activity, data_termino: draggedActivityItem.data_termino }
              : activity
          ),
          { revalidate: false }
        )
        
        console.error('Falha ao atualizar prazo no servidor:', updateError)
      } else {
        console.log(`Prazo atualizado com sucesso para atividade "${draggedActivityItem.nome}"`)
        setTimeout(() => mutate(), 100)
      }
    } catch (error) {
      // Reverter em caso de erro de rede
      mutate(
        atividades.map((activity: Atividade) => 
          activity.id === activeId 
            ? { ...activity, data_termino: draggedActivityItem.data_termino }
            : activity
        ),
        { revalidate: false }
      )
      console.error('Erro de rede ao atualizar prazo:', error)
    } finally {
      setUpdatingActivityId(null)
    }
  }

  const handleDragCancel = () => {
    setDraggedActivity(null)
    setIsDragging(false)
  }

  // ✅ CORRIGIDO: Helper para formatar data com hora do meio-dia (evita problema de timezone)
  const formatDateForAPI = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    // Usar meio-dia (12:00) para evitar problemas de fuso horário
    return `${year}-${month}-${day}T12:00:00`
  }

  // Função para calcular nova data baseada na categoria
  const calculateNewDateForCategory = (category: PrazoCategory): string | null => {
    const now = new Date()
    
    switch (category) {
      case 'vencido':
        const yesterday = new Date(now)
        yesterday.setDate(now.getDate() - 1)
        return formatDateForAPI(yesterday)
        
      case 'hoje':
        return formatDateForAPI(now)
        
      case 'proximos-3-dias':
        const in2Days = new Date(now)
        in2Days.setDate(now.getDate() + 2)
        return formatDateForAPI(in2Days)
        
      case 'proxima-semana':
        const in5Days = new Date(now)
        in5Days.setDate(now.getDate() + 5)
        return formatDateForAPI(in5Days)
        
      case 'futuro':
        const in15Days = new Date(now)
        in15Days.setDate(now.getDate() + 15)
        return formatDateForAPI(in15Days)
        
      case 'sem-prazo':
        return null
        
      default:
        return null
    }
  }

  // Agrupar atividades por categoria de prazo
  const groupedActivities = groupActivitiesByDeadline(atividades)

  // Ordenar atividades dentro de cada categoria
  const sortedGroupedActivities = {} as Record<PrazoCategory, Atividade[]>
  
  for (const category of Object.keys(groupedActivities)) {
    const categoryKey = category as PrazoCategory
    sortedGroupedActivities[categoryKey] = sortActivitiesInCategory(
      groupedActivities[categoryKey], 
      categoryKey
    ) as Atividade[]
  }

  const totalActivities = atividades.length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-white" />
          <p className="text-white/70">Carregando atividades...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="p-6 bg-white/5 backdrop-blur-xl border-white/10">
        <div className="text-center">
          <p className="text-red-400 mb-4">Erro: {error}</p>
            <Button onClick={() => mutate()} variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white">
              <RefreshCw className="h-4 w-4 mr-2" />
              Tentar novamente
            </Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Gestão de Atividades</h1>
          <p className="text-sm text-white/60">
            Organize suas atividades por proximidade do prazo e gerencie status
          </p>
          {updateError && (
            <p className="text-xs text-red-400 mt-1">
              Erro ao atualizar: {updateError}
              <button 
                onClick={clearError}
                className="ml-2 text-red-300 hover:text-red-200 underline"
              >
                Dispensar
              </button>
            </p>
          )}
          {createError && (
            <p className="text-xs text-red-400 mt-1">
              Erro ao criar atividade: {createError}
              <button 
                onClick={clearCreateError}
                className="ml-2 text-red-300 hover:text-red-200 underline"
              >
                Dispensar
              </button>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs border-white/30 text-white">
            {totalActivities} atividade(s)
          </Badge>
          {isUpdating && (
            <Badge variant="secondary" className="text-xs animate-pulse bg-white/10 text-white">
              Atualizando...
            </Badge>
          )}
          {isCreatingActivity && (
            <Badge variant="secondary" className="text-xs animate-pulse bg-white/10 text-white">
              Criando...
            </Badge>
          )}
        </div>
      </div>

          {/* Kanban Board */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="overflow-x-auto pb-2 kanban-scroll">
              <div className="grid grid-cols-4 gap-2 min-w-[800px]">
                {Object.entries(PRAZO_CATEGORIES).slice(0, 4).map(([categoryKey, classification]) => {
                  const category = categoryKey as PrazoCategory
                  const categoryActivities = sortedGroupedActivities[category] || []
                  
                  return (
                    <DroppableColumn
                      key={category}
                      id={category}
                      classification={classification}
                      activities={categoryActivities}
                      onQuickAdd={handleQuickAdd}
                      onHover={handleColumnHover}
                      onLeave={handleColumnLeave}
                      isExpanded={hoveredColumn === category}
                    >
                      {categoryActivities.map((activity: Atividade) => (
                        <div key={activity.id} className="activity-card">
                          <DraggableActivityCard
                            activity={activity}
                            onClick={handleActivityClick}
                            isUpdating={updatingActivityId === activity.id}
                          />
                        </div>
                      ))}
                    </DroppableColumn>
                  )
                })}
              </div>
            </div>
            
            {/* Drag Overlay */}
            <DragOverlay>
              {draggedActivity && (
                <div className="activity-card">
                  <ActivityCard
                    activity={draggedActivity}
                    isDragging={true}
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {/* Empty State - Sem botão redundante, texto centralizado */}
          {totalActivities === 0 && (
            <Card className="p-8 bg-white/5 backdrop-blur-xl border-white/10">
              <div className="text-center flex flex-col items-center justify-center">
                <h3 className="text-base font-semibold mb-2 text-white">Nenhuma atividade encontrada</h3>
                <p className="text-sm text-white/60">
                  Comece criando uma nova atividade.
                </p>
              </div>
            </Card>
          )}

      {/* Quick Add Modal */}
      {quickAddCategory && (
        <QuickAddModal
          isOpen={isQuickAddOpen}
          onClose={handleQuickAddClose}
          classification={PRAZO_CATEGORIES[quickAddCategory]}
          onSubmit={handleQuickAddSubmit}
          isLoading={isCreatingActivity}
        />
      )}

        {/* Activity Details Modal - apenas para atividades sem processo */}
        {isDetailsModalOpen && selectedActivity && (
          <TarefaDetailModal
            tarefa={{
              id: selectedActivity.id,
              titulo: selectedActivity.nome,
              descricao: selectedActivity.descricao || undefined,
              concluida: selectedActivity.concluida || false,
              prioridade: selectedActivity.prioridade || 'MEDIA',
              dataPrazo: selectedActivity.data_termino || undefined,
              responsavel: selectedActivity.responsavel?.id ? selectedActivity.responsavel as any : undefined,
              responsavelId: selectedActivity.responsavel?.id,
              createdAt: selectedActivity.data_criacao,
              observacoes: selectedActivity.observacoes || undefined,
              subtarefas: [],
            }}
            onClose={() => setIsDetailsModalOpen(false)}
            onUpdate={() => { mutate(); invalidateActivities() }}
            usuarios={users.map((u: any) => ({ id: u.id, nome: u.nome, email: u.email }))}
          />
        )}
    </div>
  )
}