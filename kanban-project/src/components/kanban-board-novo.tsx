// ESTE ARQUIVO VAI EM: src/components/kanban-board.tsx

"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  type DragMoveEvent,
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
import { Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react"
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
  
  // Estado para navegação por índice (modelo original)
  const [startIndex, setStartIndex] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef<NodeJS.Timeout | null>(null)
  
  const [visibleColumns, setVisibleColumns] = useState(5)
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

  const totalColumns = sortedStatusList.length + 1

  // Calcula quantas colunas cabem na tela
  useEffect(() => {
    const updateVisibleColumns = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth
        const availableWidth = containerWidth - 100
        const cols = Math.floor(availableWidth / 180)
        setVisibleColumns(Math.max(4, Math.min(6, cols)))
      }
    }

    setTimeout(updateVisibleColumns, 100)
    window.addEventListener('resize', updateVisibleColumns)
    return () => window.removeEventListener('resize', updateVisibleColumns)
  }, [])

  // Navegação
  const maxIndex = Math.max(0, totalColumns - visibleColumns)
  const canGoLeft = startIndex > 0
  const canGoRight = startIndex < maxIndex

  // Auto-scroll contínuo
  const startAutoScroll = useCallback((direction: 'left' | 'right') => {
    if (autoScrollRef.current) return
    
    // Executa imediatamente
    if (direction === 'left' && startIndex > 0) {
      setStartIndex(prev => Math.max(0, prev - 1))
    } else if (direction === 'right' && startIndex < maxIndex) {
      setStartIndex(prev => Math.min(maxIndex, prev + 1))
    }
    
    // Continua em intervalo
    autoScrollRef.current = setInterval(() => {
      setStartIndex(prev => {
        if (direction === 'left') {
          return Math.max(0, prev - 1)
        } else {
          return Math.min(maxIndex, prev + 1)
        }
      })
    }, 350)
  }, [maxIndex, startIndex])

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current) {
      clearInterval(autoScrollRef.current)
      autoScrollRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopAutoScroll()
  }, [stopAutoScroll])

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

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const activeId = typeof active.id === 'string' ? parseInt(active.id) : active.id as number
    const processo = localProcessos.find((p) => p.id === activeId)
    setActiveProcesso(processo || null)
    setIsDragging(true)
  }

  const handleDragMove = (event: DragMoveEvent) => {
    if (!containerRef.current || !isDragging) return
    
    const containerRect = containerRef.current.getBoundingClientRect()
    const { activatorEvent } = event
    
    if (activatorEvent && 'clientX' in activatorEvent) {
      const mouseX = (activatorEvent as MouseEvent).clientX
      const edgeThreshold = 80
      
      if (mouseX > containerRect.right - edgeThreshold && canGoRight) {
        if (!autoScrollRef.current) startAutoScroll('right')
      } else if (mouseX < containerRect.left + edgeThreshold && canGoLeft) {
        if (!autoScrollRef.current) startAutoScroll('left')
      } else {
        stopAutoScroll()
      }
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    
    setActiveProcesso(null)
    setIsDragging(false)
    stopAutoScroll()
    
    if (!over) return

    const activeId = typeof active.id === 'string' ? parseInt(active.id) : active.id as number
    const overId = typeof over.id === 'string' ? parseInt(over.id) : over.id as number

    const processo = localProcessos.find((p) => p.id === activeId)
    if (!processo) return

    let targetStatusId: number | null = null

    if (over.data.current?.statusId) {
      targetStatusId = over.data.current.statusId
    } else if (!isNaN(overId)) {
      const isColumnDrop = statusList.some(status => status.id === overId)
      if (isColumnDrop) {
        targetStatusId = overId
      } else {
        const overProcesso = localProcessos.find((p) => p.id === overId)
        if (overProcesso) {
          targetStatusId = overProcesso.statusId
        }
      }
    }

    if (!targetStatusId || processo.statusId === targetStatusId) return

    const previousProcessos = [...localProcessos]
    
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

  // Colunas visíveis (SLICE - modelo original que funciona)
  const visibleStatusList = sortedStatusList.slice(startIndex, startIndex + visibleColumns)
  const showAddButton = startIndex + visibleColumns >= sortedStatusList.length

  // Memoizar processos por status
  const processosByStatus = useMemo(() => {
    const map = new Map<number, ProcessoWithStatus[]>()
    for (const status of statusList) {
      map.set(status.id, localProcessos.filter(p => p.statusId === status.id))
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
        <div ref={containerRef} className="relative flex items-center gap-2">
          {/* Seta Esquerda - Circular */}
          <button
            onMouseEnter={() => canGoLeft && startAutoScroll('left')}
            onMouseLeave={stopAutoScroll}
            disabled={!canGoLeft}
            className={`
              flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center
              transition-all duration-200
              ${canGoLeft 
                ? 'bg-white/10 hover:bg-white/20 text-white cursor-pointer' 
                : 'bg-transparent text-white/20 cursor-default'}
            `}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          {/* Container das colunas - MODELO ORIGINAL */}
          <div className="flex-1 overflow-hidden rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm">
            <div className="flex min-h-[500px]">
              {visibleStatusList.map((status, index) => (
                <div 
                  key={status.id}
                  className="flex-1 min-w-0"
                >
                  <KanbanColumn
                    id={status.id}
                    title={status.nome}
                    processos={processosByStatus.get(status.id) || []}
                    headerColor={paisConfig.cor}
                    isFirst={index === 0}
                    isLast={index === visibleStatusList.length - 1 && !showAddButton}
                    onProcessoAdd={handleAddNewProcesso}
                    onProcessoClick={handleProcessoClick}
                    onStatusUpdate={onRefresh}
                    pais={pais}
                  />
                </div>
              ))}

              {/* Botão Adicionar Coluna */}
              {showAddButton && (
                <div className="flex-1 min-w-0 p-2">
                  {isAddingStatus ? (
                    <div className="p-3 rounded-lg bg-white/5 border border-white/10 h-full">
                      <form onSubmit={handleAddNewStatus}>
                        <Input
                          autoFocus
                          placeholder="Nome da nova coluna..."
                          value={newStatusName}
                          onChange={(e) => setNewStatusName(e.target.value)}
                          className="mb-2 bg-white/10 border-white/20 text-white placeholder:text-white/50 text-sm h-8"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsAddingStatus(false)}
                            className="h-7 px-2 hover:bg-white/10 text-white/70 text-xs"
                          >
                            Cancelar
                          </Button>
                          <Button type="submit" size="sm" className="h-7 px-2 bg-blue-600 hover:bg-blue-700 text-xs">
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
              )}
            </div>
          </div>

          {/* Seta Direita - Circular */}
          <button
            onMouseEnter={() => canGoRight && startAutoScroll('right')}
            onMouseLeave={stopAutoScroll}
            disabled={!canGoRight}
            className={`
              flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center
              transition-all duration-200
              ${canGoRight 
                ? 'bg-white/10 hover:bg-white/20 text-white cursor-pointer' 
                : 'bg-transparent text-white/20 cursor-default'}
            `}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
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