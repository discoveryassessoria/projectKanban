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
import type { ProcessoWithStatus, Pais } from "@/src/types/kanban"

interface KanbanColumnProps {
  id: number
  title: string
  processos: ProcessoWithStatus[]
  headerColor?: string
  isFirst?: boolean
  isLast?: boolean
  onProcessoAdd: (nome: string, statusId: number) => void
  onProcessoClick?: (processo: ProcessoWithStatus) => void
  onStatusUpdate?: () => void
  pais?: Pais
}

export function KanbanColumn({
  id,
  title,
  processos,
  headerColor = "#3f3f46",
  isFirst,
  isLast,
  onProcessoAdd,
  onProcessoClick,
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
  const [newProcessoName, setNewProcessoName] = useState("")

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editedStatusName, setEditedStatusName] = useState(title)

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const processosIds = useMemo(() => processos.map((p) => p.id), [processos])
  
  const isConcluido = title.toLowerCase() === "concluído"

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProcessoName.trim()) return
    onProcessoAdd(newProcessoName, id)
    setNewProcessoName("")
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
        className={`
          flex flex-col min-h-[450px] flex-1 min-w-[200px]
          ${!isLast ? 'border-r-2 border-dashed border-white/20' : ''}
          ${isOver ? 'bg-blue-500/10' : 'bg-transparent'}
          transition-colors duration-200
        `}
      >
        {/* Header compacto estilo Bitrix */}
        <div 
          className="px-2 py-2 border-b border-white/10"
          style={{ backgroundColor: `${headerColor}40` }}
        >
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
              <h3 className="font-medium text-xs text-white whitespace-nowrap overflow-hidden text-ellipsis">{title}</h3>
              <span className="text-xs text-white/70 flex-shrink-0">
                ({processos.length})
              </span>
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsAdding(true)}
                className="h-5 w-5 p-0 hover:bg-white/20 text-white/50 hover:text-white"
              >
                <Plus className="h-3 w-3" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 hover:bg-white/20 text-white/50 hover:text-white"
                  >
                    <MoreVertical className="h-3 w-3" />
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

        {/* Área de cards */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[200px] scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          <SortableContext items={processosIds} strategy={verticalListSortingStrategy}>
            {processos.map((processo) => (
              <KanbanCard 
                key={processo.id} 
                processo={processo} 
                onClick={() => onProcessoClick?.(processo)} 
              />
            ))}
          </SortableContext>

          {isAdding && (
            <form onSubmit={handleAddSubmit} className="mt-2 p-2 bg-white/5 rounded-lg">
              <Input
                autoFocus
                placeholder="Nome do processo..."
                value={newProcessoName}
                onChange={(e) => setNewProcessoName(e.target.value)}
                className="mb-2 bg-white/10 border-white/20 text-white placeholder:text-white/60 backdrop-blur-sm text-sm h-8"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsAdding(false)}
                  className="h-7 px-2 hover:bg-white/10 text-white text-xs"
                >
                  Cancelar
                </Button>
                <Button type="submit" size="sm" className="h-7 px-2 bg-indigo-600 hover:bg-indigo-700 text-xs">
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
              {processos.length > 0 && (
                <span className="block mt-2 text-red-400">
                  Atenção: Este status possui {processos.length} processo(s). Eles também serão excluídos.
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