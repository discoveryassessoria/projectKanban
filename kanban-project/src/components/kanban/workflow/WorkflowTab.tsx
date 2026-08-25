// src/components/kanban/workflow/WorkflowTab.tsx
"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useApi } from "@/src/lib/dados"
import {
  Check,
  Circle,
  Play,
  Loader2,
  ChevronRight,
  Lock,
} from "lucide-react"
import { CentralDaEtapaDrawer } from "./CentralDaEtapaDrawer"
import { OperacoesAntecipadasInline, type OpAntecipadaInline, type ResultadoAvaliacaoUI } from "./OperacaoAntecipadaPainel"
import { OperacaoAntecipadaModal } from "../OperacaoAntecipadaModal"

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

/**
 * Contexto para a OPERAÇÃO ANTECIPADA deste documento. Ela pertence ao ALVO (a
 * necessidade documental), e o alvo só é conhecido por quem abriu o documento —
 * por isso chega de fora, por ID, nunca resolvido por texto aqui dentro.
 *
 * Ausente ⇒ a aba não exibe operação antecipada (ex.: documento sem necessidade).
 */
export interface ContextoAntecipada {
  processoId: number
  necessidadeId: number | null
  pessoaId: number | null
  faseAtivaCode: string | null
  usuarios: Array<{ id: number; nome: string; publicCode?: string | null }>
  /** Abre a operação-ALVO da antecipada na tela oficial (o mesmo drawer). */
  onAbrirOperacaoAlvo?: (documentoId: number, necessidadeId: number | null, objetivo: string | null) => void
  readOnly?: boolean
}

interface WorkflowTabProps {
  documentoId: number
  onChange?: () => void
  contextoAntecipada?: ContextoAntecipada
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
  if (!dueAt) return { label: "no prazo", cls: "text-green-800 bg-[var(--surface-secondary)]" }
  const diff = (new Date(dueAt).getTime() - Date.now()) / 86400000
  if (diff < -5) return { label: `${Math.abs(Math.floor(diff))}d crítico`, cls: "text-red-700 bg-[var(--surface-secondary)]" }
  if (diff < 0) return { label: `${Math.abs(Math.floor(diff))}d atrasado`, cls: "text-amber-800 bg-[var(--surface-secondary)]" }
  if (diff < 1) return { label: "vence hoje", cls: "text-amber-800 bg-[var(--surface-secondary)]" }
  return { label: `${Math.ceil(diff)} dia(s)`, cls: "text-green-800 bg-[var(--surface-secondary)]" }
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

export function WorkflowTab({ documentoId, onChange, contextoAntecipada }: WorkflowTabProps) {
  // fase atual não tem Workflow Interno configurado (nunca cai no de outra fase)

  // ✅ NOVO: stepId aberto na Central da Etapa (drawer empilhado)
  const [centralStepId, setCentralStepId] = useState<number | null>(null)

  // OPERAÇÃO ANTECIPADA deste ALVO. Vive AQUI, no modal do documento — nunca na
  // listagem principal da Central, que é índice e não executor.
  const necId = contextoAntecipada?.necessidadeId ?? null
  const opsReq = useApi<{ operacoes?: OpAntecipadaInline[] }>(
    contextoAntecipada ? `/api/processos/${contextoAntecipada.processoId}/operacoes-antecipadas` : null,
  )
  // Filtra pela NECESSIDADE deste documento: a operação antecipada de outro alvo não
  // é assunto desta tela.
  const opsDoAlvo = (opsReq.dados?.operacoes ?? []).filter((o) => necId != null && o.necessidadeId === necId)
  const [criandoAntecipada, setCriandoAntecipada] = useState(false)

  // O PASSO ATUAL APARECE SEM NINGUÉM PROCURAR.
  //
  // O painel abre listando o workflow inteiro, e num documento de cinco etapas
  // isso ainda cabe na tela; num de doze, não. Quem clicou em "Continuar" quer
  // continuar de ONDE ESTÁ — não ler o histórico até achar o cartão azul.
  const passoAtual = useRef<HTMLDivElement | null>(null)

  const avaliarAntecipada = useCallback(
    async (id: number, resultado: ResultadoAvaliacaoUI, resultadoObtido: string, resultadoDados?: Record<string, unknown>) => {
      await fetch(`/api/operacoes-antecipadas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        body: JSON.stringify({ resultado, resultadoObtido: resultadoObtido || null, resultadoDados: resultadoDados ?? null }),
      })
      await opsReq.recarregar()
      onChange?.()
    },
    [opsReq, onChange],
  )

  // -- Carrega o workflow
  // Leitura pela camada oficial: o token e o tratamento de erro deixam de ser
  // montados aqui à mão. A mensagem exibida continua a mesma de antes.
  const consulta = useApi<{ workflow?: Workflow | null; semWorkflowInterno?: boolean }>(`/api/documentos/${documentoId}/workflow`)
  const workflow = consulta.dados?.workflow ?? null
  const semWorkflowInterno = consulta.dados?.semWorkflowInterno === true
  const loading = consulta.carregando
  const erro = consulta.erro ? "Erro ao carregar workflow." : null
  const carregar = consulta.recarregar

  // O foco só existe DEPOIS que a lista chegou: no primeiro render ainda é o
  // esqueleto de carregamento, e não há cartão nenhum para trazer à vista.
  useEffect(() => {
    if (!workflow) return
    passoAtual.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [workflow])

  // "Iniciar operação" manual foi removido do fluxo: o backend materializa a operação
  // da fase atual automaticamente ao carregar o workflow (garantirOperacaoDocumentoV2).

  // -- Render

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--text-secondary)]" />
      </div>
    )
  }

  if (erro) {
    return (
      <div className="px-1 py-6">
        <div className="bg-[var(--surface-secondary)] border border-red-800 rounded-lg px-4 py-3 text-sm text-red-700">
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
          <div className="w-12 h-12 rounded-full bg-[var(--text-muted)] border border-[var(--border-default)] flex items-center justify-center mb-4">
            <Circle className="w-5 h-5 text-[var(--text-secondary)]" />
          </div>
          <h4 className="text-white font-semibold text-sm mb-1.5">Sem Workflow Interno</h4>
          <p className="text-xs text-[var(--text-secondary)] max-w-xs">
            Não existe Workflow Interno configurado para esta fase.
          </p>
        </div>
      )
    }
    // Estado transitório/edge (materialização não retornou workflow por outro motivo):
    // recarregar, sem reiniciar operação nem usar fallback de outra fase.
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--text-muted)] border border-[var(--border-default)] flex items-center justify-center mb-4">
          <Circle className="w-5 h-5 text-[var(--text-secondary)]" />
        </div>
        <h4 className="text-white font-semibold text-sm mb-1.5">Não foi possível carregar as etapas</h4>
        <p className="text-xs text-[var(--text-secondary)] max-w-xs mb-5">
          Recarregue para tentar montar a operação desta fase.
        </p>
        <button
          onClick={() => { void carregar() }}
          className="px-4 py-2 bg-[var(--action-primary)] hover:bg-[var(--action-primary)] text-[var(--action-primary-ink)] text-xs font-semibold rounded-md inline-flex items-center gap-1.5"
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
      <div className="bg-gradient-to-br from-slate-900/80 to-slate-900/40 border border-[var(--border-default)] rounded-lg px-4 py-3.5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[13px] font-bold text-white">{workflow.templateName}</div>
          <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
            {workflow.steps.length} etapas · {doneCount} concluídas · iniciado em {fmtDate(workflow.startedAt)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 min-w-[160px]">
          <div className="text-[18px] font-bold text-white leading-none">{workflow.progress}%</div>
          <div className="w-40 h-1.5 bg-[var(--text-muted)] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${workflow.progress}%` }}
            />
          </div>
          <div className="text-[10px] text-[var(--text-secondary)] font-mono">{doneWeight}/{totalWeight} pontos</div>
        </div>
      </div>

      {/* ============== LISTA DE STEPS ==============
          TODOS os passos do workflow deste documento, na ordem publicada. O filtro
          que escondia "bloqueada sem motivo" e "não iniciada" saiu: com a execução
          concentrada aqui, esconder os passos futuros deixava o operador sem ver o
          caminho do documento — e a Central, que era onde ele via, virou índice. */}
      <div className="space-y-2">
        {workflow.steps.map((step) => (
          <StepCard
            key={step.id}
            step={step}
            onOpenCentral={() => setCentralStepId(step.id)}
            refDoAtual={(el) => { if (el) passoAtual.current = el }}
          />
        ))}
      </div>

      {/* ============== OPERAÇÃO ANTECIPADA ==============
          Capacidade nativa preservada INTEIRA (criar, listar, avaliar, abrir). Ela
          pertence ao ALVO deste documento e só existe aqui dentro. */}
      {contextoAntecipada && necId != null && (
        <div className="border border-[var(--border-default)] rounded-lg bg-[var(--surface-secondary)]/[0.05] px-3 py-3">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <b className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--text-secondary)]">
              Operação antecipada
            </b>
            {!contextoAntecipada.readOnly && (
              <button
                type="button"
                onClick={() => setCriandoAntecipada(true)}
                className="text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-secondary)] underline decoration-dotted underline-offset-2"
              >
                + nova operação antecipada
              </button>
            )}
          </div>
          {opsDoAlvo.length === 0 ? (
            <div className="text-[11.5px] text-[var(--text-muted)]">
              Nenhuma operação antecipada para este documento.
            </div>
          ) : (
            <OperacoesAntecipadasInline
              ops={opsDoAlvo}
              readOnly={contextoAntecipada.readOnly}
              onAvaliar={contextoAntecipada.readOnly ? undefined : avaliarAntecipada}
              onAbrir={
                contextoAntecipada.onAbrirOperacaoAlvo
                  ? (op) => contextoAntecipada.onAbrirOperacaoAlvo!(op.operacao.uiRef.id ?? 0, op.necessidadeId, op.objetivo)
                  : undefined
              }
            />
          )}
        </div>
      )}

      {criandoAntecipada && contextoAntecipada && necId != null && (
        <OperacaoAntecipadaModal
          processoId={contextoAntecipada.processoId}
          necessidadeId={necId}
          necessidadeLabel={workflow.templateName}
          pessoaId={contextoAntecipada.pessoaId}
          faseAtivaCode={contextoAntecipada.faseAtivaCode}
          usuarios={contextoAntecipada.usuarios}
          onClose={() => setCriandoAntecipada(false)}
          onCreated={() => { setCriandoAntecipada(false); void opsReq.recarregar(); onChange?.() }}
        />
      )}

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
  refDoAtual,
}: {
  step: WorkflowStep
  onOpenCentral: () => void
  /** Recebe o nó do passo ATIVO para que ele apareça sem ninguém procurar. */
  refDoAtual?: (el: HTMLDivElement | null) => void
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
        className="bg-[var(--surface-secondary)]/30 border border-green-900/60 rounded-md px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-[var(--surface-secondary)]/50 transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-[var(--action-primary)] flex items-center justify-center flex-shrink-0">
          <Check className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-green-800">
            {step.ordem}. {step.title}
          </div>
          <div className="text-[10.5px] text-green-800/80 mt-0.5">
            concluída por <strong>{completedByName}</strong> em {fmtDateTime(step.completedAt)} · peso {step.weight}%
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-green-500/70 flex-shrink-0" />
      </div>
    )
  }

  // ============================================================
  // MODO FUTURE — recolhido
  // ============================================================
  if (isFuture) {
    return (
      <div className="bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-md px-3 py-2.5 flex items-center gap-3 opacity-60">
        <div className="w-6 h-6 rounded-full bg-[var(--text-muted)] border border-[var(--border-default)] flex items-center justify-center flex-shrink-0">
          <Lock className="w-3 h-3 text-[var(--text-secondary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-[var(--text-secondary)]">
            {step.ordem}. {step.title}
          </div>
          <div className="text-[10.5px] text-[var(--text-secondary)] mt-0.5">
            {ownerName(step.ownerKey)} · peso {step.weight}% · aguarda liberação
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-[var(--text-secondary)] flex-shrink-0" />
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
    : "border-[var(--border-default)]"

  // Círculo com ícone
  const circleCls = isLockStepWait
    ? "bg-[var(--surface-secondary)]"
    : isBloqueioManual
    ? "bg-[var(--surface-secondary)]"
    : "bg-[var(--surface-secondary)]"

  // Badge de status (texto e cor)
  const statusBadgeCls = isLockStepWait
    ? "bg-[var(--surface-secondary)] text-amber-800 border-amber-800"
    : isBloqueioManual
    ? "bg-[var(--surface-secondary)] text-red-700 border-red-800"
    : step.status === "aguardando_terceiro"
    ? "bg-[var(--surface-secondary)] text-amber-800 border-amber-800"
    : step.status === "atrasada"
    ? "bg-[var(--surface-secondary)] text-amber-800 border-amber-800"
    : "bg-[var(--surface-secondary)] text-[var(--text-secondary)] border-[var(--border-default)]"

  const statusLabel = isLockStepWait
    ? "Aguardando docs"
    : STATUS_LABEL[step.status]

  const responsibleName = step.assignee?.nome || ownerName(step.ownerKey)
  const dotColor = ownerColor(step.ownerKey)

  return (
    <div className={`bg-[var(--surface-primary)] border ${cardBorderCls} rounded-md overflow-hidden`}>

      {/* Cabeçalho do step ativo */}
      <div ref={refDoAtual} className="px-3 py-3 flex items-start gap-3">
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
            <div className="text-[11px] text-[var(--text-secondary)] mt-1">{step.description}</div>
          )}

          {/* Meta compacta — esconde se for lock-step wait (responsável/SLA não fazem sentido) */}
          {!isLockStepWait && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--text-secondary)] mt-2">
              {/* QUEM EXECUTA ESTA ETAPA — não "o responsável".
                  O responsável pelo trabalho é o da TAREFA, e ele aparece uma
                  vez só, no topo do painel. Um nome solto aqui era lido como
                  "dono do documento" e disputava com aquele: a mesma certidão
                  parecia ter dois donos conforme onde se olhasse. */}
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
                <span className="text-[var(--text-secondary)]">executa</span>
                {responsibleName}
              </span>
              <span className="text-[var(--text-secondary)]">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="text-[var(--text-secondary)]">SLA</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${sla.cls}`}>
                  {sla.label}
                </span>
              </span>
              {step.dueAt && (
                <>
                  <span className="text-[var(--text-secondary)]">·</span>
                  <span className="font-mono text-[10.5px] text-[var(--text-secondary)]">{fmtDateTime(step.dueAt)}</span>
                </>
              )}
            </div>
          )}

          {/* Banner LOCK-STEP — amigável, âmbar */}
          {isLockStepWait && (
            <div className="mt-2 px-2.5 py-2 bg-amber-950/40 border border-amber-900/50 rounded text-[11.5px] text-amber-800 flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-800" />
              <div>
                <strong className="font-semibold">Aguardando outros documentos chegarem nesta etapa.</strong>
                <div className="text-[10.5px] text-amber-800/80 mt-0.5">
                  Libera automaticamente quando todos os documentos do processo concluírem a etapa anterior.
                </div>
              </div>
            </div>
          )}

          {/* Banner BLOQUEIO MANUAL — vermelho, como antes */}
          {isBloqueioManual && step.motivoBloqueio && (
            <div className="mt-2 px-2 py-1.5 bg-red-950/50 border border-red-900 rounded text-[11px] text-red-700">
              Bloqueado: <strong>{step.motivoBloqueio}</strong>
            </div>
          )}

          {/* Notas */}
          {step.notes && (
            <div className="mt-2 px-2 py-1.5 bg-[var(--surface-secondary)] rounded text-[11px] text-[var(--text-secondary)] italic">
              {step.notes}
            </div>
          )}
        </div>

        {/* Botão Central da Etapa — esconde no lock-step wait (não há ação útil) */}
        {!isLockStepWait && (
          <button
            onClick={onOpenCentral}
            className="px-2.5 py-1.5 text-[10.5px] font-semibold bg-[var(--action-primary)] hover:bg-[var(--action-primary)] text-[var(--action-primary-ink)] rounded transition-colors whitespace-nowrap"
          >
            Central da Etapa →
          </button>
        )}
      </div>

    </div>
  )
}