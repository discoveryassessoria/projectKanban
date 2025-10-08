"use client"

import type React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  KanbanIcon,
  Plus,
  FolderKanban,
  UserIcon,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Trash2,
  CheckCircle2,
  Clock,
} from "lucide-react"
import type { Projeto } from "@/src/types/kanban"

interface MenuLateralProps {
  user: { id: number; nome: string; email: string; tipo: string } | null
  projetos: Projeto[]
  projetoSelecionado: Projeto | null
  onProjetoSelect: (projeto: Projeto) => void
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
  onToggleMinimize,
}: MenuLateralProps) {
  const contarAtividades = (projeto: Projeto) => {
    return {
      total: projeto.atividades.length,
      concluidas: projeto.atividades.filter((a) => {
        const status = projeto.status.find((s) => s.id === a.statusId)
        return status?.nome === "Concluído"
      }).length,
      emAndamento: projeto.atividades.filter((a) => {
        const status = projeto.status.find((s) => s.id === a.statusId)
        return status?.nome === "Em Andamento"
      }).length,
    }
  }

  const handleDeletarProjeto = (e: React.MouseEvent, projetoId: number, projetoNome: string) => {
    e.stopPropagation()

    const confirmDelete = confirm(
      `Tem certeza que deseja deletar o projeto "${projetoNome}"? Esta ação não pode ser desfeita.`,
    )
    if (confirmDelete) {
      onDeletarProjeto(projetoId)
    }
  }

  return (
    <div
      className={`${isMinimized ? "w-16" : "w-80"} border-r border-zinc-800 bg-zinc-900 flex flex-col transition-all duration-300`}
    >
      <div className="p-4 border-b border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950">
        <div className="flex items-center justify-between">
          {!isMinimized && (
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
                <KanbanIcon className="h-5 w-5 text-white" />
              </div>
              <h2 className="font-semibold text-lg text-zinc-100">Projetos</h2>
            </div>
          )}
          {isMinimized && (
            <div className="p-1.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg mx-auto">
              <KanbanIcon className="h-5 w-5 text-white" />
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleMinimize}
            className="p-1 h-8 w-8 hover:bg-zinc-800 text-zinc-400"
          >
            {isMinimized ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
        {user && !isMinimized && (
          <div className="flex items-center gap-2 text-sm text-zinc-400 mt-3 px-2">
            <UserIcon className="h-4 w-4" />
            {user.nome}
          </div>
        )}
        {user && isMinimized && (
          <div className="flex justify-center mt-3" title={user.nome}>
            <UserIcon className="h-4 w-4 text-zinc-400" />
          </div>
        )}
      </div>

      {/* Lista de Projetos */}
      <div className="flex-1 overflow-y-auto p-4">
        {!isMinimized && (
          <>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-zinc-400">{projetos.length} projeto(s)</span>
              <Button size="sm" onClick={onNovoProjeto} className="bg-indigo-600 hover:bg-indigo-700 h-8">
                <Plus className="h-4 w-4 mr-1" />
                Novo
              </Button>
            </div>

            {projetos.length === 0 ? (
              <div className="text-center py-8">
                <div className="inline-flex p-3 bg-zinc-800 rounded-xl mb-3">
                  <FolderKanban className="h-10 w-10 text-zinc-600" />
                </div>
                <p className="text-sm text-zinc-500 mb-4">Nenhum projeto encontrado</p>
                <Button size="sm" onClick={onNovoProjeto} className="bg-indigo-600 hover:bg-indigo-700">
                  <Plus className="h-4 w-4 mr-1" />
                  Criar Projeto
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {projetos.map((projeto) => {
                  const stats = contarAtividades(projeto)
                  const isSelected = projetoSelecionado?.id === projeto.id

                  return (
                    <Card
                      key={projeto.id}
                      className={`cursor-pointer transition-all group relative border ${
                        isSelected
                          ? "ring-2 ring-indigo-500 bg-zinc-800 border-indigo-500"
                          : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850"
                      }`}
                      onClick={() => onProjetoSelect(projeto)}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 h-6 w-6 hover:bg-red-950 hover:text-red-400 text-zinc-500"
                        onClick={(e) => handleDeletarProjeto(e, projeto.id, projeto.nome)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>

                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium pr-6 text-zinc-100">{projeto.nome}</CardTitle>
                        {projeto.descricao && <p className="text-xs text-zinc-500 line-clamp-2">{projeto.descricao}</p>}
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex items-center justify-between text-xs text-zinc-500">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {stats.total} tarefas
                          </div>
                          <div className="flex gap-2">
                            <span className="flex items-center gap-1 bg-amber-950 text-amber-400 px-2 py-1 rounded-md">
                              <Clock className="h-3 w-3" />
                              {stats.emAndamento}
                            </span>
                            <span className="flex items-center gap-1 bg-emerald-950 text-emerald-400 px-2 py-1 rounded-md">
                              <CheckCircle2 className="h-3 w-3" />
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
              <Button size="sm" onClick={onNovoProjeto} className="p-2 bg-indigo-600 hover:bg-indigo-700">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              {projetos.map((projeto) => {
                const isSelected = projetoSelecionado?.id === projeto.id

                return (
                  <div
                    key={projeto.id}
                    className={`w-10 h-10 rounded-lg cursor-pointer transition-all hover:scale-105 flex items-center justify-center ${
                      isSelected
                        ? "bg-indigo-600 text-white shadow-lg"
                        : "bg-zinc-800 border border-zinc-700 text-zinc-400 hover:bg-zinc-750"
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
