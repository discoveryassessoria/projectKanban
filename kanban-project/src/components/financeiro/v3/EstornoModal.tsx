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
import { uploadFiles } from "@/src/lib/storage"

const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const money = (v: number, m: string) => { try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: m || "BRL" }).format(v || 0) } catch { return `${(v || 0).toFixed(2)} ${m}` } }
const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—")
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : Number(v) || 0 }
const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const hoje = () => new Date().toISOString().slice(0, 10)

export interface PagamentoEstorno { id: number; valor: number; data: string; formaLabel?: string | null; referencia?: string | null }
const MOTIVOS = ["Pagamento em duplicidade", "Valor incorreto", "Estorno solicitado pelo cliente", "Cancelamento da operação", "Erro de lançamento", "Outro"]

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

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onEsc)
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = orig; document.removeEventListener("keydown", onEsc) }
  }, [onClose])

  const original = cent(pagamento.valor)
  const valorEstorno = tipo === "TOTAL" ? original : cent(num(valor))
  const motivoFinal = motivo === "Outro" ? motivoOutro.trim() : motivo

  const pendencias = useMemo(() => {
    const p: string[] = []
    if (!motivoFinal) p.push("Informe o motivo do estorno.")
    if (tipo === "PARCIAL") { if (valorEstorno <= 0) p.push("Informe o valor do estorno parcial."); if (valorEstorno > original + 0.005) p.push("O estorno não pode exceder o valor do pagamento.") }
    return p
  }, [motivoFinal, tipo, valorEstorno, original])
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
          obrigacaoId, tipo: "ESTORNO", valor: valorEstorno, estornaOcorrenciaId: pagamento.id, data,
          observacao: [motivoFinal, obs].filter(Boolean).join(" — ").slice(0, 300), comprovanteUrl: comprovante?.url ?? null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setErro(j?.erro || j?.motivo || `Falha ao estornar (HTTP ${res.status}).`); setEnviando(false); return }
      setOk(true); setTimeout(() => { onDone?.(); onClose() }, 650)
    } catch { setErro("Falha de rede ao estornar."); setEnviando(false) }
  }

  const inputCls = "w-full rounded-lg border border-white/10 bg-[#20262e] px-3 py-2 text-sm text-white outline-none focus:border-[#f87171]/50"
  const modal = (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#161b21] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white"><RotateCcw className="h-4 w-4 text-[#f87171]" /> Estornar pagamento</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white/70"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* pagamento original */}
          <div className="rounded-lg border border-white/10 bg-[#1b2027] p-3 text-sm">
            <div className="flex items-center justify-between"><span className="text-white/50">Pagamento #{pagamento.id}</span><span className="font-semibold text-white">{money(original, moeda)}</span></div>
            <div className="mt-1 text-xs text-white/40">{dataBR(pagamento.data)}{pagamento.formaLabel ? ` · ${pagamento.formaLabel}` : ""}{pagamento.referencia ? ` · ${pagamento.referencia}` : ""}</div>
          </div>

          {/* tipo */}
          <div className="flex gap-2">
            {(["TOTAL", "PARCIAL"] as const).map((t) => (
              <button key={t} onClick={() => setTipo(t)} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${tipo === t ? "border-[#f87171]/50 bg-[#f87171]/10 text-[#f87171]" : "border-white/10 text-white/60 hover:bg-white/5"}`}>{t === "TOTAL" ? "Estorno total" : "Estorno parcial"}</button>
            ))}
          </div>
          {tipo === "PARCIAL" && (
            <div><label className="text-[11px] uppercase tracking-wide text-white/50">Valor do estorno ({moeda})</label><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className={`${inputCls} mt-1`} /><p className="mt-1 text-[11px] text-white/40">Máximo {money(original, moeda)}.</p></div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[11px] uppercase tracking-wide text-white/50">Data do estorno</label><input type="date" value={data} onChange={(e) => setData(e.target.value)} className={`${inputCls} mt-1`} /></div>
            <div><label className="text-[11px] uppercase tracking-wide text-white/50">Motivo *</label><select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={`${inputCls} mt-1`}><option value="">Selecione…</option>{MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
          </div>
          {motivo === "Outro" && <input value={motivoOutro} onChange={(e) => setMotivoOutro(e.target.value)} placeholder="Descreva o motivo" className={inputCls} />}

          <div><label className="text-[11px] uppercase tracking-wide text-white/50">Observação</label><textarea value={obs} onChange={(e) => setObs(e.target.value.slice(0, 240))} rows={2} className={`${inputCls} mt-1 resize-none`} placeholder="Detalhes internos (opcional)" /></div>

          {/* comprovante */}
          <div>
            <label className="text-[11px] uppercase tracking-wide text-white/50">Comprovante</label>
            {comprovante ? (
              <div className="mt-1 flex items-center gap-2 rounded-lg bg-[#1b2027] px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate text-white/80">{comprovante.nome}</span><a href={comprovante.url} target="_blank" rel="noreferrer" className="text-white/40 hover:text-white/70"><Eye className="h-4 w-4" /></a><button onClick={() => setComprovante(null)} className="text-white/40 hover:text-[#f87171]"><Trash2 className="h-4 w-4" /></button></div>
            ) : (
              <button onClick={() => fileRef.current?.click()} className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-[#1b2027] px-3 py-2.5 text-xs text-white/50 hover:border-white/25">{subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Anexar comprovante</button>
            )}
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" className="hidden" onChange={(e) => onFile(e.target.files)} />
          </div>

          {/* resumo */}
          <div className="rounded-lg border border-[#f87171]/25 bg-[#f87171]/5 p-3 text-xs text-white/70">
            <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f87171]" /> Será lançado um estorno de <span className="mx-1 font-semibold text-[#f87171]">{money(valorEstorno, moeda)}</span> vinculado ao pagamento #{pagamento.id}. O pagamento original é preservado (nunca apagado/editado).</p>
          </div>
          {erro && <div className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 p-2.5 text-xs text-[#f87171]">{erro}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/5">Cancelar</button>
          <button onClick={confirmar} disabled={!valido || enviando || ok} title={valido ? "" : pendencias[0]} className="inline-flex items-center gap-2 rounded-lg bg-[#f87171] px-4 py-2 text-sm font-semibold text-[#2a0e0e] hover:bg-[#fb8a8a] disabled:cursor-not-allowed disabled:opacity-50">{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <CheckCircle2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />} Confirmar estorno</button>
        </div>
      </div>
    </div>
  )
  return typeof document !== "undefined" ? createPortal(modal, document.body) : null
}
