"use client"
// F5 (UI) — Painel de CRONOGRAMA/PARCELAMENTO de PAGÁVEIS (Contas a Pagar). Renderiza as
// ParcelaPagavel com status DERIVADO do Ledger e permite DEFINIR o cronograma (N parcelas).
// Saldo/valores vêm do backend; a UI só agenda. Reutilizável por qualquer obrigação A_PAGAR.
import { useState } from "react"
import { CalendarClock, Plus, X } from "lucide-react"
import { authHeaders } from "@/src/lib/financeiro/http"


type Parcela = { id: number; numero: number; vencimento: string; valor: number; moeda: string; status: string }

const COR: Record<string, string> = { PAGA: "var(--success)", PARCIAL: "var(--info)", VENCIDA: "var(--danger)", PENDENTE: "var(--text-secondary)", CANCELADA: "var(--text-muted)" }
const ROT: Record<string, string> = { PAGA: "Paga", PARCIAL: "Parcial", VENCIDA: "Vencida", PENDENTE: "Pendente", CANCELADA: "Cancelada" }
const brl = (v: number, m: string) => `${m} ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
const dataBR = (s: string) => new Date(s).toLocaleDateString("pt-BR")

function gerarParcelas(total: number, n: number, primeiro: string, intervaloDias: number) {
  const base = Math.floor((total / n) * 100) / 100
  const parcelas = Array.from({ length: n }, (_, i) => ({ numero: i + 1, valor: base, vencimento: new Date(new Date(primeiro).getTime() + i * intervaloDias * 86_400_000).toISOString() }))
  const soma = Math.round(base * n * 100) / 100
  parcelas[n - 1].valor = Math.round((parcelas[n - 1].valor + (total - soma)) * 100) / 100 // ajuste de arredondamento na última
  return parcelas
}

export function CronogramaPagavelPanel({ obrigacaoId, parcelas, valorContratado, moeda, onChange }: {
  obrigacaoId: number; parcelas: Parcela[]; valorContratado: number; moeda: string; onChange?: () => void
}) {
  const [modal, setModal] = useState(false)
  const [n, setN] = useState(3)
  const [primeiro, setPrimeiro] = useState(new Date().toISOString().slice(0, 10))
  const [intervalo, setIntervalo] = useState(30)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const salvar = async () => {
    setSalvando(true); setErro(null)
    try {
      const p = gerarParcelas(valorContratado, Math.max(1, n), primeiro, intervalo)
      const r = await fetch(`/api/financeiro/v3/obrigacoes/${obrigacaoId}/cronograma`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ parcelas: p }) }).then((x) => x.json())
      if (!r?.ok) { setErro(r?.erro ?? "Falha ao definir cronograma."); return }
      setModal(false); onChange?.()
    } catch { setErro("Falha ao definir cronograma.") } finally { setSalvando(false) }
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-[var(--text-secondary)]" /><h2 className="text-lg font-semibold text-[var(--text-primary)]">Cronograma de pagamento</h2><span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{parcelas.length}</span></div>
        {parcelas.length === 0 && <button onClick={() => setModal(true)} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]"><Plus className="h-4 w-4" /> Definir cronograma</button>}
      </div>

      {parcelas.length === 0 ? (
        <div className="mt-6 py-10 text-center">
          <div className="text-sm font-medium text-[var(--text-secondary)]">Sem cronograma definido</div>
          <div className="mt-1 text-sm text-[var(--text-muted)]">Este custo é pago em parcela única (saldo no Ledger). Defina um cronograma para agendar vencimentos.</div>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{["Parcela", "Vencimento", "Valor", "Situação"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{parcelas.map((p) => (
              <tr key={p.id} className="border-t border-[var(--border-default)]">
                <td className="px-3 py-3 text-[var(--text-primary)]">{p.numero}/{parcelas.length}</td>
                <td className="px-3 text-[var(--text-secondary)]">{dataBR(p.vencimento)}</td>
                <td className="px-3 text-[var(--text-primary)]">{brl(p.valor, p.moeda)}</td>
                <td className="px-3"><span className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${COR[p.status] ?? "var(--text-secondary)"} 16%, transparent)`, color: COR[p.status] ?? "var(--text-secondary)" }}>{ROT[p.status] ?? p.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="mt-3 text-[11px] text-[var(--text-muted)]">O saldo é a fonte única do Ledger; o cronograma só distribui vencimentos. A situação de cada parcela é derivada do valor já pago.</p>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-[var(--app-overlay)] p-4" onClick={() => setModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-overlay)] p-5 shadow-[var(--shadow-surface)]">
            <div className="flex items-center justify-between"><h3 className="text-base font-semibold text-[var(--text-primary)]">Definir cronograma</h3><button onClick={() => setModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X className="h-4 w-4" /></button></div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Total a distribuir: <b className="text-[var(--text-primary)]">{brl(valorContratado, moeda)}</b> (a última parcela ajusta o arredondamento).</p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Parcelas<input type="number" min={1} max={60} value={n} onChange={(e) => setN(Number(e.target.value))} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1.5 text-sm text-[var(--text-primary)]" /></label>
              <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">1º vencimento<input type="date" value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1.5 text-sm text-[var(--text-primary)]" /></label>
              <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Intervalo (dias)<input type="number" min={1} value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1.5 text-sm text-[var(--text-primary)]" /></label>
            </div>
            {erro && <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-xs text-[var(--danger)]">{erro}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(false)} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">Cancelar</button>
              <button disabled={salvando} onClick={salvar} className="rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] disabled:opacity-50">{salvando ? "Salvando…" : "Definir"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
