// ESTE ARQUIVO VAI EM: src/components/kanban/kanban-column.tsx
//
// Coluna do kanban = FASE do Workflow Macro (motor).
// Colunas são definidas no GERENCIAMENTO → sem editar/excluir/adicionar aqui.
// O "+" de criar processo saiu da coluna: processo novo nasce na 1ª fase,
// pelo botão "+ Novo processo" do board.

"use client"

import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { useDroppable } from "@dnd-kit/core"
import { useMemo } from "react"
import { KanbanCard } from "./kanban-card"
import { Inbox, Plus } from "lucide-react"
import type { Processo } from "@/src/types/kanban"

interface KanbanColumnProps {
  faseKey: string
  title: string
  processos: Processo[]
  headerColor?: string
  isLast?: boolean
  onProcessoClick?: (processo: Processo) => void
  /** Repassado a cada card: o usuário pode arrastar processos? */
  podeArrastar?: boolean
  /** Ícone da fase, vindo do cadastro. Sem ícone a coluna não inventa um. */
  Icone?: React.ComponentType<{ className?: string }>
  /** Criar processo já nesta fase. Ausente = o rodapé não aparece. */
  onAdicionar?: () => void
  /** Rótulo da nacionalidade, repassado a cada card. */
  nacionalidade?: string
}

export function KanbanColumn({
  faseKey,
  title,
  processos,
  headerColor = "#3f3f46",
  isLast,
  podeArrastar = true,
  onProcessoClick,
  Icone,
  onAdicionar,
  nacionalidade,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${faseKey}`,
    data: {
      type: "Column",
      faseKey,
    },
  })

  const processosIds = useMemo(() => processos.map((p) => `card-${p.id}`), [processos])

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full w-full flex-col overflow-hidden rounded-xl border transition-colors duration-200 ${
        isOver
          ? "border-[var(--border-strong)] bg-[var(--surface-secondary)]"
          : "border-[var(--border-default)] bg-[var(--surface-primary)]"
      }`}
    >
      {/* Filete da cor da fase no topo — identifica a coluna sem tingir o fundo,
          que é onde os cards precisam de superfície neutra para se destacarem. */}
      <div className="h-[3px] w-full shrink-0" style={{ backgroundColor: headerColor }} />

      {/* Cabeçalho: ladrilho do ícone, nome da fase e contagem. */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-3">
        {Icone && (
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md"
            style={{ backgroundColor: `${headerColor}22`, color: headerColor }}
            aria-hidden
          >
            <Icone className="h-3.5 w-3.5" />
          </span>
        )}
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
          style={{ backgroundColor: `${headerColor}1f`, color: headerColor }}
        >
          {processos.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-2">
        {processos.length === 0 ? (
          // Coluna vazia não é buraco: diz o que significa, em vez de só faltar.
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 px-3 text-center">
            <Inbox className="h-8 w-8" style={{ color: `${headerColor}59` }} aria-hidden />
            <p className="text-[12px] leading-snug text-[var(--text-muted)]">
              Nenhum processo
              <br />
              nesta fase
            </p>
          </div>
        ) : (
          <SortableContext items={processosIds} strategy={verticalListSortingStrategy}>
            {processos.map((processo) => (
              <KanbanCard
                podeArrastar={podeArrastar}
                key={processo.id}
                processo={processo}
                corDaFase={headerColor}
                nacionalidade={nacionalidade}
                onClick={() => onProcessoClick?.(processo)}
              />
            ))}
          </SortableContext>
        )}
      </div>

      {onAdicionar && (
        <button
          type="button"
          onClick={onAdicionar}
          className="flex shrink-0 items-center justify-center gap-1.5 border-t border-[var(--border-subtle)] px-3 py-2.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-hover)]"
          style={{ color: headerColor }}
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar processo
        </button>
      )}
    </div>
  )
}
