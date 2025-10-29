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
  type DragOverEvent,
  rectIntersection,
} from "@dnd-kit/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Trash2 } from "lucide-react"
import { KanbanColumn } from "./kanban/kanban-column"
import { KanbanCard } from "./kanban/kanban-card"
import { AtividadeDetailsModal } from "./kanban/atividade-details-modal"
import { ContratanteSelector } from "@/components/ui/contratante-selector"
import { RequerenteSelector } from "@/components/ui/requerente-selector"
import type { Atividade, AtividadeWithStatus, Projeto, Contratante, Requerente } from "@/src/types/kanban"

interface Status {
  id: number
  nome: string
}

interface KanbanBoardProps {
  projeto: Projeto
  onStatusAdd: () => void
  // Props para contratantes e requerentes
  contratantes?: Contratante[]
  requerentes?: Requerente[]
  selectedContratantes?: Contratante[]
  selectedRequerentes?: Requerente[]
  onContratantesChange?: (contratantes: Contratante[]) => void
  onRequerentesChange?: (requerentes: Requerente[]) => void
  onContratanteAdd?: () => void
  onRequerenteAdd?: () => void
  onContratanteView?: (contratante: Contratante) => void
  onRequerenteView?: (requerente: Requerente) => void
}

export function KanbanBoard({ 
  projeto, 
  onStatusAdd,
  contratantes = [],
  requerentes = [],
  selectedContratantes = [],
  selectedRequerentes = [],
  onContratantesChange,
  onRequerentesChange,
  onContratanteAdd,
  onRequerenteAdd,
  onContratanteView,
  onRequerenteView
}: KanbanBoardProps) {
  const [atividades, setAtividades] = useState<AtividadeWithStatus[]>([])
  const [newStatusName, setNewStatusName] = useState("")
  const [isAddingStatus, setIsAddingStatus] = useState(false)
  const [activeAtividade, setActiveAtividade] = useState<AtividadeWithStatus | null>(null)
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
    // Convert Atividade[] to AtividadeWithStatus[] by adding status object
    const atividadesWithStatus: AtividadeWithStatus[] = projeto.atividades.map(atividade => ({
      ...atividade,
      status: projeto.status.find(status => status.id === atividade.statusId) || {
        id: atividade.statusId,
        nome: "Desconhecido"
      }
    }))
    setAtividades(atividadesWithStatus)
  }, [projeto.atividades, projeto.status])

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
      
      // Convert to AtividadeWithStatus
      const atividadeWithStatus: AtividadeWithStatus = {
        ...atividade,
        status: projeto.status.find(status => status.id === statusId) || {
          id: statusId,
          nome: "Desconhecido"
        }
      }
      
      setAtividades((prev) => [...prev, atividadeWithStatus])
    } catch (error) {
      console.error(error)
      alert("Não foi possível adicionar a atividade.")
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const activeId = typeof active.id === 'string' ? parseInt(active.id) : active.id as number
    const atividade = atividades.find((a) => a.id === activeId)
    

    
    setActiveAtividade(atividade || null)
  }

  const onDragEnd = (event: DragEndEvent) => {
    setActiveAtividade(null)

    const { active, over } = event
    if (!over) return

    // Convert IDs to numbers
    const activeId = typeof active.id === 'string' ? parseInt(active.id) : active.id as number
    const overId = typeof over.id === 'string' ? parseInt(over.id) : over.id as number



    // Find the active activity
    const activeAtividade = atividades.find((a) => a.id === activeId)
    if (!activeAtividade) {
      console.error("Active atividade not found:", activeId)
      return
    }

    // Determine the target status ID
    let targetStatusId: number

    // Check if we're dropping directly on a droppable container (column)
    // or if the over element has statusId data
    if (over.data.current?.statusId) {
      targetStatusId = over.data.current.statusId
    } else if (!isNaN(overId)) {
      // Check if this overId belongs to a status (column) or an atividade (card)
      const isColumnDrop = projeto.status.some(status => status.id === overId)
      
      if (isColumnDrop) {
        targetStatusId = overId
      } else {
        // If dropping on another card, find which column it belongs to
        const overAtividade = atividades.find((a) => a.id === overId)
        if (overAtividade) {
          targetStatusId = overAtividade.statusId
        } else {
          console.error("Could not determine target status ID")
          return
        }
      }
    } else {
      console.error("Invalid overId:", overId)
      return
    }



    // If dropping in a different status, update it
    if (activeAtividade.statusId !== targetStatusId) {
      // Find the new status object
      const newStatus = projeto.status.find(status => status.id === targetStatusId)
      
      if (!newStatus) {
        console.error("New status not found:", targetStatusId)
        return
      }

      // Update local state immediately for better UX
      setAtividades((prev) => 
        prev.map((item) => 
          item.id === activeId 
            ? { 
                ...item, 
                statusId: targetStatusId,
                status: { id: newStatus.id, nome: newStatus.nome }
              } 
            : item
        )
      )



      // Update in database
      fetch(`/api/atividades/${activeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusId: targetStatusId }),
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        return response.json()
      })
      .catch(error => {
        console.error("Error updating atividade status:", error)
        // Revert the change if the API call fails - restore original status
        const originalStatus = projeto.status.find(status => status.id === activeAtividade.statusId)
        setAtividades((prev) => 
          prev.map((item) => 
            item.id === activeId 
              ? { 
                  ...item, 
                  statusId: activeAtividade.statusId,
                  status: originalStatus || { id: activeAtividade.statusId, nome: "Desconhecido" }
                }
              : item
          )
        )
        alert("Erro ao mover a atividade. Tente novamente.")
      })
    }
  }

  const handleAtividadeClick = (atividade: AtividadeWithStatus) => {
    setSelectedAtividade(atividade)
    setIsDetailsModalOpen(true)
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
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-medium">Board do Projeto</h3>
          <p className="text-sm text-muted-foreground">
            Arraste e solte as atividades entre as colunas
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClearCompleted}
          className="hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Limpar Concluídas
        </Button>
      </div>

      {/* Seletores de Contratante e Requerente */}
      <div className="mb-6 p-4 rounded-lg border bg-card">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Contratante</label>
            <ContratanteSelector
              contratantes={contratantes}
              selectedContratantes={selectedContratantes}
              onSelectMultiple={onContratantesChange}
              onAdd={onContratanteAdd}
              onView={onContratanteView}
              placeholder="Selecione o(s) contratante(s)"
              mode="checkbox"
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Requerente(s)</label>
            <RequerenteSelector
              requerentes={requerentes}
              selectedRequerentes={selectedRequerentes}
              onSelectMultiple={onRequerentesChange}
              onAdd={onRequerenteAdd}
              onView={onRequerenteView}
              placeholder="Selecione o(s) requerente(s)"
              mode="checkbox"
              className="w-full"
            />
          </div>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        collisionDetection={rectIntersection}
      >
        <div
          ref={scrollContainerRef}
          className="overflow-hidden cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          <div className="flex gap-4 pb-4 min-h-[600px]">
            {projeto.status
              .sort((a, b) => {
                // Check if either status is "CONCLUÍDO" (case insensitive)
                const aIsConcluido = a.nome.toLowerCase() === "concluído"
                const bIsConcluido = b.nome.toLowerCase() === "concluído"

                // If a is CONCLUÍDO, it should come after b
                if (aIsConcluido) return 1
                // If b is CONCLUÍDO, it should come after a
                if (bIsConcluido) return -1
                // Otherwise, sort by ordem
                return (a.ordem ?? 0) - (b.ordem ?? 0)
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
                <div className="p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <form onSubmit={handleAddNewStatus}>
                    <Input
                      autoFocus
                      placeholder="Nome da nova coluna..."
                      value={newStatusName}
                      onChange={(e) => setNewStatusName(e.target.value)}
                      className="mb-2 bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAddingStatus(false)}
                        className="hover:bg-gray-100 dark:hover:bg-gray-700"
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
                  className="w-full h-full min-h-[100px] border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
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
