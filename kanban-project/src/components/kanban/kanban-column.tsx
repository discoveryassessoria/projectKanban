"use client"

import type React from "react"

import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { useDroppable } from "@dnd-kit/core"
import { Button } from "@/components/ui/button"
import { Plus, MoreVertical, Edit2, Trash2 } from "lucide-react"
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
import type { AtividadeWithStatus, Pais } from "@/src/types/kanban"

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
  pais?: Pais
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
  pais,
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

  return (
    <>
      <div
        ref={setNodeRef}
        className={`flex flex-col min-h-[450px] bg-white/5 backdrop-blur-xl rounded-lg border transition-all ${
          isOver ? "border-blue-400/50 ring-2 ring-blue-400/30 shadow-lg" : "border-white/10"
        }`}
      >
        <div className="p-3 border-b border-white/10 rounded-t-lg bg-gradient-to-r from-indigo-500/80 to-indigo-600/80 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-white">{title}</h3>
              <span className="px-2 py-0.5 text-xs font-medium bg-white/20 text-white rounded-full backdrop-blur-sm">
                {atividades.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsAdding(true)}
                className="h-7 px-2 hover:bg-white/20 text-white"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 hover:bg-white/20 text-white"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-gray-900/95 backdrop-blur-xl border-white/20 text-white">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditedStatusName(title)
                      setIsEditDialogOpen(true)
                    }}
                    className="text-white hover:bg-white/10 cursor-pointer"
                  >
                    <Edit2 className="h-4 w-4 mr-2" />
                    Editar nome
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem
                    onClick={() => setIsDeleteDialogOpen(true)}
                    className="text-red-400 hover:bg-white/10 hover:text-red-300 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Excluir status
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 min-h-[200px] scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
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
                className="mb-2 bg-white/10 border-white/20 text-white placeholder:text-white/60 backdrop-blur-sm"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsAdding(false)}
                  className="hover:bg-white/10 text-white"
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
        <DialogContent className="bg-gray-900/95 backdrop-blur-xl border-white/20 text-white">
          <DialogHeader>
            <DialogTitle>Editar Status</DialogTitle>
            <DialogDescription className="text-white/70">Altere o nome do status</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="status-name">Nome do Status</Label>
              <Input
                id="status-name"
                value={editedStatusName}
                onChange={(e) => setEditedStatusName(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/60 backdrop-blur-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsEditDialogOpen(false)} className="hover:bg-white/10 text-white">
              Cancelar
            </Button>
            <Button onClick={handleEditStatus} className="bg-indigo-600 hover:bg-indigo-700">
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-gray-900/95 backdrop-blur-xl border-white/20 text-white">
          <DialogHeader>
            <DialogTitle>Excluir Status</DialogTitle>
            <DialogDescription className="text-white/70">
              Tem certeza que deseja excluir o status "{title}"? Esta ação não pode ser desfeita.
              {atividades.length > 0 && (
                <span className="block mt-2 text-red-400">
                  Atenção: Este status possui {atividades.length} atividade(s). Elas também serão excluídas.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDeleteDialogOpen(false)} className="hover:bg-white/10 text-white">
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