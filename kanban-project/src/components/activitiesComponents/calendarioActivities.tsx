"use client"

import { useEffect, useState } from "react"
import Calendar from 'react-calendar'
import 'react-calendar/dist/Calendar.css'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Clock, Calendar as CalendarIcon, User } from "lucide-react"
import { useCalendarData, useDayData } from "@/src/hooks/useActivitiesData"
import { AtividadeDetailsModal } from "@/src/components/kanban/atividade-details-modal"
import type { Atividade } from "@/src/hooks/useActivitiesData"

interface CalendarActivity {
  date: string // YYYY-MM-DD
  type: 'creation' | 'deadline'
  activities: {
    id: number
    nome: string
    projeto: string
    hora: string // HH:MM
    data_completa: string // ISO string completa
    tipo_evento: 'criacao' | 'prazo'
  }[]
}

interface DayActivity {
  id: number
  nome: string
  projeto: string
  hora: string
  data_completa: string
  tipo_evento: 'criacao' | 'prazo'
  descricao: string | null
}

interface DayData {
  date: string
  activities: DayActivity[]
}

export default function CalendarioActivities() {
  const [value, setValue] = useState<Date>(new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  
  // Estados para o modal
  const [modalOpen, setModalOpen] = useState(false)
  
  // Estados para o modal de detalhes da atividade
  const [selectedAtividade, setSelectedAtividade] = useState<Atividade | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  
  // Usar hooks de cache para buscar dados do calendário
  const year = value.getFullYear()
  const month = value.getMonth() + 1
  const { calendarData = [], isLoading, error } = useCalendarData(year, month)
  
  // Buscar dados do dia selecionado apenas quando o modal estiver aberto
  const { dayData, isLoading: isLoadingDay } = useDayData(selectedDate, modalOpen)

  // Handler para clicar em uma atividade e abrir o modal de detalhes
  const handleActivityClick = async (activityId: number) => {
    try {
      // Buscar dados completos da atividade
      const response = await fetch(`/api/activities/${activityId}`)
      if (response.ok) {
        const activity = await response.json()
        setSelectedAtividade(activity)
        setIsDetailsModalOpen(true)
      }
    } catch (error) {
      console.error("Erro ao buscar atividade:", error)
    }
  }

  const handleAtividadeSave = () => {
    // Revalidar dados do calendário após salvar
    setIsDetailsModalOpen(false)
    // O useDayData já vai revalidar automaticamente quando o modal de dia reabrir
  }

  // Função para lidar com clique em um dia
  const handleDayClick = (date: Date) => {
    const dateString = date.toISOString().split('T')[0]
    const activityInfo = getActivityInfo(date)
    
    // Só abrir modal se o dia tem atividades
    if (activityInfo) {
      setSelectedDate(dateString)
      setModalOpen(true)
    }
  }

  // Função para mudar o mês visível no calendário
  const handleActiveStartDateChange = ({ activeStartDate }: { activeStartDate: Date | null }) => {
    if (activeStartDate) {
      setValue(activeStartDate)
    }
  }

  // Função para verificar se uma data tem atividades
  const getActivityInfo = (date: Date) => {
    const dateString = date.toISOString().split('T')[0]
    
    // Verificar se existem atividades nesta data
    const dayActivities = calendarData.filter((activity: any) => activity.date === dateString)
    
    if (dayActivities.length === 0) return null
    
    // Verificar tipos de eventos
    const hasCreation = dayActivities.some((a: any) => a.type === 'creation')
    const hasDeadline = dayActivities.some((a: any) => a.type === 'deadline')
    
    let type: 'creation' | 'deadline' | 'both'
    if (hasCreation && hasDeadline) {
      type = 'both'
    } else if (hasCreation) {
      type = 'creation'
    } else {
      type = 'deadline'
    }

    return { type, activities: dayActivities }
  }

  // Função para customizar o conteúdo dos dias
  const tileContent = ({ date, view }: { date: Date; view: string }) => {
    if (view === 'month') {
      const activityInfo = getActivityInfo(date)
      if (activityInfo) {
        return (
          <div className="flex flex-col items-center">
            <div className={`w-2 h-2 rounded-full mt-1 ${
              activityInfo.type === 'both' ? 'bg-yellow-500' :
              activityInfo.type === 'creation' ? 'bg-green-500' : 
              'bg-red-500'
            }`} />
          </div>
        )
      }
    }
    return null
  }

  // Função para adicionar classes CSS aos dias
  const tileClassName = ({ date, view }: { date: Date; view: string }) => {
    if (view === 'month') {
      const activityInfo = getActivityInfo(date)
      if (activityInfo) {
        return activityInfo.type === 'both' ? 'has-both' :
               activityInfo.type === 'creation' ? 'has-creation' : 
               'has-deadline'
      }
    }
    return null
  }

  if (error) {
    return (
      <div className="border rounded-lg">
        <div className="p-6">
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-destructive">Erro: {error.message || 'Erro desconhecido'}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-medium">Calendário de Atividades</h3>
        <p className="text-sm text-muted-foreground">
          Visualize as datas de criação e prazos das suas atividades. Clique em um dia marcado para ver os detalhes.
        </p>
      </div>

      {/* Legenda */}
      <div className="flex items-center space-x-6 p-4 bg-muted/30 rounded-lg">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span className="text-sm">Data de Criação</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span className="text-sm">Data de Prazo</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
          <span className="text-sm">Ambos</span>
        </div>
      </div>

      {/* Calendário */}
      <div className="border rounded-lg p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-sm text-muted-foreground">Carregando calendário...</p>
          </div>
        ) : (
          <div className="calendar-container">
            <Calendar
              value={value}
              onChange={(value) => {
                if (value instanceof Date) {
                  setValue(value)
                }
              }}
              onClickDay={handleDayClick}
              tileContent={tileContent}
              tileClassName={tileClassName}
              onActiveStartDateChange={handleActiveStartDateChange}
              locale="pt-BR"
              className="react-calendar-custom"
            />
          </div>
        )}
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-2xl font-bold text-green-600">
            {calendarData.filter((a: any) => a.type === 'creation').length}
          </div>
          <div className="text-sm text-muted-foreground">Dias com Criações</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-2xl font-bold text-red-600">
            {calendarData.filter((a: any) => a.type === 'deadline').length}
          </div>
          <div className="text-sm text-muted-foreground">Dias com Prazos</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-600">
            {calendarData.reduce((total: number, activity: any) => total + activity.activities.length, 0)}
          </div>
          <div className="text-sm text-muted-foreground">Total de Atividades</div>
        </div>
      </div>

      {/* Modal do Dia */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <CalendarIcon className="h-5 w-5" />
              <span>
                Atividades de {selectedDate && new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </span>
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {isLoadingDay ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-sm text-muted-foreground">Carregando atividades...</p>
              </div>
            ) : dayData && dayData.activities.length > 0 ? (
              <div className="space-y-3">
                {/* Timeline das atividades */}
                <div className="relative">
                  {/* Linha vertical da timeline */}
                  <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-border"></div>
                  
                  {dayData.activities.map((activity: any, index: number) => (
                    <div 
                      key={`${activity.id}-${activity.tipo_evento}-${index}`} 
                      className="relative flex items-start space-x-4 pb-4 cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => handleActivityClick(activity.id)}
                    >
                      {/* Indicador de tempo */}
                      <div className={`relative z-10 shrink-0 w-16 h-16 rounded-full border-4 border-background flex items-center justify-center text-xs font-bold ${
                        activity.tipo_evento === 'criacao' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                      }`}>
                        <div className="text-center">
                          <div className="text-[10px] opacity-80">
                            {activity.tipo_evento === 'criacao' ? 'CRIADO' : 'PRAZO'}
                          </div>
                          <div className="text-xs font-mono">
                            {activity.hora}
                          </div>
                        </div>
                      </div>
                      
                      {/* Conteúdo da atividade */}
                      <div className="flex-1 min-w-0 bg-muted/30 rounded-lg p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-semibold text-sm">{activity.nome}</h4>
                            <p className="text-xs text-muted-foreground mt-1">
                              Projeto: {activity.projeto}
                            </p>
                            {activity.descricao && (
                              <p className="text-xs text-muted-foreground mt-2">
                                {activity.descricao}
                              </p>
                            )}
                          </div>
                          <Badge 
                            variant={activity.tipo_evento === 'criacao' ? 'default' : 'destructive'}
                            className="ml-2"
                          >
                            {activity.tipo_evento === 'criacao' ? 'Criação' : 'Prazo'}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center space-x-4 mt-3 text-xs text-muted-foreground">
                          <div className="flex items-center space-x-1">
                            <Clock className="h-3 w-3" />
                            <span>{activity.hora}</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <User className="h-3 w-3" />
                            <span>ID: {activity.id}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Resumo do dia */}
                <div className="border-t pt-4">
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="text-lg font-bold text-green-600">
                        {dayData.activities.filter((a: any) => a.tipo_evento === 'criacao').length}
                      </div>
                      <div className="text-xs text-green-600">Criações</div>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <div className="text-lg font-bold text-red-600">
                        {dayData.activities.filter((a: any) => a.tipo_evento === 'prazo').length}
                      </div>
                      <div className="text-xs text-red-600">Prazos</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">Nenhuma atividade encontrada para este dia.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AtividadeDetailsModal
        atividade={selectedAtividade as any}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onSave={handleAtividadeSave}
      />
    </div>
  )
}
