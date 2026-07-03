// src/components/gerenciamentoComponents/WorkflowsFasesHubTab.tsx
"use client"

import { useState } from "react"
import MacroKanbanTab from "./MacroKanbanTab"
import PhaseWorkflowsFasesTab from "./PhaseWorkflowsFasesTab"
import ModelosWorkflowInternoTab from "./ModelosWorkflowInternoTab"
import ModosInternosFasesTab from "./ModosInternosFasesTab"

const SUBTABS: { key: string; label: string; hint: string }[] = [
  { key: "macro", label: "Workflow Macro / Kanban", hint: "Fases principais" },
  { key: "internalApplied", label: "Workflows Internos das Fases", hint: "Passos por fase" },
  { key: "internalModels", label: "Modelos de Workflow Interno", hint: "Biblioteca de passos" },
  { key: "phaseModes", label: "Modos Internos das Fases", hint: "Variações internas" },
]

export default function WorkflowsFasesHubTab() {
  const [active, setActive] = useState("macro")

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Workflows e Fases</h2>
        <p className="mt-1 text-sm text-white/60">
          Configure as fases principais do processo, os passos internos de cada fase e os modos internos de execução.
        </p>
      </div>

      {/* legenda */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="min-w-[180px] flex-1">
          <div className="text-xs font-bold text-white/80">Workflow Macro</div>
          <div className="text-[11px] text-white/50">Fases oficiais do processo (colunas do Kanban).</div>
        </div>
        <div className="min-w-[180px] flex-1">
          <div className="text-xs font-bold text-white/80">Workflow Interno</div>
          <div className="text-[11px] text-white/50">Passos executados dentro de cada fase.</div>
        </div>
        <div className="min-w-[180px] flex-1">
          <div className="text-xs font-bold text-white/80">Modo Interno</div>
          <div className="text-[11px] text-white/50">Variação/caminho dentro de uma fase (ex.: Retificação Judicial).</div>
        </div>
      </div>

      {/* sub-abas — mesmo estilo do Financeiro: aba ativa encosta na linha (borda branca), sem espaço */}
      <div className="relative">
        <div className="flex gap-1 overflow-x-auto relative z-10">
          {SUBTABS.map(t => {
            const on = active === t.key
            return (
              <button
                key={t.key}
                onClick={() => setActive(t.key)}
                className={`relative flex flex-col items-start rounded-t-lg px-3 py-2 -mb-px border-b-2 whitespace-nowrap transition-colors ${
                  on ? "bg-white/10 border-white" : "border-transparent hover:bg-white/5"
                }`}
              >
                <span className={`text-[12.5px] font-semibold ${on ? "text-white" : "text-white/70"}`}>{t.label}</span>
                <span className="text-[10px] text-white/40">{t.hint}</span>
              </button>
            )
          })}
        </div>
        <div className="h-px w-full bg-white/10" />
      </div>

      {/* conteúdo da aba ativa (telas que já existem) */}
      <div>
        {active === "macro" && <MacroKanbanTab />}
        {active === "internalApplied" && <PhaseWorkflowsFasesTab />}
        {active === "internalModels" && <ModelosWorkflowInternoTab />}
        {active === "phaseModes" && <ModosInternosFasesTab />}
      </div>
    </div>
  )
}