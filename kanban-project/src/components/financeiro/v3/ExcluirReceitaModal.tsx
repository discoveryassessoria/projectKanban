// src/components/financeiro/v3/ExcluirReceitaModal.tsx
// ============================================================================
// EXCLUSÃO (lógica) da Receita (Financeiro V3). No mount consulta ?check=1 →
// { permitido, motivos }. Se bloqueado, mostra os motivos e NÃO oferece exclusão.
// Se permitido, exige confirmação explícita (digitar "EXCLUIR") antes do DELETE.
// Ledger/histórico NUNCA são apagados (exclusão lógica). Auditável.
// Endpoints: GET .../excluir?check=1 · DELETE .../excluir.
// ============================================================================
"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { LAYER } from "@/src/lib/ui/layers"
import { vocabularioFinanceiro } from "@/lib/financeiro/vocabulario"
import { X, Loader2, CheckCircle2, AlertTriangle, Trash2, ShieldAlert } from "lucide-react"

const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const CONFIRMA = "EXCLUIR"

export default function ExcluirReceitaModal({ receitaRef, natureza, onClose, onDone }: {
  receitaRef: string; natureza?: string; onClose: () => void; onDone?: () => void
}) {
  const v = vocabularioFinanceiro(natureza)
  const [checando, setChecando] = useState(true)
  const [permitido, setPermitido] = useState(false)
  const [motivos, setMotivos] = useState<string[]>([])
  const [checkErro, setCheckErro] = useState<string | null>(null)
  const [confirma, setConfirma] = useState("")
  const [motivo, setMotivo] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !enviando) onClose() }
    document.addEventListener("keydown", onEsc)
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = orig; document.removeEventListener("keydown", onEsc) }
  }, [onClose, enviando])

  useEffect(() => {
    let vivo = true
    fetch(`/api/financeiro/v3/receita/${encodeURIComponent(receitaRef)}/excluir?check=1`, { headers: authHeaders() })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!vivo) return
        if (!r.ok || j.ok === false) { setCheckErro(j?.erro || `Falha ao checar exclusão (HTTP ${r.status}).`); return }
        setPermitido(!!j.permitido); setMotivos(Array.isArray(j.motivos) ? j.motivos : [])
      })
      .catch(() => { if (vivo) setCheckErro("Falha de rede ao checar exclusão.") })
      .finally(() => { if (vivo) setChecando(false) })
    return () => { vivo = false }
  }, [receitaRef])

  const valido = permitido && confirma.trim().toUpperCase() === CONFIRMA

  const excluir = async () => {
    if (!valido || enviando) return
    setEnviando(true); setErro(null)
    try {
      const r = await fetch(`/api/financeiro/v3/receita/${encodeURIComponent(receitaRef)}/excluir`, {
        method: "DELETE", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ motivo: motivo.trim() || null }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) { setErro(j?.erro || (j?.motivos?.[0]) || `Falha ao excluir (HTTP ${r.status}).`); setEnviando(false); return }
      setOk(true); setTimeout(() => { onDone?.(); onClose() }, 750)
    } catch { setErro("Falha de rede ao excluir."); setEnviando(false) }
  }

  if (typeof document === "undefined") return null
  const modal = (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-[var(--app-overlay)] p-4 sm:items-center" style={{ zIndex: LAYER.aboveProcessCritical }} onClick={() => !enviando && onClose()}>
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--shadow-surface)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]"><Trash2 className="h-4 w-4 text-[var(--danger)]" /> Excluir {v.Entidade}</h2>
          <button onClick={() => !enviando && onClose()} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {checando ? (
            <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Verificando se a exclusão é permitida…</div>
          ) : checkErro ? (
            <div className="rounded-[var(--radius-sm)] border p-3 text-xs text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{checkErro}</div>
          ) : !permitido ? (
            <div className="rounded-[var(--radius-sm)] border p-3 text-xs text-[var(--text-secondary)]" style={{ borderColor: "color-mix(in srgb, var(--warning) 30%, transparent)", background: "color-mix(in srgb, var(--warning) 8%, transparent)" }}>
              <p className="mb-1.5 flex items-center gap-1.5 font-medium text-[var(--warning)]"><ShieldAlert className="h-4 w-4" /> Exclusão bloqueada</p>
              {motivos.length > 0 ? (
                <ul className="list-inside list-disc space-y-0.5 text-[var(--text-secondary)]">{motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>
              ) : (
                <p className="text-[var(--text-secondary)]">{`${v.custo ? "Este custo" : "Esta Receita"} não pode ser excluíd${v.custo ? "o" : "a"} no estado atual. Cancele ou estorne os lançamentos antes.`}</p>
              )}
            </div>
          ) : (
            <>
              <p className="flex items-start gap-1.5 rounded-[var(--radius-sm)] border p-3 text-xs text-[var(--text-secondary)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 25%, transparent)", background: "color-mix(in srgb, var(--danger) 5%, transparent)" }}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--danger)]" /> {`A exclusão é lógica: ${v.custo ? "o custo sai" : "a Receita sai"} das listagens, mas o histórico e o Ledger são preservados para auditoria. Esta ação não pode ser desfeita pela tela.`}</p>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Motivo (opcional)</label>
                <textarea value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 300))} rows={2} placeholder="Justificativa (auditoria)" className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--danger)]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Digite <span className="font-semibold text-[var(--danger)]">{CONFIRMA}</span> para confirmar *</label>
                <input value={confirma} onChange={(e) => setConfirma(e.target.value)} placeholder={CONFIRMA} className="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--danger)]" />
              </div>
              {erro && <div className="rounded-[var(--radius-sm)] border p-2.5 text-xs text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{erro}</div>}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <button onClick={() => !enviando && onClose()} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">{permitido ? "Cancelar" : "Fechar"}</button>
          {permitido && (
            <button onClick={excluir} disabled={!valido || enviando || ok} title={valido ? "" : `Digite "${CONFIRMA}" para habilitar`} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-50" style={{ background: "var(--danger)" }}>{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <CheckCircle2 className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />} Excluir definitivamente</button>
          )}
        </div>
      </div>
    </div>
  )
  return createPortal(modal, document.body)
}
