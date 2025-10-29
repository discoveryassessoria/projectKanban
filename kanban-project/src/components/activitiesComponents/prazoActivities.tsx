"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, RefreshCw } from "lucide-react"
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
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
import StatusCard from "./StatusCard"
import ActivityCard from "./ActivityCard"
import CustomStatusManager from "./CustomStatusManager"
import DraggableActivityCard from "./DraggableActivityCard"
import DroppableColumn from "./DroppableColumn"
import QuickAddModal, { QuickAddFormData } from "./QuickAddModal"
import { useActivityOperations } from "@/src/hooks/useActivityOperations"
import { useQuickAddActivity } from "@/src/hooks/useQuickAddActivity"
import { useActivities, useContratantes, useRequerentes, useProject, invalidateActivities, invalidateProject } from "@/src/hooks/useActivitiesData"
import type { Atividade, Usuario, Projeto, Status } from "@/src/hooks/useActivitiesData"
import { AtividadeDetailsModal } from "@/src/components/kanban/atividade-details-modal"
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
  
  // Buscar projeto da atividade selecionada
  const { project: selectedProject, mutate: mutateProject } = useProject(selectedActivity?.projeto?.id)
  
  // Revalidar projeto quando o modal abrir
  useEffect(() => {
    if (isDetailsModalOpen && selectedActivity?.projeto?.id) {
      console.log('Modal aberto, revalidando projeto:', selectedActivity.projeto.id)
      mutateProject(undefined, { revalidate: true })
    }
  }, [isDetailsModalOpen, selectedActivity?.projeto?.id, mutateProject])
  
  // Filtrar apenas atividades não concluídas
  const atividades = activities.filter(activity => {
    const statusNome = activity.status?.nome?.toLowerCase() || ''
    return statusNome !== 'concluído' && statusNome !== 'concluido'
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
      // Invalidar cache para recarregar atividades
      invalidateActivities()
      setIsQuickAddOpen(false)
    },
    onError: (error) => {
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
    // Revalidar cache após salvar
    mutate()
    setIsDetailsModalOpen(false)
  }

  const handleRefresh = () => {
    // Revalidar cache para recarregar atividades
    mutate()
  }

  const handleStatusCreated = () => {
    // Invalidar cache para recarregar atividades quando um novo status for criado
    invalidateActivities()
  }

  // Handler para Quick Add
  const handleQuickAdd = (category: string) => {
    setQuickAddCategory(category as PrazoCategory)
    setIsQuickAddOpen(true)
  }

  // Handlers para controlar hover global
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
    const activity = atividades.find(a => a.id === Number(active.id))
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
    const draggedActivity = atividades.find(a => a.id === activeId)
    if (!draggedActivity) return

    // Calcular nova data baseada na categoria de destino
    const newDate = calculateNewDateForCategory(overId as PrazoCategory)
    
    // Optimistic Update - atualizar cache imediatamente
    mutate(
      atividades.map(activity => 
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
            {tasks.map((task, index) => (
        <React.Fragment key={task.id}>
          <TaskCard task={task} />
          
          {/* Área de Drop Entre Cards */}
          <div
            data-drop-zone={`${column}-${index}`}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              e.currentTarget.classList.add('h-16', 'bg-primary/10', 'border-primary')
            }}
            onDragLeave={(e) => {
              e.currentTarget.classList.remove('h-16', 'bg-primary/10', 'border-primary')
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              e.currentTarget.classList.remove('h-16', 'bg-primary/10', 'border-primary')
              handleDropBetween(e, column, index)
            }}
            className="h-2 border border-dashed border-transparent rounded transition-all duration-200 cursor-pointer"
          />
        </React.Fragment>
      ))}
      if (!success) {
        // Reverter mudança em caso de erro
        mutate(
          atividades.map(activity => 
            activity.id === activeId 
              ? { ...activity, data_termino: draggedActivity.data_termino }
              : activity
          ),
          { revalidate: false }
        )
        
        console.error('Falha ao atualizar prazo no servidor:', updateError)
      } else {
        console.log(`Prazo atualizado com sucesso para atividade "${draggedActivity.nome}"`)
        // Revalidar no servidor para garantir sincronização
        setTimeout(() => mutate(), 100)
      }
    } catch (error) {
      // Reverter em caso de erro de rede
      mutate(
        atividades.map(activity => 
          activity.id === activeId 
            ? { ...activity, data_termino: draggedActivity.data_termino }
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
        // Um dia atrás
        const yesterday = new Date(now)
        yesterday.setDate(now.getDate() - 1)
        return yesterday.toISOString()
        
      case 'hoje':
        // Hoje
        return now.toISOString()
        
      case 'proximos-3-dias':
        // Em 2 dias (dentro dos próximos 3)
        const in2Days = new Date(now)
        in2Days.setDate(now.getDate() + 2)
        return in2Days.toISOString()
        
      case 'proxima-semana':
        // Em 5 dias (próxima semana)
        const in5Days = new Date(now)
        in5Days.setDate(now.getDate() + 5)
        return in5Days.toISOString()
        
      case 'futuro':
        // Em 15 dias
        const in15Days = new Date(now)
        in15Days.setDate(now.getDate() + 15)
        return in15Days.toISOString()
        
      case 'sem-prazo':
        // Sem prazo
        return null
        
      default:
        return null
    }
  }

  // Agrupar atividades por categoria de prazo
  const groupedActivities = groupActivitiesByDeadline(atividades)

  // Ordenar atividades dentro de cada categoria
  const sortedGroupedActivities = Object.keys(groupedActivities).reduce(
    (acc, category) => {
      const categoryKey = category as PrazoCategory
      acc[categoryKey] = sortActivitiesInCategory(
        groupedActivities[categoryKey], 
        categoryKey
      )
      return acc
    },
    {} as Record<PrazoCategory, Atividade[]>
  )

  const totalActivities = atividades.length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p>Carregando atividades...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <p className="text-destructive mb-4">Erro: {error}</p>
          <Button onClick={handleRefresh} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Tentar novamente
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gestão de Atividades</h1>
          <p className="text-muted-foreground">
            Organize suas atividades por proximidade do prazo e gerencie status
          </p>
          {updateError && (
            <p className="text-sm text-red-600 mt-1">
              Erro ao atualizar: {updateError}
              <button 
                onClick={clearError}
                className="ml-2 text-red-800 hover:text-red-900 underline"
              >
                Dispensar
              </button>
            </p>
          )}
          {createError && (
            <p className="text-sm text-red-600 mt-1">
              Erro ao criar atividade: {createError}
              <button 
                onClick={clearCreateError}
                className="ml-2 text-red-800 hover:text-red-900 underline"
              >
                Dispensar
              </button>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm">
            {totalActivities} atividade(s)
          </Badge>
          {isUpdating && (
            <Badge variant="secondary" className="text-xs animate-pulse">
              Atualizando...
            </Badge>
          )}
          {isCreatingActivity && (
            <Badge variant="secondary" className="text-xs animate-pulse">
              Criando atividade...
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
          <TabsTrigger value="kanban">Kanban por Prazo</TabsTrigger>
          <TabsTrigger value="status">Gerenciar Status</TabsTrigger>
        </TabsList>

        <TabsContent value="kanban" className="space-y-4">
          {/* Kanban Board */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="overflow-x-auto pb-4 kanban-scroll">
              <div className="flex gap-4 min-w-full">
                {Object.entries(PRAZO_CATEGORIES).map(([categoryKey, classification]) => {
                  const category = categoryKey as PrazoCategory
                  const activities = sortedGroupedActivities[category] || []
                  
                  return (
                    <DroppableColumn
                      key={category}
                      id={category}
                      classification={classification}
                      activities={activities}
                      onQuickAdd={handleQuickAdd}
                      onHover={handleColumnHover}
                      onLeave={handleColumnLeave}
                      isExpanded={hoveredColumn === category}
                    >
                      {activities.map((activity) => (
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



          {/* Empty State - sem atividades */}
          {totalActivities === 0 && (
            <Card className="p-12">
              <div className="text-center">
                <h3 className="text-lg font-semibold mb-2">Nenhuma atividade encontrada</h3>
                <p className="text-muted-foreground mb-4">
                  Comece criando uma nova atividade.
                </p>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nova Atividade
                </Button>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="status" className="space-y-4">
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
      <AtividadeDetailsModal
        atividade={selectedActivity as any}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onSave={handleAtividadeSave}
        contratantes={contratantes}
        requerentes={requerentes}
        selectedContratantes={selectedProject?.contratante ? [selectedProject.contratante] : []}
        selectedRequerentes={selectedProject?.requerentes?.map((r: any) => r.requerente) || []}
        onContratantesChange={async (contratantes) => {
          // Atualizar contratante do projeto
          if (selectedProject) {
            try {
              const response = await fetch(`/api/projetos/${selectedProject.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                  contratanteId: contratantes.length > 0 ? contratantes[0].id : null 
                }),
              })
              if (response.ok) {
                // Revalidar dados do projeto
                if (selectedProject?.id) {
                  invalidateProject(selectedProject.id)
                }
                mutate()
              }
            } catch (error) {
              console.error("Erro ao atualizar contratante:", error)
            }
          }
        }}
        onRequerentesChange={async (requerentes) => {
          // Atualizar requerentes do projeto
          if (selectedProject) {
            try {
              const response = await fetch(`/api/projetos/${selectedProject.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                  requerenteIds: requerentes.map(r => r.id)
                }),
              })
              if (response.ok) {
                // Revalidar dados do projeto
                if (selectedProject?.id) {
                  invalidateProject(selectedProject.id)
                }
                mutate()
              }
            } catch (error) {
              console.error("Erro ao atualizar requerentes:", error)
            }
          }
        }}
      />
    </div>
  )
}