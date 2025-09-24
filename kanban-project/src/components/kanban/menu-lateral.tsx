'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { 
  Kanban as KanbanIcon, 
  Plus, 
  FolderKanban,
  User,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Trash2
} from 'lucide-react'

interface ProjetoKanban {
  id: number
  nome: string
  descricao: string | null
  atividades: Array<{
    id: number
    nome: string
    status: {
      nome: string
    }
  }>
}

interface User {
  id: number
  nome: string
  email: string
  tipo: string
}

interface MenuLateralProps {
  user: User | null
  projetos: ProjetoKanban[]
  projetoSelecionado: ProjetoKanban | null
  onProjetoSelect: (projeto: ProjetoKanban) => void
  onNovoProjeto: () => void
  onDeletarProjeto: (projetoId: number) => void
  isMinimized: boolean
  onToggleMinimize: () => void
}

export default function MenuLateral({ 
  user, 
  projetos, 
  projetoSelecionado, 
  onProjetoSelect, 
  onNovoProjeto,
  onDeletarProjeto,
  isMinimized,
  onToggleMinimize
}: MenuLateralProps) {
  
  const contarAtividades = (projeto: ProjetoKanban) => {
    return {
      total: projeto.atividades.length,
      concluidas: projeto.atividades.filter(a => a.status.nome === 'Concluído').length,
      emAndamento: projeto.atividades.filter(a => a.status.nome === 'Em Andamento').length
    }
  }

  const handleDeletarProjeto = (e: React.MouseEvent, projetoId: number, projetoNome: string) => {
    e.stopPropagation() // Impede que o clique no botão delete selecione o projeto
    
    const confirmDelete = confirm(`Tem certeza que deseja deletar o projeto "${projetoNome}"? Esta ação não pode ser desfeita.`)
    if (confirmDelete) {
      onDeletarProjeto(projetoId)
    }
  }

  return (
    <div className={`${isMinimized ? 'w-16' : 'w-80'} border-r bg-gray-50 flex flex-col transition-all duration-300`}>
      {/* Header do Sidebar */}
      <div className="p-4 border-b bg-white">
        <div className="flex items-center justify-between">
          {!isMinimized && (
            <div className="flex items-center gap-2">
              <KanbanIcon className="h-6 w-6 text-blue-600" />
              <h2 className="font-semibold text-lg">Meus Projetos</h2>
            </div>
          )}
          {isMinimized && (
            <KanbanIcon className="h-6 w-6 text-blue-600 mx-auto" />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleMinimize}
            className="p-1 h-8 w-8"
          >
            {isMinimized ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>
        {user && !isMinimized && (
          <div className="flex items-center gap-2 text-sm text-gray-600 mt-3">
            <User className="h-4 w-4" />
            {user.nome}
          </div>
        )}
        {user && isMinimized && (
          <div className="flex justify-center mt-3" title={user.nome}>
            <User className="h-4 w-4 text-gray-600" />
          </div>
        )}
      </div>

      {/* Lista de Projetos */}
      <div className="flex-1 overflow-y-auto p-4">
        {!isMinimized && (
          <>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-gray-600">
                {projetos.length} projeto(s)
              </span>
              <Button size="sm" variant="outline" onClick={onNovoProjeto}>
                <Plus className="h-4 w-4 mr-1" />
                Novo
              </Button>
            </div>

            {projetos.length === 0 ? (
              <div className="text-center py-8">
                <FolderKanban className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500 mb-4">
                  Nenhum projeto encontrado
                </p>
                <Button size="sm" onClick={onNovoProjeto}>
                  <Plus className="h-4 w-4 mr-1" />
                  Criar Primeiro Projeto
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {projetos.map(projeto => {
                  const stats = contarAtividades(projeto)
                  const isSelected = projetoSelecionado?.id === projeto.id
                  
                  return (
                    <Card 
                      key={projeto.id}
                      className={`cursor-pointer transition-all hover:shadow-md group relative ${
                        isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : ''
                      }`}
                      onClick={() => onProjetoSelect(projeto)}
                    >
                      {/* Botão de deletar que aparece no hover */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 h-6 w-6 hover:bg-red-100 hover:text-red-600"
                        onClick={(e) => handleDeletarProjeto(e, projeto.id, projeto.nome)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                      
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium pr-6">
                          {projeto.nome}
                        </CardTitle>
                        {projeto.descricao && (
                          <p className="text-xs text-gray-500 line-clamp-2">
                            {projeto.descricao}
                          </p>
                        )}
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {stats.total} atividades
                          </div>
                          <div className="flex gap-2">
                            <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                              {stats.emAndamento}
                            </span>
                            <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full">
                              {stats.concluidas}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Versão Minimizada */}
        {isMinimized && (
          <div className="space-y-3">
            <div className="flex justify-center">
              <Button size="sm" variant="outline" onClick={onNovoProjeto} className="p-2">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="space-y-2">
              {projetos.map(projeto => {
                const isSelected = projetoSelecionado?.id === projeto.id
                
                return (
                  <div
                    key={projeto.id}
                    className={`w-8 h-8 rounded-lg cursor-pointer transition-all hover:shadow-md flex items-center justify-center ${
                      isSelected ? 'bg-blue-500 text-white' : 'bg-white border'
                    }`}
                    onClick={() => onProjetoSelect(projeto)}
                    title={projeto.nome}
                  >
                    <KanbanIcon className="h-4 w-4" />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}