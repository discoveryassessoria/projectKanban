"use client"

import type React from "react"

import { useState, useEffect } from "react"
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus } from "lucide-react"
import { KanbanColumn } from "./kanban/kanban-column"
import { KanbanCard } from "./kanban/kanban-card"
import { AtividadeDetailsModal } from "./kanban/atividade-details-modal"
import type { Atividade, AtividadeWithStatus, Projeto } from "@/src/types/kanban"

interface Status {
  id: number
  nome: string
}

interface KanbanBoardProps {
  projeto: Projeto
  onStatusAdd: () => void
}

export function KanbanBoard({ projeto, onStatusAdd }: KanbanBoardProps) {
  const [atividades, setAtividades] = useState<Atividade[]>([])
  const [newStatusName, setNewStatusName] = useState("")
  const [isAddingStatus, setIsAddingStatus] = useState(false)
  const [activeAtividade, setActiveAtividade] = useState<Atividade | null>(null)
  const [selectedAtividade, setSelectedAtividade] = useState<AtividadeWithStatus | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3, // Reduced activation distance to 3px for easier dragging
      },
    }),
  )

  useEffect(() => {
    setAtividades(projeto.atividades)
  }, [projeto.atividades])

  const handleAddNewStatus = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newStatusName.trim()) return

    try {
      const response = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: newStatusName, projetoId: projeto.id }),
      })

      if (!response.ok) throw new Error("Falha ao criar novo status")

      setNewStatusName("")
      setIsAddingStatus(false)
      onStatusAdd()
    } catch (error) {
      console.error(error)
      alert("Não foi possível adicionar a coluna.")
    }
  }

  const handleAddNewAtividade = async (nome: string, statusId: number) => {
    try {
      const response = await fetch("/api/atividades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, statusId, projetoId: projeto.id }),
      })

      if (!response.ok) throw new Error("Falha ao criar nova atividade")

      const { atividade } = await response.json()
      setAtividades((prev) => [...prev, atividade])
    } catch (error) {
      console.error(error)
      alert("Não foi possível adicionar a atividade.")
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const atividade = atividades.find((a) => a.id === active.id)
    setActiveAtividade(atividade || null)
  }

  const onDragEnd = (event: DragEndEvent) => {
    setActiveAtividade(null)

    const { active, over } = event
    if (!over) return

    const activeId = active.id
    const overId = over.id

    // Get the container IDs
    const activeContainer = active.data.current?.sortable?.containerId
    const overContainer = over.data.current?.sortable?.containerId || over.id

    // Convert to number (status ID)
    const targetStatusId = Number(overContainer)

    if (isNaN(targetStatusId)) {
      console.error("Invalid drop container id:", overContainer)
      return
    }

    // Find the active activity
    const activeAtividade = atividades.find((a) => a.id === activeId)
    if (!activeAtividade) return

    // If dropping in a different status, update it
    if (activeAtividade.statusId !== targetStatusId) {
      setAtividades((prev) => prev.map((item) => (item.id === activeId ? { ...item, statusId: targetStatusId } : item)))

      // Update in database
      fetch(`/api/atividades/${activeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusId: targetStatusId }),
      }).catch(console.error)
    }
  }

  const handleAtividadeClick = (atividade: Atividade) => {
    const fullAtividade = atividades.find((a) => a.id === atividade.id)
    if (fullAtividade) {
      const atividadeWithStatus: AtividadeWithStatus = {
        ...fullAtividade,
        status: projeto.status.find((s) => s.id === fullAtividade.statusId) || {
          id: fullAtividade.statusId,
          nome: "Desconhecido",
        },
      }
      setSelectedAtividade(atividadeWithStatus)
      setIsDetailsModalOpen(true)
    }
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        collisionDetection={closestCenter}
      >
        <div className="overflow-x-auto custom-scrollbar">
          <div
            className="grid h-full gap-4"
            style={{ gridTemplateColumns: `repeat(${projeto.status.length + 1}, minmax(320px, 1fr))` }}
          >
            {projeto.status
              .sort((a, b) => a.id - b.id)
              .map((status, index) => (
                <KanbanColumn
                  key={status.id}
                  id={status.id}
                  title={status.nome}
                  atividades={atividades.filter((a) => a.statusId === status.id)}
                  headerColor="#18181b"
                  isFirst={index === 0}
                  isLast={index === projeto.status.length - 1}
                  onAtividadeAdd={handleAddNewAtividade}
                  onAtividadeClick={handleAtividadeClick}
                />
              ))}

            <div className="flex-shrink-0">
              {isAddingStatus ? (
                <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-800">
                  <form onSubmit={handleAddNewStatus}>
                    <Input
                      autoFocus
                      placeholder="Nome da nova coluna..."
                      value={newStatusName}
                      onChange={(e) => setNewStatusName(e.target.value)}
                      className="mb-2 bg-zinc-950 border-zinc-800 text-zinc-100"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAddingStatus(false)}
                        className="hover:bg-zinc-800"
                      >
                        Cancelar
                      </Button>
                      <Button type="submit" size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                        Adicionar
                      </Button>
                    </div>
                  </form>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  className="w-full h-full min-h-[100px] border-2 border-dashed border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50 text-zinc-400 hover:text-zinc-300"
                  onClick={() => setIsAddingStatus(true)}
                >
                  <Plus className="mr-2 h-4 w-4" /> Adicionar coluna
                </Button>
              )}
            </div>
          </div>
        </div>

        <DragOverlay>
          {activeAtividade ? (
            <div className="rotate-3 scale-105">
              <KanbanCard {...activeAtividade} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <AtividadeDetailsModal
        atividade={selectedAtividade}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
      />
    </>
  )
}
