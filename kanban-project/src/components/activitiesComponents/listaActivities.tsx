"use client"

import { useEffect, useState, useMemo } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useActivities, useStatuses, useContratantes, useRequerentes, useProject, invalidateActivities, invalidateProject } from "@/src/hooks/useActivitiesData"
import type { Atividade, Status, Usuario, Projeto } from "@/src/hooks/useActivitiesData"
import { ProcessoDetailsModal } from "@/src/components/kanban/atividade-details-modal"
import type { Contratante, Requerente } from "@/src/types/kanban"

interface UserAtv {
  usuario: Usuario
}

interface ListaActivitiesProps {
  filters?: any
}

export default function ListaActivities({ filters }: ListaActivitiesProps) {
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
  
  // Buscar projeto da atividade selecionada
  const { project: selectedProject, mutate: mutateProject, isLoading: isLoadingProject } = useProject(selectedAtividade?.projeto?.id)

  // Revalidar projeto quando o modal abrir
  useEffect(() => {
    if (isDetailsModalOpen && selectedAtividade?.projeto?.id) {
      mutateProject(undefined, { revalidate: true })
    }
  }, [isDetailsModalOpen, selectedAtividade?.projeto?.id, mutateProject, isLoadingProject])

  // Memoizar contratantes e requerentes selecionados
  const memoizedSelectedContratantes = useMemo(() => {
    const result = selectedProject?.contratante ? [selectedProject.contratante] : []
    return result
  }, [selectedProject?.contratante])

  const memoizedSelectedRequerentes = useMemo(() => {
    const result = selectedProject?.requerentes?.map((r: { requerente: Requerente }) => r.requerente) || []
    return result
  }, [selectedProject?.requerentes])

  // Alias para manter compatibilidade com código existente
  const atividades = activities
  const statusList = statuses

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

  const getStatusBadge = (status: string, dataTermino: string | null) => {
    const prazoFormatado = formatDate(dataTermino)
    
    switch (status.toLowerCase()) {
      case 'concluído':
      case 'concluido':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-200 border-green-200">{prazoFormatado}</Badge>
      case 'em andamento':
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border-yellow-200">{prazoFormatado}</Badge>
      default:
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200">{prazoFormatado}</Badge>
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
          const response = await fetch(`/api/activities/${id}`, { 
            method: 'DELETE' 
          })
          
          if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Erro ${response.status}: ${errorText}`)
          }
          
          const result = await response.json()
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
      const updatePromises = selectedItems.map(id => 
        fetch(`/api/activities/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statusId: parseInt(selectedStatus) })
        })
      )
      
      await Promise.all(updatePromises)
      
      const newStatus = statusList.find((s: Status) => s.id?.toString() === selectedStatus)
      if (newStatus) {
        mutate(
          atividades.map((atividade: Atividade) => 
            selectedItems.includes(atividade.id)
              ? { ...atividade, status: newStatus }
              : atividade
          ),
          { revalidate: false }
        )
        setTimeout(() => mutate(), 100)
      }
      
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
    setSelectedAtividade(atividade)
    setIsDetailsModalOpen(true)
  }

  const handleAtividadeSave = () => {
    mutate()
    setIsDetailsModalOpen(false)
  }

  // Loading state - transparente
  if (isLoading) {
    return (
      <div className="rounded-2xl">
        {/* Table Header Skeleton */}
        <div className="px-4 py-3 border-b border-white/10">
          <div className="grid grid-cols-12 gap-4 items-center">
            <div className="col-span-1 h-4 bg-white/10 rounded animate-pulse"></div>
            <div className="col-span-3 h-4 bg-white/10 rounded animate-pulse"></div>
            <div className="col-span-2 h-4 bg-white/10 rounded animate-pulse"></div>
            <div className="col-span-2 h-4 bg-white/10 rounded animate-pulse"></div>
            <div className="col-span-1 h-4 bg-white/10 rounded animate-pulse"></div>
            <div className="col-span-1 h-4 bg-white/10 rounded animate-pulse"></div>
            <div className="col-span-1 h-4 bg-white/10 rounded animate-pulse"></div>
            <div className="col-span-1 h-4 bg-white/10 rounded animate-pulse"></div>
          </div>
        </div>
        
        {/* Table Body Skeleton */}
        <div className="divide-y divide-white/10">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="px-4 py-3">
              <div className="grid grid-cols-12 gap-4 items-center">
                <div className="col-span-1 h-4 w-4 bg-white/10 rounded animate-pulse"></div>
                <div className="col-span-3 space-y-2">
                  <div className="h-4 bg-white/10 rounded animate-pulse"></div>
                  <div className="h-3 bg-white/10 rounded animate-pulse w-3/4"></div>
                </div>
                <div className="col-span-2 h-4 bg-white/10 rounded animate-pulse"></div>
                <div className="col-span-2 h-4 bg-white/10 rounded animate-pulse"></div>
                <div className="col-span-1 h-6 bg-white/10 rounded-full animate-pulse"></div>
                <div className="col-span-1 h-6 w-6 bg-white/10 rounded-full animate-pulse"></div>
                <div className="col-span-1 h-6 w-6 bg-white/10 rounded-full animate-pulse"></div>
                <div className="col-span-1 h-4 bg-white/10 rounded animate-pulse"></div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Footer Skeleton */}
        <div className="px-4 py-3 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div className="h-4 w-48 bg-white/10 rounded animate-pulse"></div>
            <div className="h-4 w-32 bg-white/10 rounded animate-pulse"></div>
          </div>
        </div>
      </div>
    )
  }

  // Error state - transparente
  if (error) {
    return (
      <div className="rounded-2xl">
        <div className="p-6">
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-red-400">Erro: {error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl">
      {/* Table Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="grid grid-cols-12 gap-4 items-center text-sm font-medium text-white">
          <div className="col-span-1">
            <input
              type="checkbox"
              checked={selectedItems.length === atividades.length && atividades.length > 0}
              onChange={toggleSelectAll}
              className="rounded border-white/30 bg-transparent"
            />
          </div>
          <div className="col-span-3">Nome</div>
          <div className="col-span-2">Data de criação</div>
          <div className="col-span-2">Prazo final</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-1">Criado por</div>
          <div className="col-span-1">Responsável</div>
          <div className="col-span-1">Projeto</div>
        </div>
      </div>

      {/* Table Body */}
      <div className="divide-y divide-white/10">
        {atividades.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-white/60">Nenhuma atividade encontrada</p>
          </div>
        ) : (
          atividades.filter((atividade: Atividade) => atividade && atividade.nome).map((atividade: Atividade) => (
            <div
              key={atividade.id}
              className="px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer"
              onClick={() => handleAtividadeClick(atividade)}
            >
              <div className="grid grid-cols-12 gap-4 items-center text-white">
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={selectedItems.includes(atividade.id)}
                    onChange={() => toggleSelectItem(atividade.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-white/30 bg-transparent"
                  />
                </div>
                
                <div className="col-span-3">
                  <div className="space-y-1">
                    <div className="font-medium text-sm">{atividade.nome}</div>
                    <div className="text-xs text-white/60">
                      {atividade.descricao || 'Sem descrição'}
                    </div>
                  </div>
                </div>
                
                <div className="col-span-2">
                  <div className="text-sm text-white/80">
                    {formatDateOnly(atividade.data_criacao)}
                  </div>
                </div>
                
                <div className="col-span-2">
                  <div className="text-sm text-white/80">
                    {formatDate(atividade.data_termino)}
                  </div>
                </div>
                
                <div className="col-span-1">
                  <Badge 
                    className={
                      atividade.status.nome.toLowerCase() === 'concluído' || atividade.status.nome.toLowerCase() === 'concluido'
                        ? "bg-green-500/20 text-green-300 hover:bg-green-500/30 border-green-500/30"
                        : atividade.status.nome.toLowerCase() === 'em andamento'
                        ? "bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 border-yellow-500/30"
                        : "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border-blue-500/30"
                    }
                  >
                    {atividade.status.nome}
                  </Badge>
                </div>
                
                <div className="col-span-1">
                  <div className="flex items-center">
                    <Avatar className="h-6 w-6 border border-white/20">
                      <AvatarFallback className="text-xs bg-white/10 text-white">
                        {atividade.usuarios[0]?.usuario.nome?.slice(0, 2).toUpperCase() || 'NA'}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </div>
                
                <div className="col-span-1">
                  <div className="flex items-center">
                    <Avatar className="h-6 w-6 border border-white/20">
                      <AvatarFallback className="text-xs bg-white/10 text-white">
                        {atividade.usuarios[0]?.usuario.nome?.slice(0, 2).toUpperCase() || 'NA'}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </div>
                
                <div className="col-span-1">
                  <div className="text-sm font-medium text-white/80">{atividade.projeto.nome}</div>
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
                      {statusList.map((status: Status) => (
                        <SelectItem key={status.id} value={status.id?.toString() || ''}>
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
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20"
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

      <ProcessoDetailsModal
        processo={selectedAtividade as any}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onSave={handleAtividadeSave}
      />
    </div>
  )
}