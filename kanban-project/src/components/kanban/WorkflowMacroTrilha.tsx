// src/components/kanban/WorkflowMacroTrilha.tsx
//
// Trilha de fases horizontal ("Workflow Macro do Processo") + resumo lateral,
// clone fiel do mockup discovery-central-operacional-v2.html (macroWorkflowPanel
// + macroSidebar). Mostra as 10 fases com estados concluída/atual/futura/pulada,
// progresso por fase, e a coluna lateral com Resumo do processo.
//
// É VISUAL: recebe a fase atual e o progresso via props. Não busca nada sozinho.

"use client"

import { Check } from "lucide-react"

// ============================================================
// AS 10 FASES NA ORDEM DO MOCKUP (PROCESS_PHASES)
// ============================================================

export const PROCESS_PHASES = [
  "Genealogia",
  "Emissão documental",
  "Análise Documental",
  "Retificação de registros",
  "Emissão documental retificada",
  "Tradução juramentada",
  "Apostilamento",
  "Aguardando protocolo",
  "Protocolado",
  "Finalizado",
] as const

export type PhaseName = (typeof PROCESS_PHASES)[number]

// Fases condicionais (só entram no caminho se houver retificação)
const RETIF_PHASES: PhaseName[] = [
  "Retificação de registros",
  "Emissão documental retificada",
]

type PhaseStatus = "concluida" | "atual" | "futura" | "pulada" | "bloqueada" | "condicional"

export interface WorkflowMacroProps {
  /** Fase atual do processo (nome exato, ex: "Emissão documental") */
  currentPhase: PhaseName | string
  /** Fases já concluídas */
  completedPhases?: string[]
  /** Progresso por fase: { "Genealogia": 100, "Emissão documental": 0, ... } */
  phaseProgress?: Record<string, number>
  /** Houve decisão de retificação? (controla se as 2 fases condicionais entram) */
  needsRectification?: boolean | null
  /** Fase selecionada para visualização (clique). Default = currentPhase */
  selectedPhase?: string
  /** Callback ao clicar numa fase */
  onSelectPhase?: (phase: string) => void
}

// ============================================================
// LÓGICA DE CAMINHO E STATUS (espelho do mockup)
// ============================================================

function getActivePath(needsRectification: boolean | null | undefined): PhaseName[] {
  const baseStart: PhaseName[] = ["Genealogia", "Emissão documental", "Análise Documental"]
  const retif: PhaseName[] = ["Retificação de registros", "Emissão documental retificada"]
  const baseEnd: PhaseName[] = [
    "Tradução juramentada",
    "Apostilamento",
    "Aguardando protocolo",
    "Protocolado",
    "Finalizado",
  ]
  return needsRectification ? [...baseStart, ...retif, ...baseEnd] : [...baseStart, ...baseEnd]
}

function phaseIndex(phase: string): number {
  return PROCESS_PHASES.indexOf(phase as PhaseName)
}

function getPhaseStatus(
  title: PhaseName,
  currentPhase: string,
  completedPhases: string[],
  path: PhaseName[],
  needsRectification: boolean | null | undefined
): PhaseStatus {
  if (!path.includes(title)) {
    // Fase fora do caminho ativo. Se é condicional E a Análise ainda NÃO
    // decidiu (null), ela é "condicional" (pode entrar). Só vira "pulada"
    // quando a decisão foi tomada e ela ficou de fora.
    const ehCondicional = RETIF_PHASES.includes(title)
    if (ehCondicional && (needsRectification === null || needsRectification === undefined)) {
      return "condicional"
    }
    return "pulada"
  }
  if (completedPhases.includes(title)) return "concluida"
  if (title === currentPhase) return "atual"
  const ci = path.indexOf(currentPhase as PhaseName)
  const pi = path.indexOf(title)
  if (pi > ci) return "futura"
  return "bloqueada"
}

// Resumo curto de cada fase (texto da coluna lateral). Genérico — sem dados de
// procState. Quando o backend fornecer contadores por fase, dá pra enriquecer.
function phaseSummary(title: PhaseName, status: PhaseStatus, progress: number): string {
  if (status === "pulada") return "Fase fora do caminho ativo deste processo."
  if (status === "concluida") return "Fase concluída."
  if (status === "atual") return `Fase em andamento · ${progress}% concluído.`
  return "Fase futura — ainda não iniciada."
}

// ============================================================
// COMPONENTE: TRILHA (timeline horizontal)
// ============================================================

export function WorkflowMacroTrilha({
  currentPhase,
  completedPhases = [],
  phaseProgress = {},
  needsRectification = null,
  selectedPhase,
  onSelectPhase,
}: WorkflowMacroProps) {
  const path = getActivePath(needsRectification)

  const progressOf = (title: PhaseName): number => {
    if (completedPhases.includes(title)) return 100
    if (!path.includes(title)) return 0
    return phaseProgress[title] ?? 0
  }

  const decLabel = (() => {
    // "Decisão da Análise Documental"
    if (needsRectification === true) return { txt: "Precisa retificação", cls: "bg-[#4ade80]/15 text-[#4ade80]" }
    if (needsRectification === false) return { txt: "Sem retificação", cls: "bg-[#4ade80]/15 text-[#4ade80]" }
    return { txt: "Não definida", cls: "bg-[#252c35] text-white/55" }
  })()

  return (
    <div className="bg-[#1b2027] border border-white/10 rounded-2xl px-5 py-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-3.5">
        <div>
          <h3 className="text-base font-extrabold text-white/95 flex items-center gap-1.5">
            Workflow Macro do Processo
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#252c35] text-white/40 text-[10px] font-bold">i</span>
          </h3>
          <div className="text-xs text-white/55 mt-0.5">Visão geral do caminho do processo entre fases.</div>
        </div>
        <div className="text-xs text-white/55 bg-[#20262e] border border-white/10 rounded-lg px-3 py-2 whitespace-nowrap">
          Decisão da Análise Documental:
          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md ml-1.5 ${decLabel.cls}`}>{decLabel.txt}</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex gap-0 overflow-x-auto pb-1">
        {PROCESS_PHASES.map((title, i) => {
          const st = getPhaseStatus(title, currentPhase, completedPhases, path, needsRectification)
          const prog = progressOf(title)
          const conditional = RETIF_PHASES.includes(title)

          const dotCls =
            st === "concluida" ? "bg-[#4ade80]/15 text-[#4ade80] border border-[#4ade80]/40"
            : st === "atual" ? "bg-[#252c35] text-white/95 border border-white/10"
            : st === "pulada" ? "bg-[#252c35] text-white/40"
            : st === "condicional" ? "bg-[#a78bfa]/15 text-[#a78bfa]"
            : st === "bloqueada" ? "bg-[#d2a948]/15 text-[#d2a948]"
            : "border-2 border-white/10 bg-[#1b2027] text-white/40"

          const badgeCls =
            st === "concluida" ? "bg-[#4ade80]/15 text-[#4ade80]"
            : st === "atual" ? "bg-[#7dd3fc]/15 text-[#7dd3fc] border border-[#7dd3fc]/40"
            : st === "pulada" ? "bg-[#252c35] text-white/55"
            : st === "condicional" ? "bg-[#a78bfa]/15 text-[#a78bfa]"
            : st === "bloqueada" ? "bg-[#d2a948]/15 text-[#d2a948]"
            : "bg-[#20262e] text-white/40"
          const badgeTxt =
            st === "concluida" ? "Concluída"
            : st === "atual" ? "Atual"
            : st === "pulada" ? "Pulada"
            : st === "condicional" ? "Condicional"
            : st === "bloqueada" ? "Bloqueada"
            : "Futura"
          const badgeFinalCls = badgeCls

          const barColor =
            st === "concluida" ? "#16a34a"
            : st === "atual" ? "#2563eb"
            : st === "pulada" ? "#cbd5e1"
            : "#d1d5db"
          const pctColor =
            st === "concluida" ? "text-[#4ade80]"
            : st === "atual" ? "text-[#7dd3fc]"
            : "text-white/40"

          // conector pra próxima fase
          const nextDone = i < PROCESS_PHASES.length - 1
            ? (getPhaseStatus(PROCESS_PHASES[i + 1], currentPhase, completedPhases, path, needsRectification) === "concluida" || st === "concluida")
            : false

          const clicavel = !!onSelectPhase
          const consultando = !!selectedPhase && selectedPhase === title && selectedPhase !== currentPhase

          return (
            <div
              key={title}
              className="flex-1 min-w-[92px] relative z-10"
            >
              <button
                onClick={() => onSelectPhase?.(title)}
                disabled={!clicavel}
                title={clicavel ? "Ver esta fase" : undefined}
                className={`flex flex-col items-center gap-1 w-full bg-transparent border-none py-1.5 px-1 rounded-[10px] transition-colors ${
                  clicavel ? "cursor-pointer hover:bg-[#20262e]" : "cursor-default"
                } ${consultando ? "ring-2 ring-[#7dd3fc]/40 bg-[#7dd3fc]/12" : ""}`}
              >
                {/* dot + conector */}
                <div className="flex items-center w-full justify-center relative">
                  <span className={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold flex-none relative z-30 ${dotCls}`}>
                    {st === "concluida" ? <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      : st === "atual" ? <b>{i + 1}</b>
                      : st === "pulada" ? "⤳" : ""}
                  </span>
                  {i < PROCESS_PHASES.length - 1 && (
                    <div
                      className="absolute left-1/2 w-full h-0.5 top-1/2 -translate-y-1/2 z-20"
                      style={{ background: nextDone ? "#16a34a" : "#e5e7eb" }}
                    />
                  )}
                </div>

                {/* nome — altura fixa p/ que badges e % de TODAS as fases fiquem alinhados
                    na mesma linha, independente de o título ter 1, 2 ou 3 linhas */}
                <span className="text-[11px] font-semibold text-white/95 text-center leading-tight h-[42px] flex items-center justify-center">
                  {title}
                </span>

                {/* badge */}
                <span className="min-h-[19px]">
                  <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${badgeFinalCls}`}>
                    {badgeTxt}
                  </span>
                </span>

                {/* pct */}
                <span className={`text-[12.5px] font-extrabold ${pctColor}`}>{prog}%</span>

                {/* mini barra */}
                <div className="w-4/5 h-1 bg-[#252c35] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${prog}%`, background: barColor }} />
                </div>
              </button>
            </div>
          )
        })}
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-3.5 pt-3 mt-2.5 border-t border-white/10 text-[11px] text-white/55">
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#4ade80]/15 text-[#4ade80] border border-[#4ade80]/40 grid place-items-center"><Check className="w-2 h-2" strokeWidth={3} /></span>Concluída</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#7dd3fc]" />Atual (fase real)</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full border-2 border-white/10 bg-[#1b2027]" />Futura</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#a78bfa]/15 text-[#a78bfa] grid place-items-center text-[8px]">?</span>Condicional</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#252c35] text-white/40 grid place-items-center text-[8px]">⤳</span>Pulada</span>
      </div>
    </div>
  )
}

function LegendItem({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`w-3.5 h-3.5 rounded-full grid place-items-center ${cls}`}>{children}</span>
}

// ============================================================
// COMPONENTE: RESUMO DO PROCESSO (caixinha de contadores)
// Extraído do MacroSidebar para poder ficar ao lado da trilha no topo.
// Usa a MESMA matemática de caminho/status do mockup.
// ============================================================

export function ResumoDoProcesso({
  currentPhase,
  completedPhases = [],
  phaseProgress = {},
  needsRectification = null,
}: WorkflowMacroProps) {
  const path = getActivePath(needsRectification)

  const progressOf = (title: PhaseName): number => {
    if (completedPhases.includes(title)) return 100
    if (!path.includes(title)) return 0
    return phaseProgress[title] ?? 0
  }

  const overall = Math.round(
    path.reduce((acc, ph) => acc + progressOf(ph), 0) / (path.length || 1)
  )
  const concluidas = completedPhases.length
  const futuras = path.filter(
    (p) => getPhaseStatus(p, currentPhase, completedPhases, path, needsRectification) === "futura"
  ).length
  const puladas = PROCESS_PHASES.filter(
    (p) => getPhaseStatus(p, currentPhase, completedPhases, path, needsRectification) === "pulada"
  ).length

  return (
    <div className="bg-[#1b2027] border border-white/10 rounded-2xl p-4 h-full flex flex-col">
      <h3 className="text-[13.5px] font-extrabold text-white/95 mb-3">Resumo do processo</h3>
      <StatRow label="Caminho ativo" value={`${path.length} fases`} />
      <StatRow label="Fases concluídas" value={String(concluidas)} />
      <StatRow label="Fase atual" value={currentPhase} />
      <StatRow label="Fases futuras" value={String(futuras)} />
      <StatRow label="Fases puladas" value={String(puladas)} />
      <div className="flex justify-between items-center text-[12.5px] pt-2.5 mt-auto border-t-2 border-white/10">
        <span className="text-white/55">Progresso geral</span>
        <b className="text-[#7dd3fc] text-[15px]">{overall}%</b>
      </div>
    </div>
  )
}

// ============================================================
// COMPONENTE: RESUMO LATERAL (coluna direita)
// ⚠ NÃO é mais montado na Central Operacional (24/jun) — o "Resumo do processo"
// foi pro topo (ResumoDoProcesso) e o "Resumo por fase" saiu por ser redundante
// com a trilha. Mantido aqui caso seja necessário reaproveitar.
// ============================================================

export function MacroSidebar({
  currentPhase,
  completedPhases = [],
  phaseProgress = {},
  needsRectification = null,
  selectedPhase,
  onSelectPhase,
}: WorkflowMacroProps) {
  const path = getActivePath(needsRectification)
  const sel = selectedPhase || currentPhase

  const progressOf = (title: PhaseName): number => {
    if (completedPhases.includes(title)) return 100
    if (!path.includes(title)) return 0
    return phaseProgress[title] ?? 0
  }

  const overall = Math.round(
    path.reduce((acc, ph) => acc + progressOf(ph), 0) / (path.length || 1)
  )
  const concluidas = completedPhases.length
  const futuras = path.filter(
    (p) => getPhaseStatus(p, currentPhase, completedPhases, path, needsRectification) === "futura"
  ).length
  const puladas = PROCESS_PHASES.filter(
    (p) => getPhaseStatus(p, currentPhase, completedPhases, path, needsRectification) === "pulada"
  ).length

  return (
    <div className="w-[290px] flex-shrink-0 space-y-3.5">
      {/* Resumo do processo */}
      <div className="bg-[#1b2027] border border-white/10 rounded-xl p-4">
        <h3 className="text-[13.5px] font-extrabold text-white/95 mb-3">Resumo do processo</h3>
        <StatRow label="Caminho ativo" value={`${path.length} fases`} />
        <StatRow label="Fases concluídas" value={String(concluidas)} />
        <StatRow label="Fase atual" value={currentPhase} />
        <StatRow label="Fases futuras" value={String(futuras)} />
        <StatRow label="Fases puladas" value={String(puladas)} />
        <div className="flex justify-between items-center text-[12.5px] pt-2.5 mt-1 border-t-2 border-white/10">
          <span className="text-white/55">Progresso geral</span>
          <b className="text-[#7dd3fc] text-[15px]">{overall}%</b>
        </div>
      </div>

      {/* Resumo por fase */}
      <div className="bg-[#1b2027] border border-white/10 rounded-xl p-4">
        <h3 className="text-[13.5px] font-extrabold text-white/95 mb-3">Resumo por fase</h3>
        <div className="flex flex-col gap-0.5">
          {PROCESS_PHASES.map((title, i) => {
            const st = getPhaseStatus(title, currentPhase, completedPhases, path, needsRectification)
            const prog = progressOf(title)
            const icCls =
              st === "concluida" ? "bg-[#4ade80]/15 text-[#4ade80] border border-[#4ade80]/40"
              : st === "atual" ? "bg-[#7dd3fc]"
              : st === "pulada" ? "bg-[#252c35] text-white/40"
              : "border-[1.5px] border-white/10 bg-[#1b2027]"
            const pctCls =
              st === "concluida" ? "text-[#4ade80]"
              : st === "atual" ? "text-[#7dd3fc]"
              : "text-white/40"
            return (
              <button
                key={title}
                onClick={() => onSelectPhase?.(title)}
                className={`flex gap-2 items-start w-full text-left p-2 rounded-lg cursor-pointer transition-colors ${
                  title === sel ? "bg-[#7dd3fc]/12" : "hover:bg-[#20262e]"
                }`}
              >
                <span className={`w-4 h-4 rounded-full grid place-items-center text-[9px] font-bold flex-none mt-0.5 ${icCls}`}>
                  {st === "concluida" ? "✓" : st === "pulada" ? "⤳" : ""}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline gap-1.5">
                    <b className="text-[12px] text-white/95">{i + 1}. {title}</b>
                    <span className={`text-[12px] font-extrabold flex-none ${pctCls}`}>{prog}%</span>
                  </div>
                  <span className="text-[10.5px] text-white/40 block mt-0.5 leading-snug">
                    {phaseSummary(title, st, prog)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-[12.5px] py-1.5 border-b border-white/10">
      <span className="text-white/55">{label}</span>
      <b className="text-white/95">{value}</b>
    </div>
  )
}