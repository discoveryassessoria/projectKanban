"use client"
// src/components/operacao/AdiarAcompanhamentoModal.tsx
// ============================================================================
// ADIAR ACOMPANHAMENTO — Torre de Controle, Bloco B (29/09/2026). Substitui o
// `window.prompt` de operacao-v3.tsx: dias (1–15) e motivo (10–300 chars). O
// motivo grava em TarefaHistorico (`adiarAcompanhamento`,
// src/services/subtarefas-da-etapa.ts) e passa a aparecer em "Andamento".
// ============================================================================

import { useState } from "react"
import { LAYER } from "@/src/lib/ui/layers"

export function AdiarAcompanhamentoModal({
  onFechar, onEnviar,
}: {
  onFechar: () => void
  onEnviar: (dados: { dias: number; motivo: string }) => Promise<{ ok: boolean; mensagem?: string }>
}) {
  const [dias, setDias] = useState(3)
  const [motivo, setMotivo] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const motivoValido = motivo.trim().length >= 10 && motivo.trim().length <= 300
  const diasValido = Number.isInteger(dias) && dias >= 1 && dias <= 15

  const confirmar = async () => {
    if (!diasValido || !motivoValido) return
    setEnviando(true); setErro(null)
    try {
      const r = await onEnviar({ dias, motivo: motivo.trim() })
      if (!r.ok) { setErro(r.mensagem ?? "Não foi possível adiar."); return }
    } catch { setErro("Erro de conexão. Nada foi adiado.") }
    finally { setEnviando(false) }
  }

  const inp = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2 text-[13px] text-white/95 outline-none focus:border-[var(--border-default)]"
  const rot = "text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]"

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--overlay-modal)] px-4" style={{ zIndex: LAYER.popover }} onClick={enviando ? undefined : onFechar}>
      <div className="w-full max-w-md rounded-2xl bg-[var(--surface-popover)] shadow-[var(--elev-3)] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-extrabold text-white/95">Adiar acompanhamento</h3>
        <p className="text-[12px] text-[var(--text-secondary)]">O prazo da tarefa não muda — só quando o sistema volta a lembrar de cobrar.</p>

        <label className="block space-y-1">
          <span className={rot}>Dias (1 a 15)</span>
          <input type="number" min={1} max={15} value={dias} onChange={(e) => setDias(Number(e.target.value))} className={inp} />
        </label>

        <label className="block space-y-1">
          <span className={rot}>Motivo (10 a 300 caracteres)</span>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} className={inp} placeholder="Por que adiar o acompanhamento?" />
          <span className="text-[10.5px] text-[var(--text-muted)]">{motivo.trim().length}/300</span>
        </label>

        {erro && <div className="text-[12px] text-red-700 bg-[var(--surface-secondary)] rounded-lg px-3 py-2">{erro}</div>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onFechar} disabled={enviando} className="text-[13px] font-semibold px-3.5 py-2 rounded-lg text-white/68 hover:bg-[var(--surface-tertiary)]">Cancelar</button>
          <button onClick={confirmar} disabled={enviando || !diasValido || !motivoValido} className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[var(--action-primary)] text-[var(--action-primary-ink)] hover:bg-[var(--action-primary-hover)] disabled:opacity-60">
            {enviando ? "Adiando…" : "Adiar"}
          </button>
        </div>
      </div>
    </div>
  )
}
