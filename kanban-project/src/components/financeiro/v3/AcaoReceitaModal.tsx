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
import { X, Loader2, CheckCircle2, AlertTriangle, ReceiptText, RefreshCcw, Ban, Archive, ThumbsDown } from "lucide-react"
import { LAYER } from "@/src/lib/ui/layers"

const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }

export type AcaoReceita = "recibo" | "renegociar" | "cancelar" | "arquivar" | "reprovar"
const META: Record<AcaoReceita, { titulo: string; verbo: string; Ic: any; cor: string; exigeMotivo: boolean; nota: string; endpoint: string }> = {
  recibo: { titulo: "Gerar recibo", verbo: "Gerar recibo", Ic: ReceiptText, cor: "var(--success)", exigeMotivo: false, nota: "Exige ao menos um pagamento confirmado. O recibo consolida os pagamentos recebidos.", endpoint: "recibo" },
  renegociar: { titulo: "Renegociar cobranças", verbo: "Renegociar", Ic: RefreshCcw, cor: "var(--info)", exigeMotivo: true, nota: "Atua apenas sobre cobranças em aberto/parciais. Não altera pagamentos confirmados.", endpoint: "renegociar" },
  cancelar: { titulo: "Cancelar Receita", verbo: "Cancelar Receita", Ic: Ban, cor: "var(--danger)", exigeMotivo: true, nota: "Não apaga cobranças, pagamentos nem lançamentos. Bloqueado se houver pagamento confirmado sem estorno prévio.", endpoint: "cancelar" },
  arquivar: { titulo: "Arquivar Receita", verbo: "Arquivar", Ic: Archive, cor: "var(--info)", exigeMotivo: false, nota: "Não altera saldos. A Receita sai das listagens operacionais.", endpoint: "arquivar" },
  // F7.2 — reprovação: recusa de um custo em análise. Só existe para CUSTO.
  reprovar: { titulo: "Reprovar custo", verbo: "Reprovar custo", Ic: ThumbsDown, cor: "var(--danger)", exigeMotivo: true, nota: "Recusa o custo em análise (Previsto/Aprovado) e encerra a obrigação — o histórico é preservado e a reprovação fica registrada com autor e motivo. Custo já contratado/executado ou com pagamento deve ser cancelado/estornado.", endpoint: "reprovar" },
}

export default function AcaoReceitaModal({ acao, receitaRef, natureza, onClose, onDone }: {
  acao: AcaoReceita; receitaRef: string; natureza?: string; onClose: () => void; onDone?: () => void
}) {
  const ehCusto = natureza === "CUSTO"
  const m = META[acao]
  // Rótulo/nota por direção (evita "Cancelar Receita" e texto de cobrança num custo).
  const titulo = ehCusto && acao === "cancelar" ? "Cancelar custo" : m.titulo
  const verbo = ehCusto && acao === "cancelar" ? "Cancelar custo" : m.verbo
  const nota = ehCusto && acao === "cancelar"
    ? "Estorna automaticamente os pagamentos e lançamentos do custo — o histórico é preservado (estorno auditável) e a obrigação passa a CANCELADO."
    : m.nota
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
      // Cancelar é parametrizado por DIREÇÃO: custo (A_PAGAR) usa o cancelamento de
      // OBRIGAÇÃO (direction-agnóstico, com motivo — reusa cancelarObrigacao); receita
      // mantém o serviço de Receita. Sem duplicar lógica.
      const url = (acao === "cancelar" && ehCusto) || acao === "reprovar"
        ? `/api/financeiro/v3/obrigacoes/${receitaRef}/${m.endpoint}`
        : `/api/financeiro/v3/receita/${receitaRef}/${m.endpoint}`
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.ok === false) { setErro(j?.erro || j?.motivo || `Falha (HTTP ${res.status}).`); setEnviando(false); return }
      const msg = acao === "recibo" && (j?.codigo || j?.recibo?.numero) ? `Recibo ${j.codigo ?? j.recibo?.numero} gerado.` : "Concluído."
      setOk(msg); setTimeout(() => { onDone?.(); onClose() }, 900)
    } catch { setErro("Falha de rede."); setEnviando(false) }
  }

  const modal = (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-[var(--app-overlay)] p-4 sm:items-center" style={{ zIndex: LAYER.aboveProcessCritical }} onClick={onClose}>
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--shadow-surface)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]"><m.Ic className="h-4 w-4" style={{ color: m.cor }} /> {titulo}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="flex items-start gap-1.5 rounded-[var(--radius-sm)] border p-3 text-xs text-[var(--text-secondary)]" style={{ borderColor: `color-mix(in srgb, ${m.cor} 25%, transparent)`, background: `color-mix(in srgb, ${m.cor} 5%, transparent)` }}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: m.cor }} /> {nota}</p>
          {acao === "renegociar" && (
            <div><label className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Nova data de vencimento (opcional)</label><input type="date" value={novaData} onChange={(e) => setNovaData(e.target.value)} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--info)]" /></div>
          )}
          {m.exigeMotivo && (
            <div><label className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{acao === "cancelar" ? "Motivo do cancelamento *" : acao === "reprovar" ? "Motivo da reprovação *" : "Observação / motivo *"}</label><textarea value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 300))} rows={3} className="mt-1 w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]" placeholder="Justificativa (auditoria)" /></div>
          )}
          {erro && <div className="rounded-[var(--radius-sm)] border p-2.5 text-xs text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{erro}</div>}
          {ok && <div className="rounded-[var(--radius-sm)] border p-2.5 text-xs text-[var(--success)]" style={{ borderColor: "color-mix(in srgb, var(--success) 30%, transparent)", background: "color-mix(in srgb, var(--success) 10%, transparent)" }}>{ok}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <button onClick={onClose} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Cancelar</button>
          <button onClick={executar} disabled={!valido || enviando || !!ok} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-50" style={{ background: m.cor }}>{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <CheckCircle2 className="h-4 w-4" /> : <m.Ic className="h-4 w-4" />} {verbo}</button>
        </div>
      </div>
    </div>
  )
  return typeof document !== "undefined" ? createPortal(modal, document.body) : null
}
