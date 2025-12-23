"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import CustomStatusManager from "./CustomStatusManager"
import DraggableActivityCard from "./DraggableActivityCard"
import DroppableColumn from "./DroppableColumn"
import QuickAddModal, { QuickAddFormData } from "./QuickAddModal"
import { useActivityOperations } from "@/src/hooks/useActivityOperations"
import { useQuickAddActivity } from "@/src/hooks/useQuickAddActivity"
import { useActivities, useContratantes, useRequerentes, invalidateActivities } from "@/src/hooks/useActivitiesData"
import type { Atividade, Usuario, Status } from "@/src/hooks/useActivitiesData"
import { ProcessoDetailsModal } from "@/src/components/kanban/atividade-details-modal"
import type { Contratante, Requerente } from "@/src/types/kanban"
import "@/src/styles/kanban.css"

interface UserAtv {
  usuario: Usuario
}

export default function PrazoActivities() {
  // Usar hook de cache para buscar todas as atividades
  const { activities = [], isLoading, error, mutate } = useActivities()
  const { contratantes = [] } = useContratantes()
  const { requerentes = [] } = useRequerentes()
  
  const [selectedActivity, setSelectedActivity] = useState<Atividade | null>(null)
  const [activeTab, setActiveTab] = useState("kanban")
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  
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

  const handleActivityClick = (activity: Atividade) => {
    setSelectedActivity(activity)
    setIsDetailsModalOpen(true)
  }

  const handleAtividadeSave = () => {
    mutate()
    invalidateActivities()
    setIsDetailsModalOpen(false)
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      // Invalida o cache e força revalidação
      invalidateActivities()
      await mutate()
    } catch (error) {
      console.error('Erro ao atualizar:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleStatusCreated = () => {
    invalidateActivities()
    mutate()
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

  // Função para calcular nova data baseada na categoria
  const calculateNewDateForCategory = (category: PrazoCategory): string | null => {
    const now = new Date()
    
    switch (category) {
      case 'vencido':
        const yesterday = new Date(now)
        yesterday.setDate(now.getDate() - 1)
        return yesterday.toISOString()
        
      case 'hoje':
        return now.toISOString()
        
      case 'proximos-3-dias':
        const in2Days = new Date(now)
        in2Days.setDate(now.getDate() + 2)
        return in2Days.toISOString()
        
      case 'proxima-semana':
        const in5Days = new Date(now)
        in5Days.setDate(now.getDate() + 5)
        return in5Days.toISOString()
        
      case 'futuro':
        const in15Days = new Date(now)
        in15Days.setDate(now.getDate() + 15)
        return in15Days.toISOString()
        
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

  if (isLoading && !isRefreshing) {
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
          <Button onClick={handleRefresh} variant="outline" className="bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white">
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
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh} 
            disabled={isRefreshing}
            className="bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white h-8 text-xs"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Atualizando...' : 'Atualizar'}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:w-[300px] bg-transparent border border-white/30 h-9">
          <TabsTrigger value="kanban" className="data-[state=active]:bg-white/20 text-white text-xs">Kanban por Prazo</TabsTrigger>
          <TabsTrigger value="status" className="data-[state=active]:bg-white/20 text-white text-xs">Gerenciar Status</TabsTrigger>
        </TabsList>

        <TabsContent value="kanban" className="space-y-3 mt-3">
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
        </TabsContent>

        <TabsContent value="status" className="space-y-3 mt-3">
          <CustomStatusManager onStatusCreated={handleStatusCreated} />
        </TabsContent>
      </Tabs>

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

      {/* Activity Details Modal */}
      <ProcessoDetailsModal
        processo={selectedActivity as any}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onSave={handleAtividadeSave}
      />
    </div>
  )
}