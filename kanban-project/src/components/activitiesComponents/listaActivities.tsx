"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useActivities, useStatuses, useContratantes, useRequerentes, invalidateActivities } from "@/src/hooks/useActivitiesData"
import type { Atividade, Status, Usuario } from "@/src/hooks/useActivitiesData"
import { TarefaDetailsModal } from "@/src/components/activitiesComponents/tarefa-details-modal"

// Mapeamento de países para exibição
const PAIS_LABELS: Record<string, string> = {
  PORTUGAL: 'Portugal',
  ESPANHA: 'Espanha',
  ALEMANHA: 'Alemanha',
  ITALIA: 'Itália'
}

interface UserAtv {
  usuario: Usuario
}

interface ListaActivitiesProps {
  filters?: any
}

export default function ListaActivities({ filters }: ListaActivitiesProps) {
  const router = useRouter()
  
  // Usar hooks de cache para buscar dados
  const { activities = [], isLoading, error, mutate } = useActivities(filters)
  const { statuses = [] } = useStatuses()
  const { contratantes = [] } = useContratantes()
  const { requerentes = [] } = useRequerentes()
  
  const [selectedItems, setSelectedItems] = useState<number[]>([])
  const [selectedAction, setSelectedAction] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<string>('')
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [selectedAtividade, setSelectedAtividade] = useState<Atividade | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)

  // Garantir que atividades é sempre um array
  const atividades = Array.isArray(activities) ? activities : []
  
  // Status para tarefas (Pendente/Concluída)
  const statusTarefas = [
    { id: -2, nome: 'Pendente' },
    { id: -1, nome: 'Concluída' }
  ]

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Sem prazo'
    
    const date = new Date(dateString)
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatDateOnly = (dateString: string | null) => {
    if (!dateString) return 'Data inválida'
    
    try {
      let date: Date
      
      if (typeof dateString === 'string') {
        date = new Date(dateString)
      } else {
        date = new Date(String(dateString))
      }
      
      if (isNaN(date.getTime())) {
        return 'Data inválida'
      }
      
      const formatted = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'America/Sao_Paulo'
      }).format(date)
      
      return formatted
    } catch (error) {
      return 'Data inválida'
    }
  }

  const toggleSelectAll = () => {
    if (selectedItems.length === atividades.length) {
      setSelectedItems([])
    } else {
      setSelectedItems(atividades.map((a: Atividade) => a.id))
    }
  }

  const toggleSelectItem = (id: number) => {
    setSelectedItems(prev => 
      prev.includes(id) 
        ? prev.filter(item => item !== id)
        : [...prev, id]
    )
  }

  const handleBulkDelete = async () => {
    if (selectedItems.length === 0) {
      alert('Nenhuma atividade selecionada')
      return
    }
    
    if (!confirm(`Tem certeza que deseja excluir ${selectedItems.length} atividade(s)?`)) {
      return
    }

    setIsActionLoading(true)
    try {
      const results = []
      for (const id of selectedItems) {
        try {
          const response = await fetch(`/api/tarefas/${id}`, { 
            method: 'DELETE' 
          })
          
          if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Erro ${response.status}: ${errorText}`)
          }
          
          results.push({ id, success: true })
        } catch (error) {
          results.push({ id, success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' })
        }
      }
      
      const successfulDeletes = results.filter(r => r.success).map(r => r.id)
      const failedDeletes = results.filter(r => !r.success)
      
      if (failedDeletes.length > 0) {
        alert(`Erro ao excluir ${failedDeletes.length} atividade(s).`)
      }
      
      if (successfulDeletes.length > 0) {
        mutate(
          atividades.filter((atividade: Atividade) => !successfulDeletes.includes(atividade.id)),
          { revalidate: false }
        )
        setTimeout(() => mutate(), 100)
      }
      
      setSelectedItems([])
      setSelectedAction('')
      
      if (successfulDeletes.length === selectedItems.length) {
        alert('Todas as atividades foram excluídas com sucesso!')
      }
    } catch (error) {
      alert('Erro ao excluir atividades: ' + (error instanceof Error ? error.message : 'Erro desconhecido'))
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleBulkStatusUpdate = async () => {
    if (selectedItems.length === 0 || !selectedStatus) return

    setIsActionLoading(true)
    try {
      // Para tarefas, atualizar o campo concluida
      const concluida = selectedStatus === '-1' // -1 = Concluída
      
      const updatePromises = selectedItems.map(id => 
        fetch(`/api/tarefas/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ concluida })
        })
      )
      
      await Promise.all(updatePromises)
      
      // Revalidar dados
      setTimeout(() => mutate(), 100)
      
      setSelectedItems([])
      setSelectedAction('')
      setSelectedStatus('')
    } catch (error) {
      console.error('Erro ao atualizar status:', error)
      alert('Erro ao atualizar status das atividades')
    } finally {
      setIsActionLoading(false)
    }
  }

  const applyAction = () => {
    if (selectedAction === 'delete') {
      handleBulkDelete()
    } else if (selectedAction === 'status' && selectedStatus) {
      handleBulkStatusUpdate()
    }
  }

  const handleAtividadeClick = (atividade: Atividade) => {
    if (atividade.processo?.id) {
      const pais = atividade.processo.pais || atividade.pais || 'PORTUGAL'
      const tarefaPaiId = atividade.tarefaPai?.id ? `&tarefaPaiId=${atividade.tarefaPai.id}` : ''
      router.push(`/kanban?processoId=${atividade.processo.id}&tab=tarefas&pais=${pais}${tarefaPaiId}`)
    } else {
      setSelectedAtividade(atividade)
      setIsDetailsModalOpen(true)
    }
  }

  const handleAtividadeSave = () => {
    mutate()
    setIsDetailsModalOpen(false)
  }

  // Função para obter cor do status
  const getStatusBadgeClass = (statusNome: string | undefined) => {
    const nome = statusNome?.toLowerCase() || ''
    
    if (nome === 'concluída' || nome === 'concluida' || nome === 'concluído' || nome === 'concluido') {
      return "bg-green-500/20 text-green-300 hover:bg-green-500/30 border-green-500/30"
    }
    if (nome === 'pendente') {
      return "bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 border-yellow-500/30"
    }
    if (nome === 'em andamento') {
      return "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border-blue-500/30"
    }
    return "bg-gray-500/20 text-gray-300 border-gray-500/30"
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
        <div className="px-4 py-3 border-b border-white/10">
          <div className="grid gap-4 items-center" style={{ gridTemplateColumns: '28px repeat(8, 1fr)' }}>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className="h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
          </div>
        </div>
        
        <div className="divide-y divide-white/10">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="px-4 py-3">
              <div className="grid gap-4 items-center" style={{ gridTemplateColumns: '28px repeat(8, 1fr)' }}>
                <div className=" h-4 w-4 bg-white/10 rounded animate-pulse"></div>
                <div className="space-y-2">
                  <div className="h-4 bg-white/10 rounded animate-pulse"></div>
                  <div className="h-3 bg-white/10 rounded animate-pulse w-3/4"></div>
                </div>
                <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
                <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
                <div className=" h-6 bg-white/10 rounded-full animate-pulse"></div>
                <div className=" h-6 w-6 bg-white/10 rounded-full animate-pulse"></div>
                <div className=" h-6 w-6 bg-white/10 rounded-full animate-pulse"></div>
                <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Error state - mostrar mensagem amigável ao invés de erro técnico
  if (error) {
    return (
      <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
        <div className="p-6">
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <div className="w-16 h-16 mb-4 rounded-full bg-white/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-white/70 mb-2">Nenhuma atividade disponível</p>
            <p className="text-sm text-white/50">Crie uma nova atividade para começar</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
      {/* Table Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="grid gap-4 items-center text-sm font-medium text-white/80" style={{ gridTemplateColumns: '28px repeat(8, 1fr)' }}>
          <div className="">
            <input
              type="checkbox"
              checked={selectedItems.length === atividades.length && atividades.length > 0}
              onChange={toggleSelectAll}
              className="rounded border-white/30 bg-transparent"
            />
          </div>
          <div className="">Nome</div>
          <div className="">Processo</div>
          <div className="">Vinculado a</div>
          <div className="">Data de criação</div>
          <div className="">Prazo final</div>
          <div className="">Status</div>
          <div className="">Responsável</div>
          <div className="">País</div>
        </div>
      </div>

      {/* Table Body */}
      <div className="divide-y divide-white/10">
        {atividades.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-white/70 mb-2">Nenhuma atividade encontrada</p>
            <p className="text-sm text-white/50">Crie uma nova atividade clicando no botão acima</p>
          </div>
        ) : (
          atividades.map((atividade: Atividade) => (
            <div
              key={atividade.id}
              className="px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer"
              onClick={() => handleAtividadeClick(atividade)}
            >
              <div className="grid gap-4 items-center text-white/80" style={{ gridTemplateColumns: '28px repeat(8, 1fr)' }}>
                <div className="">
                  <input
                    type="checkbox"
                    checked={selectedItems.includes(atividade.id)}
                    onChange={() => toggleSelectItem(atividade.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-white/30 bg-transparent"
                  />
                </div>
                
                <div className="">
                  <div className="space-y-1">
                    <div className="font-medium text-sm text-white">{atividade.nome || 'Sem título'}</div>
                    <div className="text-xs text-white/50 truncate">
                      {atividade.observacoes || atividade.descricao || ''}
                    </div>
                  </div>
                </div>

                <div className="">
                  <div className="text-sm text-white/70 truncate">
                    {atividade.processo?.nome || '-'}
                  </div>
                </div>

                <div className="">
                  <div className="text-sm text-white/70 truncate">
                    {atividade.tarefaPai?.titulo || '-'}
                  </div>
                </div>
                
                <div className="">
                  <div className="text-sm text-white/70">
                    {formatDateOnly(atividade.data_criacao)}
                  </div>
                </div>
                
                <div className="">
                  <div className="text-sm text-white/70">
                    {formatDate(atividade.data_termino)}
                  </div>
                </div>
                
                <div className="">
                  <Badge className={getStatusBadgeClass(atividade.status?.nome)}>
                    {atividade.status?.nome || 'Sem status'}
                  </Badge>
                </div>
                
                <div className="">
                  <div className="flex items-center">
                    <Avatar className="h-6 w-6 border border-white/20">
                      <AvatarFallback className="text-xs bg-white/10 text-white">
                        {atividade.responsavel?.nome?.slice(0, 2).toUpperCase() || 'NA'}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </div>
                
                <div className="">
                  <div className="text-sm font-medium text-white/70">
                    {PAIS_LABELS[atividade.pais] || atividade.pais || '-'}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/10">
        <div className="flex items-center justify-between text-sm text-white/60">
          <div className="flex items-center space-x-4">
            <span>Selecionado: {selectedItems.length} / {atividades.length}</span>
            <span>Total mostrando: {atividades.length}</span>
            {selectedItems.length > 0 && (
              <div className="flex items-center space-x-2">
                <Select value={selectedAction} onValueChange={setSelectedAction}>
                  <SelectTrigger className="w-40 bg-white/10 border-white/20 text-white">
                    <SelectValue placeholder="Selecionar ação" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a2e] border-white/20 text-white">
                    <SelectItem value="delete">Excluir</SelectItem>
                    <SelectItem value="status">Marcar como...</SelectItem>
                  </SelectContent>
                </Select>
                
                {selectedAction === 'status' && (
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger className="w-32 bg-white/10 border-white/20 text-white">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a2e] border-white/20 text-white">
                      {statusTarefas.map((status) => (
                        <SelectItem key={status.id} value={status.id.toString()}>
                          {status.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={applyAction}
                  disabled={isActionLoading || (!selectedAction || (selectedAction === 'status' && !selectedStatus))}
                  className="bg-white/10 border-white/20 text-white hover:bg-white/10"
                >
                  {isActionLoading ? 'Aplicando...' : 'Aplicar'}
                </Button>
                
                <label className="flex items-center space-x-2">
                  <input 
                    type="checkbox" 
                    className="rounded border-white/30 bg-transparent" 
                    checked={selectedItems.length === atividades.length && atividades.length > 0}
                    onChange={toggleSelectAll}
                  />
                  <span className="text-xs">Para todos</span>
                </label>
              </div>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <span>Páginas: 1</span>
            <span>Registros: {atividades.length}</span>
          </div>
        </div>
      </div>

      {/* ✅ NOVO: Modal específico para tarefas */}
      <TarefaDetailsModal
        tarefa={selectedAtividade as any}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onSave={handleAtividadeSave}
      />
    </div>
  )
}