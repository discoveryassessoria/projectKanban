"use client"

import type React from "react"

import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { useDroppable } from "@dnd-kit/core"
import { Button } from "@/components/ui/button"
import { Plus, MoreVertical, Edit2, Trash2, ArrowUp, ArrowDown } from "lucide-react"
import { useMemo, useState } from "react"
import { KanbanCard } from "./kanban-card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { Atividade, AtividadeWithStatus } from "@/src/types/kanban"

interface KanbanColumnProps {
  id: number
  title: string
  atividades: AtividadeWithStatus[]
  headerColor?: string
  isFirst?: boolean
  isLast?: boolean
  onAtividadeAdd: (nome: string, statusId: number) => void
  onAtividadeClick?: (atividade: AtividadeWithStatus) => void
  onStatusUpdate?: () => void
  projetoId?: number
}

export function KanbanColumn({
  id,
  title,
  atividades,
  headerColor = "#3f3f46",
  isFirst,
  isLast,
  onAtividadeAdd,
  onAtividadeClick,
  onStatusUpdate,
  projetoId,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ 
    id: id,
    data: {
      type: "Column",
      statusId: id,
    },
  })
  const [isAdding, setIsAdding] = useState(false)
  const [newAtividadeName, setNewAtividadeName] = useState("")

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editedStatusName, setEditedStatusName] = useState(title)

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const atividadesIds = useMemo(() => atividades.map((a) => a.id), [atividades])
  
  // Verificar se é a coluna "Concluído" (não pode ser movida)
  const isConcluido = title.toLowerCase() === "concluído"

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAtividadeName.trim()) return
    onAtividadeAdd(newAtividadeName, id)
    setNewAtividadeName("")
    setIsAdding(false)
  }

  const handleEditStatus = async () => {
    if (!editedStatusName.trim()) return

    try {
      const response = await fetch(`/api/status/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: editedStatusName }),
      })

      if (!response.ok) throw new Error("Falha ao atualizar status")

      setIsEditDialogOpen(false)
      onStatusUpdate?.()
    } catch (error) {
      console.error(error)
      alert("Não foi possível atualizar o status.")
    }
  }

  const handleDeleteStatus = async () => {
    try {
      const response = await fetch(`/api/status/${id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Falha ao excluir status")
      }

      setIsDeleteDialogOpen(false)
      onStatusUpdate?.()
    } catch (error: any) {
      console.error(error)
      alert(error.message || "Não foi possível excluir o status.")
    }
  }

  const handleMoveStatus = async (direction: "up" | "down") => {
    try {
      const response = await fetch(`/api/status/${id}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, projetoId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Falha ao mover status")
      }

      onStatusUpdate?.()
    } catch (error) {
      console.error(error)
      alert(error instanceof Error ? error.message : "Não foi possível mover o status.")
    }
  }

  return (
    <>
      <div
        ref={setNodeRef}
        className={`flex flex-col min-h-[500px] bg-white dark:bg-gray-800 rounded-lg border transition-all ${
          isOver ? "border-indigo-500 ring-2 ring-indigo-500/20" : "border-gray-200 dark:border-gray-700"
        }`}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 rounded-t-lg" style={{ backgroundColor: headerColor }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-white">{title}</h3>
              <span className="px-2 py-0.5 text-xs font-medium bg-gray-600 dark:bg-gray-700 text-gray-200 rounded-full">
                {atividades.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsAdding(true)}
                className="h-7 px-2 hover:bg-gray-600 dark:hover:bg-gray-700 text-gray-200 hover:text-white"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 hover:bg-gray-600 dark:hover:bg-gray-700 text-gray-200 hover:text-white"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditedStatusName(title)
                      setIsEditDialogOpen(true)
                    }}
                    className="text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                  >
                    <Edit2 className="h-4 w-4 mr-2" />
                    Editar nome
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700" />
                  <DropdownMenuItem
                    onClick={() => handleMoveStatus("up")}
                    disabled={isFirst || isConcluido}
                    className="text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowUp className="h-4 w-4 mr-2" />
                    Mover para esquerda
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleMoveStatus("down")}
                    disabled={isLast || isConcluido}
                    className="text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowDown className="h-4 w-4 mr-2" />
                    Mover para direita
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700" />
                  <DropdownMenuItem
                    onClick={() => setIsDeleteDialogOpen(true)}
                    className="text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-red-700 dark:hover:text-red-300 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir status
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 min-h-[200px]">
          <SortableContext items={atividadesIds} strategy={verticalListSortingStrategy}>
            {atividades.map((atividade) => (
              <KanbanCard key={atividade.id} {...atividade} onClick={() => onAtividadeClick?.(atividade)} />
            ))}
          </SortableContext>

          {isAdding && (
            <form onSubmit={handleAddSubmit} className="mt-2">
              <Input
                autoFocus
                placeholder="Nome da atividade..."
                value={newAtividadeName}
                onChange={(e) => setNewAtividadeName(e.target.value)}
                className="mb-2 bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsAdding(false)}
                  className="hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Cancelar
                </Button>
                <Button type="submit" size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                  Adicionar
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
          <DialogHeader>
            <DialogTitle>Editar Status</DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-gray-400">Altere o nome do status</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="status-name">Nome do Status</Label>
              <Input
                id="status-name"
                value={editedStatusName}
                onChange={(e) => setEditedStatusName(e.target.value)}
                className="bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsEditDialogOpen(false)} className="hover:bg-gray-100 dark:hover:bg-gray-700">
              Cancelar
            </Button>
            <Button onClick={handleEditStatus} className="bg-indigo-600 hover:bg-indigo-700">
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
          <DialogHeader>
            <DialogTitle>Excluir Status</DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-gray-400">
              Tem certeza que deseja excluir o status "{title}"? Esta ação não pode ser desfeita.
              {atividades.length > 0 && (
                <span className="block mt-2 text-red-600 dark:text-red-400">
                  Atenção: Este status possui {atividades.length} atividade(s). Elas também serão excluídas.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDeleteDialogOpen(false)} className="hover:bg-gray-100 dark:hover:bg-gray-700">
              Cancelar
            </Button>
            <Button onClick={handleDeleteStatus} className="bg-red-600 hover:bg-red-700">
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
