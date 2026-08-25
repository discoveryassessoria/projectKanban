"use client"

// Gerenciamento → Motor → Diagnóstico do Runtime.
// Painel TÉCNICO do Runtime v2 por processo (runtime atual, gate global, readiness/
// pré-requisitos, versões, simular/avançar/forçar). REUTILIZA os componentes
// existentes (WorkflowV2AtivacaoPanel + WorkflowV2Panel) — sem duplicar lógica nem
// fetch. Fica FORA da Central Operacional (que é puramente operacional). Gated pela
// permissão do grupo Motor Técnico + as próprias checagens de permissão dos painéis.

import { useState } from "react"
import { WorkflowV2AtivacaoPanel } from "@/src/components/kanban/WorkflowV2AtivacaoPanel"
import { WorkflowV2Panel } from "@/src/components/kanban/WorkflowV2Panel"

export default function RuntimeWorkflowDiagnostics() {
  const [input, setInput] = useState("")
  const [processoId, setProcessoId] = useState<number | null>(null)

  const carregar = () => {
    const n = parseInt(input, 10)
    setProcessoId(Number.isInteger(n) && n > 0 ? n : null)
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">Diagnóstico do Runtime</h2>
        <p className="mt-1 text-sm text-white/60">
          Área técnica do Motor: runtime atual, gate global, readiness/pré-requisitos, versões macro/interna
          e ações de avanço (simular/avançar/forçar) por processo. Estas informações NÃO aparecem na Central Operacional.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && carregar()}
            placeholder="ID do processo"
            inputMode="numeric"
            className="w-40 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
          />
          <button onClick={carregar} className="rounded-lg bg-[var(--action-primary)] px-3 py-2 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]">
            Carregar diagnóstico
          </button>
        </div>
      </div>

      {processoId != null ? (
        // Os painéis kanban usam tema claro — renderiza sobre fundo branco.
        <div className="space-y-3 rounded-2xl bg-[var(--surface-primary)] p-4">
          <WorkflowV2AtivacaoPanel processoId={processoId} />
          <WorkflowV2Panel processoId={processoId} />
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-8 text-center text-sm text-[var(--text-muted)]">
          Informe o ID de um processo para ver o diagnóstico técnico do Runtime.
        </div>
      )}
    </div>
  )
}
