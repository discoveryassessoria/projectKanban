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
// IDENTIDADE CANÔNICA DA FASE — phaseKey, fornecida pelo backend
// (MacroWorkflow.fases real, GET /api/processos/[id]/phases). NENHUMA lista
// fixa de fase aqui: uma fase publicada pelo Catálogo de Fases (mandato
// 20/09/2026) aparece na trilha assim que o backend a devolver — sem alterar
// este arquivo. Identidade é `phaseKey`; `label` é só o que a tela mostra.
// ============================================================

export interface FaseTrilha {
  phaseKey: string
  label: string
  /** Só entra no caminho ativo condicionalmente (ex.: Retificação). */
  conditional?: boolean
}

type PhaseStatus = "concluida" | "atual" | "futura" | "pulada" | "bloqueada" | "condicional"

export interface WorkflowMacroProps {
  /** As fases do Workflow Macro deste processo, na ordem real (phaseKey + label). */
  fases: FaseTrilha[]
  /** phaseKey da fase atual do processo. */
  currentPhase: string
  /** phaseKeys já concluídas */
  completedPhases?: string[]
  /** Progresso por fase, chaveado por phaseKey: { genealogia: 100, ... } */
  phaseProgress?: Record<string, number>
  /** Houve decisão de retificação? (controla se as fases condicionais entram) */
  needsRectification?: boolean | null
  /** phaseKey selecionada para visualização (clique). Default = currentPhase */
  selectedPhase?: string
  /** Callback ao clicar numa fase — recebe o phaseKey */
  onSelectPhase?: (phaseKey: string) => void
}

// ============================================================
// LÓGICA DE CAMINHO E STATUS — dirigida pelos dados recebidos, nunca por lista fixa
// ============================================================

export function getActivePath(fases: FaseTrilha[], needsRectification: boolean | null | undefined): string[] {
  return fases.filter((f) => !f.conditional || needsRectification).map((f) => f.phaseKey)
}

export function getPhaseStatus(
  fases: FaseTrilha[],
  phaseKey: string,
  currentPhase: string,
  completedPhases: string[],
  path: string[],
  needsRectification: boolean | null | undefined
): PhaseStatus {
  // A fase em que o processo REALMENTE está vence qualquer heurística de
  // caminho. Sem isto, um processo já dentro de "Retificação de registros"
  // sem a Decisão da Análise Documental registrada (ex.: chegou lá por
  // movimentação manual) ficava com a fase atual marcada "Condicional" — o
  // operador não conseguia nem ver em que fase o processo estava.
  if (phaseKey === currentPhase) return "atual"
  if (!path.includes(phaseKey)) {
    // Fase fora do caminho ativo. Se é condicional E a Análise ainda NÃO
    // decidiu (null), ela é "condicional" (pode entrar). Só vira "pulada"
    // quando a decisão foi tomada e ela ficou de fora.
    const def = fases.find((f) => f.phaseKey === phaseKey)
    if (def?.conditional && (needsRectification === null || needsRectification === undefined)) {
      return "condicional"
    }
    return "pulada"
  }
  if (completedPhases.includes(phaseKey)) return "concluida"
  // Ordem GLOBAL (não a do `path`) — a fase atual pode estar fora do `path`
  // pela mesma razão do bloco acima (condicional sem decisão registrada), e
  // `path.indexOf` devolveria -1, jogando toda fase anterior para "futura".
  const ci = fases.findIndex((f) => f.phaseKey === currentPhase)
  const pi = fases.findIndex((f) => f.phaseKey === phaseKey)
  if (pi > ci) return "futura"
  return "bloqueada"
}

// Resumo curto de cada fase (texto da coluna lateral). Genérico — sem dados de
// procState. Quando o backend fornecer contadores por fase, dá pra enriquecer.
function phaseSummary(status: PhaseStatus, progress: number): string {
  if (status === "pulada") return "Fase fora do caminho ativo deste processo."
  if (status === "concluida") return "Fase concluída."
  if (status === "atual") return `Fase em andamento · ${progress}% concluído.`
  return "Fase futura — ainda não iniciada."
}

// ============================================================
// COMPONENTE: TRILHA (timeline horizontal)
// ============================================================

export function WorkflowMacroTrilha({
  fases,
  currentPhase,
  completedPhases = [],
  phaseProgress = {},
  needsRectification = null,
  selectedPhase,
  onSelectPhase,
}: WorkflowMacroProps) {
  const path = getActivePath(fases, needsRectification)

  const progressOf = (phaseKey: string): number => {
    if (completedPhases.includes(phaseKey)) return 100
    if (!path.includes(phaseKey)) return 0
    return phaseProgress[phaseKey] ?? 0
  }

  const decLabel = (() => {
    // "Decisão da Análise Documental"
    if (needsRectification === true) return { txt: "Precisa retificação", cls: "bg-[var(--surface-secondary)] text-green-800" }
    if (needsRectification === false) return { txt: "Sem retificação", cls: "bg-[var(--surface-secondary)] text-green-800" }
    return { txt: "Não definida", cls: "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]" }
  })()

  return (
    <div className="bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-2xl px-5 py-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-3.5">
        <div>
          <h3 className="text-base font-extrabold text-white/95 flex items-center gap-1.5">
            Workflow Macro do Processo
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--surface-tertiary)] text-[var(--text-muted)] text-[10px] font-bold">i</span>
          </h3>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">Visão geral do caminho do processo entre fases.</div>
        </div>
        <div className="text-xs text-[var(--text-secondary)] bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-lg px-3 py-2 whitespace-nowrap">
          Decisão da Análise Documental:
          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md ml-1.5 ${decLabel.cls}`}>{decLabel.txt}</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex gap-0 overflow-x-auto pb-1">
        {fases.map((f, i) => {
          const title = f.label
          const st = getPhaseStatus(fases, f.phaseKey, currentPhase, completedPhases, path, needsRectification)
          const prog = progressOf(f.phaseKey)

          // IDENTIDADE BITRIX (14-15/09/2026): a fase ATUAL é azul, uma fase
          // já PASSADA é âmbar, e só a ÚLTIMA fase (o processo de verdade
          // encerrado) é verde — nunca "concluída" genérica em verde, que era
          // a leitura da Identidade AZUL. Ver `--stepper-*` em globals.css.
          const ehFaseFinal = f.phaseKey === fases[fases.length - 1]?.phaseKey
          const dotCls =
            st === "concluida" ? (ehFaseFinal ? "text-[var(--stepper-success-text)]" : "text-[var(--stepper-passed-text)]")
            : st === "atual" ? "text-[var(--stepper-current-text)]"
            : st === "pulada" ? "bg-[var(--surface-tertiary)] text-[var(--text-muted)]"
            : st === "condicional" ? "bg-[var(--surface-secondary)] text-[var(--text-secondary)]"
            : st === "bloqueada" ? "bg-[var(--accent-primary)]/15 text-[var(--accent-text)]"
            : "border-2 border-[var(--border-default)] bg-[var(--surface-popover)] text-[var(--text-muted)]"
          const dotStyle: React.CSSProperties | undefined =
            st === "concluida" ? { backgroundColor: ehFaseFinal ? "var(--stepper-success-bg)" : "var(--stepper-passed-bg)" }
            : st === "atual" ? { backgroundColor: "var(--stepper-current-bg)" }
            : undefined

          const badgeCls =
            st === "concluida" ? (ehFaseFinal ? "text-[var(--stepper-success-text)]" : "text-[var(--stepper-passed-text)]")
            : st === "atual" ? "text-[var(--stepper-current-text)]"
            : st === "pulada" ? "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]"
            : st === "condicional" ? "bg-[var(--surface-secondary)] text-[var(--text-secondary)]"
            : st === "bloqueada" ? "bg-[var(--accent-primary)]/15 text-[var(--accent-text)]"
            : "bg-[var(--surface-secondary)] text-[var(--text-muted)]"
          const badgeStyle: React.CSSProperties | undefined =
            st === "concluida" ? { backgroundColor: ehFaseFinal ? "var(--stepper-success-bg)" : "var(--stepper-passed-bg)" }
            : st === "atual" ? { backgroundColor: "var(--stepper-current-bg)" }
            : undefined
          const badgeTxt =
            st === "concluida" ? "Concluída"
            : st === "atual" ? "Atual"
            : st === "pulada" ? "Pulada"
            : st === "condicional" ? "Condicional"
            // "Bloqueada" soava como um impedimento ativo (a mesma leitura
            // errada que já saiu de outras telas) — o que este status
            // realmente representa é uma fase anterior à atual sem marca
            // explícita de conclusão registrada. Sem inventar "concluída"
            // (não é o que o dado diz): só um rótulo que não contradiz o
            // progresso que aparece ao lado (mandato "modernização visual",
            // 19/09/2026).
            : st === "bloqueada" ? "Não confirmada"
            : "Futura"
          const badgeFinalCls = badgeCls

          const barColor =
            st === "concluida" ? (ehFaseFinal ? "var(--stepper-success-bg)" : "var(--stepper-passed-bg)")
            : st === "atual" ? "var(--stepper-current-bg)"
            : st === "pulada" ? "var(--border-strong)"
            : "var(--stepper-future-text)"
          const pctColor =
            st === "concluida" ? (ehFaseFinal ? "text-[var(--stepper-success-bg)]" : "text-[var(--stepper-passed-bg)]")
            : st === "atual" ? "text-[var(--stepper-current-bg)]"
            : "text-[var(--text-muted)]"

          // conector pra próxima fase
          const nextDone = i < fases.length - 1
            ? (getPhaseStatus(fases, fases[i + 1].phaseKey, currentPhase, completedPhases, path, needsRectification) === "concluida" || st === "concluida")
            : false

          const clicavel = !!onSelectPhase
          const consultando = !!selectedPhase && selectedPhase === f.phaseKey && selectedPhase !== currentPhase

          return (
            <div
              key={f.phaseKey}
              className="flex-1 min-w-[92px] relative z-10"
            >
              <button
                onClick={() => onSelectPhase?.(f.phaseKey)}
                disabled={!clicavel}
                title={clicavel ? "Ver esta fase" : undefined}
                className={`flex flex-col items-center gap-1 w-full py-1.5 px-1 rounded-xl border transition-colors ${
                  clicavel ? "cursor-pointer" : "cursor-default"
                } ${
                  // FASE REAL do processo: quadro próprio (borda + fundo + sombra), não
                  // só o texto do badge — é o que dá pra achar "em qual fase está" num
                  // relance, sem ler as 10 etiquetas.
                  st === "atual"
                    ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 shadow-[var(--elev-2)]"
                    : `border-transparent bg-transparent ${clicavel ? "hover:bg-[var(--surface-secondary)]" : ""}`
                } ${consultando ? "ring-2 border-[var(--border-default)] bg-[var(--surface-secondary)]" : ""}`}
              >
                {/* dot + conector */}
                <div className="flex items-center w-full justify-center relative">
                  <span className={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold flex-none relative z-30 ${dotCls}`} style={dotStyle}>
                    {st === "concluida" ? <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      : st === "atual" ? <b>{i + 1}</b>
                      : st === "pulada" ? "⤳" : ""}
                  </span>
                  {i < fases.length - 1 && (
                    <div
                      className="absolute left-1/2 w-full h-0.5 top-1/2 -translate-y-1/2 z-20"
                      style={{ background: nextDone ? "#f5a524" : "#bfd8e8" }}
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
                  <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${badgeFinalCls}`} style={badgeStyle}>
                    {badgeTxt}
                  </span>
                </span>

                {/* pct */}
                <span className={`text-[12.5px] font-extrabold ${pctColor}`}>{prog}%</span>

                {/* mini barra */}
                <div className="w-4/5 h-1 bg-[var(--surface-tertiary)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${prog}%`, background: barColor }} />
                </div>
              </button>
            </div>
          )
        })}
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-3.5 pt-3 mt-2.5 border-t border-[var(--border-default)] text-[11px] text-[var(--text-secondary)]">
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[var(--surface-secondary)] text-green-800 border border-[var(--border-default)] grid place-items-center"><Check className="w-2 h-2" strokeWidth={3} /></span>Concluída</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[var(--surface-secondary)]" />Atual (fase real)</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-popover)]" />Futura</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[var(--surface-secondary)] text-[var(--text-secondary)] grid place-items-center text-[8px]">?</span>Condicional</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[var(--surface-tertiary)] text-[var(--text-muted)] grid place-items-center text-[8px]">⤳</span>Pulada</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[var(--accent-primary)]/15 text-[var(--accent-text)] grid place-items-center text-[8px]">!</span>Não confirmada (anterior à atual, sem conclusão registrada)</span>
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
  fases,
  currentPhase,
  completedPhases = [],
  phaseProgress = {},
  needsRectification = null,
}: WorkflowMacroProps) {
  const path = getActivePath(fases, needsRectification)

  const progressOf = (phaseKey: string): number => {
    if (completedPhases.includes(phaseKey)) return 100
    if (!path.includes(phaseKey)) return 0
    return phaseProgress[phaseKey] ?? 0
  }

  const overall = Math.round(
    path.reduce((acc, ph) => acc + progressOf(ph), 0) / (path.length || 1)
  )
  const concluidas = completedPhases.length
  const futuras = path.filter(
    (p) => getPhaseStatus(fases, p, currentPhase, completedPhases, path, needsRectification) === "futura"
  ).length
  const puladas = fases.filter(
    (f) => getPhaseStatus(fases, f.phaseKey, currentPhase, completedPhases, path, needsRectification) === "pulada"
  ).length
  const currentLabel = fases.find((f) => f.phaseKey === currentPhase)?.label ?? (currentPhase ? `⚠ Fase não cadastrada (${currentPhase})` : "—")

  const item = (label: string, value: string, destaque?: boolean) => (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-[var(--text-muted)]">{label}</span>
      <b className={destaque ? "text-white/95" : "text-[var(--text-secondary)]"}>{value}</b>
    </span>
  )

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3.5 py-2 text-[12px]">
      {item("Caminho ativo", `${path.length} fases`)}
      <span className="text-[var(--border-default)]">·</span>
      {item("Concluídas", String(concluidas))}
      <span className="text-[var(--border-default)]">·</span>
      {item("Fase atual", currentLabel, true)}
      <span className="text-[var(--border-default)]">·</span>
      {item("Futuras", String(futuras))}
      <span className="text-[var(--border-default)]">·</span>
      {item("Puladas", String(puladas))}
      <span className="text-[var(--border-default)]">·</span>
      {item("Progresso geral", `${overall}%`, true)}
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
  fases,
  currentPhase,
  completedPhases = [],
  phaseProgress = {},
  needsRectification = null,
  selectedPhase,
  onSelectPhase,
}: WorkflowMacroProps) {
  const path = getActivePath(fases, needsRectification)
  const sel = selectedPhase || currentPhase

  const progressOf = (phaseKey: string): number => {
    if (completedPhases.includes(phaseKey)) return 100
    if (!path.includes(phaseKey)) return 0
    return phaseProgress[phaseKey] ?? 0
  }

  const overall = Math.round(
    path.reduce((acc, ph) => acc + progressOf(ph), 0) / (path.length || 1)
  )
  const concluidas = completedPhases.length
  const futuras = path.filter(
    (p) => getPhaseStatus(fases, p, currentPhase, completedPhases, path, needsRectification) === "futura"
  ).length
  const puladas = fases.filter(
    (f) => getPhaseStatus(fases, f.phaseKey, currentPhase, completedPhases, path, needsRectification) === "pulada"
  ).length
  const currentLabel = fases.find((f) => f.phaseKey === currentPhase)?.label ?? (currentPhase ? `⚠ Fase não cadastrada (${currentPhase})` : "—")

  return (
    <div className="w-[290px] flex-shrink-0 space-y-3.5">
      {/* Resumo do processo */}
      <div className="bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl p-4">
        <h3 className="text-[13.5px] font-extrabold text-white/95 mb-3">Resumo do processo</h3>
        <StatRow label="Caminho ativo" value={`${path.length} fases`} />
        <StatRow label="Fases concluídas" value={String(concluidas)} />
        <StatRow label="Fase atual" value={currentLabel} />
        <StatRow label="Fases futuras" value={String(futuras)} />
        <StatRow label="Fases puladas" value={String(puladas)} />
        <div className="flex justify-between items-center text-[12.5px] pt-2.5 mt-1 border-t-2 border-[var(--border-default)]">
          <span className="text-[var(--text-secondary)]">Progresso geral</span>
          <b className="text-[var(--text-secondary)] text-[15px]">{overall}%</b>
        </div>
      </div>

      {/* Resumo por fase */}
      <div className="bg-[var(--surface-popover)] border border-[var(--border-default)] rounded-xl p-4">
        <h3 className="text-[13.5px] font-extrabold text-white/95 mb-3">Resumo por fase</h3>
        <div className="flex flex-col gap-0.5">
          {fases.map((f, i) => {
            const st = getPhaseStatus(fases, f.phaseKey, currentPhase, completedPhases, path, needsRectification)
            const prog = progressOf(f.phaseKey)
            const icCls =
              st === "concluida" ? "bg-[var(--surface-secondary)] text-green-800 border border-[var(--border-default)]"
              : st === "atual" ? "bg-[var(--surface-secondary)]"
              : st === "pulada" ? "bg-[var(--surface-tertiary)] text-[var(--text-muted)]"
              : "border-[1.5px] border-[var(--border-default)] bg-[var(--surface-popover)]"
            const pctCls =
              st === "concluida" ? "text-green-800"
              : st === "atual" ? "text-[var(--text-secondary)]"
              : "text-[var(--text-muted)]"
            return (
              <button
                key={f.phaseKey}
                onClick={() => onSelectPhase?.(f.phaseKey)}
                className={`flex gap-2 items-start w-full text-left p-2 rounded-lg cursor-pointer transition-colors ${
                  f.phaseKey === sel ? "bg-[var(--surface-secondary)]" : "hover:bg-[var(--surface-secondary)]"
                }`}
              >
                <span className={`w-4 h-4 rounded-full grid place-items-center text-[9px] font-bold flex-none mt-0.5 ${icCls}`}>
                  {st === "concluida" ? "✓" : st === "pulada" ? "⤳" : ""}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline gap-1.5">
                    <b className="text-[12px] text-white/95">{i + 1}. {f.label}</b>
                    <span className={`text-[12px] font-extrabold flex-none ${pctCls}`}>{prog}%</span>
                  </div>
                  <span className="text-[10.5px] text-[var(--text-muted)] block mt-0.5 leading-snug">
                    {phaseSummary(st, prog)}
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
    <div className="flex justify-between items-center text-[12.5px] py-1.5 border-b border-[var(--border-default)]">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <b className="text-white/95">{value}</b>
    </div>
  )
}