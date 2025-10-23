"use client"

import { useEffect, useState } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useProjects, invalidateProjects } from "@/src/hooks/useActivitiesData"
import type { Projeto } from "@/src/hooks/useActivitiesData"

interface ListaProjectsProps {
  filters?: any
}

export default function ListaProjects({ filters }: ListaProjectsProps) {
  // Usar hooks de cache para buscar dados
  const { projects = [], isLoading, error, mutate } = useProjects()
  
  const [selectedItems, setSelectedItems] = useState<number[]>([])
  const [selectedAction, setSelectedAction] = useState<string>('')
  const [isActionLoading, setIsActionLoading] = useState(false)

  // Alias para manter compatibilidade com código existente
  const projetos = projects

  const toggleSelectAll = () => {
    if (selectedItems.length === projetos.length) {
      setSelectedItems([])
    } else {
      setSelectedItems(projetos.map(p => p.id).filter((id): id is number => id !== undefined))
    }
  }

  const toggleSelectItem = (id: number | undefined) => {
    if (id === undefined) return
    setSelectedItems(prev => 
      prev.includes(id) 
        ? prev.filter(item => item !== id)
        : [...prev, id]
    )
  }

  const handleBulkDelete = async () => {
    if (selectedItems.length === 0) {
      alert('Nenhum projeto selecionado')
      return
    }
    
    if (!confirm(`Tem certeza que deseja excluir ${selectedItems.length} projeto(s)?`)) {
      return
    }

    setIsActionLoading(true)
    try {
      // Fazer as requisições uma por uma para melhor controle de erro
      const results = []
      for (const id of selectedItems) {
        try {
          console.log('Tentando excluir projeto com ID:', id)
          const response = await fetch(`/api/projetos/${id}`, { 
            method: 'DELETE' 
          })
          
          console.log('Response status:', response.status)
          console.log('Response ok:', response.ok)
          
          if (!response.ok) {
            const errorText = await response.text()
            console.log('Error response:', errorText)
            throw new Error(`Erro ${response.status}: ${errorText}`)
          }
          
          const result = await response.json()
          console.log('Success result:', result)
          results.push({ id, success: true })
        } catch (error) {
          console.error('Error deleting project:', error)
          results.push({ id, success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' })
        }
      }
      
      // Verificar resultados
      const successfulDeletes = results.filter(r => r.success).map(r => r.id)
      const failedDeletes = results.filter(r => !r.success)
      
      if (failedDeletes.length > 0) {
        alert(`Erro ao excluir ${failedDeletes.length} projeto(s).`)
      }
      
      // Atualizar a lista removendo apenas os itens excluídos com sucesso
      if (successfulDeletes.length > 0) {
        // Invalidar cache para forçar recarregamento
        invalidateProjects()
      }
      
      setSelectedItems([])
      setSelectedAction('')
      
      if (successfulDeletes.length === selectedItems.length) {
        alert('Todos os projetos foram excluídos com sucesso!')
      }
    } catch (error) {
      alert('Erro ao excluir projetos: ' + (error instanceof Error ? error.message : 'Erro desconhecido'))
    } finally {
      setIsActionLoading(false)
    }
  }

  const applyAction = () => {
    if (selectedAction === 'delete') {
      handleBulkDelete()
    }
  }

  if (isLoading) {
    return (
      <div className="border rounded-lg">
        <div className="p-6">
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-muted-foreground">Carregando projetos...</p>
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
    <div className="border rounded-lg">
      {/* Table Header */}
      <div className="bg-muted/50 px-4 py-3 border-b">
        <div className="grid grid-cols-12 gap-4 items-center text-sm font-medium">
          <div className="col-span-1">
            <input
              type="checkbox"
              checked={selectedItems.length === projetos.length && projetos.length > 0}
              onChange={toggleSelectAll}
              className="rounded border-gray-300"
            />
          </div>
          <div className="col-span-5">Nome do Projeto</div>
          <div className="col-span-5">Descrição</div>
          <div className="col-span-1">Atividades</div>
        </div>
      </div>

      {/* Table Body */}
      <div className="divide-y">
        {projetos.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-muted-foreground">Nenhum projeto encontrado</p>
          </div>
        ) : (
          projetos.map((projeto) => (
            <div
              key={projeto.id}
              className="px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <div className="grid grid-cols-12 gap-4 items-center">
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={projeto.id ? selectedItems.includes(projeto.id) : false}
                    onChange={() => toggleSelectItem(projeto.id)}
                    className="rounded border-gray-300"
                  />
                </div>
                
                <div className="col-span-5">
                  <div className="space-y-1">
                    <div className="font-medium text-sm">{projeto.nome}</div>
                  </div>
                </div>
                
                <div className="col-span-5">
                  <div className="text-sm text-muted-foreground">
                    {projeto.descricao || 'Sem descrição'}
                  </div>
                </div>
                
                <div className="col-span-1">
                  <Badge variant="secondary" className="text-xs">
                    {projeto._count?.atividades || 0}
                  </Badge>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="bg-muted/30 px-4 py-3 border-t">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center space-x-4">
            <span>Selecionado: {selectedItems.length} / {projetos.length}</span>
            <span>Total mostrando: {projetos.length}</span>
            {selectedItems.length > 0 && (
              <div className="flex items-center space-x-2">
                <Select value={selectedAction} onValueChange={setSelectedAction}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Selecionar ação" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delete">Excluir</SelectItem>
                  </SelectContent>
                </Select>
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={applyAction}
                  disabled={isActionLoading || !selectedAction}
                >
                  {isActionLoading ? 'Aplicando...' : 'Aplicar'}
                </Button>
                
                <label className="flex items-center space-x-2">
                  <input 
                    type="checkbox" 
                    className="rounded" 
                    checked={selectedItems.length === projetos.length && projetos.length > 0}
                    onChange={toggleSelectAll}
                  />
                  <span className="text-xs">Para todos</span>
                </label>
              </div>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <span>Páginas: 1</span>
            <span>Registros: {projetos.length}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
