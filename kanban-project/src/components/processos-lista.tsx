"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Search, 
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Eye,
  Users,
  CheckSquare
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ProcessoWithStatus, Status, Contratante } from "@/src/types/kanban"

interface ProcessosListaProps {
  processos: ProcessoWithStatus[]
  statusList: Status[]
  contratantes: Contratante[]
  onRefresh: () => void
}

export function ProcessosLista({ 
  processos, 
  statusList, 
  contratantes,
  onRefresh 
}: ProcessosListaProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Filtrar processos
  const filteredProcessos = processos.filter(p => 
    p.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.descricao?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.contratante?.nome.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Paginação
  const totalPages = Math.ceil(filteredProcessos.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedProcessos = filteredProcessos.slice(startIndex, startIndex + itemsPerPage)

  // Função para obter nome do status
  const getStatusNome = (statusId: number) => {
    return statusList.find(s => s.id === statusId)?.nome || "Desconhecido"
  }

  // Função para obter cor do status (baseado na posição)
  const getStatusColor = (statusId: number) => {
    const index = statusList.findIndex(s => s.id === statusId)
    const colors = [
      "bg-blue-500",
      "bg-yellow-500", 
      "bg-orange-500",
      "bg-purple-500",
      "bg-pink-500",
      "bg-green-500"
    ]
    return colors[index % colors.length]
  }

  // Calcular progresso baseado na posição do status
  const getProgress = (statusId: number) => {
    const index = statusList.findIndex(s => s.id === statusId)
    if (index === -1) return 0
    return Math.round(((index + 1) / statusList.length) * 100)
  }

  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir este processo?")) return

    try {
      const response = await fetch(`/api/processos/${id}`, {
        method: "DELETE"
      })

      if (!response.ok) throw new Error("Erro ao excluir processo")
      onRefresh()
    } catch (error) {
      console.error(error)
      alert("Erro ao excluir processo")
    }
  }

  return (
    <div className="space-y-4">
      {/* Header com busca */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <Input
            placeholder="Buscar processo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-white/40"
          />
        </div>
        <div className="text-sm text-white/60">
          {filteredProcessos.length} processo(s) encontrado(s)
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Processo</th>
              <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Fase</th>
              <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Contratante</th>
              <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Requerentes</th>
              <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Tarefas</th>
              <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Criado</th>
              <th className="text-right py-3 px-4 text-white/60 font-medium text-sm">Ações</th>
            </tr>
          </thead>
          <tbody>
            {paginatedProcessos.map((processo) => {
              const tarefasCount = processo._count?.tarefas ?? processo.tarefas?.length ?? 0
              const tarefasConcluidas = processo.tarefas?.filter(t => t.concluida)?.length ?? 0
              const requerentesCount = processo.requerentes?.length ?? 0

              return (
                <tr 
                  key={processo.id} 
                  className="border-b border-white/10 hover:bg-white/5 transition-colors"
                >
                  <td className="py-3 px-4">
                    <div>
                      <span className="text-white font-medium">{processo.nome}</span>
                      {processo.descricao && (
                        <p className="text-white/50 text-sm truncate max-w-[200px]">
                          {processo.descricao}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${getStatusColor(processo.statusId)}`} />
                        <span className="text-white/80 text-sm">{getStatusNome(processo.statusId)}</span>
                      </div>
                      {/* Barra de progresso */}
                      <div className="w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${getStatusColor(processo.statusId)} transition-all duration-300`}
                          style={{ width: `${getProgress(processo.statusId)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {processo.contratante ? (
                      <span className="text-indigo-400 hover:underline cursor-pointer">
                        {processo.contratante.nome}
                      </span>
                    ) : (
                      <span className="text-white/40">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {requerentesCount > 0 ? (
                      <span className="flex items-center gap-1 text-purple-400">
                        <Users className="h-3 w-3" />
                        {requerentesCount}
                      </span>
                    ) : (
                      <span className="text-white/40">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {tarefasCount > 0 ? (
                      <span className="flex items-center gap-1 text-blue-400">
                        <CheckSquare className="h-3 w-3" />
                        {tarefasConcluidas}/{tarefasCount}
                      </span>
                    ) : (
                      <span className="text-white/40">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-white/60 text-sm">
                    {processo.createdAt 
                      ? new Date(processo.createdAt).toLocaleDateString('pt-BR')
                      : '-'
                    }
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-white/60 hover:text-white hover:bg-white/10"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-gray-900 border-white/20">
                          <DropdownMenuItem 
                            className="text-white hover:bg-white/10 cursor-pointer"
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            Ver detalhes
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            className="text-white hover:bg-white/10 cursor-pointer"
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDelete(processo.id)}
                            className="text-red-400 hover:bg-red-500/20 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              )
            })}

            {/* Mensagem quando não há resultados */}
            {paginatedProcessos.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-white/40">
                  {searchTerm ? "Nenhum processo encontrado" : "Nenhum processo cadastrado"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-white/10">
          <span className="text-sm text-white/60">
            Mostrando {startIndex + 1} a {Math.min(startIndex + itemsPerPage, filteredProcessos.length)} de {filteredProcessos.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-white/60">
              Página {currentPage} de {totalPages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}