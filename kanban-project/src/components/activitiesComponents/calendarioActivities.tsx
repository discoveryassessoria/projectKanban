"use client"

import { useEffect, useState } from "react"
import Calendar from 'react-calendar'
import 'react-calendar/dist/Calendar.css'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Clock, Calendar as CalendarIcon, User, RefreshCw } from "lucide-react"
import { useActivities } from "@/src/hooks/useActivitiesData"
import { ProcessoDetailsModal } from "@/src/components/kanban/atividade-details-modal"
import type { Atividade } from "@/src/hooks/useActivitiesData"

interface CalendarActivityItem {
  id: number
  nome: string
  projeto: string
  hora: string
  data_completa: string
  tipo_evento: 'criacao' | 'prazo'
}

interface CalendarActivity {
  date: string
  type: 'creation' | 'deadline'
  activities: CalendarActivityItem[]
}

interface DayActivityItem extends CalendarActivityItem {
  descricao: string | null
}

export default function CalendarioActivities() {
  const [value, setValue] = useState<Date>(new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedAtividade, setSelectedAtividade] = useState<Atividade | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  
  // Usar hook de atividades em vez de API de calendário (que não existe)
  const { activities = [], isLoading, error, mutate } = useActivities()

  // Processar atividades para formato de calendário
  const calendarData = (activities || []).reduce((acc: CalendarActivity[], activity: Atividade) => {
    // Adicionar data de criação
    if (activity.data_criacao) {
      const creationDate = activity.data_criacao.split('T')[0]
      const creationTime = new Date(activity.data_criacao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      
      let existingCreation = acc.find(a => a.date === creationDate && a.type === 'creation')
      if (!existingCreation) {
        existingCreation = { date: creationDate, type: 'creation', activities: [] }
        acc.push(existingCreation)
      }
      existingCreation.activities.push({
        id: activity.id,
        nome: activity.nome,
        projeto: activity.pais || 'Sem país',
        hora: creationTime,
        data_completa: activity.data_criacao,
        tipo_evento: 'criacao'
      })
    }
    
    // Adicionar data de prazo
    if (activity.data_termino) {
      const deadlineDate = activity.data_termino.split('T')[0]
      const deadlineTime = new Date(activity.data_termino).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      
      let existingDeadline = acc.find(a => a.date === deadlineDate && a.type === 'deadline')
      if (!existingDeadline) {
        existingDeadline = { date: deadlineDate, type: 'deadline', activities: [] }
        acc.push(existingDeadline)
      }
      existingDeadline.activities.push({
        id: activity.id,
        nome: activity.nome,
        projeto: activity.pais || 'Sem país',
        hora: deadlineTime,
        data_completa: activity.data_termino,
        tipo_evento: 'prazo'
      })
    }
    
    return acc
  }, [])

  // Handler para clicar em uma atividade
  const handleActivityClick = async (activityId: number) => {
    try {
      const response = await fetch(`/api/tarefas/${activityId}`)
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
    mutate()
    setIsDetailsModalOpen(false)
  }

  // Função para lidar com clique em um dia
  const handleDayClick = (date: Date) => {
    const dateString = date.toISOString().split('T')[0]
    const activityInfo = getActivityInfo(date)
    
    if (activityInfo) {
      setSelectedDate(dateString)
      setModalOpen(true)
    }
  }

  // Função para mudar o mês visível
  const handleActiveStartDateChange = ({ activeStartDate }: { activeStartDate: Date | null }) => {
    if (activeStartDate) {
      setValue(activeStartDate)
    }
  }

  // Função para verificar se uma data tem atividades
  const getActivityInfo = (date: Date) => {
    const dateString = date.toISOString().split('T')[0]
    const dayActivities = calendarData.filter((activity: CalendarActivity) => activity.date === dateString)
    
    if (dayActivities.length === 0) return null
    
    const hasCreation = dayActivities.some((a: CalendarActivity) => a.type === 'creation')
    const hasDeadline = dayActivities.some((a: CalendarActivity) => a.type === 'deadline')
    
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

  // Obter atividades do dia selecionado
  const getDayActivities = (): DayActivityItem[] => {
    if (!selectedDate) return []
    
    const dayData = calendarData.filter((a: CalendarActivity) => a.date === selectedDate)
    const allActivities: DayActivityItem[] = []
    
    dayData.forEach((d: CalendarActivity) => {
      d.activities.forEach((act: CalendarActivityItem) => {
        allActivities.push({
          ...act,
          descricao: activities.find((a: Atividade) => a.id === act.id)?.descricao || null
        })
      })
    })
    
    return allActivities.sort((a: DayActivityItem, b: DayActivityItem) => a.hora.localeCompare(b.hora))
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-white" />
          <p className="text-white/70">Carregando calendário...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-6">
        <div className="flex flex-col items-center justify-center h-32 text-center">
          <div className="w-16 h-16 mb-4 rounded-full bg-white/10 flex items-center justify-center">
            <CalendarIcon className="w-8 h-8 text-white/50" />
          </div>
          <p className="text-white/70 mb-2">Não foi possível carregar o calendário</p>
          <p className="text-sm text-white/50">Tente novamente mais tarde</p>
        </div>
      </div>
    )
  }

  const dayActivities = getDayActivities()

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-medium text-white">Calendário de Atividades</h3>
        <p className="text-sm text-white/60">
          Visualize as datas de criação e prazos das suas atividades. Clique em um dia marcado para ver os detalhes.
        </p>
      </div>

      {/* Legenda */}
      <div className="flex items-center space-x-6 p-4 bg-white/5 backdrop-blur-xl border border-white/10 rounded-lg">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span className="text-sm text-white">Data de Criação</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span className="text-sm text-white">Data de Prazo</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
          <span className="text-sm text-white">Ambos</span>
        </div>
      </div>

      {/* Calendário */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-lg p-6">
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
            className="react-calendar-custom !bg-transparent !border-none"
          />
        </div>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-400">
            {calendarData.filter((a: CalendarActivity) => a.type === 'creation').length}
          </div>
          <div className="text-sm text-white/60">Dias com Criações</div>
        </div>
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-400">
            {calendarData.filter((a: CalendarActivity) => a.type === 'deadline').length}
          </div>
          <div className="text-sm text-white/60">Dias com Prazos</div>
        </div>
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-400">
            {calendarData.reduce((total: number, activity: CalendarActivity) => total + activity.activities.length, 0)}
          </div>
          <div className="text-sm text-white/60">Total de Atividades</div>
        </div>
      </div>

      {/* Modal do Dia */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto bg-white/10 backdrop-blur-xl border-white/20 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2 text-white">
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
            {dayActivities.length > 0 ? (
              <div className="space-y-3">
                {/* Timeline das atividades */}
                <div className="relative">
                  <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-white/20"></div>
                  
                  {dayActivities.map((activity: DayActivityItem, index: number) => (
                    <div 
                      key={`${activity.id}-${activity.tipo_evento}-${index}`} 
                      className="relative flex items-start space-x-4 pb-4 cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => handleActivityClick(activity.id)}
                    >
                      <div className={`relative z-10 shrink-0 w-16 h-16 rounded-full border-4 border-white/10 flex items-center justify-center text-xs font-bold ${
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
                      
                      <div className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-semibold text-sm text-white">{activity.nome}</h4>
                            <p className="text-xs text-white/60 mt-1">
                              País: {activity.projeto}
                            </p>
                            {activity.descricao && (
                              <p className="text-xs text-white/60 mt-2">
                                {activity.descricao}
                              </p>
                            )}
                          </div>
                          <Badge 
                            className={activity.tipo_evento === 'criacao' 
                              ? 'bg-green-500/20 text-green-300 border-green-500/30' 
                              : 'bg-red-500/20 text-red-300 border-red-500/30'
                            }
                          >
                            {activity.tipo_evento === 'criacao' ? 'Criação' : 'Prazo'}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center space-x-4 mt-3 text-xs text-white/50">
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
                <div className="border-t border-white/10 pt-4">
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                      <div className="text-lg font-bold text-green-400">
                        {dayActivities.filter((a: DayActivityItem) => a.tipo_evento === 'criacao').length}
                      </div>
                      <div className="text-xs text-green-400">Criações</div>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                      <div className="text-lg font-bold text-red-400">
                        {dayActivities.filter((a: DayActivityItem) => a.tipo_evento === 'prazo').length}
                      </div>
                      <div className="text-xs text-red-400">Prazos</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-white/60">Nenhuma atividade encontrada para este dia.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ProcessoDetailsModal
        processo={selectedAtividade as any}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onSave={handleAtividadeSave}
      />

      {/* CSS customizado para o calendário */}
      <style jsx global>{`
        .react-calendar-custom {
          background: transparent !important;
          border: none !important;
          font-family: inherit !important;
          width: 100% !important;
        }
        
        .react-calendar-custom .react-calendar__navigation {
          margin-bottom: 1rem;
        }
        
        .react-calendar-custom .react-calendar__navigation button {
          color: white;
          background: transparent;
          font-size: 1rem;
          font-weight: 500;
        }
        
        .react-calendar-custom .react-calendar__navigation button:hover,
        .react-calendar-custom .react-calendar__navigation button:focus {
          background: rgba(255, 255, 255, 0.1);
        }
        
        .react-calendar-custom .react-calendar__navigation button:disabled {
          background: transparent;
          color: rgba(255, 255, 255, 0.3);
        }
        
        .react-calendar-custom .react-calendar__month-view__weekdays {
          text-transform: uppercase;
          font-weight: 500;
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.6);
        }
        
        .react-calendar-custom .react-calendar__month-view__weekdays__weekday {
          padding: 0.5rem;
        }
        
        .react-calendar-custom .react-calendar__month-view__weekdays__weekday abbr {
          text-decoration: none;
        }
        
        .react-calendar-custom .react-calendar__tile {
          color: white;
          background: transparent;
          padding: 0.75rem 0.5rem;
          font-size: 0.875rem;
        }
        
        .react-calendar-custom .react-calendar__tile:hover,
        .react-calendar-custom .react-calendar__tile:focus {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 0.5rem;
        }
        
        .react-calendar-custom .react-calendar__tile--now {
          background: rgba(59, 130, 246, 0.2);
          border-radius: 0.5rem;
        }
        
        .react-calendar-custom .react-calendar__tile--now:hover,
        .react-calendar-custom .react-calendar__tile--now:focus {
          background: rgba(59, 130, 246, 0.3);
        }
        
        .react-calendar-custom .react-calendar__tile--active {
          background: rgba(59, 130, 246, 0.4) !important;
          border-radius: 0.5rem;
        }
        
        .react-calendar-custom .react-calendar__month-view__days__day--neighboringMonth {
          color: rgba(255, 255, 255, 0.3);
        }
        
        .react-calendar-custom .has-creation,
        .react-calendar-custom .has-deadline,
        .react-calendar-custom .has-both {
          position: relative;
        }
      `}</style>
    </div>
  )
}