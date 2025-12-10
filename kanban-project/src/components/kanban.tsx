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
        distance: 3,
      },
    }),
  )

  useEffect(() => {
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
    const walk = (x - startX) * 1.5
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

    const activeId = typeof active.id === 'string' ? parseInt(active.id) : active.id as number
    const overId = typeof over.id === 'string' ? parseInt(over.id) : over.id as number

    const activeAtividade = atividades.find((a) => a.id === activeId)
    if (!activeAtividade) return

    let targetStatusId: number

    if (over.data.current?.statusId) {
      targetStatusId = over.data.current.statusId
    } else if (!isNaN(overId)) {
      const isColumnDrop = projeto.status.some(status => status.id === overId)
      
      if (isColumnDrop) {
        targetStatusId = overId
      } else {
        const overAtividade = atividades.find((a) => a.id === overId)
        if (overAtividade) {
          targetStatusId = overAtividade.statusId
        } else {
          return
        }
      }
    } else {
      return
    }

    if (activeAtividade.statusId !== targetStatusId) {
      const newStatus = projeto.status.find(status => status.id === targetStatusId)
      
      if (!newStatus) return

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
      await Promise.all(
        completedAtividades.map((atividade) =>
          fetch(`/api/atividades/${atividade.id}`, {
            method: "DELETE",
          }),
        ),
      )

      setAtividades((prev) => prev.filter((a) => a.statusId !== concluidoStatus.id))
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
          <h3 className="text-lg font-medium text-white">Board do Projeto</h3>
          <p className="text-sm text-white/70">
            Arraste e solte as atividades entre as colunas
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClearCompleted}
          className="border-red-400/40 text-red-300 bg-red-500/10 hover:bg-red-500/20 backdrop-blur-sm"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Limpar Concluídas
        </Button>
      </div>

      {/* Seletores de Contratante e Requerente */}
      <div className="mb-4 p-3 rounded-lg bg-white/5 border border-white/15 backdrop-blur-xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-white">Contratante</label>
            <ContratanteSelector
              contratantes={contratantes}
              selectedContratantes={selectedContratantes}
              onSelectMultiple={onContratantesChange}
              onAdd={onContratanteAdd}
              onView={onContratanteView}
              onEdit={onContratanteView}
              placeholder="Selecione o(s) contratante(s)"
              mode="checkbox"
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-white">Requerente(s)</label>
            <RequerenteSelector
              requerentes={requerentes}
              selectedRequerentes={selectedRequerentes}
              onSelectMultiple={onRequerentesChange}
              onAdd={onRequerenteAdd}
              onView={onRequerenteView}
              onEdit={onRequerenteView}
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
          className="overflow-x-auto overflow-y-visible cursor-grab active:cursor-grabbing w-full scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="flex gap-2 pb-4 min-h-[450px] w-max">
            {projeto.status
              .sort((a, b) => {
                const aIsConcluido = a.nome.toLowerCase() === "concluído"
                const bIsConcluido = b.nome.toLowerCase() === "concluído"

                if (aIsConcluido) return 1
                if (bIsConcluido) return -1
                return (a.ordem ?? 0) - (b.ordem ?? 0)
              })
              .map((status, index) => (
                <div key={status.id} className="w-56 flex-shrink-0">
                  <KanbanColumn
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

            <div className="flex-shrink-0 w-56">
              {isAddingStatus ? (
                <div className="p-3 rounded-lg bg-white/10 border border-white/20 backdrop-blur-xl">
                  <form onSubmit={handleAddNewStatus}>
                    <Input
                      autoFocus
                      placeholder="Nome da nova coluna..."
                      value={newStatusName}
                      onChange={(e) => setNewStatusName(e.target.value)}
                      className="mb-2 bg-white/10 border-white/20 text-white placeholder:text-white/60 backdrop-blur-sm"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAddingStatus(false)}
                        className="hover:bg-white/10 text-white/80"
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
                  className="w-full h-full min-h-[100px] border-2 border-dashed border-white/30 hover:border-white/50 hover:bg-white/5 text-white/70 hover:text-white backdrop-blur-sm"
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