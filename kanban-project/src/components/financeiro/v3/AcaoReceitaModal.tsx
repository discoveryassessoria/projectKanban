// src/components/financeiro/v3/AcaoReceitaModal.tsx
// ============================================================================
// Modal genérico das "Mais Ações" da Receita (fluxo completo — nunca botão morto):
// Gerar Recibo · Renegociar · Cancelar · Arquivar. Cada ação chama o endpoint real
// v3/receita/[ref]/<acao>, valida no backend, audita e atualiza a tela. Não apaga
// cobrança/pagamento/ledger. Reusa o padrão de fetch/portal das demais telas.
// ============================================================================
"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, CheckCircle2, AlertTriangle, ReceiptText, RefreshCcw, Ban, Archive } from "lucide-react"

const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }

export type AcaoReceita = "recibo" | "renegociar" | "cancelar" | "arquivar"
const META: Record<AcaoReceita, { titulo: string; verbo: string; Ic: any; cor: string; exigeMotivo: boolean; nota: string; endpoint: string }> = {
  recibo: { titulo: "Gerar recibo", verbo: "Gerar recibo", Ic: ReceiptText, cor: "#4ade80", exigeMotivo: false, nota: "Exige ao menos um pagamento confirmado. O recibo consolida os pagamentos recebidos.", endpoint: "recibo" },
  renegociar: { titulo: "Renegociar cobranças", verbo: "Renegociar", Ic: RefreshCcw, cor: "#7dd3fc", exigeMotivo: true, nota: "Atua apenas sobre cobranças em aberto/parciais. Não altera pagamentos confirmados.", endpoint: "renegociar" },
  cancelar: { titulo: "Cancelar Receita", verbo: "Cancelar Receita", Ic: Ban, cor: "#f87171", exigeMotivo: true, nota: "Não apaga cobranças, pagamentos nem lançamentos. Bloqueado se houver pagamento confirmado sem estorno prévio.", endpoint: "cancelar" },
  arquivar: { titulo: "Arquivar Receita", verbo: "Arquivar", Ic: Archive, cor: "#a78bfa", exigeMotivo: false, nota: "Não altera saldos. A Receita sai das listagens operacionais.", endpoint: "arquivar" },
}

export default function AcaoReceitaModal({ acao, receitaRef, onClose, onDone }: {
  acao: AcaoReceita; receitaRef: string; onClose: () => void; onDone?: () => void
}) {
  const m = META[acao]
  const [motivo, setMotivo] = useState("")
  const [novaData, setNovaData] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onEsc)
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = orig; document.removeEventListener("keydown", onEsc) }
  }, [onClose])

  const valido = !m.exigeMotivo || motivo.trim().length > 0

  const executar = async () => {
    if (!valido || enviando) return
    setEnviando(true); setErro(null)
    try {
      const body: Record<string, unknown> = {}
      if (m.exigeMotivo) body.motivo = motivo.trim()
      if (acao === "renegociar") { body.observacao = motivo.trim(); if (novaData) body.novaData = novaData }
      if (acao === "cancelar") body.observacao = motivo.trim()
      const res = await fetch(`/api/financeiro/v3/receita/${receitaRef}/${m.endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.ok === false) { setErro(j?.erro || j?.motivo || `Falha (HTTP ${res.status}).`); setEnviando(false); return }
      const msg = acao === "recibo" && (j?.codigo || j?.recibo?.numero) ? `Recibo ${j.codigo ?? j.recibo?.numero} gerado.` : "Concluído."
      setOk(msg); setTimeout(() => { onDone?.(); onClose() }, 900)
    } catch { setErro("Falha de rede."); setEnviando(false) }
  }

  const modal = (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#161b21] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white"><m.Ic className="h-4 w-4" style={{ color: m.cor }} /> {m.titulo}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white/70"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="flex items-start gap-1.5 rounded-lg border p-3 text-xs text-white/70" style={{ borderColor: `${m.cor}40`, background: `${m.cor}0d` }}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: m.cor }} /> {m.nota}</p>
          {acao === "renegociar" && (
            <div><label className="text-[11px] uppercase tracking-wide text-white/50">Nova data de vencimento (opcional)</label><input type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#20262e] px-3 py-2 text-sm text-white outline-none focus:border-[#7dd3fc]/50" /></div>
          )}
          {m.exigeMotivo && (
            <div><label className="text-[11px] uppercase tracking-wide text-white/50">{acao === "cancelar" ? "Motivo do cancelamento *" : "Observação / motivo *"}</label><textarea value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 300))} rows={3} className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-[#20262e] px-3 py-2 text-sm text-white outline-none focus:border-white/25" placeholder="Justificativa (auditoria)" /></div>
          )}
          {erro && <div className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 p-2.5 text-xs text-[#f87171]">{erro}</div>}
          {ok && <div className="rounded-lg border border-[#4ade80]/30 bg-[#4ade80]/10 p-2.5 text-xs text-[#4ade80]">{ok}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/5">Cancelar</button>
          <button onClick={executar} disabled={!valido || enviando || !!ok} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-[#0d1117] disabled:cursor-not-allowed disabled:opacity-50" style={{ background: m.cor }}>{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <CheckCircle2 className="h-4 w-4" /> : <m.Ic className="h-4 w-4" />} {m.verbo}</button>
        </div>
      </div>
    </div>
  )
  return typeof document !== "undefined" ? createPortal(modal, document.body) : null
}
