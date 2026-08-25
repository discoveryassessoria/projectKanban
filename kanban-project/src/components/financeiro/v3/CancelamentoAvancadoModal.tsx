// src/components/financeiro/v3/CancelamentoAvancadoModal.tsx
// ============================================================================
// CANCELAMENTO PROFISSIONAL da Receita (Financeiro V3) — substitui o cancelamento
// simples. Seletor de MODO (Total · Parcial por valor · Parcial por % · Por
// participante · Por parcela). A cada mudança consulta o backend em ?preview=1
// (debounce) e exibe a PREVISÃO real (o que cancela / o que permanece / recálculo
// de saldo e parcelas / impacto contábil e financeiro). Só confirma com preview
// válido e motivo informado. Nunca apaga pagamento confirmado (o motor bloqueia).
// Endpoint: POST /api/financeiro/v3/receita/[ref]/cancelamento-avancado.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useConsulta } from "@/src/lib/dados"
import { useDebounce } from "@/src/hooks/use-debounce"
import { createPortal } from "react-dom"
import { LAYER } from "@/src/lib/ui/layers"
import { vocabularioFinanceiro } from "@/lib/financeiro/vocabulario"
import { X, Loader2, CheckCircle2, AlertTriangle, Ban, Info as InfoIcon, ArrowRight } from "lucide-react"
import { authHeaders } from "@/src/lib/financeiro/http"
import { fmtMoeda as money } from "@/src/lib/financeiro/formato"
import { useChaveIdempotencia } from "@/src/lib/financeiro/useChaveIdempotencia"

const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—")
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : Number(v) || 0 }

type Modo = "TOTAL" | "PARCIAL_VALOR" | "PARCIAL_PERCENTUAL" | "POR_PARTICIPANTE" | "POR_PARCELA"
const MODOS: { modo: Modo; label: string; hint: string }[] = [
  { modo: "TOTAL", label: "Total", hint: "Cancela todo o saldo em aberto do lançamento." },
  { modo: "PARCIAL_VALOR", label: "Parcial por valor", hint: "Cancela um valor do saldo em aberto." },
  { modo: "PARCIAL_PERCENTUAL", label: "Parcial por %", hint: "Cancela um percentual do saldo em aberto." },
  { modo: "POR_PARTICIPANTE", label: "Por participante", hint: "Cancela o saldo em aberto de um participante." },
  { modo: "POR_PARCELA", label: "Por parcela", hint: "Cancela parcelas pendentes específicas." },
]

interface Participante { obrigacaoId: number; nome: string }
interface ParcelaAfetada { parcelaId: number; numero: number; vencimento: string | null; valorAntes: number; valorDepois: number; statusDepois: string }
interface Previsao {
  ok: boolean; erros: string[]; modo: Modo; obrigacaoId: number; moeda: string
  oQueCancela: { descricao: string | null; nome: string; valorBase: number }
  oQuePermanece: { saldoAberto: number; recebido: number }
  recalculo: { saldoAntes: number; saldoDepois: number; parcelasAfetadas: ParcelaAfetada[]; cobrancasAfetadas: number[] }
  impactoContabil: { conta: string; direcao: "DEBITO" | "CREDITO"; valor: number }[]
  impactoFinanceiro: { valorContratadoAntes: number; valorContratadoDepois: number; recebido: number; moeda: string }
}

const inputCls = "w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--danger)]"
const labelCls = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]"

export default function CancelamentoAvancadoModal({ receitaRef, participantes, natureza, onClose, onDone }: {
  receitaRef: string; participantes?: Participante[]; natureza?: string; onClose: () => void; onDone?: () => void
}) {
  const v = vocabularioFinanceiro(natureza)
  const [modo, setModo] = useState<Modo>("TOTAL")
  const [valor, setValor] = useState("")
  const [percentual, setPercentual] = useState("")
  const [participanteId, setParticipanteId] = useState<number | null>(null)
  const [parcelaIds, setParcelaIds] = useState<number[]>([])
  const [motivo, setMotivo] = useState("")

  const [parts, setParts] = useState<Participante[]>(participantes ?? [])
  const [parcelas, setParcelas] = useState<{ id: number; numero: number; totalParcelas: number; vencimento: string; valorBrl: number; status: string }[]>([])
  const [moeda, setMoeda] = useState("BRL")


  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const idemKey = useChaveIdempotencia(`cancel-adv-${receitaRef}`)

  // ESC + scroll lock + carga inicial (parcelas pendentes + participantes + moeda).
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !enviando) onClose() }
    document.addEventListener("keydown", onEsc)
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = orig; document.removeEventListener("keydown", onEsc) }
  }, [onClose, enviando])

  useEffect(() => {
    let vivo = true
    fetch(`/api/financeiro/v3/receita/${encodeURIComponent(receitaRef)}`, { headers: authHeaders() })
      .then(async (r) => { const j = await r.json(); if (!vivo || !r.ok || !j.disponivel) return; const d = j.receita
        setMoeda(d.moeda ?? d.moedaBase ?? "BRL")
        if (!participantes?.length && Array.isArray(d.participantes)) setParts(d.participantes.map((p: any) => ({ obrigacaoId: p.obrigacaoId, nome: p.nome })))
        const pend = (d.parcelasDetalhe ?? []).filter((p: any) => !["PAGA", "CANCELADA"].includes(String(p.status).toUpperCase()))
        setParcelas(pend.map((p: any) => ({ id: p.id, numero: p.numero, totalParcelas: p.totalParcelas, vencimento: p.vencimento, valorBrl: p.valorBrl, status: p.status })))
      }).catch(() => {})
    return () => { vivo = false }
  }, [receitaRef, participantes])

  // patch de entrada do modo — o que vai ao preview/execução.
  const patch = useMemo(() => {
    const b: Record<string, unknown> = { modo }
    if (modo === "PARCIAL_VALOR") b.valor = num(valor)
    if (modo === "PARCIAL_PERCENTUAL") b.percentual = num(percentual)
    if (modo === "POR_PARTICIPANTE") b.participanteObrigacaoId = participanteId
    if (modo === "POR_PARCELA") b.parcelaIds = parcelaIds
    return b
  }, [modo, valor, percentual, participanteId, parcelaIds])

  // pré-condição mínima p/ chamar o preview (evita requisição inútil).
  const entradaMinima = useMemo(() => {
    if (modo === "PARCIAL_VALOR") return num(valor) > 0
    if (modo === "PARCIAL_PERCENTUAL") { const p = num(percentual); return p > 0 && p <= 100 }
    if (modo === "POR_PARTICIPANTE") return participanteId != null
    if (modo === "POR_PARCELA") return parcelaIds.length > 0
    return true // TOTAL
  }, [modo, valor, percentual, participanteId, parcelaIds])

  // A previsão é uma LEITURA feita por POST (`?preview=1` não persiste nada). Vira
  // consulta com o patch na CHAVE, e o atraso passa a ser do VALOR: o efeito com
  // `setTimeout` + ref de debounce, que ainda limpava previsão e erro por fora antes de
  // cada disparo, deixa de existir. Enquanto a entrada mínima não está satisfeita, a
  // chave é `null` — nenhuma requisição inútil, como o guard antigo garantia.
  const patchEstavel = useDebounce(JSON.stringify(patch), 450)
  const previewReq = useConsulta<{ ok?: boolean; previsao?: Previsao; erro?: string }>(
    entradaMinima ? `cancelamento-preview:${receitaRef}:${patchEstavel}` : null,
    async () => {
      const r = await fetch(`/api/financeiro/v3/receita/${encodeURIComponent(receitaRef)}/cancelamento-avancado?preview=1`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: patchEstavel,
      })
      const j = await r.json().catch(() => ({}))
      // Erro de NEGÓCIO vem no corpo com 200: continua sendo tratado como erro exibido,
      // e não como falha de rede.
      if (!r.ok || !j?.ok || !j?.previsao) {
        throw new Error(j?.erro || `Falha ao calcular a previsão (HTTP ${r.status}).`)
      }
      return j
    },
  )
  const previsao = entradaMinima ? (previewReq.dados?.previsao ?? null) : null
  const previewing = Boolean(entradaMinima) && previewReq.carregando
  const previewErro = entradaMinima && previewReq.erro
    ? (previewReq.erro.message || "Falha de rede ao calcular a previsão.")
    : null

  const previewValido = !!previsao && previsao.ok && previsao.erros.length === 0
  const valido = previewValido && motivo.trim().length > 0 && !previewing

  const confirmar = async () => {
    if (!valido || enviando) return
    setEnviando(true); setErro(null)
    try {
      const r = await fetch(`/api/financeiro/v3/receita/${encodeURIComponent(receitaRef)}/cancelamento-avancado`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ...patch, motivo: motivo.trim(), idempotencyKey: idemKey.current }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) { setErro(j?.erro || (j?.erros?.[0]) || `Falha ao cancelar (HTTP ${r.status}).`); setEnviando(false); return }
      setOk(true); setTimeout(() => { onDone?.(); onClose() }, 750)
    } catch { setErro("Falha de rede ao cancelar."); setEnviando(false) }
  }

  const modoMeta = MODOS.find((m) => m.modo === modo)!
  const toggleParcela = (id: number) => setParcelaIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])

  if (typeof document === "undefined") return null
  const modal = (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-[var(--app-overlay)] p-4 sm:items-center" style={{ zIndex: LAYER.aboveProcessCritical }} onClick={() => !enviando && onClose()}>
      <div className="my-4 w-full max-w-2xl rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--shadow-surface)]" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]"><Ban className="h-4 w-4 text-[var(--danger)]" /> Cancelamento {v.doDa}</h2>
          <button onClick={() => !enviando && onClose()} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* seletor de modo */}
          <div>
            <label className={labelCls}>Estratégia de cancelamento</label>
            <div className="flex flex-wrap gap-2">
              {MODOS.map((m) => (
                <button key={m.modo} onClick={() => setModo(m.modo)} className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-medium ${modo === m.modo ? "text-[var(--danger)]" : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`} style={modo === m.modo ? { borderColor: "color-mix(in srgb, var(--danger) 50%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" } : undefined}>{m.label}</button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{modoMeta.hint}</p>
          </div>

          {/* campos por modo */}
          {modo === "PARCIAL_VALOR" && (
            <div><label className={labelCls}>Valor a cancelar ({moeda})</label><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className={inputCls} /></div>
          )}
          {modo === "PARCIAL_PERCENTUAL" && (
            <div><label className={labelCls}>Percentual do saldo em aberto (%)</label><input inputMode="decimal" value={percentual} onChange={(e) => setPercentual(e.target.value)} placeholder="0" className={inputCls} /></div>
          )}
          {modo === "POR_PARTICIPANTE" && (
            <div>
              <label className={labelCls}>Participante</label>
              <select value={participanteId ?? ""} onChange={(e) => setParticipanteId(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
                <option value="">— Selecione —</option>
                {parts.map((p) => <option key={p.obrigacaoId} value={p.obrigacaoId}>{p.nome}</option>)}
              </select>
              {parts.length === 0 && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{`Sem participantes disponíveis para ${v.esteEsta}.`}</p>}
            </div>
          )}
          {modo === "POR_PARCELA" && (
            <div>
              <label className={labelCls}>Parcelas pendentes</label>
              {parcelas.length === 0 ? (
                <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-4 text-center text-xs text-[var(--text-muted)]">Nenhuma parcela pendente para cancelar.</div>
              ) : (
                <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] p-2">
                  {parcelas.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-[var(--surface-hover)]">
                      <input type="checkbox" checked={parcelaIds.includes(p.id)} onChange={() => toggleParcela(p.id)} className="accent-[var(--danger)]" />
                      <span className="text-sm font-medium text-[var(--text-primary)]">Parcela {p.numero}/{p.totalParcelas}</span>
                      <span className="text-xs text-[var(--text-muted)]">venc. {dataBR(p.vencimento)}</span>
                      <span className="ml-auto text-sm text-[var(--text-secondary)]">{money(p.valorBrl, "BRL")}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* motivo */}
          <div>
            <label className={labelCls}>Motivo do cancelamento *</label>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 300))} rows={2} placeholder="Justificativa (auditoria)" className={`${inputCls} resize-none`} />
          </div>

          {/* PREVIEW */}
          <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]"><ArrowRight className="h-4 w-4" /> Previsão do cancelamento
              {previewing && <span className="inline-flex items-center gap-1 text-[11px] font-normal text-[var(--text-muted)]"><Loader2 className="h-3 w-3 animate-spin" /> calculando…</span>}
            </div>

            {!entradaMinima ? (
              <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-xs text-[var(--text-muted)]"><InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--info)]" /> Preencha os campos do modo para ver a previsão.</div>
            ) : previewErro ? (
              <div className="rounded-[var(--radius-sm)] border p-3 text-xs text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{previewErro}</div>
            ) : !previsao ? (
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> carregando previsão…</div>
            ) : (
              <div className="space-y-3">
                {previsao.erros.length > 0 && (
                  <div className="rounded-[var(--radius-sm)] border p-3 text-xs text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>
                    <p className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" /> Não é possível cancelar:</p>
                    <ul className="list-inside list-disc space-y-0.5">{previsao.erros.map((e, i) => <li key={i}>{e}</li>)}</ul>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-[var(--radius-sm)] border p-3" style={{ borderColor: "color-mix(in srgb, var(--danger) 25%, transparent)", background: "color-mix(in srgb, var(--danger) 5%, transparent)" }}>
                    <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">O que será cancelado</div>
                    <div className="mt-1 text-lg font-semibold text-[var(--danger)]">{money(previsao.oQueCancela.valorBase, previsao.moeda)}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{previsao.oQueCancela.nome || previsao.oQueCancela.descricao || "Saldo em aberto"}</div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] border p-3" style={{ borderColor: "color-mix(in srgb, var(--success) 25%, transparent)", background: "color-mix(in srgb, var(--success) 5%, transparent)" }}>
                    <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">O que permanece</div>
                    <div className="mt-1 text-lg font-semibold text-[var(--success)]">{money(previsao.oQuePermanece.saldoAberto, previsao.moeda)}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">Saldo em aberto · recebido preservado {money(previsao.oQuePermanece.recebido, previsao.moeda)}</div>
                  </div>
                </div>

                {/* recálculo de saldo */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-[var(--radius-sm)] bg-[var(--surface-secondary)] px-3 py-2.5 text-sm">
                  <div><span className="text-[var(--text-muted)]">Saldo:</span> <span className="text-[var(--text-secondary)]">{money(previsao.recalculo.saldoAntes, previsao.moeda)}</span> <ArrowRight className="mx-0.5 inline h-3 w-3 text-[var(--text-muted)]" /> <span className="font-semibold text-[var(--text-primary)]">{money(previsao.recalculo.saldoDepois, previsao.moeda)}</span></div>
                  <div><span className="text-[var(--text-muted)]">Contratado:</span> <span className="text-[var(--text-secondary)]">{money(previsao.impactoFinanceiro.valorContratadoAntes, previsao.moeda)}</span> <ArrowRight className="mx-0.5 inline h-3 w-3 text-[var(--text-muted)]" /> <span className="font-semibold text-[var(--info)]">{money(previsao.impactoFinanceiro.valorContratadoDepois, previsao.moeda)}</span></div>
                </div>

                {/* parcelas afetadas */}
                {previsao.recalculo.parcelasAfetadas.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Parcelas afetadas ({previsao.recalculo.parcelasAfetadas.length})</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]"><th className="px-2 py-1 font-medium">Parcela</th><th className="px-2 py-1 font-medium">Vencimento</th><th className="px-2 py-1 text-right font-medium">Antes</th><th className="px-2 py-1 text-right font-medium">Depois</th><th className="px-2 py-1 font-medium">Status</th></tr></thead>
                        <tbody>{previsao.recalculo.parcelasAfetadas.map((p) => (
                          <tr key={p.parcelaId} className="border-t border-[var(--border-default)]">
                            <td className="px-2 py-1 text-[var(--text-secondary)]">#{p.numero}</td>
                            <td className="px-2 py-1 text-[var(--text-secondary)]">{dataBR(p.vencimento)}</td>
                            <td className="px-2 py-1 text-right text-[var(--text-muted)]">{money(p.valorAntes, previsao.moeda)}</td>
                            <td className="px-2 py-1 text-right font-medium text-[var(--text-primary)]">{money(p.valorDepois, previsao.moeda)}</td>
                            <td className="px-2 py-1"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${p.statusDepois === "CANCELADA" ? "text-[var(--danger)]" : "text-[var(--accent-text)]"}`} style={{ background: `color-mix(in srgb, ${p.statusDepois === "CANCELADA" ? "var(--danger)" : "var(--accent-primary)"} 15%, transparent)` }}>{p.statusDepois}</span></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                )}
                {previsao.recalculo.cobrancasAfetadas.length > 0 && (
                  <div className="text-[11px] text-[var(--text-muted)]">{previsao.recalculo.cobrancasAfetadas.length} cobrança(s) em aberto afetada(s).</div>
                )}

                {/* impacto contábil */}
                {previsao.impactoContabil.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Impacto contábil (Ledger)</div>
                    <div className="space-y-1">{previsao.impactoContabil.map((l, i) => (
                      <div key={i} className="flex items-center justify-between rounded-[var(--radius-sm)] bg-[var(--surface-secondary)] px-3 py-1.5 text-xs">
                        <span className="text-[var(--text-secondary)]">{l.conta}</span>
                        <span className="inline-flex items-center gap-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${l.direcao === "DEBITO" ? "text-[var(--info)]" : "text-[var(--accent-text)]"}`} style={{ background: `color-mix(in srgb, ${l.direcao === "DEBITO" ? "var(--info)" : "var(--accent-primary)"} 15%, transparent)` }}>{l.direcao}</span><span className="font-medium text-[var(--text-primary)]">{money(l.valor, previsao.moeda)}</span></span>
                      </div>
                    ))}</div>
                  </div>
                )}

                <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border p-2.5 text-[11px] text-[var(--text-secondary)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 25%, transparent)", background: "color-mix(in srgb, var(--danger) 5%, transparent)" }}>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--danger)]" /> Estratégia: <strong>{modoMeta.label}</strong>. Reduz apenas o saldo em aberto no Ledger (append-only); pagamentos confirmados são preservados. A ação é auditável e não apaga histórico.
                </div>
              </div>
            )}
          </div>

          {erro && <div className="rounded-[var(--radius-sm)] border p-2.5 text-xs text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{erro}</div>}
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <button onClick={() => !enviando && onClose()} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Cancelar</button>
          <button onClick={confirmar} disabled={!valido || enviando || ok} title={valido ? "" : !previewValido ? "Ajuste os campos até a previsão ficar válida" : motivo.trim() ? "" : "Informe o motivo"} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-50" style={{ background: "var(--danger)" }}>{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />} Confirmar cancelamento</button>
        </div>
      </div>
    </div>
  )
  return createPortal(modal, document.body)
}
