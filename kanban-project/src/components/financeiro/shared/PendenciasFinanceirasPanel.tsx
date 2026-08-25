// src/components/financeiro/shared/PendenciasFinanceirasPanel.tsx
// §11 — painel de PendenciasFinanceiras (preço ausente, conflito, natureza
// incompatível, contexto incompleto, falha de projeção/estorno). Read-only: a
// correção é reprocessar a fase — NÃO editar valor para contornar configuração.
"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2, CheckCircle2 } from "lucide-react"
import { authToken } from "@/src/lib/financeiro/http"

interface Pendencia {
  id: number; processoId: number; processoNome: string | null; phaseKey: string
  natureza: string | null; motivo: string; detalhe: string; resolvida: boolean; criadoEm: string; acaoSugerida: string
}

export default function PendenciasFinanceirasPanel({ processoId, compact = false }: { processoId?: number; compact?: boolean }) {
  const [itens, setItens] = useState<Pendencia[] | null>(null)
  useEffect(() => {
    const token = authToken()
    const qs = processoId ? `?processoId=${processoId}` : ""
    fetch(`/api/financas/pendencias${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setItens(d?.itens ?? [])).catch(() => setItens([]))
  }, [processoId])

  if (itens == null) return <div className="py-4 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-[var(--text-muted)]" /></div>
  const abertas = itens.filter((i) => !i.resolvida)

  return (
    <div className="bg-[var(--surface-primary)] backdrop-blur-sm border border-[var(--border-default)] rounded-xl p-4">
      <div className="text-[11px] text-[var(--text-secondary)] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5" /> Pendências financeiras
        {abertas.length > 0 && <span className="text-[10px] bg-[var(--surface-secondary)] text-amber-800 px-1.5 rounded-full">{abertas.length}</span>}
      </div>
      {abertas.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-800" /> Nenhuma pendência aberta.</p>
      ) : (
        <ul className="space-y-2">
          {abertas.slice(0, compact ? 3 : 20).map((p) => (
            <li key={p.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-amber-800">{p.motivo}{p.natureza ? ` · ${p.natureza}` : ""}</span>
                <span className="text-[10px] text-[var(--text-muted)]">{new Date(p.criadoEm).toLocaleDateString("pt-BR")}</span>
              </div>
              <div className="text-[11px] text-white/70 mt-0.5">{p.processoNome ?? `Processo ${p.processoId}`} · {p.phaseKey}</div>
              <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{p.detalhe}</div>
              <div className="text-[10px] text-[var(--text-secondary)] mt-1">→ {p.acaoSugerida}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
