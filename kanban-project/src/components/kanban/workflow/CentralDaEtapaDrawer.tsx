// src/components/kanban/workflow/CentralDaEtapaDrawer.tsx
//
// Drawer empilhado sobre o DocumentoOperationalDrawer. Abre quando o usuário
// clica em "Central da Etapa →" na lista de steps do WorkflowTab.
//
// Espelha a "Central da Etapa" do HTML do Marco (Image 4 da rodada anterior):
// header com "ETAPA X DE Y", botões grandes Concluir/Bloquear/Transferir/Forçar/Fechar,
// e tabs Campos / Anexos / Comentários / Dependências / SLA / Automação / Timeline.

"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useApi } from "@/src/lib/dados"
import { createPortal } from "react-dom"
import {
  X,
  Loader2,
  Check,
  AlertTriangle,
  Lock,
  ArrowLeftRight,
  Zap,
  ChevronRight,
  Clock,
  User as UserIcon,
  FileText,
} from "lucide-react"
import { EditorRegistralModal } from "./EditorRegistralModal"
import { StepEditorRouter } from "./StepEditors"

// ============================================================
// HELPER — pega userId logado do localStorage (mesmo padrão do
// DocumentoOperationalDrawer / ProcessoCentralOperacional)
// ============================================================

const getUserId = (): number | null => {
  try {
    const stored = localStorage.getItem("user")
    if (stored) {
      const u = JSON.parse(stored)
      return u.id ?? null
    }
  } catch {}
  return null
}

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
  email: string | null
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
  requestChannel: string | null
  reviewResult: string | null
  validationResult: string | null
  createdAt: string
  updatedAt: string
}

interface Workflow {
  id: number
  status: string
  progress: number
  steps: WorkflowStep[]
}

type TabId =
  | "campos"
  | "anexos"
  | "comentarios"
  | "dependencias"
  | "sla"
  | "automacao"
  | "timeline"

export interface CentralDaEtapaDrawerProps {
  documentoId: number
  stepId: number | null
  isOpen: boolean
  onClose: () => void
  onUpdate?: () => void
}

// ============================================================
// LABELS / HELPERS
// ============================================================

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

const STATUS_LABEL: Record<StatusStep, string> = {
  nao_iniciada: "Não iniciada",
  bloqueada: "Bloqueada",
  em_andamento: "Em andamento",
  aguardando_terceiro: "Aguardando terceiro",
  atrasada: "Atrasada",
  concluida: "Concluída",
  cancelada: "Cancelada",
}

const STATUS_PILL_CLS: Record<StatusStep, string> = {
  nao_iniciada: "bg-[#20262e]0/20 text-white/40 border-white/10",
  bloqueada: "bg-[#f87171]/20 text-[#f87171] border-[#f87171]/50",
  em_andamento: "bg-[#7dd3fc]/20 text-[#7dd3fc] border-[#7dd3fc]/50",
  aguardando_terceiro: "bg-[#d2a948]/20 text-[#d2a948] border-[#d2a948]/50",
  atrasada: "bg-[#fbbf24]/20 text-[#fbbf24] border-[#fbbf24]/50",
  concluida: "bg-[#4ade80]/20 text-[#4ade80] border-[#4ade80]/50",
  cancelada: "bg-[#20262e]0/20 text-white/40 border-white/10",
}

const fmtDateTime = (iso: string | null): string => {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    return (
      d.toLocaleDateString("pt-BR") +
      " " +
      d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    )
  } catch {
    return "—"
  }
}

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString("pt-BR")
  } catch {
    return "—"
  }
}

const fmtSla = (
  dueAt: string | null,
): { label: string; cls: string } => {
  if (!dueAt) return { label: "sem prazo", cls: "text-white/40" }
  const diff = (new Date(dueAt).getTime() - Date.now()) / 86400000
  if (diff < -5)
    return { label: `${Math.abs(Math.floor(diff))}d crítico`, cls: "text-[#f87171]" }
  if (diff < 0)
    return { label: `${Math.abs(Math.floor(diff))}d atrasado`, cls: "text-[#fbbf24]" }
  if (diff < 1) return { label: "vence hoje", cls: "text-[#d2a948]" }
  return { label: `${Math.ceil(diff)} dia(s) restantes`, cls: "text-[#4ade80]" }
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

/**
 * Casca fina: identidade em (documento, etapa). Abrir, trocar de etapa ou reabrir monta
 * de novo — é o que substitui o bloco "Trigger inicial + reset" que zerava aba e os
 * dois formulários inline antes de cada carga.
 */
export function CentralDaEtapaDrawer(props: CentralDaEtapaDrawerProps) {
  if (!props.isOpen) return null
  return <ConteudoDrawer key={`${props.documentoId ?? 'sem-doc'}-${props.stepId ?? 'sem-step'}`} {...props} />
}

function ConteudoDrawer({
  documentoId,
  stepId,
  isOpen,
  onClose,
  onUpdate,
}: CentralDaEtapaDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabId>("campos")
  const [saving, setSaving] = useState<string | null>(null)

  // -- Estados dos formulários inline (bloquear, transferir)
  const [showBlockForm, setShowBlockForm] = useState(false)
  const [blockReason, setBlockReason] = useState("")
  const [showTransferForm, setShowTransferForm] = useState(false)
  const [transferUserId, setTransferUserId] = useState<number | null>(null)

  // -- Estado pro editor da etapa (registral pra etapa 1, router pras outras)
  const [editorAberto, setEditorAberto] = useState(false)

  // -- Workflow inteiro pela camada oficial (o passo específico sai dele). A chave é o
  // documento, então este drawer COMPARTILHA a requisição com a aba de workflow em vez
  // de refazer a mesma leitura.
  const consulta = useApi<{ workflow?: Workflow | null }>(documentoId ? `/api/documentos/${documentoId}/workflow` : null)
  const workflow = consulta.dados?.workflow ?? null
  const loading = consulta.carregando
  const erro = consulta.erro ? "Erro ao carregar etapa." : null
  const carregar = consulta.recarregar

  // -- Usuários para transferir: leitura independente, com o seu cache.
  const usuariosReq = useApi<{ usuarios?: UserRef[] } | UserRef[]>("/api/usuarios")
  const usuarios = useMemo<UserRef[]>(() => {
    const d = usuariosReq.dados
    if (!d) return []
    return Array.isArray(d) ? d : (d.usuarios ?? [])
  }, [usuariosReq.dados])

  // -- ESC fecha
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose()
    }
    document.addEventListener("keydown", onEsc)
    return () => document.removeEventListener("keydown", onEsc)
  }, [isOpen, onClose])

  // -- PATCH wrapper
  const patchStep = async (body: Record<string, unknown>): Promise<boolean> => {
    if (!stepId) return false
    try {
      const res = await fetch(
        `/api/documentos/${documentoId}/workflow/steps/${stepId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      // O PATCH devolve o workflow atualizado: entra no cache como dado otimista e o
      // servidor confirma na revalidação — a tela responde na hora, sem estado paralelo.
      if (json.workflow) void consulta.recarregar({ workflow: json.workflow })
      onUpdate?.()
      return true
    } catch (e) {
      console.error("[CentralDaEtapaDrawer] patch:", e)
      alert("Erro ao salvar alteração. Veja o console.")
      return false
    }
  }

  // -- Handlers
  const handleConcluir = () => {
    // "Concluir etapa" do header AGORA abre o editor da etapa.
    // O editor é que faz a validação dos campos obrigatórios e dispara
    // o PATCH status="concluida" no final.
    setEditorAberto(true)
  }

  const handleBloquear = async () => {
    if (!blockReason.trim()) {
      alert("Informe um motivo de bloqueio.")
      return
    }
    setSaving("bloqueando")
    const ok = await patchStep({ status: "bloqueada", motivoBloqueio: blockReason.trim() })
    setSaving(null)
    if (ok) {
      setShowBlockForm(false)
      setBlockReason("")
    }
  }

  const handleDesbloquear = async () => {
    setSaving("desbloqueando")
    await patchStep({ status: "em_andamento", motivoBloqueio: null })
    setSaving(null)
  }

  const handleTransferir = async () => {
    if (!transferUserId) {
      alert("Selecione um responsável.")
      return
    }
    setSaving("transferindo")
    const ok = await patchStep({ assigneeId: transferUserId })
    setSaving(null)
    if (ok) {
      setShowTransferForm(false)
      setTransferUserId(null)
    }
  }

  const handleForcar = async () => {
    if (
      !confirm(
        `⚠ FORÇAR conclusão da etapa "${step?.title}"?\n\nEssa ação pula as validações normais e marca a etapa como concluída.\n\nSó use se souber exatamente o que está fazendo.`,
      )
    )
      return
    if (!confirm("Tem certeza? Esta ação é registrada na auditoria e não pode ser desfeita."))
      return
    setSaving("forcando")
    const ok = await patchStep({
      status: "concluida",
      completedById: getUserId(),
      notes: ((step?.notes || "") + "\n[FORÇADO] Etapa concluída via Forçar.").trim(),
    })
    setSaving(null)
    if (ok) onClose()
  }

  const handleReabrir = async () => {
    if (
      !confirm(
        `Reabrir a etapa "${step?.title}"?\n\n` +
          `Isso vai:\n` +
          `• Voltar esta etapa para "Em andamento"\n` +
          `• Bloquear a próxima etapa ativa (se houver)\n` +
          `• Manter etapas já concluídas posteriores intactas\n\n` +
          `Confirmar?`,
      )
    )
      return
    setSaving("reabrindo")
    const ok = await patchStep({ status: "em_andamento" })
    setSaving(null)
    if (ok) onClose()
  }

  // -- Encontra o step na lista
  const step = workflow?.steps.find((s) => s.id === stepId) || null
  const totalSteps = workflow?.steps.length || 0

  // ✅ Se o drawer está aberto, já terminou de carregar, tem um workflow
  // carregado, mas o stepId que deveríamos mostrar NÃO está mais nele —
  // significa que a etapa foi concluída e o avanço de fase arquivou este
  // workflow (criando outro da próxima fase). Em vez de ficar numa tela
  // preta tentando mostrar um step que sumiu, fechamos o drawer.
  // (O onClose leva de volta ao WorkflowTab, que já recarregou a fase nova,
  // e o refresh sobe até o Kanban.)
  useEffect(() => {
    if (!isOpen) return
    if (loading) return            // ainda carregando — não decide nada
    if (!workflow) return          // sem workflow carregado ainda
    if (stepId === null) return    // nada pra mostrar mesmo
    const aindaExiste = workflow.steps.some((s) => s.id === stepId)
    if (!aindaExiste) {
      // o step sumiu (fase avançou) → fecha o drawer
      onClose()
    }
  }, [isOpen, loading, workflow, stepId, onClose])

  // -- Render

  const drawerContent = (
    <>
      {/* Backdrop empilhado (z-index acima do DocumentoOperationalDrawer) */}
      <div
        className="fixed inset-0 bg-black/55 z-[10002] transition-opacity"
        onClick={onClose}
      />

      <div
        className="fixed top-0 right-0 h-screen z-[10003] flex flex-col text-white/70 font-sans shadow-[-30px_0_60px_rgba(0,0,0,0.5)]"
        style={{
          width: "45vw",
          minWidth: "640px",
          maxWidth: "880px",
          background: "#161b22",
        }}
      >
        {loading && !step && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-white/50" />
          </div>
        )}

        {erro && !step && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/60 gap-3 p-6">
            <AlertTriangle className="w-8 h-8 text-[#d2a948]" />
            <p className="text-sm">{erro}</p>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-[#1b2027]/10 hover:bg-[#1b2027]/15 rounded-md"
            >
              Fechar
            </button>
          </div>
        )}

        {step && (
          <>
            {/* ============== HEADER ============== */}
            <div
              className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-white/10"
              style={{ background: "linear-gradient(180deg,#1c222b 0%,#161b22 100%)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] uppercase font-semibold tracking-wider text-white/55">
                  Etapa {step.ordem} de {totalSteps} · Workflow Documental
                </div>
                <button
                  onClick={onClose}
                  className="w-[30px] h-[30px] rounded-md bg-[#1b2027]/5 hover:bg-[#1b2027]/15 flex items-center justify-center text-white"
                  aria-label="Fechar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-[20px] font-bold tracking-tight leading-tight text-white mb-1">
                {step.title}
              </div>
              {step.description && (
                <div className="text-[13px] text-white/65 leading-relaxed mb-3 max-w-[680px]">
                  {step.description}
                </div>
              )}

              {/* Pills: status / responsável / prazo */}
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-wider border ${STATUS_PILL_CLS[step.status]}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {STATUS_LABEL[step.status]}
                </span>

                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1b2027]/5 border border-white/10 text-[11px] text-white/80">
                  <UserIcon className="w-3 h-3" />
                  {step.assignee?.nome || ownerName(step.ownerKey)}
                </span>

                {step.dueAt && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1b2027]/5 border border-white/10 text-[11px] text-white/80 font-mono">
                    <Clock className="w-3 h-3" />
                    {fmtDateTime(step.dueAt)}
                  </span>
                )}
              </div>

              {/* ============== BOTÕES DE AÇÃO ============== */}
              {step.status === "concluida" ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleReabrir}
                    disabled={!!saving}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#1b2027]/10 hover:bg-[#1b2027]/15 disabled:opacity-50 text-white rounded-md transition-colors border border-white/15"
                  >
                    {saving === "reabrindo" ? "Reabrindo…" : "↻ Reabrir etapa"}
                  </button>
                  <button
                    onClick={onClose}
                    disabled={!!saving}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#f87171]/15 hover:bg-[#f87171]/25 disabled:opacity-50 text-[#f87171] border border-[#f87171]/30 rounded-md transition-colors"
                  >
                    Fechar
                  </button>
                  <div className="ml-auto text-[11px] text-[#4ade80]/80">
                    Concluída por <strong>{step.completedBy?.nome || "—"}</strong> em{" "}
                    {fmtDateTime(step.completedAt)}
                  </div>
                </div>
              ) : step.status === "cancelada" ? (
                <div className="text-[11px] text-white/40/80">
                  Etapa cancelada.
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Concluir */}
                  <button
                    onClick={handleConcluir}
                    disabled={!!saving || step.status === "bloqueada"}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#4ade80]/15 hover:bg-[#4ade80]/15 disabled:bg-[#4ade80]/15 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Concluir etapa
                  </button>

                  {/* Bloquear / Desbloquear */}
                  {step.status === "bloqueada" && step.motivoBloqueio ? (
                    <button
                      onClick={handleDesbloquear}
                      disabled={!!saving}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#7dd3fc] hover:bg-[#7dd3fc] disabled:opacity-50 text-white rounded-md transition-colors"
                    >
                      {saving === "desbloqueando" ? "Desbloqueando…" : "Desbloquear"}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setShowBlockForm(!showBlockForm)
                        setShowTransferForm(false)
                      }}
                      disabled={!!saving}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#1b2027]/10 hover:bg-[#1b2027]/15 disabled:opacity-50 text-white rounded-md transition-colors"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Bloquear
                    </button>
                  )}

                  {/* Transferir */}
                  <button
                    onClick={() => {
                      setShowTransferForm(!showTransferForm)
                      setShowBlockForm(false)
                    }}
                    disabled={!!saving}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#1b2027]/10 hover:bg-[#1b2027]/15 disabled:opacity-50 text-white rounded-md transition-colors"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    Transferir
                  </button>

                  {/* Forçar */}
                  <button
                    onClick={handleForcar}
                    disabled={!!saving}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#d2a948]/20 hover:bg-[#d2a948]/30 disabled:opacity-50 text-[#d2a948] border border-[#d2a948]/30 rounded-md transition-colors"
                    title="Pula validações e marca como concluída (admin)"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Forçar
                  </button>

                  {/* Fechar */}
                  <button
                    onClick={onClose}
                    disabled={!!saving}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-white/70 hover:text-white hover:bg-[#1b2027]/5 rounded-md transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              )}

              {/* Form inline: Bloquear */}
              {showBlockForm && (
                <div className="mt-3 p-3 rounded-md border border-[#f87171]/30 bg-[#f87171]/10">
                  <label className="block text-[10px] uppercase font-semibold tracking-wider text-[#f87171]/80 mb-1.5">
                    Motivo do bloqueio
                  </label>
                  <input
                    type="text"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    placeholder="ex: aguardando cliente confirmar dados"
                    className="w-full px-2.5 py-1.5 bg-[#1b2027]/5 border border-white/10 rounded text-[12px] text-white placeholder-white/30 focus:outline-none focus:border-[#f87171]/50"
                    autoFocus
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleBloquear}
                      disabled={!!saving || !blockReason.trim()}
                      className="px-3 py-1.5 text-[11px] font-semibold bg-[#f87171] hover:bg-[#f87171]/15 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded"
                    >
                      {saving === "bloqueando" ? "Bloqueando…" : "Confirmar bloqueio"}
                    </button>
                    <button
                      onClick={() => {
                        setShowBlockForm(false)
                        setBlockReason("")
                      }}
                      className="px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:text-white"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Form inline: Transferir */}
              {showTransferForm && (
                <div className="mt-3 p-3 rounded-md border border-[#7dd3fc]/30 bg-[#7dd3fc]/10">
                  <label className="block text-[10px] uppercase font-semibold tracking-wider text-[#7dd3fc]/80 mb-1.5">
                    Transferir para
                  </label>
                  <select
                    value={transferUserId ?? ""}
                    onChange={(e) =>
                      setTransferUserId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="w-full px-2.5 py-1.5 bg-[#1b2027]/5 border border-white/10 rounded text-[12px] text-white focus:outline-none focus:border-[#7dd3fc]/50"
                  >
                    <option value="" className="bg-[#20262e]">
                      — Selecione um responsável —
                    </option>
                    {usuarios.map((u) => (
                      <option key={u.id} value={u.id} className="bg-[#20262e]">
                        {u.nome}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleTransferir}
                      disabled={!!saving || !transferUserId}
                      className="px-3 py-1.5 text-[11px] font-semibold bg-[#7dd3fc] hover:bg-[#7dd3fc] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded"
                    >
                      {saving === "transferindo" ? "Transferindo…" : "Confirmar"}
                    </button>
                    <button
                      onClick={() => {
                        setShowTransferForm(false)
                        setTransferUserId(null)
                      }}
                      className="px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:text-white"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Banner motivoBloqueio */}
              {step.status === "bloqueada" && step.motivoBloqueio && (
                <div className="mt-3 p-2.5 rounded-md border border-[#f87171]/30 bg-[#f87171]/10 text-[12px] text-[#f87171]">
                  <strong className="font-semibold">Bloqueado:</strong> {step.motivoBloqueio}
                </div>
              )}
            </div>

            {/* ============== TABS ============== */}
            <div
              className="flex-shrink-0 flex overflow-x-auto px-6 border-b border-white/10"
              style={{ background: "#11151b" }}
            >
              {(
                [
                  { id: "campos" as TabId, label: "Campos" },
                  { id: "anexos" as TabId, label: "Anexos", count: 0 },
                  { id: "comentarios" as TabId, label: "Comentários", count: 0 },
                  { id: "dependencias" as TabId, label: "Dependências" },
                  { id: "sla" as TabId, label: "SLA" },
                  { id: "automacao" as TabId, label: "Automação" },
                  { id: "timeline" as TabId, label: "Timeline" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 text-[11.5px] font-semibold border-b-2 transition-colors -mb-px ${
                    activeTab === t.id
                      ? "text-white border-[#7dd3fc]"
                      : "text-white/55 hover:text-white border-transparent"
                  }`}
                >
                  {t.label}
                  {"count" in t && t.count !== undefined && (
                    <span
                      className={`text-[9.5px] px-1.5 rounded-full font-bold ${
                        activeTab === t.id
                          ? "bg-[#7dd3fc]/30 text-[#7dd3fc]"
                          : "bg-[#1b2027]/10 text-white/70"
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* ============== BODY ============== */}
            <div className="flex-1 overflow-y-auto px-6 py-5" style={{ background: "#0f1419" }}>
              {activeTab === "campos" && (
                <TabCampos
                  step={step}
                  onOpenEditor={() => setEditorAberto(true)}
                />
              )}
              {activeTab === "sla" && (
                // A `key` inclui prazo e notas de propósito: o formulário abaixo
                // reinicia exatamente quando o efeito antigo reiniciava — ao trocar de
                // passo OU quando o servidor devolve valores novos para o mesmo passo.
                <TabSla key={`${step.id}-${step.dueAt ?? ''}-${step.notes ?? ''}`} step={step} onPatch={patchStep} saving={saving} />
              )}
              {activeTab === "timeline" && <TabTimeline step={step} />}
              {activeTab === "anexos" && (
                <Placeholder
                  titulo="Anexos"
                  descricao="Arquivos da equipe relacionados a esta etapa (rascunhos, comprovantes, capturas de tela)."
                  pendencia="Requer modelo WorkflowStepAttachment no schema."
                />
              )}
              {activeTab === "comentarios" && (
                <Placeholder
                  titulo="Comentários"
                  descricao="Conversa interna da equipe sobre esta etapa específica. Separado das observações livres."
                  pendencia="Requer modelo WorkflowStepComment no schema."
                />
              )}
              {activeTab === "dependencias" && (
                <Placeholder
                  titulo="Dependências"
                  descricao="Outras etapas (deste ou de outros documentos) que dependem da conclusão desta para serem desbloqueadas."
                  pendencia="Requer modelo WorkflowStepDependency no schema."
                />
              )}
              {activeTab === "automacao" && (
                <Placeholder
                  titulo="Automação"
                  descricao="Regras automáticas que disparam follow-ups, mudam status do documento ou abrem subtarefas quando algo acontece com esta etapa."
                  pendencia="Requer engine de regras + modelo WorkflowStepAutomation."
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* ============== EDITORES DE ETAPA (3º nível, empilhados) ============== */}
      {step && step.stepKey === "localizar_registro" && (
        <EditorRegistralModal
          documentoId={documentoId}
          stepKey={step.stepKey}
          stepId={step.id}
          isOpen={editorAberto}
          onClose={() => setEditorAberto(false)}
          onSaved={() => {
            setEditorAberto(false)
            carregar()
            onUpdate?.()
          }}
        />
      )}

      {step && step.stepKey !== "localizar_registro" && (
        <StepEditorRouter
          stepKey={step.stepKey}
          documentoId={documentoId}
          stepId={step.id}
          stepStatus={step.status}
          isOpen={editorAberto}
          onClose={() => setEditorAberto(false)}
          onSaved={() => {
            setEditorAberto(false)
            carregar()
            onUpdate?.()
          }}
        />
      )}
    </>
  )

  if (typeof window === "undefined") return null
  return createPortal(drawerContent, document.body)
}

// ============================================================
// TAB: CAMPOS — gatilho do editor (que vive no drawer principal)
// ============================================================

function TabCampos({
  step,
  onOpenEditor,
}: {
  step: WorkflowStep
  onOpenEditor: () => void
}) {
  // Cada stepKey tem uma descrição própria do editor que vai abrir
  const editorByStepKey: Record<
    string,
    { titulo: string; descricao: string }
  > = {
    localizar_registro: {
      titulo: "Editor registral completo",
      descricao:
        "Preencha os 23 campos canônicos da certidão (identificação, evento, localidade, referência, rastreamento). Ao salvar, a etapa é concluída automaticamente e as divergências são recalculadas.",
    },
    solicitar_certidao: {
      titulo: "Solicitação ao cartório",
      descricao:
        "Escolha o canal de solicitação (CRC Nacional, E-cartório, E-mail, WhatsApp, presencial). Cada canal exige evidências diferentes.",
    },
    aguardar_retorno: {
      titulo: "Aguardo do retorno do cartório",
      descricao:
        "Registre código de rastreio, follow-ups feitos, e evidências do contato com o cartório.",
    },
    receber_certidao: {
      titulo: "Recebimento da certidão",
      descricao:
        "Anexe o link do PDF da certidão recebida + observações do recebimento.",
    },
    conferir_certidao: {
      titulo: "Conferência operacional",
      descricao:
        "Checklist: legibilidade, integridade, dados mínimos, apostila, tradução. Resultado: aprovar / pedir retificação / reprovar.",
    },
    validar_certidao: {
      titulo: "Validação jurídica",
      descricao:
        "Decisão jurídica final do Marco: validar, marcar como divergente ou inválido. Parecer obrigatório.",
    },
  }

  const config = editorByStepKey[step.stepKey] || {
    titulo: "Campos específicos desta etapa",
    descricao: "Editor a ser definido para esta etapa.",
  }

  // Se etapa concluída, mostra texto explicando precisa reabrir
  const isConcluida = step.status === "concluida"

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center max-w-lg mx-auto">
      <div className="w-14 h-14 rounded-full bg-[#7dd3fc]/10 border border-[#7dd3fc]/30 flex items-center justify-center mb-4">
        <FileText className="w-6 h-6 text-[#7dd3fc]" />
      </div>
      <div className="text-base font-semibold text-white mb-2">{config.titulo}</div>
      <div className="text-sm text-white/65 leading-relaxed mb-5">{config.descricao}</div>

      <button
        onClick={onOpenEditor}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-[12.5px] font-semibold bg-[#7dd3fc] hover:bg-[#252c35] text-white/95 border border-white/10 rounded-md transition-colors"
      >
        {isConcluida ? "Ver campos preenchidos" : "Abrir editor"}
        <ChevronRight className="w-3.5 h-3.5" />
      </button>

      {isConcluida && (
        <div className="mt-3 text-[10px] uppercase tracking-wider text-white/40">
          Etapa concluída — modo leitura. Use ↻ Reabrir etapa para editar.
        </div>
      )}
    </div>
  )
}

// ============================================================
// TAB: SLA — funcional
// ============================================================

function TabSla({
  step,
  onPatch,
  saving,
}: {
  step: WorkflowStep
  onPatch: (body: Record<string, unknown>) => Promise<boolean>
  saving: string | null
}) {
  // O rascunho nasce do passo. Quem garante que ele é REINICIADO quando o passo muda
  // é a `key` no ponto de uso — não um efeito que sobrescreve o que o usuário digitou
  // um render depois de a tela já ter aparecido com o valor velho.
  const [dueAt, setDueAt] = useState(step.dueAt ? step.dueAt.slice(0, 10) : "")
  const [notes, setNotes] = useState(step.notes || "")
  const sla = fmtSla(step.dueAt)

  const salvar = async () => {
    await onPatch({
      dueAt: dueAt || null,
      notes: notes || null,
    })
  }

  const inputCls =
    "w-full px-3 py-2 bg-[#1b2027]/5 border border-white/10 rounded-md text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/30"

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-2.5">
          Prazo da etapa
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] uppercase font-semibold tracking-wider text-white/50 mb-1.5">
              Data prazo
            </label>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-semibold tracking-wider text-white/50 mb-1.5">
              Status do SLA
            </label>
            <div className={`px-3 py-2 bg-[#1b2027]/5 border border-white/10 rounded-md text-sm font-semibold ${sla.cls}`}>
              {sla.label}
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-2.5">
          Observações desta etapa
        </div>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas livres da equipe sobre esta etapa…"
          className={inputCls + " resize-none"}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="SLA configurado" value={`${step.slaDays} dia(s)`} />
        <Field label="Iniciada em" value={fmtDateTime(step.startedAt)} />
        <Field label="Última atualização" value={fmtDateTime(step.updatedAt)} />
      </div>

      <div className="flex justify-end pt-3 border-t border-white/10">
        <button
          onClick={salvar}
          disabled={!!saving}
          className="px-4 py-2 bg-[#7dd3fc] hover:bg-[#7dd3fc] disabled:opacity-50 text-white text-sm font-semibold rounded-md inline-flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          Salvar
        </button>
      </div>
    </div>
  )
}

// ============================================================
// TAB: TIMELINE — eventos disponíveis hoje
// ============================================================

function TabTimeline({ step }: { step: WorkflowStep }) {
  const eventos: Array<{ data: string; label: string; sublabel?: string }> = []

  if (step.createdAt)
    eventos.push({ data: step.createdAt, label: "Etapa criada no workflow" })
  if (step.startedAt && step.startedAt !== step.createdAt)
    eventos.push({ data: step.startedAt, label: "Etapa iniciada" })
  if (step.completedAt)
    eventos.push({
      data: step.completedAt,
      label: "Etapa concluída",
      sublabel: step.completedBy?.nome ? `por ${step.completedBy.nome}` : undefined,
    })
  if (step.updatedAt && step.updatedAt !== step.createdAt)
    eventos.push({ data: step.updatedAt, label: "Última atualização" })

  eventos.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())

  if (eventos.length === 0) {
    return (
      <div className="text-center py-12 text-white/40">
        <p className="text-sm">Nenhum evento registrado ainda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-1">
        Eventos desta etapa
      </div>
      <div className="space-y-2">
        {eventos.map((e, i) => (
          <div
            key={i}
            className="flex items-start gap-3 p-3 rounded-md bg-[#1b2027]/5 border border-white/10"
          >
            <div className="w-2 h-2 rounded-full bg-[#7dd3fc]/15 mt-1.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white">{e.label}</div>
              {e.sublabel && (
                <div className="text-[11px] text-white/55 mt-0.5">{e.sublabel}</div>
              )}
              <div className="text-[11px] text-white/45 font-mono mt-0.5">
                {fmtDateTime(e.data)}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-white/40 italic pt-2">
        Timeline básica baseada nos timestamps do step. Histórico completo de eventos
        (transferências, bloqueios, comentários) requer modelo WorkflowStepHistory no
        schema.
      </div>
    </div>
  )
}

// ============================================================
// HELPERS DE UI
// ============================================================

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">
        {label}
      </div>
      <div className={`text-sm ${value && value !== "—" ? "text-white" : "text-white/30 italic"}`}>
        {value || "—"}
      </div>
    </div>
  )
}

function Placeholder({
  titulo,
  descricao,
  pendencia,
}: {
  titulo: string
  descricao: string
  pendencia: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
      <div className="w-12 h-12 rounded-full bg-[#1b2027]/5 border border-white/10 flex items-center justify-center mb-4">
        <AlertTriangle className="w-5 h-5 text-[#d2a948]/70" />
      </div>
      <div className="text-base font-semibold text-white mb-2">{titulo}</div>
      <div className="text-sm text-white/60 leading-relaxed mb-4">{descricao}</div>
      <div className="text-[11px] text-[#d2a948]/80 bg-[#d2a948]/10 border border-[#d2a948]/20 rounded-md px-3 py-2 leading-relaxed">
        ⚠ {pendencia}
      </div>
    </div>
  )
}