"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CheckCircle2, Clock, Info, ChevronDown, ChevronUp } from "lucide-react"
import { useActivities, invalidateActivities } from "@/src/hooks/useActivitiesData"
import type { Atividade } from "@/src/hooks/useActivitiesData"

interface CustomStatusManagerProps {
  onStatusCreated?: () => void
}

export default function CustomStatusManager({ onStatusCreated }: CustomStatusManagerProps) {
  const { activities = [], isLoading, mutate } = useActivities()
  const [showPendentes, setShowPendentes] = useState(true)
  const [showConcluidas, setShowConcluidas] = useState(false)

  // Separar tarefas por status
  const tarefasPendentes = activities.filter((a: Atividade) => {
    const statusNome = a.status?.nome?.toLowerCase() || ''
    return statusNome === 'pendente' || (!a.concluida && statusNome !== 'concluída' && statusNome !== 'concluida')
  })

  const tarefasConcluidas = activities.filter((a: Atividade) => {
    const statusNome = a.status?.nome?.toLowerCase() || ''
    return statusNome === 'concluída' || statusNome === 'concluida' || a.concluida === true
  })

  const handleToggleConcluida = async (tarefa: Atividade) => {
    try {
      const response = await fetch(`/api/tarefas/${tarefa.id}/toggle`, {
        method: 'POST',
      })

      if (response.ok) {
        mutate()
        invalidateActivities()
      }
    } catch (error) {
      console.error('Erro ao alternar status:', error)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Sem prazo'
    const date = new Date(dateString)
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  }

  return (
    <div className="space-y-4">

      {/* Cards de Status com contadores */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Status Pendente */}
        <Card 
          className="p-4 bg-yellow-500/10 border-yellow-500/30 cursor-pointer hover:bg-yellow-500/20 transition-colors"
          onClick={() => setShowPendentes(!showPendentes)}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-yellow-500/20">
              <Clock className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-white">Pendente</h4>
              <p className="text-sm text-white/60">
                Tarefas ainda não concluídas
              </p>
            </div>
            <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30 text-lg px-3">
              {tarefasPendentes.length}
            </Badge>
            {showPendentes ? (
              <ChevronUp className="h-5 w-5 text-white/50" />
            ) : (
              <ChevronDown className="h-5 w-5 text-white/50" />
            )}
          </div>
        </Card>

        {/* Status Concluída */}
        <Card 
          className="p-4 bg-green-500/10 border-green-500/30 cursor-pointer hover:bg-green-500/20 transition-colors"
          onClick={() => setShowConcluidas(!showConcluidas)}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-green-500/20">
              <CheckCircle2 className="h-5 w-5 text-green-400" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-white">Concluída</h4>
              <p className="text-sm text-white/60">
                Tarefas marcadas como concluídas
              </p>
            </div>
            <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-lg px-3">
              {tarefasConcluidas.length}
            </Badge>
            {showConcluidas ? (
              <ChevronUp className="h-5 w-5 text-white/50" />
            ) : (
              <ChevronDown className="h-5 w-5 text-white/50" />
            )}
          </div>
        </Card>
      </div>

      {/* Lista de Tarefas Pendentes */}
      {showPendentes && (
        <Card className="p-4 bg-white/5 backdrop-blur-xl border-white/10">
          <h3 className="text-sm font-medium text-yellow-300 mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Tarefas Pendentes ({tarefasPendentes.length})
          </h3>
          
          {tarefasPendentes.length === 0 ? (
            <p className="text-white/50 text-sm text-center py-4">
              Nenhuma tarefa pendente 🎉
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tarefasPendentes.map((tarefa: Atividade) => (
                <div 
                  key={tarefa.id}
                  className="flex items-center gap-3 p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleConcluida(tarefa)
                    }}
                    className="w-5 h-5 rounded border-2 border-yellow-400/50 hover:border-yellow-400 hover:bg-yellow-400/20 transition-colors flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {tarefa.nome}
                    </p>
                    <p className="text-xs text-white/50">
                      Prazo: {formatDate(tarefa.data_termino)}
                    </p>
                  </div>
                  {tarefa.prioridade && (
                    <Badge 
                      variant="outline" 
                      className={`text-xs ${
                        tarefa.prioridade === 'URGENTE' ? 'border-red-400 text-red-400' :
                        tarefa.prioridade === 'ALTA' ? 'border-orange-400 text-orange-400' :
                        tarefa.prioridade === 'MEDIA' ? 'border-yellow-400 text-yellow-400' :
                        'border-green-400 text-green-400'
                      }`}
                    >
                      {tarefa.prioridade}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Lista de Tarefas Concluídas */}
      {showConcluidas && (
        <Card className="p-4 bg-white/5 backdrop-blur-xl border-white/10">
          <h3 className="text-sm font-medium text-green-300 mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Tarefas Concluídas ({tarefasConcluidas.length})
          </h3>
          
          {tarefasConcluidas.length === 0 ? (
            <p className="text-white/50 text-sm text-center py-4">
              Nenhuma tarefa concluída ainda
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tarefasConcluidas.map((tarefa: Atividade) => (
                <div 
                  key={tarefa.id}
                  className="flex items-center gap-3 p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleConcluida(tarefa)
                    }}
                    className="w-5 h-5 rounded border-2 border-green-400 bg-green-400 flex items-center justify-center flex-shrink-0"
                  >
                    <CheckCircle2 className="h-3 w-3 text-white" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white/60 truncate line-through">
                      {tarefa.nome}
                    </p>
                    <p className="text-xs text-white/40">
                      Prazo: {formatDate(tarefa.data_termino)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Como funciona */}
      <Card className="p-4 bg-white/5 backdrop-blur-xl border-white/10">
        <h4 className="font-medium text-white mb-3 flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-400" />
          Como funciona:
        </h4>
        <ul className="text-sm text-white/70 space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-blue-400">•</span>
            Novas tarefas começam automaticamente como <strong className="text-yellow-300">Pendente</strong>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-400">•</span>
            Clique no checkbox da tarefa para marcá-la como <strong className="text-green-300">Concluída</strong>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-400">•</span>
            Tarefas com subtarefas só podem ser concluídas quando todas as subtarefas estiverem concluídas
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-400">•</span>
            Concluir todas as subtarefas automaticamente conclui a tarefa pai
          </li>
        </ul>
      </Card>

      {/* Nota sobre Status de Processos */}
      <Card className="p-4 bg-white/5 backdrop-blur-xl border-white/10">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-white/50 mt-0.5" />
          <div>
            <p className="text-sm text-white/70">
              <strong className="text-white">Nota:</strong> Os status de processos (etapas como "Busca Documental", "Emissão de Documentos", etc.) 
              são gerenciados na página de <strong className="text-white">Processos</strong> e são diferentes dos status de tarefas.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}