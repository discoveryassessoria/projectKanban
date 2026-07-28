// src/components/financeiro/v3/DuplicarReceitaModal.tsx
// ============================================================================
// DUPLICAR Receita (Financeiro V3). Cria uma NOVA Receita/Obrigação a partir da
// origem (mesmo item/valor/moeda/câmbio/distribuição/participantes), SEM copiar
// pagamentos/cobranças/ledger. Confirmação simples → POST duplicar → abre a nova
// (onDone recebe o obrigacaoId novo). Endpoint: POST .../duplicar.
// ============================================================================
"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { LAYER } from "@/src/lib/ui/layers"
import { vocabularioFinanceiro } from "@/lib/financeiro/vocabulario"
import { X, Loader2, CheckCircle2, Copy, Info as InfoIcon } from "lucide-react"

const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }

export default function DuplicarReceitaModal({ receitaRef, natureza, onClose, onDone }: {
  receitaRef: string; natureza?: string; onClose: () => void; onDone?: (obrigacaoIdNovo: number) => void
}) {
  const v = vocabularioFinanceiro(natureza)
  const [vencimentoEmDias, setVencimentoEmDias] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !enviando) onClose() }
    document.addEventListener("keydown", onEsc)
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = orig; document.removeEventListener("keydown", onEsc) }
  }, [onClose, enviando])

  const duplicar = async () => {
    if (enviando) return
    setEnviando(true); setErro(null)
    try {
      const dias = vencimentoEmDias.trim()
      const r = await fetch(`/api/financeiro/v3/receita/${encodeURIComponent(receitaRef)}/duplicar`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ vencimentoEmDias: dias === "" ? null : Number(dias) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false || j.obrigacaoId == null) { setErro(j?.erro || `Falha ao duplicar (HTTP ${r.status}).`); setEnviando(false); return }
      setOk(true); setTimeout(() => { onDone?.(Number(j.obrigacaoId)); onClose() }, 650)
    } catch { setErro("Falha de rede ao duplicar."); setEnviando(false) }
  }

  if (typeof document === "undefined") return null
  const modal = (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-[var(--app-overlay)] p-4 sm:items-center" style={{ zIndex: LAYER.aboveProcess }} onClick={() => !enviando && onClose()}>
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--shadow-surface)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]"><Copy className="h-4 w-4 text-[var(--info)]" /> Duplicar {v.Entidade}</h2>
          <button onClick={() => !enviando && onClose()} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="flex items-start gap-1.5 rounded-[var(--radius-sm)] border p-3 text-xs text-[var(--text-secondary)]" style={{ borderColor: "color-mix(in srgb, var(--info) 25%, transparent)", background: "color-mix(in srgb, var(--info) 5%, transparent)" }}><InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--info)]" /> {`Cria ${v.custo ? "um novo custo" : "uma nova Receita"} com o mesmo item, valor-base, moeda, câmbio, distribuição e participantes. Pagamentos, ${v.cronograma.toLowerCase()} e histórico da origem NÃO são copiados. ${v.custo ? "O novo custo abre" : "A nova Receita abre"} em seguida.`}</p>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Vencimento (dias a partir de hoje, opcional)</label>
            <input inputMode="numeric" value={vencimentoEmDias} onChange={(e) => setVencimentoEmDias(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Sem vencimento" className="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--info)]" />
          </div>
          {erro && <div className="rounded-[var(--radius-sm)] border p-2.5 text-xs text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{erro}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <button onClick={() => !enviando && onClose()} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Cancelar</button>
          <button onClick={duplicar} disabled={enviando || ok} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--info)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Duplicar</button>
        </div>
      </div>
    </div>
  )
  return createPortal(modal, document.body)
}
