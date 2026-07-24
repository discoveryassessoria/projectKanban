// src/components/kanban/WorkflowControls.tsx
//
// Bloco que vai entre o header de identificação (status/responsável/sla/última mov)
// e a barra de abas do DocumentoOperationalDrawer.
//
// Mostra:
//  • Barra de progresso operacional (X% · iniciado em ...)
//  • Botões: Pausar / Retomar / Cancelar / Invalidar
//  • Banner se a operação está pausada ou foi cancelada
//
// O componente recebe o workflow como prop (carregado pelo pai)
// + um callback onChange que é disparado depois de qualquer ação.

"use client"

import { useState } from "react"
import { Pause, Play, X, Ban, Loader2 } from "lucide-react"
import { OpManageModal } from "./OpManageModal"

// ============================================================
// TIPOS
// ============================================================

interface WorkflowMinimal {
  id: number
  status: string                // em_andamento | pausado | cancelado | concluido
  progress: number              // 0-100
  startedAt: string | Date | null
  cancelledAt?: string | Date | null
}

interface WorkflowControlsProps {
  documentoId: number | null
  workflow: WorkflowMinimal | null
  onChange: () => void          // chamar após qualquer ação bem-sucedida
}

type ActionKey = "pausar" | "retomar" | "cancelar" | "invalidar"

// ============================================================
// HELPERS
// ============================================================

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—"
  const date = typeof d === "string" ? new Date(d) : d
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }) + " " + date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function WorkflowControls({
  documentoId,
  workflow,
  onChange,
}: WorkflowControlsProps) {
  const [actionLoading, setActionLoading] = useState<ActionKey | null>(null)
  const [confirmAction, setConfirmAction] = useState<ActionKey | null>(null)
  const [observacao, setObservacao] = useState("")

  // Se não tem workflow, esconde o bloco (header já mostra "Iniciar operação" na aba Operação)
  if (!workflow || !documentoId) return null

  const progress = workflow.progress ?? 0
  const startedAt = formatDate(workflow.startedAt)
  const cancelledAt = workflow.cancelledAt ? formatDate(workflow.cancelledAt) : null
  const status = workflow.status

  const isAndamento = status === "em_andamento"
  const isPausado = status === "pausado"
  const isCancelado = status === "cancelado"

  // ============================================================
  // EXECUTAR AÇÃO
  // ============================================================

  const executeAction = async (action: ActionKey, withObs: boolean) => {
    if (actionLoading) return
    setActionLoading(action)
    try {
      const res = await fetch(`/api/documentos/${documentoId}/workflow`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({
          action,
          observacao: withObs ? observacao.trim() || undefined : undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      setConfirmAction(null)
      setObservacao("")
      onChange()
    } catch (e) {
      console.error("[WorkflowControls] falha:", e)
      alert(`Erro: ${e instanceof Error ? e.message : "falha desconhecida"}`)
    } finally {
      setActionLoading(null)
    }
  }

  // Pausar/Retomar não precisam de confirmação (são reversíveis)
  const handlePausar  = () => executeAction("pausar",  false)
  const handleRetomar = () => executeAction("retomar", false)

  // Cancelar/Invalidar pedem confirmação + observação
  const handleConfirmarAction = () => {
    if (!confirmAction) return
    executeAction(confirmAction, true)
  }

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="px-6 py-3 border-b border-white/10" style={{ background: "#11151b" }}>
      <div className="bg-[#161b21] border border-white/10 rounded-xl px-4 py-3.5">

        {/* Barra de progresso */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            Progresso operacional
          </span>
          <span className="text-[11px] font-mono text-white/50">
            {progress}% · {isCancelado && cancelledAt ? `Cancelado em ${cancelledAt}` : `Iniciado em ${startedAt}`}
          </span>
        </div>
        <div className="h-1.5 bg-[#252c35] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#2563eb] rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Banner de status */}
        {isPausado && (
          <div className="mt-3 px-3 py-2 bg-amber-500/15 border border-amber-500/30 rounded-md text-[11px] text-amber-200 flex items-center gap-2">
            <Pause className="w-3 h-3 flex-shrink-0" />
            <span><strong>Operação PAUSADA</strong> · use Retomar quando estiver pronto pra continuar</span>
          </div>
        )}
        {isCancelado && (
          <div className="mt-3 px-3 py-2 bg-red-500/15 border border-red-500/30 rounded-md text-[11px] text-red-200 flex items-center gap-2">
            <Ban className="w-3 h-3 flex-shrink-0" />
            <span><strong>Operação CANCELADA</strong> · documento voltou pra fila de pendentes</span>
          </div>
        )}

        {/* Botões (só aparecem se workflow não está cancelado) */}
        {!isCancelado && (
          <div className="flex gap-2 flex-wrap mt-3.5">
            {isAndamento && (
              <button
                onClick={handlePausar}
                disabled={!!actionLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-50 border border-[#2563eb]/50 text-[#7dd3fc] bg-transparent hover:bg-[#2563eb]/10"
              >
                {actionLoading === "pausar" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pause className="w-3 h-3" />}
                Pausar operação
              </button>
            )}
            {isPausado && (
              <button
                onClick={handleRetomar}
                disabled={!!actionLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-50 border border-[#4ade80]/40 text-[#4ade80] bg-transparent hover:bg-[#4ade80]/10"
              >
                {actionLoading === "retomar" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Retomar operação
              </button>
            )}
            <button
              onClick={() => setConfirmAction("cancelar")}
              disabled={!!actionLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-50 border border-white/12 text-white/80 bg-[#20262e] hover:bg-[#252c35]"
            >
              <X className="w-3 h-3" />
              Cancelar operação
            </button>
            {isAndamento && (
              <button
                onClick={() => setConfirmAction("invalidar")}
                disabled={!!actionLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-50 border border-[#f87171]/40 text-[#f87171] bg-transparent hover:bg-[#f87171]/10"
              >
                <Ban className="w-3 h-3" />
                Invalidar operação
              </button>
            )}
          </div>
        )}
      </div>

      {/* Modal de Cancelar/Invalidar — reproduz fielmente o openOpManageModal do mockup */}
      <OpManageModal
        isOpen={confirmAction === "cancelar" || confirmAction === "invalidar"}
        mode={confirmAction === "cancelar" ? "cancel" : "invalidate"}
        documentoId={documentoId}
        onClose={() => setConfirmAction(null)}
        onSuccess={() => {
          setConfirmAction(null)
          onChange()
        }}
      />
    </div>
  )
}