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
  closestCorners,
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
import "@/src/styles/kanban.css"

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



export default function PrazoActivities() {
  const [atividades, setAtividades] = useState<Atividade[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedActivity, setSelectedActivity] = useState<Atividade | null>(null)
  const [activeTab, setActiveTab] = useState("kanban")
  
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
      fetchActivities() // Recarregar atividades após criar
      setIsQuickAddOpen(false)
    },
    onError: (error) => {
      console.error('Erro ao criar atividade:', error)
    }
  })
  
  // Estado para controlar qual atividade está sendo atualizada
  const [updatingActivityId, setUpdatingActivityId] = useState<number | null>(null)

  // Carregar atividades
  useEffect(() => {
    fetchActivities()
  }, [])

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


  const fetchActivities = async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      const response = await fetch('/api/activities')
      if (!response.ok) {
        throw new Error('Erro ao carregar atividades')
      }

      const data = await response.json()
      setAtividades(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setIsLoading(false)
    }
  }

  

  const handleActivityClick = (activity: Atividade) => {
    setSelectedActivity(activity)
    // Aqui você pode implementar um modal ou drawer para mostrar detalhes
    console.log('Activity clicked:', activity)
  }

  const handleRefresh = () => {
    fetchActivities()
  }

  const handleStatusCreated = () => {
    fetchActivities() // Recarregar atividades quando um novo status for criado
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
    
    // Optimistic Update - atualizar UI imediatamente
    setAtividades(prev => prev.map(activity => 
      activity.id === activeId 
        ? { ...activity, data_termino: newDate }
        : activity
    ))

    // Indicar que está atualizando
    setUpdatingActivityId(activeId)

    try {
      // Chamar API para persistir mudança
      const success = await updateDeadline(activeId, newDate)
      
      if (!success) {
        // Reverter mudança em caso de erro
        setAtividades(prev => prev.map(activity => 
          activity.id === activeId 
            ? { ...activity, data_termino: draggedActivity.data_termino }
            : activity
        ))
        
        console.error('Falha ao atualizar prazo no servidor:', updateError)
      } else {
        console.log(`Prazo atualizado com sucesso para atividade "${draggedActivity.nome}"`)
      }
    } catch (error) {
      // Reverter em caso de erro de rede
      setAtividades(prev => prev.map(activity => 
        activity.id === activeId 
          ? { ...activity, data_termino: draggedActivity.data_termino }
          : activity
      ))
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
            collisionDetection={closestCorners}
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
    </div>
  )
}