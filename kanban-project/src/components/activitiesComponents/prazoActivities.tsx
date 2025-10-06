"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, RefreshCw } from "lucide-react"
import { 
  PRAZO_CATEGORIES, 
  groupActivitiesByDeadline, 
  sortActivitiesInCategory,
  PrazoCategory 
} from "@/src/utils/prazoUtils"
import StatusCard from "./StatusCard"
import ActivityCard from "./ActivityCard"
import CustomStatusManager from "./CustomStatusManager"
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

  // Carregar atividades
  useEffect(() => {
    fetchActivities()
  }, [])


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
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm">
            {totalActivities} atividade(s)
          </Badge>
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
          <div className="overflow-x-auto pb-4 kanban-scroll">
            <div className="flex gap-4 min-w-full">
              {Object.entries(PRAZO_CATEGORIES).map(([categoryKey, classification]) => {
                const category = categoryKey as PrazoCategory
                const activities = sortedGroupedActivities[category] || []
                
                return (
                  <div key={category} className="kanban-column">
                    <StatusCard
                      classification={classification}
                      activities={activities}
                      canManage={false} // Por enquanto não permite gerenciar essas categorias fixas
                    >
                      {activities.map((activity) => (
                        <div key={activity.id} className="activity-card">
                          <ActivityCard
                            activity={activity}
                            onClick={handleActivityClick}
                          />
                        </div>
                      ))}
                    </StatusCard>
                  </div>
                )
              })}
            </div>
          </div>



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
    </div>
  )
}