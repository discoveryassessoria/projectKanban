"use client"
// F5 (UI) — Painel de REPASSE/REEMBOLSO do custo. Vínculo EXPLÍCITO e auditável custo→
// cobrança do cliente. Nunca converte custo em receita — só registra o elo rastreável.
import { useState } from "react"
import { ArrowLeftRight, Plus, X } from "lucide-react"

const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
type Repasse = { id: number; tipo: string; valor: number; percentual: number | null; receitaObrigacaoId: number | null; status: string; motivo: string | null; criadoEm: string }
const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
const dataBR = (s: string) => new Date(s).toLocaleDateString("pt-BR")

export function RepassePanel({ obrigacaoId, repasses, onChange }: { obrigacaoId: number; repasses: Repasse[]; onChange?: () => void }) {
  const [modal, setModal] = useState(false)
  const [tipo, setTipo] = useState<"REPASSE" | "REEMBOLSO">("REEMBOLSO")
  const [valor, setValor] = useState("")
  const [receitaObrigacaoId, setReceitaObrigacaoId] = useState("")
  const [motivo, setMotivo] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const salvar = async () => {
    setSalvando(true); setErro(null)
    try {
      const r = await fetch(`/api/financeiro/v3/obrigacoes/${obrigacaoId}/repasse`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ tipo, valor: Number(valor), receitaObrigacaoId: receitaObrigacaoId ? Number(receitaObrigacaoId) : null, motivo: motivo || null }) }).then((x) => x.json())
      if (!r?.ok) { setErro(r?.erro ?? "Falha ao registrar."); return }
      setModal(false); setValor(""); setReceitaObrigacaoId(""); setMotivo(""); onChange?.()
    } catch { setErro("Falha ao registrar.") } finally { setSalvando(false) }
  }

  const ativos = repasses.filter((r) => r.status !== "CANCELADO")

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><ArrowLeftRight className="h-5 w-5 text-[var(--text-secondary)]" /><h2 className="text-lg font-semibold text-[var(--text-primary)]">Repasses e reembolsos</h2><span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{ativos.length}</span></div>
        <button onClick={() => setModal(true)} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]"><Plus className="h-4 w-4" /> Registrar</button>
      </div>

      {repasses.length === 0 ? (
        <div className="mt-6 py-10 text-center">
          <div className="text-sm font-medium text-[var(--text-secondary)]">Nenhum repasse/reembolso</div>
          <div className="mt-1 text-sm text-[var(--text-muted)]">Vincule este custo a uma cobrança do cliente (repasse) ou registre um reembolso. Custo nunca vira receita — o vínculo é rastreável.</div>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{["Tipo", "Valor", "Cobrança vinculada", "Situação", "Data"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{repasses.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border-default)]">
                <td className="px-3 py-3 text-[var(--text-primary)]">{r.tipo === "REPASSE" ? "Repasse" : "Reembolso"}</td>
                <td className="px-3 text-[var(--text-primary)]">{brl(r.valor)}</td>
                <td className="px-3 text-[var(--text-secondary)]">{r.receitaObrigacaoId ? `Obrigação #${r.receitaObrigacaoId}` : "—"}</td>
                <td className="px-3"><span className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${r.status === "CANCELADO" ? "var(--text-muted)" : "var(--success)"} 16%, transparent)`, color: r.status === "CANCELADO" ? "var(--text-muted)" : "var(--success)" }}>{r.status === "CANCELADO" ? "Cancelado" : "Ativo"}</span></td>
                <td className="px-3 text-[var(--text-secondary)]">{dataBR(r.criadoEm)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-[var(--app-overlay)] p-4" onClick={() => setModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-overlay)] p-5 shadow-[var(--shadow-surface)]">
            <div className="flex items-center justify-between"><h3 className="text-base font-semibold text-[var(--text-primary)]">Registrar repasse/reembolso</h3><button onClick={() => setModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X className="h-4 w-4" /></button></div>
            <div className="mt-4 space-y-3">
              <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Tipo
                <select value={tipo} onChange={(e) => setTipo(e.target.value as any)} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1.5 text-sm text-[var(--text-primary)]"><option value="REEMBOLSO">Reembolso</option><option value="REPASSE">Repasse</option></select>
              </label>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Valor
                <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0,00" className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1.5 text-sm text-[var(--text-primary)]" />
              </label>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Obrigação da cobrança (A_RECEBER) — opcional
                <input inputMode="numeric" value={receitaObrigacaoId} onChange={(e) => setReceitaObrigacaoId(e.target.value.replace(/[^0-9]/g, ""))} placeholder="ID da obrigação de receita" className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1.5 text-sm text-[var(--text-primary)]" />
              </label>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Motivo
                <input value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 300))} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1.5 text-sm text-[var(--text-primary)]" />
              </label>
            </div>
            {erro && <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-xs text-[var(--danger)]">{erro}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(false)} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Cancelar</button>
              <button disabled={salvando || !valor} onClick={salvar} className="rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] disabled:opacity-50">{salvando ? "Salvando…" : "Registrar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
