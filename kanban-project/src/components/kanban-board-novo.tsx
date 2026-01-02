// ESTE ARQUIVO VAI EM: src/components/kanban-board-novo.tsx
// SUBSTITUA O ARQUIVO EXISTENTE

"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback, useMemo } from "react"
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
  rectIntersection,
  type DragOverEvent,
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
  // ========================================
  // ESTADO LOCAL PARA ATUALIZAÇÃO OTIMISTA
  // ========================================
  const [localProcessos, setLocalProcessos] = useState<ProcessoWithStatus[]>(processosFromProps)
  
  // Sincronizar quando props mudam (ex: após refresh real)
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
  
  // Estado para navegação por setas
  const [startIndex, setStartIndex] = useState(0)
  const [isHoveringLeft, setIsHoveringLeft] = useState(false)
  const [isHoveringRight, setIsHoveringRight] = useState(false)
  const hoverIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  const [visibleColumns, setVisibleColumns] = useState(4)
  const [initialParamsProcessed, setInitialParamsProcessed] = useState(false)

  const paisConfig = PAISES_CONFIG[pais]

  // ========================================
  // SENSORES OTIMIZADOS
  // ========================================
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      // Precisa mover 8px antes de ativar o drag (evita cliques acidentais)
      distance: 8,
    },
  })
  
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      // Para touch: delay de 150ms OU mover 5px
      delay: 150,
      tolerance: 5,
    },
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
        
        if (onModalOpened) {
          onModalOpened()
        }
      }
    }
  }, [initialProcessoId, initialTab, initialPessoaId, initialSidebarTab, localProcessos, initialParamsProcessed, onModalOpened])

  // Ordenar status (memoizado para performance)
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
        const availableWidth = containerWidth - 80
        const cols = Math.floor(availableWidth / 220)
        setVisibleColumns(Math.max(3, Math.min(5, cols)))
      }
    }

    setTimeout(updateVisibleColumns, 100)
    window.addEventListener('resize', updateVisibleColumns)
    return () => window.removeEventListener('resize', updateVisibleColumns)
  }, [])

  // Navegação
  const canGoLeft = startIndex > 0
  const canGoRight = startIndex + visibleColumns < totalColumns

  const handlePrev = useCallback(() => {
    setStartIndex(prev => Math.max(0, prev - 1))
  }, [])

  const handleNext = useCallback(() => {
    setStartIndex(prev => Math.min(Math.max(0, totalColumns - visibleColumns), prev + 1))
  }, [totalColumns, visibleColumns])

  // Hover navigation
  const startHoverNavigation = useCallback((direction: 'left' | 'right') => {
    if (hoverIntervalRef.current) {
      clearInterval(hoverIntervalRef.current)
    }

    if (direction === 'left') {
      handlePrev()
    } else {
      handleNext()
    }

    hoverIntervalRef.current = setInterval(() => {
      if (direction === 'left') {
        setStartIndex(prev => Math.max(0, prev - 1))
      } else {
        setStartIndex(prev => Math.min(Math.max(0, totalColumns - visibleColumns), prev + 1))
      }
    }, 500)
  }, [totalColumns, visibleColumns, handlePrev, handleNext])

  const stopHoverNavigation = useCallback(() => {
    if (hoverIntervalRef.current) {
      clearInterval(hoverIntervalRef.current)
      hoverIntervalRef.current = null
    }
    setIsHoveringLeft(false)
    setIsHoveringRight(false)
  }, [])

  useEffect(() => {
    return () => {
      if (hoverIntervalRef.current) {
        clearInterval(hoverIntervalRef.current)
      }
    }
  }, [])

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
        body: JSON.stringify({ 
          nome, 
          statusId, 
          pais
        }),
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

  const handleProcessoSave = () => {
    onRefresh()
  }

  const handleModalClose = () => {
    setIsDetailsModalOpen(false)
    setModalInitialTab(undefined)
    setModalInitialPessoaId(undefined)
    setModalInitialSidebarTab(undefined)
  }

  // ========================================
  // DRAG HANDLERS OTIMIZADOS
  // ========================================
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const activeId = typeof active.id === 'string' ? parseInt(active.id) : active.id as number
    const processo = localProcessos.find((p) => p.id === activeId)
    setActiveProcesso(processo || null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    
    // Limpa o overlay imediatamente
    setActiveProcesso(null)
    
    if (!over) return

    const activeId = typeof active.id === 'string' ? parseInt(active.id) : active.id as number
    const overId = typeof over.id === 'string' ? parseInt(over.id) : over.id as number

    const processo = localProcessos.find((p) => p.id === activeId)
    if (!processo) return

    // Determinar o status de destino
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

    // ========================================
    // ATUALIZAÇÃO OTIMISTA - Move imediatamente na UI
    // ========================================
    const previousProcessos = [...localProcessos]
    
    setLocalProcessos(prev => 
      prev.map(p => 
        p.id === activeId 
          ? { ...p, statusId: targetStatusId! }
          : p
      )
    )

    // Chamada à API em background
    try {
      const response = await fetch(`/api/processos/${activeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusId: targetStatusId }),
      })

      if (!response.ok) {
        throw new Error("Erro ao mover processo")
      }
      
      // Não precisa chamar onRefresh() - já atualizamos localmente
      // Só chama se precisar sincronizar outros dados
    } catch (error) {
      console.error("Error updating processo status:", error)
      // ROLLBACK - volta ao estado anterior se der erro
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

  // Colunas visíveis
  const visibleStatusList = sortedStatusList.slice(startIndex, startIndex + visibleColumns)
  const showAddButton = startIndex + visibleColumns >= sortedStatusList.length

  // Memoizar processos por status para evitar recálculos
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
        onDragEnd={handleDragEnd}
        collisionDetection={pointerWithin}
      >
        {/* Container com setas de navegação */}
        <div ref={containerRef} className="relative flex items-stretch">
          {/* Seta Esquerda */}
          <div
            onMouseEnter={() => {
              if (canGoLeft) {
                setIsHoveringLeft(true)
                startHoverNavigation('left')
              }
            }}
            onMouseLeave={stopHoverNavigation}
            className={`
              flex-shrink-0 w-10 flex items-center justify-center
              transition-all duration-200 rounded-l-lg
              ${canGoLeft 
                ? 'cursor-pointer bg-white/5 hover:bg-white/20' 
                : 'cursor-default bg-transparent'}
              ${isHoveringLeft ? 'bg-white/20' : ''}
            `}
          >
            <ChevronLeft className={`h-6 w-6 transition-all ${canGoLeft ? 'text-white' : 'text-white/10'} ${isHoveringLeft ? 'scale-125' : ''}`} />
          </div>

          {/* Área das colunas */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <div 
              className="grid pb-4 min-h-[450px] gap-2"
              style={{
                gridTemplateColumns: `repeat(${visibleStatusList.length + (showAddButton ? 1 : 0)}, 1fr)`
              }}
            >
              {visibleStatusList.map((status, index) => (
                <div 
                  key={status.id} 
                  className="min-w-0"
                >
                  <KanbanColumn
                    id={status.id}
                    title={status.nome}
                    processos={processosByStatus.get(status.id) || []}
                    headerColor={paisConfig.cor}
                    isFirst={startIndex + index === 0}
                    isLast={startIndex + index === sortedStatusList.length - 1}
                    onProcessoAdd={handleAddNewProcesso}
                    onProcessoClick={handleProcessoClick}
                    onStatusUpdate={onRefresh}
                    pais={pais}
                  />
                </div>
              ))}

              {/* Botão Adicionar Coluna */}
              {showAddButton && (
                <div className="min-w-0">
                  {isAddingStatus ? (
                    <div className="p-3 rounded-lg bg-white/10 border border-white/20 backdrop-blur-xl h-full">
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
              )}
            </div>
          </div>

          {/* Seta Direita */}
          <div
            onMouseEnter={() => {
              if (canGoRight) {
                setIsHoveringRight(true)
                startHoverNavigation('right')
              }
            }}
            onMouseLeave={stopHoverNavigation}
            className={`
              flex-shrink-0 w-10 flex items-center justify-center
              transition-all duration-200 rounded-r-lg
              ${canGoRight 
                ? 'cursor-pointer bg-white/5 hover:bg-white/20' 
                : 'cursor-default bg-transparent'}
              ${isHoveringRight ? 'bg-white/20' : ''}
            `}
          >
            <ChevronRight className={`h-6 w-6 transition-all ${canGoRight ? 'text-white' : 'text-white/10'} ${isHoveringRight ? 'scale-125' : ''}`} />
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
            <div style={{ transform: 'rotate(3deg) scale(1.05)', opacity: 0.9 }}>
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