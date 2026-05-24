// src/components/kanban/OpManageModal.tsx
//
// Modal de gerenciamento de operação — reprodução fiel do mockup HTML
// (openOpManageModal no discovery-bancada.html linha 13016).
//
// Cobre 3 modos:
//   • cancel       — cancela a operação, doc volta a PENDENTE
//   • invalidate   — invalida juridicamente, doc fica INVALIDO
//   • (pause é tratado direto no WorkflowControls — não passa por aqui)
//
// Visual:
//   • Overlay escuro 65% opacity
//   • Modal #0f1419, 620px, border-radius 12px
//   • Header com gradient vermelho (#7c1d1d → #3f1010)
//   • Body com seções numeradas (badges circulares vermelhos)
//   • Inputs escuros com borda translúcida, focus vermelho
//   • Footer escuro com botão primário vermelho

"use client"

import { useState, useEffect } from "react"
import { X, Ban, Loader2 } from "lucide-react"
import { createPortal } from "react-dom"

// ============================================================
// MOTIVOS — copiados do mockup (Engine.CANCEL_REASONS e INVALIDATE_REASONS)
// ============================================================

const CANCEL_REASONS: Record<string, string> = {
  documento_incorreto:      "Documento incorreto",
  duplicidade:              "Duplicidade de operação",
  erro_operacional:         "Erro operacional do time",
  operacao_aberta_errada:   "Operação aberta no documento errado",
  cartorio_incorreto:       "Cartório incorreto",
  fluxo_incorreto:          "Fluxo escolhido incorreto",
  cliente_desistiu:         "Cliente desistiu",
  documento_nao_necessario: "Documento não necessário",
  outro:                    "Outro motivo",
}

const INVALIDATE_REASONS: Record<string, string> = {
  documento_errado:     "Operação no documento errado",
  duplicidade:          "Documento duplicado",
  fluxo_errado:         "Fluxo escolhido errado",
  classificacao_errada: "Erro de classificação",
  outro:                "Outro motivo",
}

// ============================================================
// TIPOS
// ============================================================

type Mode = "cancel" | "invalidate"

interface OpManageModalProps {
  isOpen: boolean
  mode: Mode
  documentoId: number | null
  onClose: () => void
  onSuccess: () => void
}

// ============================================================
// COMPONENTE
// ============================================================

export function OpManageModal({
  isOpen,
  mode,
  documentoId,
  onClose,
  onSuccess,
}: OpManageModalProps) {
  const reasonsMap = mode === "cancel" ? CANCEL_REASONS : INVALIDATE_REASONS
  const reasonKeys = Object.keys(reasonsMap)

  const [reason, setReason] = useState<string>(reasonKeys[0])
  const [notes, setNotes] = useState("")
  const [impact, setImpact] = useState("")
  const [cancelSla, setCancelSla] = useState(true)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Reset ao abrir
  useEffect(() => {
    if (isOpen) {
      setReason(reasonKeys[0])
      setNotes("")
      setImpact("")
      setCancelSla(true)
      setErro(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode])

  // ESC fecha
  useEffect(() => {
    if (!isOpen) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onEsc)
    return () => document.removeEventListener("keydown", onEsc)
  }, [isOpen, onClose])

  if (!isOpen || !documentoId) return null

  const titles: Record<Mode, string> = {
    cancel:     "CANCELAR OPERAÇÃO",
    invalidate: "INVALIDAR OPERAÇÃO",
  }
  const subs: Record<Mode, string> = {
    cancel:     "O cancelamento NÃO apaga histórico. Etapas concluídas permanecem. Anexos preservados.",
    invalidate: "Invalidar mantém os dados mas remove a operação das métricas operacionais ativas.",
  }
  const warns: Record<Mode, string> = {
    cancel:     "Esta ação NÃO apaga histórico, anexos ou observações. Apenas marca a operação como cancelada e impede avanço futuro.",
    invalidate: "Invalidar é uma ação administrativa. A operação fica preservada em audit, mas não conta mais nas métricas ativas.",
  }
  const submitLabels: Record<Mode, string> = {
    cancel:     "Confirmar cancelamento",
    invalidate: "Confirmar invalidação",
  }

  const handleSubmit = async () => {
    if (saving) return
    setErro(null)

    if (!notes.trim() || notes.trim().length < 5) {
      setErro("Observação obrigatória (mínimo 5 caracteres)")
      return
    }
    if (!reason) {
      setErro("Selecione um motivo")
      return
    }

    setSaving(true)
    try {
      // Monta a observação composta (motivo + nota + impacto)
      const reasonLabel = reasonsMap[reason]
      const composedObs = [
        `Motivo: ${reasonLabel}`,
        `Justificativa: ${notes.trim()}`,
        mode === "cancel" && impact.trim() ? `Impacto: ${impact.trim()}` : null,
        mode === "cancel" && !cancelSla ? "SLA das etapas ativas: NÃO cancelado" : null,
      ].filter(Boolean).join(" · ")

      const action = mode === "cancel" ? "cancelar" : "invalidar"
      const res = await fetch(`/api/documentos/${documentoId}/workflow`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({ action, observacao: composedObs }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      onSuccess()
    } catch (e) {
      console.error("[OpManageModal]", e)
      setErro(e instanceof Error ? e.message : "Erro desconhecido")
    } finally {
      setSaving(false)
    }
  }

  // ============================================================
  // RENDER (via portal — escapa do drawer z-index)
  // ============================================================

  const modalContent = (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[10010] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col overflow-hidden text-white"
        style={{
          background: "#0f1419",
          borderRadius: "12px",
          width: "620px",
          maxWidth: "94vw",
          maxHeight: "90vh",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* ============== HEAD ============== */}
        <div
          className="px-[22px] pt-[18px] pb-[14px] border-b border-white/10 flex items-start justify-between gap-3"
          style={{ background: "linear-gradient(135deg,#7c1d1d 0%,#3f1010 100%)" }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-extrabold uppercase tracking-tight text-white">
              {titles[mode]}
            </div>
            <div className="text-[11px] text-white/70 mt-1.5 leading-relaxed">
              {subs[mode]}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/85 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ============== BODY ============== */}
        <div className="flex-1 overflow-y-auto px-[22px] py-[18px]">

          {/* Warn banner */}
          <div
            className="mb-4 px-3 py-2 rounded-md border text-[11px] leading-relaxed"
            style={{
              background: "rgba(245,158,11,0.12)",
              borderColor: "rgba(245,158,11,0.30)",
              color: "#fbbf24",
            }}
          >
            {warns[mode]}
          </div>

          {/* === Seção 1 — Motivo === */}
          <Section num={1} title={mode === "cancel" ? "Motivo do cancelamento" : "Motivo da invalidação"}>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="ret-input w-full"
              style={inputStyle}
            >
              {Object.entries(reasonsMap).map(([k, label]) => (
                <option key={k} value={k} style={{ background: "#1a2028", color: "#fff" }}>
                  {label}
                </option>
              ))}
            </select>
          </Section>

          {/* === Seção 2 — Observação obrigatória / Justificativa === */}
          <Section num={2} title={mode === "cancel" ? "Observação obrigatória" : "Justificativa obrigatória"}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={mode === "cancel"
                ? "Descreva o que aconteceu (mín. 5 chars)…"
                : "Por que esta operação não é válida (mín. 5 chars)…"
              }
              rows={4}
              className="w-full resize-y"
              style={{ ...inputStyle, minHeight: "80px", lineHeight: "1.5" }}
            />
          </Section>

          {/* === Seção 3 — Impacto e opções (só no cancel) === */}
          {mode === "cancel" && (
            <Section num={3} title="Impacto e opções">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/55">
                  Impacto operacional
                </label>
                <input
                  type="text"
                  value={impact}
                  onChange={(e) => setImpact(e.target.value)}
                  placeholder="Ex.: processo segue normalmente, doc duplicado"
                  className="w-full"
                  style={inputStyle}
                />
              </div>
              <label className="flex items-center gap-2 mt-3 text-[12px] text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={cancelSla}
                  onChange={(e) => setCancelSla(e.target.checked)}
                  style={{ accentColor: "#dc2626" }}
                />
                Cancelar SLA das etapas ativas
              </label>
            </Section>
          )}

          {erro && (
            <div className="mt-3 px-3 py-2 rounded-md border text-[11px]"
                 style={{ background: "rgba(220,38,38,0.12)", borderColor: "rgba(220,38,38,0.30)", color: "#fca5a5" }}>
              ⚠ {erro}
            </div>
          )}
        </div>

        {/* ============== FOOT ============== */}
        <div
          className="px-[22px] py-[13px] border-t border-white/10 flex justify-end gap-2"
          style={{ background: "rgba(0,0,0,0.3)" }}
        >
          <button
            onClick={onClose}
            disabled={saving}
            className="h-[34px] px-[18px] text-[12px] font-bold rounded-[7px] disabled:opacity-50"
            style={{
              background: "rgba(255,255,255,0.08)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            Voltar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="h-[34px] px-[18px] text-[12px] font-bold rounded-[7px] inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{
              background: "#dc2626",
              color: "#fff",
              border: "1px solid #dc2626",
            }}
            onMouseEnter={(e) => { if (!saving) (e.target as HTMLButtonElement).style.background = "#b91c1c" }}
            onMouseLeave={(e) => { if (!saving) (e.target as HTMLButtonElement).style.background = "#dc2626" }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
            {submitLabels[mode]}
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof window === "undefined") return null
  return createPortal(modalContent, document.body)
}

// ============================================================
// HELPERS
// ============================================================

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.10)",
  color: "#fff",
  fontFamily: "inherit",
  fontSize: "12px",
  padding: "8px 10px",
  borderRadius: "6px",
  outline: "none",
}

function Section({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-[18px]">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/80 mb-2 flex items-center gap-2">
        <span
          className="w-[18px] h-[18px] rounded-full text-[9px] font-extrabold flex items-center justify-center"
          style={{ background: "#dc2626", color: "#fff" }}
        >
          {num}
        </span>
        {title}
      </div>
      {children}
    </div>
  )
}