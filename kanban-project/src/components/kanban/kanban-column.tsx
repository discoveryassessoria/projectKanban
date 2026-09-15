// ESTE ARQUIVO VAI EM: src/components/kanban/kanban-column.tsx
//
// Coluna do kanban = FASE do Workflow Macro (motor).
// Colunas são definidas no GERENCIAMENTO → sem editar/excluir/adicionar aqui.
// O "+" de criar processo NÃO existe na coluna — nem no topo, nem no rodapé.
// Processo novo nasce na 1ª fase, e só pelo botão "+ Novo processo" do board.

"use client"

import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { useDroppable } from "@dnd-kit/core"
import { useMemo } from "react"
import { KanbanCard } from "./kanban-card"
import { Inbox } from "lucide-react"
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
  /** Rótulo da nacionalidade, repassado a cada card. */
  nacionalidade?: string
  /** Seleção em massa (IDENTIDADE BITRIX) — repassada a cada card. */
  selecionados?: Set<number>
  onAlternarSelecao?: (processoId: number) => void
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
  nacionalidade,
  selecionados,
  onAlternarSelecao,
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
      {/* IDENTIDADE BITRIX: cabeçalho é uma BARRA CHEIA da cor da fase (era um
          filete de 3px) — cada coluna com identidade visual própria, texto
          claro por cima. */}
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-2.5"
        style={{ backgroundColor: headerColor }}
      >
        {Icone && (
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--text-inverse)]"
            style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
            aria-hidden
          >
            <Icone className="h-3.5 w-3.5" />
          </span>
        )}
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-inverse)]">
          {title}
        </h3>
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--text-inverse)]"
          style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
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
                selecionado={selecionados?.has(processo.id)}
                onAlternarSelecao={onAlternarSelecao ? () => onAlternarSelecao(processo.id) : undefined}
              />
            ))}
          </SortableContext>
        )}
      </div>

    </div>
  )
}
