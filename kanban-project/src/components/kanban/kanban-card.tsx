// ESTE ARQUIVO VAI EM: src/components/kanban/kanban-card.tsx
//
// Card do kanban. Igual ao anterior — só muda:
// - type: Processo (o kanban agrupa por faseAtualKey, não mais por Status)
// - data do drag: faseKey em vez de statusId

"use client"

import { nomePessoa } from "@/src/lib/ui/pessoa-exibicao"
import type React from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { AlertCircle, MoreVertical } from "lucide-react"
import type { Processo } from "@/src/types/kanban"

interface KanbanCardProps {
  processo: Processo
  /** Cor da fase (coluna) — tinge a barra de progresso e o realce do card. */
  corDaFase?: string
  /** Rótulo da nacionalidade ("Cidadania Alemã"), resolvido pelo board. */
  nacionalidade?: string
  onClick?: () => void
  isDragging?: boolean // Prop para quando está no DragOverlay
  /**
   * O card pode ser ARRASTADO por este usuário. Falso ⇒ `useSortable` nasce
   * desabilitado: sem listeners, sem cursor de arraste, sem drop registrado. A
   * autorização definitiva continua sendo do servidor; isto evita oferecer ao
   * operador uma ação que ele não pode concluir.
   */
  podeArrastar?: boolean
}

export function KanbanCard({ processo, onClick, corDaFase, nacionalidade, isDragging: isDraggingProp, podeArrastar = true }: KanbanCardProps) {
  const {
    id,
    nome,
    contratantes = [], // Array de contratantes
    requerentes = [],
    projection,
    sla,
  } = processo

  /** Iniciais para o avatar: duas letras, sem inventar quando o nome é curto. */
  const iniciais = (v: string) =>
    v.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("")

  // Pegar o primeiro contratante para exibir dados de contato
  const contratante = contratantes[0] || null

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isDraggingSortable
  } = useSortable({
    id: `card-${id}`,
    disabled: !podeArrastar,
    data: {
      type: "Card",
      processo: processo,
      faseKey: processo.faseAtualKey ?? null,
    },
  })

  // Usar prop isDragging se fornecida (DragOverlay), senão usar do useSortable
  const isDragging = isDraggingProp ?? isDraggingSortable

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    // Sem permissão o cursor não promete movimento nenhum.
    cursor: podeArrastar ? undefined : "default",
  }

  // Dados do contratante para contato
  const telefone = contratante?.telefone
  const email = contratante?.email

  // Contagem de requerentes (identidade do processo — não é contador operacional)
  const requerentesCount = requerentes?.length ?? 0

  // PROGRESSO DA FASE — fonte ÚNICA: projeção operacional oficial. O card NUNCA
  // calcula progresso nem conta tarefas/documentos/necessidades/steps; apenas
  // consome a projeção e exibe barra + percentual.
  const activePhase = projection?.activePhase ?? null
  const pct = projection?.progress.percentage ?? 0
  const opState = projection?.status.operationalState ?? ""
  const barColor =
    opState === "BLOQUEADA" ? "#f59e0b"
    : pct >= 100 ? "#10b981"
    : "#4f91c5"

  const handleCardClick = (e: React.MouseEvent) => {
    if (!isDragging && onClick) {
      onClick()
    }
  }

  const handlePhoneClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (telefone) {
      window.open(`tel:${telefone}`, '_blank')
    }
  }

  const handleEmailClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (email) {
      window.open(`mailto:${email}`, '_blank')
    }
  }

  const handleChatClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (telefone) {
      const whatsappNumber = telefone.replace(/\D/g, '')
      window.open(`https://wa.me/55${whatsappNumber}`, '_blank')
    }
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div
        className={`
          mb-3 bg-[var(--surface-elevated)] rounded-lg shadow-[var(--elev-1)] border border-[var(--border-default)]
          hover:shadow-[var(--elev-2)] transition-all cursor-grab active:cursor-grabbing
          ${isDragging ? "shadow-[var(--elev-3)] ring-2 ring-[var(--border-strong)]" : ""}
        `}
        onClick={handleCardClick}
      >
        {/* Conteúdo principal — desenho do mockup aprovado: nome + avatar,
            nacionalidade, código, chips de requerente, barra da fase, alerta. */}
        <div className="p-3.5">
          {/* Nome do processo e avatar com as iniciais */}
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
              {nome}
            </h3>
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
              style={{ backgroundColor: `${corDaFase ?? "#4e6879"}1f`, color: corDaFase ?? "var(--text-secondary)" }}
              aria-hidden
            >
              {iniciais(nome)}
            </span>
          </div>

          {/* Nacionalidade e código — duas linhas secundárias, como no mockup.
              Só aparecem quando existem: card não inventa rótulo. */}
          {nacionalidade && (
            <p className="truncate text-[12px] leading-snug text-[var(--text-muted)]">{nacionalidade}</p>
          )}
          {processo.codigo && (
            <p className="truncate text-[12px] leading-snug text-[var(--text-muted)]">Proc. {processo.codigo}</p>
          )}

          {/* Requerentes como chips. É o MESMO dado que antes era um contador com
              ícone — só apresentado como o mockup apresenta. */}
          {requerentesCount > 0 && (
            <div className="mt-2.5 flex items-center gap-1">
              {requerentes!.slice(0, 2).map((r, i) => (
                <span
                  key={i}
                  className="grid h-6 w-6 place-items-center rounded-full bg-[var(--surface-secondary)] text-[9.5px] font-semibold text-[var(--text-secondary)]"
                  title={nomePessoa(r)}
                >
                  {iniciais(nomePessoa(r))}
                </span>
              ))}
              {requerentesCount > 2 && (
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--surface-secondary)] text-[9.5px] font-semibold text-[var(--text-muted)]">
                  +{requerentesCount - 2}
                </span>
              )}
            </div>
          )}

          {/* Barra da fase — percentual OFICIAL da projeção, na cor da coluna. */}
          {activePhase && (
            <div className="mt-2.5 flex items-center gap-2">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-tertiary)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: corDaFase ?? barColor }}
                />
              </div>
              <span className="shrink-0 text-[12px] font-semibold tabular-nums text-[var(--text-primary)]">
                {pct}%
              </span>
            </div>
          )}

          {/* Rodapé: alerta de SLA (só quando há) e o menu do card. */}
          <div className="mt-2.5 flex items-center justify-between">
            {sla && sla.status === "atrasado" ? (
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--danger-text)]">
                <AlertCircle className="h-3.5 w-3.5" />
                {sla.diasAtraso}
              </span>
            ) : <span />}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClick?.() }}
              className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
              title="Abrir processo"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}