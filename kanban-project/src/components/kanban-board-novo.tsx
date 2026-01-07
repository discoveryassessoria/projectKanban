// ESTE ARQUIVO VAI EM: src/components/kanban-board.tsx

"use client"

import type React from "react"
import { useState, useRef, useEffect, useMemo } from "react"
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core"
import { snapCenterToCursor } from "@dnd-kit/modifiers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Trash2 } from "lucide-react"
import { KanbanColumn } from "./kanban/kanban-column"
import { KanbanCard } from "./kanban/kanban-card"
import { ProcessoDetailsModal } from "./kanban/atividade-details-modal"
import { 
  Pais, 
  PAISES_CONFIG,
  type ProcessoWithStatus, 
  type Status,
  type Contratante, 
  type Requerente 
} from "@/src/types/kanban"

interface KanbanBoardProps {
  pais: Pais
  processos: ProcessoWithStatus[]
  statusList: Status[]
  contratantes?: Contratante[]
  requerentes?: Requerente[]
  onRefresh: () => void
  initialProcessoId?: number | null
  initialTab?: string | null
  initialPessoaId?: number | null
  initialSidebarTab?: string | null
  onModalOpened?: () => void
}

// ✅ Helper para extrair ID numérico de IDs prefixados
const extractId = (id: string | number): number => {
  if (typeof id === 'number') return id
  // Remove prefixos "card-" ou "column-"
  const match = id.match(/\d+$/)
  return match ? parseInt(match[0]) : 0
}

// ✅ Helper para verificar se é um card
const isCardId = (id: string | number): boolean => {
  return typeof id === 'string' && id.startsWith('card-')
}

// ✅ Helper para verificar se é uma coluna
const isColumnId = (id: string | number): boolean => {
  return typeof id === 'string' && id.startsWith('column-')
}

export function KanbanBoard({ 
  pais,
  processos: processosFromProps,
  statusList,
  contratantes = [],
  requerentes = [],
  onRefresh,
  initialProcessoId = null,
  initialTab = null,
  initialPessoaId = null,
  initialSidebarTab = null,
  onModalOpened,
}: KanbanBoardProps) {
  const [localProcessos, setLocalProcessos] = useState<ProcessoWithStatus[]>(processosFromProps)
  
  useEffect(() => {
    setLocalProcessos(processosFromProps)
  }, [processosFromProps])

  const [newStatusName, setNewStatusName] = useState("")
  const [isAddingStatus, setIsAddingStatus] = useState(false)
  const [activeProcesso, setActiveProcesso] = useState<ProcessoWithStatus | null>(null)
  const [selectedProcesso, setSelectedProcesso] = useState<ProcessoWithStatus | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  const [modalInitialTab, setModalInitialTab] = useState<string | undefined>(undefined)
  const [modalInitialPessoaId, setModalInitialPessoaId] = useState<number | undefined>(undefined)
  const [modalInitialSidebarTab, setModalInitialSidebarTab] = useState<string | undefined>(undefined)
  
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [initialParamsProcessed, setInitialParamsProcessed] = useState(false)

  const paisConfig = PAISES_CONFIG[pais]

  // Sensores
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  })
  
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 150, tolerance: 5 },
  })

  const sensors = useSensors(pointerSensor, touchSensor)

  // Efeito para abrir modal automaticamente
  useEffect(() => {
    if (initialProcessoId && localProcessos.length > 0 && !initialParamsProcessed) {
      const processo = localProcessos.find(p => p.id === initialProcessoId)
      if (processo) {
        setSelectedProcesso(processo)
        setModalInitialTab(initialTab || undefined)
        setModalInitialPessoaId(initialPessoaId || undefined)
        setModalInitialSidebarTab(initialSidebarTab || undefined)
        setIsDetailsModalOpen(true)
        setInitialParamsProcessed(true)
        onModalOpened?.()
      }
    }
  }, [initialProcessoId, initialTab, initialPessoaId, initialSidebarTab, localProcessos, initialParamsProcessed, onModalOpened])

  // Ordenar status
  const sortedStatusList = useMemo(() => {
    return [...statusList].sort((a, b) => {
      const aIsConcluido = a.nome.toLowerCase() === "concluído"
      const bIsConcluido = b.nome.toLowerCase() === "concluído"
      if (aIsConcluido) return 1
      if (bIsConcluido) return -1
      return (a.ordem ?? 0) - (b.ordem ?? 0)
    })
  }, [statusList])

  // Handlers
  const handleAddNewStatus = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newStatusName.trim()) return

    try {
      const response = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: newStatusName, pais }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Falha ao criar novo status")
      }

      setNewStatusName("")
      setIsAddingStatus(false)
      onRefresh()
    } catch (error: any) {
      console.error(error)
      alert(error.message || "Não foi possível adicionar a coluna.")
    }
  }

  const handleAddNewProcesso = async (nome: string, statusId: number) => {
    try {
      const response = await fetch("/api/processos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, statusId, pais }),
      })

      if (!response.ok) throw new Error("Falha ao criar novo processo")
      onRefresh()
    } catch (error) {
      console.error(error)
      alert("Não foi possível adicionar o processo.")
    }
  }

  const handleProcessoClick = (processo: ProcessoWithStatus) => {
    setSelectedProcesso(processo)
    setModalInitialTab(undefined)
    setModalInitialPessoaId(undefined)
    setModalInitialSidebarTab(undefined)
    setIsDetailsModalOpen(true)
  }

  const handleProcessoSave = () => onRefresh()

  const handleModalClose = () => {
    setIsDetailsModalOpen(false)
    setModalInitialTab(undefined)
    setModalInitialPessoaId(undefined)
    setModalInitialSidebarTab(undefined)
  }

  // ✅ CORREÇÃO: Drag handlers atualizados para IDs prefixados
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    // Extrair ID numérico do processo
    const activeId = extractId(active.id)
    const processo = localProcessos.find((p) => p.id === activeId)
    setActiveProcesso(processo || null)
    setIsDragging(true)
  }

  // Drag handlers não precisam mais de auto-scroll com scroll nativo
  const handleDragMove = () => {
    // Scroll nativo do browser vai funcionar automaticamente
  }

  // ✅ CORREÇÃO: handleDragEnd atualizado para IDs prefixados
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    
    setActiveProcesso(null)
    setIsDragging(false)
    
    if (!over) return

    // Extrair ID numérico do card arrastado
    const activeId = extractId(active.id)
    
    const processo = localProcessos.find((p) => p.id === activeId)
    if (!processo) return

    let targetStatusId: number | null = null

    // Primeiro, tentar pegar do data (mais confiável)
    if (over.data.current?.statusId) {
      targetStatusId = over.data.current.statusId
    } 
    // Se soltou sobre uma coluna
    else if (isColumnId(over.id)) {
      targetStatusId = extractId(over.id)
    }
    // Se soltou sobre outro card
    else if (isCardId(over.id)) {
      const overProcessoId = extractId(over.id)
      const overProcesso = localProcessos.find((p) => p.id === overProcessoId)
      if (overProcesso) {
        targetStatusId = overProcesso.statusId
      }
    }

    // Se não conseguiu determinar o status ou é o mesmo, não faz nada
    if (!targetStatusId || processo.statusId === targetStatusId) return

    const previousProcessos = [...localProcessos]
    
    // Atualização otimista
    setLocalProcessos(prev => 
      prev.map(p => p.id === activeId ? { ...p, statusId: targetStatusId! } : p)
    )

    try {
      const response = await fetch(`/api/processos/${activeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusId: targetStatusId }),
      })

      if (!response.ok) throw new Error("Erro ao mover processo")
    } catch (error) {
      console.error("Error updating processo status:", error)
      setLocalProcessos(previousProcessos)
      alert("Erro ao mover o processo. Tente novamente.")
    }
  }

  const handleClearCompleted = async () => {
    const concluidoStatus = statusList.find((s) => s.nome.toLowerCase() === "transcrição")
    if (!concluidoStatus) return

    const completedProcessos = localProcessos.filter((p) => p.statusId === concluidoStatus.id)

    if (completedProcessos.length === 0) {
      alert("Não há processos concluídos para limpar.")
      return
    }

    if (!confirm(`Tem certeza que deseja deletar ${completedProcessos.length} processo(s) concluído(s)?`)) {
      return
    }

    try {
      await Promise.all(
        completedProcessos.map((processo) =>
          fetch(`/api/processos/${processo.id}`, { method: "DELETE" }),
        ),
      )
      onRefresh()
    } catch (error) {
      console.error("Erro ao limpar processos concluídos:", error)
      alert("Não foi possível limpar os processos concluídos.")
    }
  }

  // Todas as colunas (sem paginação)
  const showAddButton = true

  // ✅ Memoizar processos por status - ordenados alfabeticamente (A-Z)
  const processosByStatus = useMemo(() => {
    const map = new Map<number, ProcessoWithStatus[]>()
    for (const status of statusList) {
      map.set(status.id, localProcessos.filter(p => p.statusId === status.id).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
    }
    return map
  }, [localProcessos, statusList])

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <span className="text-xl">{paisConfig.bandeira}</span>
            Processos - {paisConfig.label}
          </h3>
          <p className="text-sm text-white/70">
            Arraste e solte os processos entre as colunas
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

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        collisionDetection={pointerWithin}
      >
        <div ref={containerRef} className="relative w-full max-w-full">
          {/* Container das colunas com scroll horizontal */}
          <div 
            className="rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm pb-3 scrollbar-thin scrollbar-thumb-white/30 scrollbar-track-white/10"
            style={{ 
              overflowX: 'auto', 
              overflowY: 'hidden',
              maxWidth: '100%'
            }}
          >
            <div className="flex h-[calc(100vh-280px)] min-h-[500px]" style={{ width: 'max-content' }}>
              {sortedStatusList.map((status, index) => (
                <div 
                  key={status.id}
                  className="flex-shrink-0 w-[260px] h-full"
                >
                  <KanbanColumn
                    id={status.id}
                    title={status.nome}
                    processos={processosByStatus.get(status.id) || []}
                    headerColor={paisConfig.cor}
                    isFirst={index === 0}
                    isLast={index === sortedStatusList.length - 1 && !showAddButton}
                    onProcessoAdd={handleAddNewProcesso}
                    onProcessoClick={handleProcessoClick}
                    onStatusUpdate={onRefresh}
                    pais={pais}
                  />
                </div>
              ))}

              {/* Botão Adicionar Coluna */}
              <div className="flex-shrink-0 w-[260px] p-2 h-full">
                {isAddingStatus ? (
                  <div className="p-3 rounded-lg bg-white border border-gray-200 shadow-sm h-full">
                    <form onSubmit={handleAddNewStatus}>
                      <Input
                        autoFocus
                        placeholder="Nome da nova coluna..."
                        value={newStatusName}
                        onChange={(e) => setNewStatusName(e.target.value)}
                        className="mb-2 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 text-sm h-8"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsAddingStatus(false)}
                          className="h-7 px-2 hover:bg-gray-100 text-gray-600 text-xs"
                        >
                          Cancelar
                        </Button>
                        <Button type="submit" size="sm" className="h-7 px-2 bg-blue-600 hover:bg-blue-700 text-white text-xs">
                          Adicionar
                        </Button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    className="w-full h-full min-h-[80px] border border-dashed border-white/20 hover:border-white/40 hover:bg-white/5 text-white/50 hover:text-white/80 text-sm"
                    onClick={() => setIsAddingStatus(true)}
                  >
                    <Plus className="mr-1.5 h-4 w-4" /> Nova coluna
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <DragOverlay 
          modifiers={[snapCenterToCursor]}
          dropAnimation={{
            duration: 200,
            easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
          }}
        >
          {activeProcesso ? (
            <div style={{ transform: 'rotate(2deg) scale(1.02)', opacity: 0.95 }}>
              <KanbanCard processo={activeProcesso} isDragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ProcessoDetailsModal
        processo={selectedProcesso}
        isOpen={isDetailsModalOpen}
        onClose={handleModalClose}
        onSave={handleProcessoSave}
        statusList={statusList}
        initialTab={modalInitialTab}
        initialPessoaId={modalInitialPessoaId}
        initialSidebarTab={modalInitialSidebarTab}
      />
    </>
  )
}