// src/components/kanban/workflow/WorkflowTab.tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Check,
  Circle,
  Play,
  Loader2,
  ChevronRight,
  Lock,
} from "lucide-react"
import { CentralDaEtapaDrawer } from "./CentralDaEtapaDrawer"

// ============================================================
// TIPOS
// ============================================================

type StatusStep =
  | "nao_iniciada"
  | "bloqueada"
  | "em_andamento"
  | "aguardando_terceiro"
  | "atrasada"
  | "concluida"
  | "cancelada"

interface UserRef {
  id: number
  nome: string
  email: string
}

interface WorkflowStep {
  id: number
  ordem: number
  stepKey: string
  title: string
  description: string | null
  status: StatusStep
  weight: number
  ownerKey: string | null
  assigneeId: number | null
  assignee: UserRef | null
  startedAt: string | null
  dueAt: string | null
  completedAt: string | null
  completedById: number | null
  completedBy: UserRef | null
  motivoBloqueio: string | null
  notes: string | null
  slaDays: number
  trackingCode: string | null
  externalProtocol: string | null
}

interface Workflow {
  id: number
  documentoId: number
  templateCode: string
  templateName: string
  status: string
  progress: number
  startedAt: string
  completedAt: string | null
  steps: WorkflowStep[]
}

interface WorkflowTabProps {
  documentoId: number
  onChange?: () => void
}

// ============================================================
// HELPERS
// ============================================================

const LOCK_STEP_PREFIX = "Aguardando outros documentos do processo"

const OWNERS_MAP: Record<string, string> = {
  equipe_documental: "Equipe Documental",
  daniela_brait: "Daniela Brait",
  marco_rovatti: "Marco Rovatti",
  sistema: "Sistema",
}

const ownerName = (key: string | null): string => {
  if (!key) return "—"
  return OWNERS_MAP[key] || key
}

const ownerColor = (key: string | null): string => {
  if (!key) return "#64748b"
  if (key.includes("daniela")) return "#ec4899"
  if (key.includes("marco")) return "#3b82f6"
  if (key.includes("equipe")) return "#10b981"
  return "#64748b"
}

const fmtDateTime = (iso: string | null): string => {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR")
}

const fmtSla = (dueAt: string | null) => {
  if (!dueAt) return { label: "no prazo", cls: "text-emerald-300 bg-emerald-900/40" }
  const diff = (new Date(dueAt).getTime() - Date.now()) / 86400000
  if (diff < -5) return { label: `${Math.abs(Math.floor(diff))}d crítico`, cls: "text-red-300 bg-red-900/50" }
  if (diff < 0) return { label: `${Math.abs(Math.floor(diff))}d atrasado`, cls: "text-orange-300 bg-orange-900/50" }
  if (diff < 1) return { label: "vence hoje", cls: "text-amber-300 bg-amber-900/50" }
  return { label: `${Math.ceil(diff)} dia(s)`, cls: "text-emerald-300 bg-emerald-900/40" }
}

const STATUS_LABEL: Record<StatusStep, string> = {
  nao_iniciada: "Não iniciada",
  bloqueada: "Bloqueada",
  em_andamento: "Em execução",
  aguardando_terceiro: "Aguardando terceiro",
  atrasada: "Atrasada",
  concluida: "Concluída",
  cancelada: "Cancelada",
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function WorkflowTab({ documentoId, onChange }: WorkflowTabProps) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  // fase atual não tem Workflow Interno configurado (nunca cai no de outra fase)
  const [semWorkflowInterno, setSemWorkflowInterno] = useState(false)

  // ✅ NOVO: stepId aberto na Central da Etapa (drawer empilhado)
  const [centralStepId, setCentralStepId] = useState<number | null>(null)

  // -- Carrega o workflow
  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const res = await fetch(`/api/documentos/${documentoId}/workflow`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setWorkflow(json.workflow)
      setSemWorkflowInterno(json.semWorkflowInterno === true)
    } catch (e) {
      console.warn("[WorkflowTab] falha:", e)
      setErro("Erro ao carregar workflow.")
    } finally {
      setLoading(false)
    }
  }, [documentoId])

  useEffect(() => {
    carregar()
  }, [carregar])

  // "Iniciar operação" manual foi removido do fluxo: o backend materializa a operação
  // da fase atual automaticamente ao carregar o workflow (garantirOperacaoDocumentoV2).

  // -- Render

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      </div>
    )
  }

  if (erro) {
    return (
      <div className="px-1 py-6">
        <div className="bg-red-900/20 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-200">
          ⚠ {erro}
        </div>
      </div>
    )
  }

  // -- Sem workflow (o backend já materializa automaticamente ao abrir; se ainda assim
  //    não há workflow, é porque a FASE ATUAL não tem Workflow Interno configurado —
  //    mensagem controlada, NUNCA workflow de outra fase, sem "Iniciar operação").
  if (!workflow) {
    if (semWorkflowInterno) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
            <Circle className="w-5 h-5 text-slate-500" />
          </div>
          <h4 className="text-white font-semibold text-sm mb-1.5">Sem Workflow Interno</h4>
          <p className="text-xs text-slate-400 max-w-xs">
            Não existe Workflow Interno configurado para esta fase.
          </p>
        </div>
      )
    }
    // Estado transitório/edge (materialização não retornou workflow por outro motivo):
    // recarregar, sem reiniciar operação nem usar fallback de outra fase.
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mb-4">
          <Circle className="w-5 h-5 text-slate-500" />
        </div>
        <h4 className="text-white font-semibold text-sm mb-1.5">Não foi possível carregar as etapas</h4>
        <p className="text-xs text-slate-400 max-w-xs mb-5">
          Recarregue para tentar montar a operação desta fase.
        </p>
        <button
          onClick={carregar}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-md inline-flex items-center gap-1.5"
        >
          ↻ Recarregar
        </button>
      </div>
    )
  }

  // -- Render do workflow
  const totalWeight = workflow.steps.reduce((s, x) => s + x.weight, 0)
  const doneWeight = workflow.steps
    .filter((x) => x.status === "concluida")
    .reduce((s, x) => s + x.weight, 0)
  const doneCount = workflow.steps.filter((s) => s.status === "concluida").length

  return (
    <div className="space-y-4">

      {/* ============== HEADER ============== */}
      <div className="bg-gradient-to-br from-slate-900/80 to-slate-900/40 border border-slate-700/50 rounded-lg px-4 py-3.5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[13px] font-bold text-white">{workflow.templateName}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {workflow.steps.length} etapas · {doneCount} concluídas · iniciado em {fmtDate(workflow.startedAt)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 min-w-[160px]">
          <div className="text-[18px] font-bold text-white leading-none">{workflow.progress}%</div>
          <div className="w-40 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${workflow.progress}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500 font-mono">{doneWeight}/{totalWeight} pontos</div>
        </div>
      </div>

      {/* ============== LISTA DE STEPS ============== */}
      <div className="space-y-2">
        {workflow.steps
          .filter((step) => {
            // ✅ Mostra: concluídas + em execução + bloqueadas COM motivo
            //    (cobre lock-step "aguardando irmãos" e bloqueio manual)
            // ❌ Esconde: bloqueadas sem motivo (= ainda não chegou a vez)
            //    e não_iniciada
            const isDone = step.status === "concluida"
            const isActive =
              step.status === "em_andamento" ||
              step.status === "aguardando_terceiro" ||
              step.status === "atrasada" ||
              (step.status === "bloqueada" && step.motivoBloqueio !== null)
            return isDone || isActive
          })
          .map((step) => (
            <StepCard
              key={step.id}
              step={step}
              onOpenCentral={() => setCentralStepId(step.id)}
            />
          ))}
      </div>

      {/* ============== CENTRAL DA ETAPA (drawer empilhado) ============== */}
      <CentralDaEtapaDrawer
        documentoId={documentoId}
        stepId={centralStepId}
        isOpen={centralStepId !== null}
        onClose={() => setCentralStepId(null)}
        onUpdate={() => {
          carregar()
          onChange?.()
        }}
      />

    </div>
  )
}

// ============================================================
// STEP CARD — 3 modos: DONE / ACTIVE / FUTURE
// (Editor inline removido — toda interação vai pra Central da Etapa)
// ============================================================

function StepCard({
  step,
  onOpenCentral,
}: {
  step: WorkflowStep
  onOpenCentral: () => void
}) {
  const isDone = step.status === "concluida"
  const isActive =
    step.status === "em_andamento" ||
    step.status === "aguardando_terceiro" ||
    step.status === "atrasada" ||
    (step.status === "bloqueada" && step.motivoBloqueio !== null)
  const isFuture = !isDone && !isActive

  // ============================================================
  // MODO DONE — compacto
  // ============================================================
  if (isDone) {
    const completedByName = step.completedBy?.nome || ownerName(step.ownerKey)
    return (
      <div
        onClick={onOpenCentral}
        className="bg-emerald-950/30 border border-emerald-900/60 rounded-md px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-emerald-950/50 transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
          <Check className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-emerald-200">
            {step.ordem}. {step.title}
          </div>
          <div className="text-[10.5px] text-emerald-400/80 mt-0.5">
            concluída por <strong>{completedByName}</strong> em {fmtDateTime(step.completedAt)} · peso {step.weight}%
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-emerald-500/70 flex-shrink-0" />
      </div>
    )
  }

  // ============================================================
  // MODO FUTURE — recolhido
  // ============================================================
  if (isFuture) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-md px-3 py-2.5 flex items-center gap-3 opacity-60">
        <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
          <Lock className="w-3 h-3 text-slate-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-slate-400">
            {step.ordem}. {step.title}
          </div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">
            {ownerName(step.ownerKey)} · peso {step.weight}% · aguarda liberação
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-700 flex-shrink-0" />
      </div>
    )
  }

  // ============================================================
  // MODO ACTIVE — expandido (3 sub-modos visuais)
  // ============================================================
  const sla = fmtSla(step.dueAt)
  const isBloqueada = step.status === "bloqueada"
  const isLockStepWait =
    isBloqueada && step.motivoBloqueio?.startsWith(LOCK_STEP_PREFIX)
  const isBloqueioManual = isBloqueada && !isLockStepWait

  // Cor da borda do card
  const cardBorderCls = isLockStepWait
    ? "border-amber-900/60"
    : isBloqueioManual
    ? "border-red-900/60"
    : "border-blue-900/60"

  // Círculo com ícone
  const circleCls = isLockStepWait
    ? "bg-amber-500/80"
    : isBloqueioManual
    ? "bg-red-500/80"
    : "bg-blue-500"

  // Badge de status (texto e cor)
  const statusBadgeCls = isLockStepWait
    ? "bg-amber-900/60 text-amber-200 border-amber-800"
    : isBloqueioManual
    ? "bg-red-900/60 text-red-200 border-red-800"
    : step.status === "aguardando_terceiro"
    ? "bg-amber-900/60 text-amber-200 border-amber-800"
    : step.status === "atrasada"
    ? "bg-orange-900/60 text-orange-200 border-orange-800"
    : "bg-blue-900/60 text-blue-200 border-blue-800"

  const statusLabel = isLockStepWait
    ? "Aguardando docs"
    : STATUS_LABEL[step.status]

  const responsibleName = step.assignee?.nome || ownerName(step.ownerKey)
  const dotColor = ownerColor(step.ownerKey)

  return (
    <div className={`bg-slate-900/60 border ${cardBorderCls} rounded-md overflow-hidden`}>

      {/* Cabeçalho do step ativo */}
      <div className="px-3 py-3 flex items-start gap-3">
        <div className={`w-6 h-6 rounded-full ${circleCls} flex items-center justify-center flex-shrink-0 mt-0.5`}>
          {isBloqueada ? (
            <Lock className="w-3 h-3 text-white" />
          ) : (
            <Play className="w-3 h-3 text-white fill-white ml-0.5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12.5px] font-semibold text-white">
              {step.ordem}. {step.title}
            </div>
            <span className={`text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusBadgeCls}`}>
              {statusLabel}
            </span>
          </div>
          {step.description && (
            <div className="text-[11px] text-slate-400 mt-1">{step.description}</div>
          )}

          {/* Meta compacta — esconde se for lock-step wait (responsável/SLA não fazem sentido) */}
          {!isLockStepWait && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-300 mt-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
                {responsibleName}
              </span>
              <span className="text-slate-600">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="text-slate-500">SLA</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${sla.cls}`}>
                  {sla.label}
                </span>
              </span>
              {step.dueAt && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="font-mono text-[10.5px] text-slate-400">{fmtDateTime(step.dueAt)}</span>
                </>
              )}
            </div>
          )}

          {/* Banner LOCK-STEP — amigável, âmbar */}
          {isLockStepWait && (
            <div className="mt-2 px-2.5 py-2 bg-amber-950/40 border border-amber-900/50 rounded text-[11.5px] text-amber-200 flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-400" />
              <div>
                <strong className="font-semibold">Aguardando outros documentos chegarem nesta etapa.</strong>
                <div className="text-[10.5px] text-amber-400/80 mt-0.5">
                  Libera automaticamente quando todos os documentos do processo concluírem a etapa anterior.
                </div>
              </div>
            </div>
          )}

          {/* Banner BLOQUEIO MANUAL — vermelho, como antes */}
          {isBloqueioManual && step.motivoBloqueio && (
            <div className="mt-2 px-2 py-1.5 bg-red-950/50 border border-red-900 rounded text-[11px] text-red-200">
              Bloqueado: <strong>{step.motivoBloqueio}</strong>
            </div>
          )}

          {/* Notas */}
          {step.notes && (
            <div className="mt-2 px-2 py-1.5 bg-slate-800/50 rounded text-[11px] text-slate-300 italic">
              {step.notes}
            </div>
          )}
        </div>

        {/* Botão Central da Etapa — esconde no lock-step wait (não há ação útil) */}
        {!isLockStepWait && (
          <button
            onClick={onOpenCentral}
            className="px-2.5 py-1.5 text-[10.5px] font-semibold bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors whitespace-nowrap"
          >
            Central da Etapa →
          </button>
        )}
      </div>

    </div>
  )
}