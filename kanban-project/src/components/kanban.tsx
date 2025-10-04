"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
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
import { Plus, Trash2 } from "lucide-react"
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
  const [isPanning, setIsPanning] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

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

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrollContainerRef.current) return
    // Only start panning if clicking on the container itself, not on interactive elements
    if ((e.target as HTMLElement).closest('button, input, [role="button"]')) return

    setIsPanning(true)
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft)
    setScrollLeft(scrollContainerRef.current.scrollLeft)
    scrollContainerRef.current.style.cursor = "grabbing"
    scrollContainerRef.current.style.userSelect = "none"
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !scrollContainerRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollContainerRef.current.offsetLeft
    const walk = (x - startX) * 1.5 // Multiply by 1.5 for faster scrolling
    scrollContainerRef.current.scrollLeft = scrollLeft - walk
  }

  const handleMouseUp = () => {
    setIsPanning(false)
    if (scrollContainerRef.current) {
      scrollContainerRef.current.style.cursor = "grab"
      scrollContainerRef.current.style.userSelect = "auto"
    }
  }

  const handleMouseLeave = () => {
    if (isPanning) {
      setIsPanning(false)
      if (scrollContainerRef.current) {
        scrollContainerRef.current.style.cursor = "grab"
        scrollContainerRef.current.style.userSelect = "auto"
      }
    }
  }

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

  const handleAtividadeSave = () => {
    // Refresh the project data
    onStatusAdd()
  }

  const handleClearCompleted = async () => {
    const concluidoStatus = projeto.status.find((s) => s.nome.toLowerCase() === "concluído")
    if (!concluidoStatus) return

    const completedAtividades = atividades.filter((a) => a.statusId === concluidoStatus.id)

    if (completedAtividades.length === 0) {
      alert("Não há atividades concluídas para limpar.")
      return
    }

    if (!confirm(`Tem certeza que deseja deletar ${completedAtividades.length} atividade(s) concluída(s)?`)) {
      return
    }

    try {
      // Delete all completed activities
      await Promise.all(
        completedAtividades.map((atividade) =>
          fetch(`/api/atividades/${atividade.id}`, {
            method: "DELETE",
          }),
        ),
      )

      // Update local state
      setAtividades((prev) => prev.filter((a) => a.statusId !== concluidoStatus.id))

      // Refresh project data
      onStatusAdd()
    } catch (error) {
      console.error("Erro ao limpar atividades concluídas:", error)
      alert("Não foi possível limpar as atividades concluídas.")
    }
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={handleClearCompleted}
          className="bg-white border-gray-300 hover:bg-red-50 hover:border-red-300 hover:text-red-600 text-gray-700"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Limpar Concluídas
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        collisionDetection={closestCenter}
      >
        <div
          ref={scrollContainerRef}
          className="overflow-x-auto custom-scrollbar cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          <div className="flex gap-4 pb-4 min-h-[calc(100vh-200px)]">
            {projeto.status
              .sort((a, b) => {
                // Check if either status is "CONCLUÍDO" (case insensitive)
                const aIsConcluido = a.nome.toLowerCase() === "concluído"
                const bIsConcluido = b.nome.toLowerCase() === "concluído"

                // If a is CONCLUÍDO, it should come after b
                if (aIsConcluido) return 1
                // If b is CONCLUÍDO, it should come after a
                if (bIsConcluido) return -1
                // Otherwise, sort by id
                return a.id - b.id
              })
              .map((status, index) => (
                <div className="w-80 flex-shrink-0">
                  <KanbanColumn
                    key={status.id}
                    id={status.id}
                    title={status.nome}
                    atividades={atividades.filter((a) => a.statusId === status.id)}
                    headerColor="#6366f1"
                    isFirst={index === 0}
                    isLast={index === projeto.status.length - 1}
                    onAtividadeAdd={handleAddNewAtividade}
                    onAtividadeClick={handleAtividadeClick}
                    onStatusUpdate={onStatusAdd}
                    projetoId={projeto.id}
                  />
                </div>
              ))}

            <div className="flex-shrink-0 w-80">
              {isAddingStatus ? (
                <div className="p-4 rounded-lg bg-white border border-gray-200">
                  <form onSubmit={handleAddNewStatus}>
                    <Input
                      autoFocus
                      placeholder="Nome da nova coluna..."
                      value={newStatusName}
                      onChange={(e) => setNewStatusName(e.target.value)}
                      className="mb-2 bg-white border-gray-300 text-gray-900"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAddingStatus(false)}
                        className="hover:bg-gray-100"
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
                  className="w-full h-full min-h-[100px] border-2 border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50 text-gray-600 hover:text-gray-700"
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
        onSave={handleAtividadeSave}
      />
    </>
  )
}
