"use client"

import type React from "react"

import { SortableContext } from "@dnd-kit/sortable"
import { useDroppable } from "@dnd-kit/core"
import { Button } from "@/components/ui/button"
import { Plus, MoreVertical } from "lucide-react"
import { useMemo, useState } from "react"
import { KanbanCard } from "./kanban-card"
import { Input } from "@/components/ui/input"
import type { Atividade } from "@/src/types/kanban"

interface KanbanColumnProps {
  id: number
  title: string
  atividades: Atividade[]
  headerColor?: string
  isFirst?: boolean
  isLast?: boolean
  onAtividadeAdd: (nome: string, statusId: number) => void
  onAtividadeClick?: (atividade: Atividade) => void
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
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const [isAdding, setIsAdding] = useState(false)
  const [newAtividadeName, setNewAtividadeName] = useState("")

  const atividadesIds = useMemo(() => atividades.map((a) => a.id), [atividades])

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAtividadeName.trim()) return
    onAtividadeAdd(newAtividadeName, id)
    setNewAtividadeName("")
    setIsAdding(false)
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col h-full bg-zinc-950 rounded-lg border transition-all ${
        isOver ? "border-indigo-500 ring-2 ring-indigo-500/20" : "border-zinc-800"
      }`}
    >
      <div className="p-4 border-b border-zinc-800" style={{ backgroundColor: headerColor }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-zinc-100">{title}</h3>
            <span className="px-2 py-0.5 text-xs font-medium bg-zinc-800 text-zinc-400 rounded-full">
              {atividades.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsAdding(true)}
              className="h-7 px-2 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 min-h-[200px]">
        <SortableContext items={atividadesIds}>
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
              className="mb-2 bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-500"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsAdding(false)}
                className="hover:bg-zinc-800"
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
  )
}
