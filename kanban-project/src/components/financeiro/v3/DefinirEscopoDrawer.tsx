// src/components/financeiro/v3/DefinirEscopoDrawer.tsx
// ============================================================================
// Drawer "Definir escopo do pagamento" (Registrar Pagamento). O botão GERAL da
// Receita NUNCA abre no valor/cobrança de um participante — obriga a escolher:
// cobrança específica · várias cobranças · participante · geral · adiantamento ·
// crédito recebido. Retorna o escopo escolhido (persistido no pagamento).
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, Receipt, Layers, User as UserIcon, Wallet, ArrowDownCircle, Coins, ChevronRight, Check } from "lucide-react"
import { authHeaders } from "@/src/lib/financeiro/http"
import { fmtBrl as brl } from "@/src/lib/financeiro/formato"

// Identidade ESTÁVEL para a ausência de dados. `?? []` criava um array novo a
// cada render, e qualquer useMemo que dependesse dele recomputava sempre —
// era a memoização se anulando sozinha. Congelado: ninguém pode mutá-lo.
const SEM_COBRANCAS: any[] = Object.freeze([]) as unknown as any[]

const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—")

export type EscopoTipo = "COBRANCA" | "VARIAS" | "PARTICIPANTE" | "GERAL" | "ADIANTAMENTO" | "CREDITO"
export interface EscopoEscolhido {
  tipo: EscopoTipo
  tag: string
  obrigacaoId: number
  saldoBrl: number
  cobrancaChaves?: string[]
  participanteNome?: string
}

const OPCOES: { tipo: EscopoTipo; lb: string; desc: string; Ic: any }[] = [
  { tipo: "COBRANCA", lb: "Pagamento de uma cobrança específica", desc: "Aplica em uma cobrança/parcela em aberto.", Ic: Receipt },
  { tipo: "VARIAS", lb: "Pagamento de várias cobranças", desc: "Seleciona múltiplas cobranças em aberto.", Ic: Layers },
  { tipo: "PARTICIPANTE", lb: "Pagamento de um participante", desc: "Escolhe o participante e suas cobranças.", Ic: UserIcon },
  { tipo: "GERAL", lb: "Pagamento geral da Receita", desc: "Sem cobrança/participante fixo; define aplicação depois.", Ic: Wallet },
  { tipo: "ADIANTAMENTO", lb: "Adiantamento sem cobrança definida", desc: "Registra recebimento e gera crédito disponível.", Ic: ArrowDownCircle },
  { tipo: "CREDITO", lb: "Crédito recebido", desc: "Recebimento que vira crédito financeiro do processo.", Ic: Coins },
]

export default function DefinirEscopoDrawer({ receitaRef, onEscolher, onClose }: {
  receitaRef: string; onEscolher: (e: EscopoEscolhido) => void; onClose: () => void
}) {
  const [esc, setEsc] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [tipo, setTipo] = useState<EscopoTipo | null>(null)
  const [selCobrancas, setSelCobrancas] = useState<string[]>([])
  const [selParticipante, setSelParticipante] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    ;(async () => {
      try {
        const r = await fetch(`/api/financeiro/v3/receita/${receitaRef}/escopo`, { headers: authHeaders() }).then((x) => x.json())
        if (!vivo) return
        if (!r?.ok) { setErro(r?.erro ?? "Falha ao carregar escopo."); return }
        setEsc(r.escopo)
      } catch { if (vivo) setErro("Falha de rede.") } finally { if (vivo) setLoading(false) }
    })()
    return () => { vivo = false; document.body.style.overflow = orig }
  }, [receitaRef])

  const cobrancas: any[] = esc?.cobrancas ?? SEM_COBRANCAS
  const participantes: any[] = esc?.participantes ?? []
  const cobrancasDoParticipante = useMemo(() => cobrancas.filter((c) => c.obrigacaoId === selParticipante), [cobrancas, selParticipante])

  const podeConfirmar = useMemo(() => {
    if (!tipo) return false
    if (tipo === "COBRANCA") return selCobrancas.length === 1
    if (tipo === "VARIAS") return selCobrancas.length >= 1
    if (tipo === "PARTICIPANTE") return selParticipante != null
    return true // GERAL/ADIANTAMENTO/CREDITO
  }, [tipo, selCobrancas, selParticipante])

  const confirmar = () => {
    if (!podeConfirmar || !esc) return
    if (tipo === "COBRANCA" || tipo === "VARIAS") {
      const escolhidas = cobrancas.filter((c) => selCobrancas.includes(c.chave))
      const saldo = escolhidas.reduce((s, c) => s + c.saldoBrl, 0)
      const obrig = escolhidas[0]?.obrigacaoId ?? esc.obrigacaoIdRef
      onEscolher({ tipo: tipo!, tag: tipo === "COBRANCA" ? `Cobrança — ${escolhidas[0]?.participanteNome} · parc. ${escolhidas[0]?.parcelaNumero}/${escolhidas[0]?.totalParcelas}` : `${escolhidas.length} cobranças selecionadas`, obrigacaoId: obrig, saldoBrl: saldo, cobrancaChaves: selCobrancas })
      return
    }
    if (tipo === "PARTICIPANTE") {
      const p = participantes.find((x) => x.obrigacaoId === selParticipante)
      onEscolher({ tipo: "PARTICIPANTE", tag: `Participante — ${p?.nome}`, obrigacaoId: selParticipante!, saldoBrl: p?.saldoBrl ?? 0, participanteNome: p?.nome })
      return
    }
    // GERAL / ADIANTAMENTO / CREDITO — sem participante/cobrança
    const tag = tipo === "GERAL" ? "Pagamento geral da Receita" : tipo === "ADIANTAMENTO" ? "Adiantamento (sem cobrança)" : "Crédito recebido"
    onEscolher({ tipo: tipo!, tag, obrigacaoId: esc.obrigacaoIdRef, saldoBrl: tipo === "GERAL" ? esc.totalSaldoBrl : 0 })
  }

  const toggleCob = (chave: string) => setSelCobrancas((s) => tipo === "COBRANCA" ? [chave] : s.includes(chave) ? s.filter((x) => x !== chave) : [...s, chave])

  const modal = (
    <div className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-[var(--app-overlay)] p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--shadow-surface)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <div><h2 className="text-base font-semibold text-[var(--text-primary)]">Definir escopo do pagamento</h2><p className="text-xs text-[var(--text-muted)]">{esc?.descricao} {esc?.codigo ? `· ${esc.codigo}` : ""} · saldo {brl(esc?.totalSaldoBrl ?? 0)}</p></div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X className="h-5 w-5" /></button>
        </div>

        {loading ? <div className="flex h-40 items-center justify-center text-[var(--text-muted)]"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>
        : erro ? <div className="m-5 rounded-[var(--radius-sm)] border p-3 text-sm text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{erro}</div>
        : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {OPCOES.map(({ tipo: t, lb, desc, Ic }) => (
                <button key={t} onClick={() => { setTipo(t); setSelCobrancas([]); setSelParticipante(null) }} className={`flex items-start gap-2.5 rounded-[var(--radius-sm)] border p-3 text-left ${tipo === t ? "" : "border-[var(--border-default)] hover:bg-[var(--surface-hover)]"}`} style={tipo === t ? { borderColor: "color-mix(in srgb, var(--accent-primary) 60%, transparent)", background: "color-mix(in srgb, var(--accent-primary) 10%, transparent)" } : undefined}>
                  <Ic className={`mt-0.5 h-4 w-4 shrink-0 ${tipo === t ? "text-[var(--accent-hover)]" : "text-[var(--text-muted)]"}`} />
                  <div><div className="text-sm font-medium text-[var(--text-primary)]">{lb}</div><div className="text-[11px] text-[var(--text-muted)]">{desc}</div></div>
                </button>
              ))}
            </div>

            {(tipo === "COBRANCA" || tipo === "VARIAS") && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                <p className="mb-2 text-xs text-[var(--text-muted)]">{tipo === "COBRANCA" ? "Escolha uma cobrança em aberto:" : "Selecione as cobranças (múltipla):"}</p>
                <div className="space-y-1.5">
                  {cobrancas.length === 0 ? <p className="text-xs text-[var(--text-muted)]">Nenhuma cobrança em aberto.</p> : cobrancas.map((c) => (
                    <label key={c.chave} className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border p-2 text-sm ${selCobrancas.includes(c.chave) ? "" : "border-[var(--border-default)]"}`} style={selCobrancas.includes(c.chave) ? { borderColor: "color-mix(in srgb, var(--accent-primary) 50%, transparent)", background: "color-mix(in srgb, var(--accent-primary) 5%, transparent)" } : undefined}>
                      <input type={tipo === "COBRANCA" ? "radio" : "checkbox"} checked={selCobrancas.includes(c.chave)} onChange={() => toggleCob(c.chave)} className="accent-[var(--accent-primary)]" />
                      <span className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-[var(--text-secondary)]" style={{ background: "color-mix(in srgb, var(--text-secondary) 20%, transparent)" }}>{(c.participanteNome ?? "?").slice(0, 1)}</span>
                      <div className="min-w-0 flex-1"><div className="truncate text-[var(--text-primary)]">{c.participanteNome} · parcela {c.parcelaNumero}/{c.totalParcelas}</div><div className="text-[11px] text-[var(--text-muted)]">vence {dataBR(c.vencimento)} · {c.status}</div></div>
                      <div className="text-right"><div className="text-[var(--text-primary)]">{brl(c.saldoBrl)}</div><div className="text-[10px] text-[var(--text-muted)]">de {brl(c.valorOriginalBrl)}</div></div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {tipo === "PARTICIPANTE" && (
              <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                <p className="mb-2 text-xs text-[var(--text-muted)]">Escolha o participante:</p>
                <div className="space-y-1.5">
                  {participantes.map((p) => (
                    <label key={p.obrigacaoId} className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border p-2 text-sm ${selParticipante === p.obrigacaoId ? "" : "border-[var(--border-default)]"}`} style={selParticipante === p.obrigacaoId ? { borderColor: "color-mix(in srgb, var(--accent-primary) 50%, transparent)", background: "color-mix(in srgb, var(--accent-primary) 5%, transparent)" } : undefined}>
                      <input type="radio" checked={selParticipante === p.obrigacaoId} onChange={() => setSelParticipante(p.obrigacaoId)} className="accent-[var(--accent-primary)]" />
                      <span className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-[var(--text-secondary)]" style={{ background: "color-mix(in srgb, var(--text-secondary) 20%, transparent)" }}>{(p.nome ?? "?").slice(0, 1)}</span>
                      <div className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{p.nome}</div>
                      <div className="text-right"><div className="text-[var(--text-primary)]">{brl(p.saldoBrl)}</div><div className="text-[10px] text-[var(--text-muted)]">{p.cobrancasAbertas} cobrança(s)</div></div>
                    </label>
                  ))}
                </div>
                {selParticipante != null && <p className="mt-2 text-[11px] text-[var(--text-muted)]">{cobrancasDoParticipante.length} cobrança(s) em aberto deste participante serão o alvo.</p>}
              </div>
            )}

            {tipo === "GERAL" && <p className="rounded-[var(--radius-sm)] bg-[var(--surface-overlay)] px-3 py-2 text-xs text-[var(--text-muted)]">Nenhuma cobrança/participante/pagador será pré-selecionado. Você definirá a aplicação (automática/manual) na próxima etapa.</p>}
            {(tipo === "ADIANTAMENTO" || tipo === "CREDITO") && <p className="rounded-[var(--radius-sm)] bg-[var(--surface-overlay)] px-3 py-2 text-xs text-[var(--text-muted)]">O recebimento será registrado sem vincular a uma cobrança e gerará crédito financeiro disponível no processo.</p>}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <button onClick={onClose} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Cancelar</button>
          <button onClick={confirmar} disabled={!podeConfirmar} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50">Continuar <ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  )
  return typeof document !== "undefined" ? createPortal(modal, document.body) : null
}
