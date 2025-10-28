"use client"

import { useEffect, useState, useMemo } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useActivities, useStatuses, useContratantes, useRequerentes, useProject, invalidateActivities, invalidateProject } from "@/src/hooks/useActivitiesData"
import type { Atividade, Status, Usuario, Projeto } from "@/src/hooks/useActivitiesData"
import { AtividadeDetailsModal } from "@/src/components/kanban/atividade-details-modal"
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
    console.log('=== useEffect Modal ===')
    console.log('isDetailsModalOpen:', isDetailsModalOpen)
    console.log('selectedAtividade?.projeto?.id:', selectedAtividade?.projeto?.id)
    console.log('selectedProject atual:', selectedProject)
    console.log('isLoadingProject:', isLoadingProject)
    
    if (isDetailsModalOpen && selectedAtividade?.projeto?.id) {
      console.log('Revalidando projeto:', selectedAtividade.projeto.id)
      mutateProject(undefined, { revalidate: true })
    }
  }, [isDetailsModalOpen, selectedAtividade?.projeto?.id, mutateProject, isLoadingProject])

  // Debug: Log do projeto quando ele mudar
  useEffect(() => {
    if (selectedProject) {
      console.log('selectedProject atualizado:', {
        id: selectedProject.id,
        nome: selectedProject.nome,
        contratante: selectedProject.contratante,
        requerentes: selectedProject.requerentes
      })
    }
  }, [selectedProject])

  // Memoizar contratantes e requerentes selecionados
  const memoizedSelectedContratantes = useMemo(() => {
    const result = selectedProject?.contratante ? [selectedProject.contratante] : []
    console.log('=== memoizedSelectedContratantes ===', result)
    return result
  }, [selectedProject?.contratante])

  const memoizedSelectedRequerentes = useMemo(() => {
    const result = selectedProject?.requerentes?.map((r: any) => r.requerente) || []
    console.log('=== memoizedSelectedRequerentes ===', result)
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
      // Tentar diferentes formas de parsing
      let date: Date
      
      if (typeof dateString === 'string') {
        // Se for string ISO (ex: "2025-09-29T21:41:44.893Z")
        date = new Date(dateString)
      } else {
        // Se for outro formato
        date = new Date(String(dateString))
      }
      
      if (isNaN(date.getTime())) {
        return 'Data inválida'
      }
      
      // Usar Intl.DateTimeFormat para melhor compatibilidade
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
      // Fazer as requisições uma por uma para melhor controle de erro
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
      
      // Verificar resultados
      const successfulDeletes = results.filter(r => r.success).map(r => r.id)
      const failedDeletes = results.filter(r => !r.success)
      
      if (failedDeletes.length > 0) {
        alert(`Erro ao excluir ${failedDeletes.length} atividade(s).`)
      }
      
      // Atualizar a lista removendo apenas os itens excluídos com sucesso
      if (successfulDeletes.length > 0) {
        // Usar mutate otimista para atualizar o cache
        mutate(
          atividades.filter((atividade: Atividade) => !successfulDeletes.includes(atividade.id)),
          { revalidate: false }
        )
        // Revalidar no servidor para garantir sincronização
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
      
      // Atualizar a lista localmente usando mutate otimista
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
        // Revalidar no servidor para garantir sincronização
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
    console.log('=== handleAtividadeClick ===')
    console.log('Atividade clicada:', atividade)
    console.log('atividade.projeto:', atividade.projeto)
    console.log('atividade.projeto?.id:', atividade.projeto?.id)
    setSelectedAtividade(atividade)
    setIsDetailsModalOpen(true)
  }

  const handleAtividadeSave = () => {
    // Revalidar dados após salvar
    mutate()
    setIsDetailsModalOpen(false)
  }

  if (isLoading) {
    return (
      <div className="border rounded-lg">
        <div className="p-6">
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-muted-foreground">Carregando atividades...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border rounded-lg">
        <div className="p-6">
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-destructive">Erro: {error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border rounded-lg bg-white shadow-sm">
      {/* Table Header */}
      <div className="bg-gray-50 px-4 py-3 border-b">
        <div className="grid grid-cols-12 gap-4 items-center text-sm font-medium text-gray-700">
          <div className="col-span-1">
            <input
              type="checkbox"
              checked={selectedItems.length === atividades.length && atividades.length > 0}
              onChange={toggleSelectAll}
              className="rounded border-gray-300"
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
      <div className="divide-y">
        {atividades.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-500">Nenhuma atividade encontrada</p>
          </div>
        ) : (
          atividades.filter((atividade: Atividade) => atividade && atividade.nome).map((atividade: Atividade) => (
            <div
              key={atividade.id}
              className="px-4 py-3 hover:bg-gray-50 transition-colors bg-white cursor-pointer"
              onClick={() => handleAtividadeClick(atividade)}
            >
              <div className="grid grid-cols-12 gap-4 items-center text-gray-900">
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={selectedItems.includes(atividade.id)}
                    onChange={() => toggleSelectItem(atividade.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-gray-300"
                  />
                </div>
                
                <div className="col-span-3">
                  <div className="space-y-1">
                    <div className="font-medium text-sm text-gray-900">{atividade.nome}</div>
                    <div className="text-xs text-gray-500">
                      {atividade.descricao || 'Sem descrição'}
                    </div>
                  </div>
                </div>
                
                <div className="col-span-2">
                  <div className="text-sm text-gray-700">
                    {formatDateOnly(atividade.data_criacao)}
                  </div>
                </div>
                
                <div className="col-span-2">
                  <div className="text-sm text-gray-700">
                    {formatDate(atividade.data_termino)}
                  </div>
                </div>
                
                <div className="col-span-1">
                  <Badge 
                    className={
                      atividade.status.nome.toLowerCase() === 'concluído' || atividade.status.nome.toLowerCase() === 'concluido'
                        ? "bg-green-100 text-green-800 hover:bg-green-200 border-green-200"
                        : atividade.status.nome.toLowerCase() === 'em andamento'
                        ? "bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border-yellow-200"
                        : "bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200"
                    }
                  >
                    {atividade.status.nome}
                  </Badge>
                </div>
                
                <div className="col-span-1">
                  <div className="flex items-center">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">
                        {atividade.usuarios[0]?.usuario.nome?.slice(0, 2).toUpperCase() || 'NA'}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </div>
                
                <div className="col-span-1">
                  <div className="flex items-center">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">
                        {atividade.usuarios[0]?.usuario.nome?.slice(0, 2).toUpperCase() || 'NA'}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </div>
                
                <div className="col-span-1">
                  <div className="text-sm font-medium text-gray-900">{atividade.projeto.nome}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="bg-gray-50 px-4 py-3 border-t">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div className="flex items-center space-x-4">
            <span>Selecionado: {selectedItems.length} / {atividades.length}</span>
            <span>Total mostrando: {atividades.length}</span>
            {selectedItems.length > 0 && (
              <div className="flex items-center space-x-2">
                <Select value={selectedAction} onValueChange={setSelectedAction}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Selecionar ação" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delete">Excluir</SelectItem>
                    <SelectItem value="status">Marcar como...</SelectItem>
                  </SelectContent>
                </Select>
                
                {selectedAction === 'status' && (
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
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
                >
                  {isActionLoading ? 'Aplicando...' : 'Aplicar'}
                </Button>
                
                <label className="flex items-center space-x-2">
                  <input 
                    type="checkbox" 
                    className="rounded" 
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

      <AtividadeDetailsModal
        atividade={selectedAtividade as any}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onSave={handleAtividadeSave}
        contratantes={contratantes}
        requerentes={requerentes}
        selectedContratantes={memoizedSelectedContratantes}
        selectedRequerentes={memoizedSelectedRequerentes}
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
