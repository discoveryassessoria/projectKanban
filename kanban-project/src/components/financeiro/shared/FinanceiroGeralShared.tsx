// src/components/financeiro/shared/FinanceiroGeralShared.tsx
// ============================================================================
// Componentes COMPARTILHADOS do Financeiro Geral (§3/§4/§5/§6/§7):
//   • OrigemBadge      — selo Processo / Corporativo.
//   • StatusBadge      — status padronizado (lib/financeiro/status-financeiro).
//   • LancamentoDetalheModal — detalhe canônico de Receita/Custo (Ver origem).
//   • CancelarEstornarModal  — confirmação com motivo obrigatório; chama os
//     serviços já implementados (idempotentes) e trata "já processado" como sucesso.
// Sem lógica financeira nova; só apresentação e chamada dos endpoints canônicos.
// ============================================================================
"use client"

import { useEffect, useState } from "react"
import { Building2, Workflow, ExternalLink, Loader2, X, Ban, RotateCcw } from "lucide-react"
import { statusUi, rotuloStatus, corStatus, type EntradaStatus } from "@/lib/financeiro/status-financeiro"

function auth() { return typeof window !== "undefined" ? localStorage.getItem("authToken") : null }
function fmt(v: number | null | undefined, moeda = "BRL") { return v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: moeda }) }
function fmtD(d: string | Date | null | undefined) { return d ? new Date(d).toLocaleDateString("pt-BR") : "—" }

export function OrigemBadge({ origem }: { origem: string | null | undefined }) {
  const proc = origem === "PROCESSO"
  const desconhecida = origem === "ORIGEM_DESCONHECIDA"
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${proc ? "bg-blue-500/15 text-blue-300 border-blue-500/25" : desconhecida ? "bg-amber-500/15 text-amber-300 border-amber-500/25" : "bg-white/8 text-white/60 border-white/15"}`}>
      {proc ? <Workflow className="h-2.5 w-2.5" /> : <Building2 className="h-2.5 w-2.5" />}
      {proc ? "Processo" : desconhecida ? "Origem?" : "Corporativo"}
    </span>
  )
}

export function StatusBadge({ e }: { e: EntradaStatus }) {
  const s = statusUi(e)
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border ${corStatus(s)}`}>{rotuloStatus(s)}</span>
}

export function VerOrigemLink({ tipo, id, onOpen }: { tipo: "receita" | "custo"; id: number | null; onOpen: (t: "receita" | "custo", id: number) => void }) {
  if (id == null) return null
  return (
    <button onClick={() => onOpen(tipo, id)} className="inline-flex items-center gap-1 text-[11px] text-blue-300 hover:text-blue-200 hover:underline">
      <ExternalLink className="h-3 w-3" /> Ver lançamento de origem
    </button>
  )
}

// ── Detalhe canônico ─────────────────────────────────────────────────────────
export function LancamentoDetalheModal({ tipo, id, onClose }: { tipo: "receita" | "custo"; id: number; onClose: () => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch(`/api/financeiro/lancamento?tipo=${tipo}&id=${id}`, { headers: { Authorization: `Bearer ${auth()}` } })
      .then((r) => (r.ok ? r.json() : null)).then(setData).finally(() => setLoading(false))
  }, [tipo, id])
  const l = data?.lancamento
  return (
    <Overlay onClose={onClose} title={`Lançamento ${tipo === "receita" ? "de Receita" : "de Custo"}`}>
      {loading ? <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-white/50" /></div> : !l ? (
        <p className="text-sm text-white/50 py-6">Não foi possível carregar o lançamento.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <OrigemBadge origem={l.origemLancamento} />
            <StatusBadge e={{ statusBruto: l.status, canceladoEm: l.canceladoEm, estornadoEm: l.estornadoEm, estorno: l.estornoDeId != null }} />
            <span className="text-white/40 text-xs">{l.codigo}</span>
          </div>
          <Campo k="Natureza do lançamento" v={l.naturezaLancamento} />
          <Campo k="Processo / Fase" v={`${l.processo?.nome ?? "—"}${l.phaseKey ? " · " + l.phaseKey : ""}`} />
          <Campo k="Configuração Financeira" v={data.configuracao?.nome ?? (l.configFinanceiraId ? `#${l.configFinanceiraId}` : "—")} />
          <Campo k="Regra financeira" v={l.regraFinanceiraId ? `#${l.regraFinanceiraId}` : "—"} />
          <Campo k="Regra de preço (TabelaValor)" v={l.pricingRuleId ? `#${l.pricingRuleId}` : "manual"} />
          <Campo k="Evento operacional" v={l.eventoOperacionalId ?? "—"} />
          <div className="grid grid-cols-3 gap-2">
            <Campo k="Valor unitário" v={fmt(l.valorUnitario != null ? Number(l.valorUnitario) : null, l.moeda)} />
            <Campo k="Quantidade" v={l.quantidade != null ? String(Number(l.quantidade)) : "—"} />
            <Campo k="Valor total" v={fmt(Number(l.valor), l.moeda)} />
          </div>
          <Campo k="Modo de cálculo · natureza do preço" v={`${l.modoCalculoAplicado ?? "—"} · ${l.naturezaPreco ?? "—"}`} />
          <Campo k="Referência · Competência" v={`${fmtD(l.dataReferencia)} · ${fmtD(l.dataCompetencia)}`} />
          <Campo k={tipo === "custo" ? "Fornecedor" : "Cliente"} v={tipo === "custo" ? (l.fornecedor ?? "—") : (l.processo?.nome ?? "—")} />
          {l.canceladoEm && <Campo k="Cancelado" v={`${fmtD(l.canceladoEm)} — ${l.canceladoMotivo ?? ""}`} />}
          {l.estornadoEm && <Campo k="Estornado" v={`${fmtD(l.estornadoEm)} — ${l.estornoMotivo ?? ""}`} />}
          {data.movimentoInverso && <Campo k="Movimento inverso" v={`${data.movimentoInverso.codigo} (#${data.movimentoInverso.id})`} />}
          {l.estornoDeId && <Campo k="Estorno do lançamento" v={`#${l.estornoDeId}`} />}
          {l.contextoAplicado && (
            <details className="text-xs text-white/50"><summary className="cursor-pointer">Contexto aplicado</summary>
              <pre className="mt-1 p-2 rounded bg-black/30 overflow-x-auto">{JSON.stringify(l.contextoAplicado, null, 2)}</pre></details>
          )}
          <details className="text-xs text-white/40"><summary className="cursor-pointer">Auditoria técnica</summary>
            <div className="mt-1">Chave de idempotência: <code>{l.chaveIdempotencia ?? "—"}</code></div>
            <div>Criado: {fmtD(l.createdAt)} · Atualizado: {fmtD(l.updatedAt)}</div>
          </details>
        </div>
      )}
    </Overlay>
  )
}

// ── Cancelar / Estornar ──────────────────────────────────────────────────────
export function CancelarEstornarModal({ acao, tipo, id, resumo, onClose, onDone }: {
  acao: "cancelar" | "estornar"; tipo: "receita" | "custo"; id: number
  resumo: { item: string; valor: string; processo: string | null }
  onClose: () => void; onDone: (msg: string) => void
}) {
  const [motivo, setMotivo] = useState("")
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const estorno = acao === "estornar"

  async function confirmar() {
    if (!motivo.trim()) { setErro("Informe o motivo (obrigatório)."); return }
    setSaving(true); setErro(null)
    try {
      const res = await fetch(`/api/financeiro/${tipo === "receita" ? "receitas" : "custos"}/${id}/${acao}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth()}` },
        body: JSON.stringify({ motivo, eventoRef: `ui-${acao}` }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(j.motivo || j.error || "Falha na operação"); setSaving(false); return }
      // idempotente: "ja_processado" também é sucesso.
      onDone(j.status === "ja_processado" ? "Operação já havia sido processada." : estorno ? "Estorno criado." : "Lançamento cancelado.")
    } catch { setErro("Erro de rede"); setSaving(false) }
  }

  return (
    <Overlay onClose={onClose} title={estorno ? "Estornar lançamento" : "Cancelar lançamento"}>
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="text-white/80">{resumo.item}</div>
          <div className="text-white/50 text-xs">{resumo.processo ?? "—"} · <b className="text-white/80">{resumo.valor}</b></div>
        </div>
        <p className="text-xs text-white/60">
          {estorno
            ? "O lançamento original será PRESERVADO e um MOVIMENTO INVERSO será criado, revertendo o impacto financeiro. Estorno repetido não duplica."
            : "O histórico será PRESERVADO: o lançamento passa a CANCELADO, sai dos totais ativos e não pode ser recriado pelo mesmo evento. Liquidados não podem ser cancelados (use estorno)."}
        </p>
        <div>
          <label className="block text-xs text-white/60 mb-1">Motivo *</label>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30" placeholder="Descreva o motivo…" />
        </div>
        {erro && <p className="text-xs text-red-300">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg border border-white/15 text-white/70 hover:bg-white/10">Voltar</button>
          <button onClick={confirmar} disabled={saving}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg text-white ${estorno ? "bg-purple-600 hover:bg-purple-700" : "bg-red-600 hover:bg-red-700"} disabled:opacity-50`}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : estorno ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
            {estorno ? "Confirmar estorno" : "Confirmar cancelamento"}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

// ── primitivos ───────────────────────────────────────────────────────────────
function Overlay({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
function Campo({ k, v }: { k: string; v: string }) {
  return <div><div className="text-[10px] uppercase tracking-wide text-white/40">{k}</div><div className="text-white/85">{v}</div></div>
}
