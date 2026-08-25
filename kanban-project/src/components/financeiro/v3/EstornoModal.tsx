// src/components/financeiro/v3/EstornoModal.tsx
// ============================================================================
// ESTORNO rico de um pagamento (Financeiro V3). Total ou PARCIAL, com motivo
// obrigatório, observação e comprovante. Lança um movimento NEGATIVO vinculado
// (tipo ESTORNO, estornaOcorrenciaId) — nunca apaga nem edita o pagamento
// original (integridade contábil). Reusa POST /api/financeiro/v3/ocorrencias.
// ============================================================================
"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, Upload, AlertTriangle, RotateCcw, CheckCircle2, Trash2, Eye } from "lucide-react"
import { LAYER } from "@/src/lib/ui/layers"
import { uploadFiles } from "@/src/lib/storage"
import { authHeaders } from "@/src/lib/financeiro/http"
import { fmtMoeda as money } from "@/src/lib/financeiro/formato"
import { useChaveIdempotencia } from "@/src/lib/financeiro/useChaveIdempotencia"

const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—")
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : Number(v) || 0 }
const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const hoje = () => new Date().toISOString().slice(0, 10)

export interface PagamentoEstorno { id: number; valor: number; data: string; formaLabel?: string | null; referencia?: string | null }
// Categorias canônicas de motivo de estorno (estruturadas — vão para timeline + auditoria).
const MOTIVOS = [
  "Pagamento duplicado", "Valor incorreto", "Pagador incorreto", "Cobrança incorreta",
  "Devolução ao cliente", "Chargeback", "Erro operacional", "Fraude ou contestação",
  "Cancelamento contratual", "Outro",
]

export default function EstornoModal({ obrigacaoId, moeda, pagamento, onClose, onDone }: {
  obrigacaoId: number; moeda: string; pagamento: PagamentoEstorno; onClose: () => void; onDone?: () => void
}) {
  const [tipo, setTipo] = useState<"TOTAL" | "PARCIAL">("TOTAL")
  const [valor, setValor] = useState<string>("")
  const [data, setData] = useState(hoje())
  const [motivo, setMotivo] = useState("")
  const [motivoOutro, setMotivoOutro] = useState("")
  const [obs, setObs] = useState("")
  const [comprovante, setComprovante] = useState<{ url: string; nome: string; size: number } | null>(null)
  const [subindo, setSubindo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const idemKey = useChaveIdempotencia(`estorno-${pagamento.id}`)

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onEsc)
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = orig; document.removeEventListener("keydown", onEsc) }
  }, [onClose])

  const original = cent(pagamento.valor)
  const valorEstorno = tipo === "TOTAL" ? original : cent(num(valor))
  const saldoResultante = cent(original - valorEstorno)
  // categoria (select) + detalhe. "Outro" EXIGE detalhamento.
  const categoria = motivo
  const detalhe = motivoOutro.trim()
  const motivoFinal = motivo === "Outro" ? detalhe : motivo

  const pendencias = useMemo(() => {
    const p: string[] = []
    if (!categoria) p.push("Selecione a categoria do motivo do estorno.")
    if (categoria === "Outro" && !detalhe) p.push("Categoria 'Outro' exige uma justificativa detalhada.")
    if (tipo === "PARCIAL") { if (valorEstorno <= 0) p.push("Informe o valor do estorno parcial."); if (valorEstorno > original + 0.005) p.push("O estorno não pode exceder o valor do pagamento.") }
    return p
  }, [categoria, detalhe, tipo, valorEstorno, original])
  const valido = pendencias.length === 0

  const onFile = async (files: FileList | null) => {
    if (!files?.length) return
    setSubindo(true)
    try { const [e] = await uploadFiles([files[0]], { prefix: "financeiro/estornos" }); setComprovante({ url: e.url, nome: e.name, size: e.size }) }
    catch { setErro("Falha no upload do comprovante.") } finally { setSubindo(false) }
  }

  const confirmar = async () => {
    if (!valido || enviando) return
    setEnviando(true); setErro(null)
    try {
      const res = await fetch("/api/financeiro/v3/ocorrencias", {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          obrigacaoId, tipo: "ESTORNO", valor: valorEstorno, estornaOcorrenciaId: pagamento.id, data, idempotencyKey: idemKey.current,
          // categoria estruturada + observação legível (categoria vai p/ timeline + auditoria).
          categoria,
          observacao: [`[${categoria}]`, motivo === "Outro" ? detalhe : null, obs].filter(Boolean).join(" — ").slice(0, 300),
          comprovanteUrl: comprovante?.url ?? null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setErro(j?.erro || j?.motivo || `Falha ao estornar (HTTP ${res.status}).`); setEnviando(false); return }
      setOk(true); setTimeout(() => { onDone?.(); onClose() }, 650)
    } catch { setErro("Falha de rede ao estornar."); setEnviando(false) }
  }

  const inputCls = "w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--danger)]"
  const modal = (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-[var(--app-overlay)] p-4 sm:items-center" style={{ zIndex: LAYER.aboveProcessCritical }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--elev-2)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]"><RotateCcw className="h-4 w-4 text-[var(--danger)]" /> Estornar pagamento</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* pagamento original */}
          <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-3 text-sm">
            <div className="flex items-center justify-between"><span className="text-[var(--text-muted)]">Pagamento #{pagamento.id}</span><span className="font-semibold text-[var(--text-primary)]">{money(original, moeda)}</span></div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">{dataBR(pagamento.data)}{pagamento.formaLabel ? ` · ${pagamento.formaLabel}` : ""}{pagamento.referencia ? ` · ${pagamento.referencia}` : ""}</div>
          </div>

          {/* tipo */}
          <div className="flex gap-2">
            {(["TOTAL", "PARCIAL"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className={`flex-1 rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-medium ${tipo === t ? "text-[var(--danger)]" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}
                style={tipo === t ? { borderColor: "color-mix(in srgb, var(--danger) 50%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" } : undefined}
              >{t === "TOTAL" ? "Estorno total" : "Estorno parcial"}</button>
            ))}
          </div>
          {tipo === "PARCIAL" && (
            <div><label className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Valor do estorno ({moeda})</label><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className={`${inputCls} mt-1`} /><p className="mt-1 text-[11px] text-[var(--text-muted)]">Máximo {money(original, moeda)}.</p></div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Data do estorno</label><input type="date" value={data} onChange={(e) => setData(e.target.value)} className={`${inputCls} mt-1`} /></div>
            <div><label className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Categoria do motivo *</label><select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={`${inputCls} mt-1`}><option value="">Selecione…</option>{MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
          </div>
          {motivo === "Outro" && <div><label className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Justificativa detalhada * (categoria Outro)</label><input value={motivoOutro} onChange={(e) => setMotivoOutro(e.target.value)} placeholder="Descreva o motivo do estorno" className={`${inputCls} mt-1`} /></div>}

          <div><label className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Observação</label><textarea value={obs} onChange={(e) => setObs(e.target.value.slice(0, 240))} rows={2} className={`${inputCls} mt-1 resize-none`} placeholder="Detalhes internos (opcional)" /></div>

          {/* comprovante */}
          <div>
            <label className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Comprovante</label>
            {comprovante ? (
              <div className="mt-1 flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--surface-primary)] px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{comprovante.nome}</span><a href={comprovante.url} target="_blank" rel="noreferrer" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><Eye className="h-4 w-4" /></a><button onClick={() => setComprovante(null)} className="text-[var(--text-muted)] hover:text-[var(--danger)]"><Trash2 className="h-4 w-4" /></button></div>
            ) : (
              <button onClick={() => fileRef.current?.click()} className="mt-1 flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-strong)] bg-[var(--surface-primary)] px-3 py-2.5 text-xs text-[var(--text-muted)] hover:border-[var(--border-strong)]">{subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Anexar comprovante</button>
            )}
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" className="hidden" onChange={(e) => onFile(e.target.files)} />
          </div>

          {/* resumo / impacto previsto antes de confirmar */}
          <div className="rounded-[var(--radius-sm)] border p-3 text-xs text-[var(--text-secondary)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 25%, transparent)", background: "color-mix(in srgb, var(--danger) 5%, transparent)" }}>
            <div className="mb-2 grid grid-cols-3 gap-2 text-center">
              <div><div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Pago</div><div className="font-semibold text-[var(--text-primary)]">{money(original, moeda)}</div></div>
              <div><div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">A estornar</div><div className="font-semibold text-[var(--danger)]">{money(valorEstorno, moeda)}</div></div>
              <div><div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Resta no pagamento</div><div className="font-semibold text-[var(--text-primary)]">{money(saldoResultante, moeda)}</div></div>
            </div>
            <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--danger)]" /> Reverte o razão, reabre o saldo da cobrança e revoga o crédito de excedente proporcional (se houver). O pagamento original é preservado (nunca apagado). <span className="text-[var(--danger)]">Irreversível pela tela — desfazer exige um novo lançamento.</span></p>
          </div>
          {erro && <div className="rounded-[var(--radius-sm)] border p-2.5 text-xs text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{erro}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <button onClick={onClose} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Cancelar</button>
          <button onClick={confirmar} disabled={!valido || enviando || ok} title={valido ? "" : pendencias[0]} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: "var(--danger)" }}>{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <CheckCircle2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />} Confirmar estorno</button>
        </div>
      </div>
    </div>
  )
  return typeof document !== "undefined" ? createPortal(modal, document.body) : null
}
