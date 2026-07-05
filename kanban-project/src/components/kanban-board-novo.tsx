// ESTE ARQUIVO VAI EM: src/components/kanban-board-novo.tsx
//
// BOARD MOTOR-NATIVE (5/jul):
// - Colunas = FASES do Workflow Macro do TIPO selecionado (vêm por prop)
// - Arrastar card = mover de FASE (PUT /api/processos/[id]/fase)
// - "+ Novo processo" único no topo (nasce na 1ª fase do tipo, ligado ao motor)
// - SEM criar/editar/excluir coluna (colunas são do Gerenciamento)

"use client"

import type React from "react"
import { createPortal } from "react-dom"
import { useState, useEffect, useMemo } from "react"
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
import { Plus } from "lucide-react"
import { KanbanColumn } from "./kanban/kanban-column"
import { KanbanCard } from "./kanban/kanban-card"
import { ProcessoDetailsModal } from "./kanban/atividade-details-modal"
import {
  corDoPais,
  type PaisKanban,
  type TipoKanban,
  type Processo,
  type Status,
  type Contratante,
  type Requerente,
} from "@/src/types/kanban"
import { usePermissoes } from "@/src/hooks/use-permissoes"

interface KanbanBoardProps {
  pais: PaisKanban
  tipo: TipoKanban                    // tipo selecionado — as fases dele são as colunas
  processos: Processo[]
  statusList?: Status[]               // LEGADO — só repassado ao modal de detalhes
  contratantes?: Contratante[]
  requerentes?: Requerente[]
  onRefresh: () => void
  initialProcessoId?: number | null
  initialTab?: string | null
  initialPessoaId?: number | null
  initialSidebarTab?: string | null
  initialTarefaPaiId?: number | null
  initialAtividadeId?: number | null
  onModalOpened?: () => void
}

// Helper para extrair ID numérico de IDs prefixados ("card-12" -> 12)
const extractId = (id: string | number): number => {
  if (typeof id === 'number') return id
  const match = id.match(/\d+$/)
  return match ? parseInt(match[0]) : 0
}

const isCardId = (id: string | number): boolean =>
  typeof id === 'string' && id.startsWith('card-')

const isColumnId = (id: string | number): boolean =>
  typeof id === 'string' && id.startsWith('column-')

// "column-analise_documental" -> "analise_documental"
const faseFromColumnId = (id: string | number): string | null =>
  isColumnId(id) ? String(id).slice('column-'.length) : null

export function KanbanBoard({
  pais,
  tipo,
  processos: processosFromProps,
  statusList = [],
  contratantes = [],
  requerentes = [],
  onRefresh,
  initialProcessoId = null,
  initialTab = null,
  initialPessoaId = null,
  initialSidebarTab = null,
  onModalOpened,
  initialTarefaPaiId = null,
  initialAtividadeId = null,
}: KanbanBoardProps) {
  const [localProcessos, setLocalProcessos] = useState<Processo[]>(processosFromProps)

  useEffect(() => {
    setLocalProcessos(processosFromProps)
  }, [processosFromProps])

  const [activeProcesso, setActiveProcesso] = useState<Processo | null>(null)
  const [selectedProcesso, setSelectedProcesso] = useState<Processo | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  const [modalInitialTab, setModalInitialTab] = useState<string | undefined>(undefined)
  const [modalInitialPessoaId, setModalInitialPessoaId] = useState<number | undefined>(undefined)
  const [modalInitialSidebarTab, setModalInitialSidebarTab] = useState<string | undefined>(undefined)
  const [modalInitialTarefaPaiId, setModalInitialTarefaPaiId] = useState<number | undefined>(undefined)
  const [modalInitialAtividadeId, setModalInitialAtividadeId] = useState<number | undefined>(undefined)
  const { pode } = usePermissoes()

  // Modal "Novo processo" (nasce na 1ª fase do tipo, ligado ao motor)
  const [criarModal, setCriarModal] = useState(false)
  const [criarNome, setCriarNome] = useState("")
  const [salvandoCriar, setSalvandoCriar] = useState(false)
  const [erroCriar, setErroCriar] = useState<string | null>(null)

  const [initialParamsProcessed, setInitialParamsProcessed] = useState(false)

  useEffect(() => {
    if (initialProcessoId !== null) {
      setInitialParamsProcessed(false)
    }
  }, [initialProcessoId])

  const corPais = corDoPais(pais.countryKey)

  // Fases visíveis (colunas) — já vêm ordenadas do config
  const fases = tipo?.fases ?? []

  // Sensores
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  )

  // Abrir modal automaticamente (deep-link)
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

  // Processos agrupados por fase (A-Z dentro da fase)
  const processosByFase = useMemo(() => {
    const map = new Map<string, Processo[]>()
    for (const fase of fases) {
      map.set(
        fase.phaseKey,
        localProcessos
          .filter(p => p.faseAtualKey === fase.phaseKey)
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      )
    }
    return map
  }, [localProcessos, fases])

  const handleProcessoClick = (processo: Processo) => {
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

  // ✅ Criar processo — nasce na 1ª fase, já ligado ao motor
  const abrirCriar = () => {
    setCriarNome("")
    setErroCriar(null)
    setCriarModal(true)
  }

  const confirmarCriarProcesso = async () => {
    if (!criarNome.trim()) { setErroCriar("Informe o nome do processo."); return }

    setSalvandoCriar(true); setErroCriar(null)
    try {
      const response = await fetch('/api/processos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({
          nome: criarNome.trim(),
          pais: pais.countryKey,
          tipoProcessoMotorId: tipo.id,
        })
      })

      if (!response.ok) {
        const d = await response.json().catch(() => ({}))
        throw new Error(d.error || "Falha ao criar novo processo")
      }
      setCriarModal(false)
      onRefresh()
    } catch (error: any) {
      console.error(error)
      setErroCriar(error.message || "Não foi possível adicionar o processo.")
    } finally {
      setSalvandoCriar(false)
    }
  }

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const activeId = extractId(active.id)
    const processo = localProcessos.find((p) => p.id === activeId)
    setActiveProcesso(processo || null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    setActiveProcesso(null)
    if (!over) return

    const activeId = extractId(active.id)
    const processo = localProcessos.find((p) => p.id === activeId)
    if (!processo) return

    // Fase de destino
    let targetFaseKey: string | null = null
    if (over.data.current?.faseKey) {
      targetFaseKey = over.data.current.faseKey
    } else if (isColumnId(over.id)) {
      targetFaseKey = faseFromColumnId(over.id)
    } else if (isCardId(over.id)) {
      const overProcessoId = extractId(over.id)
      const overProcesso = localProcessos.find((p) => p.id === overProcessoId)
      if (overProcesso) targetFaseKey = overProcesso.faseAtualKey ?? null
    }

    // Mesma fase ou indefinida: não faz nada
    if (!targetFaseKey || processo.faseAtualKey === targetFaseKey) return

    // 🔒 Mover de fase na mão exige permissão. Sem ela: avisa e o card volta.
    if (!pode('processos.editar_status')) {
      alert("As fases avançam automaticamente conforme os documentos são validados. Você não tem permissão para mover o processo de fase manualmente.")
      return
    }

    // Com permissão: move de verdade (atualização otimista + PUT de fase)
    const previousProcessos = [...localProcessos]
    setLocalProcessos(prev =>
      prev.map(p => p.id === activeId ? { ...p, faseAtualKey: targetFaseKey! } : p)
    )

    try {
      const response = await fetch(`/api/processos/${activeId}/fase`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify({ faseAtualKey: targetFaseKey }),
      })
      if (!response.ok) {
        const d = await response.json().catch(() => ({}))
        throw new Error(d.error || "Erro ao mover processo")
      }
      onRefresh()
    } catch (error: any) {
      console.error("Erro ao mover processo de fase:", error)
      setLocalProcessos(previousProcessos)
      alert(error.message || "Erro ao mover o processo. Tente novamente.")
    }
  }

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            {pais.flag && <span className="text-xl">{pais.flag}</span>}
            Processos - {pais.countryLabel}
            <span className="text-sm font-normal text-white/50">· {tipo.name}</span>
          </h3>
          <p className="text-sm text-white/70">
            Arraste e solte os processos entre as fases
          </p>
        </div>
        {pode('processos.criar') && (
          <Button
            onClick={abrirCriar}
            className="bg-blue-600 hover:bg-blue-500 text-white"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Novo processo
          </Button>
        )}
      </div>

      {fases.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center text-sm text-amber-200">
          Este tipo de processo ainda não tem fases configuradas.
          Monte o workflow em Gerenciamento → Workflows e Fases → Workflow Macro.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          collisionDetection={pointerWithin}
        >
          <div className="relative w-full max-w-full">
            <div
              className="rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm pb-3 scrollbar-thin scrollbar-thumb-white/30 scrollbar-track-white/10"
              style={{
                overflowX: 'auto',
                overflowY: 'hidden',
                maxWidth: '100%'
              }}
            >
              <div className="flex h-[calc(100vh-280px)] min-h-[500px]" style={{ width: 'max-content' }}>
                {fases.map((fase, index) => (
                  <div
                    key={fase.phaseKey}
                    className="flex-shrink-0 w-[260px] h-full"
                  >
                    <KanbanColumn
                      faseKey={fase.phaseKey}
                      title={fase.label}
                      processos={processosByFase.get(fase.phaseKey) || []}
                      headerColor={corPais}
                      isLast={index === fases.length - 1}
                      onProcessoClick={handleProcessoClick}
                    />
                  </div>
                ))}
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
      )}

      {/* MODAL: Novo processo — em portal pro body (senão fica preso no painel com blur) */}
      {criarModal && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">Novo processo</h3>
              <button onClick={() => setCriarModal(false)} className="text-white/40 transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-white/60">Nome *</label>
                <input
                  autoFocus
                  value={criarNome}
                  onChange={(e) => setCriarNome(e.target.value)}
                  placeholder="Nome do processo"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmarCriarProcesso() }}
                />
              </div>

              <p className="text-xs text-white/40">
                Tipo: <span className="text-white/70">{tipo.name}</span> — o processo nasce na primeira fase
                {fases[0] ? ` (${fases[0].label})` : ""} e já entra no motor.
              </p>

              {erroCriar && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erroCriar}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setCriarModal(false)} className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white">Cancelar</button>
              <button
                onClick={confirmarCriarProcesso}
                disabled={salvandoCriar}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {salvandoCriar ? "Criando..." : "Criar processo"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <ProcessoDetailsModal
        processo={selectedProcesso as any}
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