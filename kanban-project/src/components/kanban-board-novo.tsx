// ESTE ARQUIVO VAI EM: src/components/kanban-board-novo.tsx

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
import { Plus } from "lucide-react"
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
import { usePermissoes } from "@/src/hooks/use-permissoes"

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
  initialTarefaPaiId?: number | null  // ← NOVO
  initialAtividadeId?: number | null  // ← NOVO
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
  initialTarefaPaiId = null,  // ← NOVO
  initialAtividadeId = null,  // ← NOVO
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
  const [modalInitialTarefaPaiId, setModalInitialTarefaPaiId] = useState<number | undefined>(undefined)
  const [modalInitialAtividadeId, setModalInitialAtividadeId] = useState<number | undefined>(undefined)
  const { pode } = usePermissoes()
  
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [initialParamsProcessed, setInitialParamsProcessed] = useState(false)

  // ✅ CORREÇÃO: Resetar initialParamsProcessed quando um novo processoId chega
  useEffect(() => {
    if (initialProcessoId !== null) {
      setInitialParamsProcessed(false)
    }
  }, [initialProcessoId])

  const paisConfig = PAISES_CONFIG[pais]

  // Sensores
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  )

  // Efeito para abrir modal automaticamente
  useEffect(() => {
    if (initialProcessoId && localProcessos.length > 0 && !initialParamsProcessed) {
      const processo = localProcessos.find(p => p.id === initialProcessoId)
      if (processo) {
        setSelectedProcesso(processo)
        setModalInitialTab(initialTab || undefined)
        setModalInitialPessoaId(initialPessoaId || undefined)
        setModalInitialSidebarTab(initialSidebarTab || undefined)
        setModalInitialTarefaPaiId(initialTarefaPaiId || undefined)
        setModalInitialAtividadeId(initialAtividadeId || undefined)
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
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
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
      const response = await fetch('/api/processos', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({
          nome: nome,
          statusId: statusId,
          pais: pais
        })
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
    setModalInitialTarefaPaiId(undefined)
    setModalInitialAtividadeId(undefined)
  }

  const handleProcessoSave = () => onRefresh()

  const handleModalClose = () => {
    setIsDetailsModalOpen(false)
    setModalInitialTab(undefined)
    setModalInitialPessoaId(undefined)
    setModalInitialSidebarTab(undefined)
    setModalInitialTarefaPaiId(undefined)
    setModalInitialAtividadeId(undefined)
    onRefresh()
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

    const activeId = extractId(active.id)
    const processo = localProcessos.find((p) => p.id === activeId)
    if (!processo) return

    let targetStatusId: number | null = null
    if (over.data.current?.statusId) {
      targetStatusId = over.data.current.statusId
    } else if (isColumnId(over.id)) {
      targetStatusId = extractId(over.id)
    } else if (isCardId(over.id)) {
      const overProcessoId = extractId(over.id)
      const overProcesso = localProcessos.find((p) => p.id === overProcessoId)
      if (overProcesso) {
        targetStatusId = overProcesso.statusId
      }
    }

    // Mesmo status ou indefinido: não faz nada
    if (!targetStatusId || processo.statusId === targetStatusId) return

    // 🔒 Mover de fase na mão exige permissão. Sem ela: avisa e o card volta.
    if (!pode('processos.editar_status')) {
      alert("As fases avançam automaticamente conforme os documentos são validados. Você não tem permissão para mover o processo de fase manualmente.")
      return
    }

    // Com permissão: move de verdade (atualização otimista + PUT)
    const previousProcessos = [...localProcessos]
    setLocalProcessos(prev =>
      prev.map(p => p.id === activeId ? { ...p, statusId: targetStatusId! } : p)
    )

    try {
      const response = await fetch(`/api/processos/${activeId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({ statusId: targetStatusId }),
      })
      if (!response.ok) throw new Error("Erro ao mover processo")
    } catch (error) {
      console.error("Error updating processo status:", error)
      setLocalProcessos(previousProcessos)
      alert("Erro ao mover o processo. Tente novamente.")
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
                    podeCriarProcesso={pode('processos.criar')}
                    podeEditarColuna={pode('processos.editar_coluna')}
                    podeExcluirColuna={pode('processos.excluir_coluna')}
                  />
                </div>
              ))}

              {/* Botão Adicionar Coluna */}
              {pode('processos.criar_coluna') && (
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
              )}
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
        initialTarefaPaiId={modalInitialTarefaPaiId}
        initialAtividadeId={modalInitialAtividadeId}
      />
    </>
  )
}