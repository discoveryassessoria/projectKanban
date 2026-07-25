// src/components/financeiro/v3/RegistrarPagamentoModal.tsx
// ============================================================================
// Modal REAL de "Registrar pagamento" para uma obrigação V3 existente (receita
// ou custo). POST /api/financeiro/v3/ocorrencias (motor V3, registrarOcorrencia).
// Discovery Design System (graphite sólido). Sem mocks: registra de verdade,
// e o chamador refetcha ao concluir (onDone).
// ============================================================================
"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { LAYER } from "@/src/lib/ui/layers"
import { X, Loader2, CheckCircle2 } from "lucide-react"

const authHeaders = (extra?: Record<string, string>): Record<string, string> => {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(extra ?? {}) }
}
const fmt = (v: number, m = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)

interface FormaPagamento { id: number; nome: string }

export type PagamentoNatureza = "RECEITA" | "CUSTO"

interface Props {
  obrigacaoId: number
  moeda?: string
  saldo?: number | null
  natureza?: PagamentoNatureza // só rótulos; o motor roteia pela direção da obrigação
  onClose: () => void
  onDone: () => void
}

const inp =
  "mt-1 w-full rounded-lg border border-white/10 bg-[#12161c] px-3 py-2 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/25"
const lbl = "block text-[11px] font-medium uppercase tracking-wider text-white/45"

export default function RegistrarPagamentoModal({ obrigacaoId, moeda = "BRL", saldo, natureza = "RECEITA", onClose, onDone }: Props) {
  const recebido = natureza === "CUSTO"
  const [valor, setValor] = useState(saldo && saldo > 0 ? String(saldo).replace(".", ",") : "")
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [formaId, setFormaId] = useState("")
  const [formas, setFormas] = useState<FormaPagamento[]>([])
  const [politica, setPolitica] = useState("FIFO")
  const [pagadorTipo, setPagadorTipo] = useState(recebido ? "EMPRESA" : "REQUERENTE")
  const [pessoaId, setPessoaId] = useState("")
  const [externo, setExterno] = useState("")
  const [referencia, setReferencia] = useState("")
  const [comprovante, setComprovante] = useState("")
  const [obs, setObs] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // ESC + scroll lock
  useEffect(() => {
    const orig = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !salvando) onClose() }
    document.addEventListener("keydown", onEsc)
    return () => { document.body.style.overflow = orig; document.removeEventListener("keydown", onEsc) }
  }, [onClose, salvando])

  // formas de pagamento reais (degrade gracioso se indisponível)
  useEffect(() => {
    let vivo = true
    fetch("/api/gerenciamento/formas-pagamento", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!vivo || !j) return
        const arr: any[] = Array.isArray(j) ? j : (j.formas ?? j.data ?? [])
        setFormas(arr.map((f) => ({ id: f.id, nome: f.nome ?? f.label ?? f.descricao ?? `Forma ${f.id}` })).filter((f) => f.id != null))
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [])

  const valorNum = parseFloat(valor.replace(/\./g, "").replace(",", "."))
  const valido = !isNaN(valorNum) && valorNum > 0
  const parcial = saldo != null && saldo > 0 && valido && valorNum < saldo - 0.005

  const enviar = async () => {
    if (!valido) { setErro("Informe um valor válido."); return }
    setSalvando(true); setErro(null)
    const pagador =
      pagadorTipo === "EXTERNO"
        ? { tipo: "EXTERNO", parteExterna: { nome: externo.trim() || "Externo" } }
        : (pessoaId ? { tipo: pagadorTipo, pessoaId: Number(pessoaId) } : { tipo: pagadorTipo })
    const body: Record<string, unknown> = {
      obrigacaoId,
      tipo: parcial ? "PAGAMENTO_PARCIAL" : "PAGAMENTO",
      valor: valorNum,
      moeda,
      data,
      formaPagamentoId: formaId ? Number(formaId) : null,
      origemRecurso: referencia.trim() || null,
      pagador,
      aplicacao: { politica },
      excedenteDestino: "CREDITO",
      comprovanteUrl: comprovante.trim() || null,
      observacao: obs.trim() || null,
      idempotencyKey: `pag:${obrigacaoId}:${data}:${Math.round(valorNum * 100)}:${formaId || "-"}`,
    }
    try {
      const r = await fetch("/api/financeiro/v3/ocorrencias", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.ok) { onDone() }
      else setErro(j.erro || j.motivo || `Falha ao registrar (HTTP ${r.status}).`)
    } catch {
      setErro("Falha de rede ao registrar o pagamento.")
    } finally {
      setSalvando(false)
    }
  }

  if (typeof window === "undefined") return null

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/65" style={{ zIndex: LAYER.aboveProcess }} onClick={() => !salvando && onClose()} />
      <div className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none" style={{ zIndex: LAYER.aboveProcess }}>
        <div className="pointer-events-auto flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0d1117] shadow-2xl">
          {/* header */}
          <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-[#161b21] px-5 py-4">
            <div>
              <div className="text-[15px] font-bold text-white">{recebido ? "Registrar pagamento do custo" : "Registrar pagamento"}</div>
              <div className="mt-0.5 text-[12px] text-white/55">
                {saldo != null ? <>Saldo {recebido ? "a pagar" : "em aberto"}: <strong className="text-white/80">{fmt(saldo, moeda)}</strong></> : "Lançamento no motor financeiro"}
              </div>
            </div>
            <button onClick={() => !salvando && onClose()} className="flex h-8 w-8 items-center justify-center rounded-md text-white/60 hover:bg-white/5 hover:text-white" aria-label="Fechar"><X className="h-4 w-4" /></button>
          </div>

          {/* body */}
          <div className="grid grid-cols-2 gap-4 overflow-y-auto px-5 py-5">
            <div>
              <label className={lbl}>Valor ({moeda}) *</label>
              <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" className={inp} autoFocus />
              {parcial && <div className="mt-1 text-[11px] text-[#d2a948]">Pagamento parcial — restará {fmt(saldo! - valorNum, moeda)}.</div>}
            </div>
            <div>
              <label className={lbl}>Data *</label>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inp} />
            </div>

            <div>
              <label className={lbl}>Forma de pagamento</label>
              <select value={formaId} onChange={(e) => setFormaId(e.target.value)} className={inp}>
                <option value="" className="bg-[#20262e]">— Selecione —</option>
                {formas.map((f) => <option key={f.id} value={f.id} className="bg-[#20262e]">{f.nome}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Aplicação</label>
              <select value={politica} onChange={(e) => setPolitica(e.target.value)} className={inp}>
                <option value="FIFO" className="bg-[#20262e]">Mais antigas primeiro (FIFO)</option>
                <option value="PROPORCIONAL" className="bg-[#20262e]">Proporcional</option>
              </select>
            </div>

            <div>
              <label className={lbl}>{recebido ? "Beneficiário" : "Pagador"}</label>
              <select value={pagadorTipo} onChange={(e) => setPagadorTipo(e.target.value)} className={inp}>
                {["REQUERENTE", "EMPRESA", "TERCEIRO", "EXTERNO"].map((t) => <option key={t} value={t} className="bg-[#20262e]">{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <div>
              {pagadorTipo === "EXTERNO" ? (
                <><label className={lbl}>Nome externo</label><input value={externo} onChange={(e) => setExterno(e.target.value)} placeholder="Ex: Banco / Terceiro" className={inp} /></>
              ) : (
                <><label className={lbl}>Pessoa (id, opcional)</label><input value={pessoaId} onChange={(e) => setPessoaId(e.target.value)} inputMode="numeric" placeholder="—" className={inp} /></>
              )}
            </div>

            <div className="col-span-2">
              <label className={lbl}>Referência</label>
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Nº do comprovante / origem do recurso" className={inp} />
            </div>
            <div className="col-span-2">
              <label className={lbl}>Comprovante (URL)</label>
              <input value={comprovante} onChange={(e) => setComprovante(e.target.value)} placeholder="https://…" className={inp} />
            </div>
            <div className="col-span-2">
              <label className={lbl}>Observação</label>
              <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" className={inp} />
            </div>

            {erro && <div className="col-span-2 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[12px] text-[#f87171]">{erro}</div>}
          </div>

          {/* footer */}
          <div className="flex items-center justify-end gap-3 border-t border-white/10 bg-[#11151b] px-5 py-4">
            <button onClick={() => !salvando && onClose()} disabled={salvando} className="rounded-lg px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:bg-white/5 hover:text-white disabled:opacity-50">Cancelar</button>
            <button onClick={enviar} disabled={salvando || !valido} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-[12.5px] font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {salvando ? "Registrando…" : "Registrar pagamento"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
