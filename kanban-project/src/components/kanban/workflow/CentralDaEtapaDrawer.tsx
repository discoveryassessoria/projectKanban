// src/components/kanban/workflow/CentralDaEtapaDrawer.tsx
//
// Drawer empilhado sobre o DocumentoOperationalDrawer. Abre quando o usuário
// clica em "Central da Etapa →" na lista de steps do WorkflowTab.
//
// Header com "ETAPA X DE Y", barra de ações (Concluir / Abrir editor / Bloquear /
// Transferir / Forçar / Reabrir / Fechar) e as abas OPERACIONAIS da etapa:
// Anexos, Observações e Timeline.
//
// As abas de CONFIGURAÇÃO (Campos, Dependências, SLA, Automação) saíram da
// interface diária — ver o comentário de `TabId`. Nada do motor foi tocado:
// dependências, SLA e automações continuam valendo, calculados onde sempre
// estiveram; o que deixou de existir é a vitrine técnica delas dentro da etapa.

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
  Clock,
  User as UserIcon,
  FileText,
} from "lucide-react"
import { EditorRegistralModal } from "./EditorRegistralModal"
import { StepEditorRouter } from "./StepEditors"
import {
  resolveWorkflowStepEditor,
  type StepEditorKind,
} from "@/src/lib/process-stage/step-editor-registry"
import type { AcaoEtapa } from "@/src/lib/process-stage/acoes-etapa"
import { mensagemDoErro } from "./AndamentoEtapa"
import {
  AbaAnexosDocumentais,
  AbaObservacoesDocumentais,
} from "../documento/AbasDocumentais"

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
  /** Editor resolvido pelo registry OFICIAL, no servidor. */
  editor?: { kind: StepEditorKind; especifico: boolean; stepKeyCanonico: string } | null
  /** Ações que o SERVIDOR autoriza para o usuário desta sessão. */
  acoesPermitidas?: AcaoEtapa[] | null
}

interface Workflow {
  id: number
  status: string
  progress: number
  steps: WorkflowStep[]
}

// ABAS DA ETAPA — só o que o operador USA no dia a dia.
//
// "Campos", "Dependências", "SLA" e "Automação" saíram: são CONFIGURAÇÃO do
// workflow, não trabalho de etapa. As duas primeiras eram placeholders; a de SLA
// duplicava um prazo que o motor já deriva; e o editor — a única coisa útil que a
// aba "Campos" fazia — continua nos botões oficiais "Abrir editor" e "Ver campos
// preenchidos" da barra de ações, que nunca dependeram dela.
//
// O que ficou é o registro operacional: os arquivos, as observações e a linha do
// tempo da etapa.
type TabId = "anexos" | "comentarios" | "timeline"

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

/**
 * Editor da etapa. Preferimos SEMPRE o que o servidor resolveu (fonte única); a
 * resolução local existe só para respostas antigas em cache e usa o MESMO registry.
 */
const kindDoEditor = (step: WorkflowStep): StepEditorKind =>
  step.editor?.kind ?? resolveWorkflowStepEditor({ stepKey: step.stepKey }).kind

/** A ação está autorizada pelo servidor para esta etapa e este usuário? */
const permite = (step: WorkflowStep | null, acao: AcaoEtapa): boolean =>
  !!step?.acoesPermitidas?.includes(acao)


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
  const [activeTab, setActiveTab] = useState<TabId>("anexos")
  const [saving, setSaving] = useState<string | null>(null)

  // -- Estados dos formulários inline (bloquear, transferir)
  const [showBlockForm, setShowBlockForm] = useState(false)
  const [blockReason, setBlockReason] = useState("")
  const [showTransferForm, setShowTransferForm] = useState(false)
  const [transferUserId, setTransferUserId] = useState<number | null>(null)
  // "Forçar" é ato administrativo: exige MOTIVO e JUSTIFICATIVA, e os dois vão
  // para a auditoria junto com quem executou.
  const [showForceForm, setShowForceForm] = useState(false)
  const [forceMotivo, setForceMotivo] = useState("")
  const [forceJustificativa, setForceJustificativa] = useState("")
  const [erroAcao, setErroAcao] = useState<string | null>(null)

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

  // -- PATCH wrapper. O erro do domínio chega CODIFICADO e é traduzido para uma
  //    frase operacional — nada de "veja o console" nem de nome de model na tela.
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
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErroAcao(mensagemDoErro(json?.error))
        return false
      }
      setErroAcao(null)
      // O PATCH devolve o workflow atualizado: entra no cache como dado otimista e o
      // servidor confirma na revalidação — a tela responde na hora, sem estado paralelo.
      if (json.workflow) void consulta.recarregar({ workflow: json.workflow })
      onUpdate?.()
      return true
    } catch (e) {
      console.error("[CentralDaEtapaDrawer] patch:", e)
      setErroAcao(mensagemDoErro("INTERNAL_ERROR"))
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

  /**
   * ALTERAR O EXECUTOR DESTA ETAPA — não transferir a tarefa.
   *
   * O PATCH grava `assigneeId` em `PhaseWorkflowStepInstance`: quem executa
   * AQUELA etapa. O responsável pelo TRABALHO é o da Tarefa, e ele se move pela
   * porta de tarefa (`/api/tarefas/{id}/atribuir`), com auditoria e aviso.
   *
   * O botão chamava-se "Transferir" e não transferia coisa nenhuma: a tarefa
   * continuava com a mesma pessoa, e quem clicava saía convencido de que tinha
   * repassado o trabalho. Um nome errado aqui é pior do que um botão a menos.
   */
  const handleAlterarExecutor = async () => {
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

  // FORÇAR — nunca é o caminho normal de execução. Só existe como função
  // administrativa auditada: exige permissão própria (o servidor confere),
  // motivo e justificativa. Nunca é oferecido como saída para "falta editor".
  const handleForcar = async () => {
    if (!forceMotivo.trim() || !forceJustificativa.trim()) {
      setErroAcao("Informe o motivo e a justificativa para forçar a conclusão.")
      return
    }
    if (!confirm("Forçar a conclusão desta etapa? A ação fica registrada na auditoria."))
      return
    setSaving("forcando")
    const ok = await patchStep({
      status: "concluida",
      forcar: true,
      motivo: forceMotivo.trim(),
      justificativa: forceJustificativa.trim(),
    })
    setSaving(null)
    if (ok) {
      setShowForceForm(false)
      setForceMotivo("")
      setForceJustificativa("")
      onClose()
    }
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
                    onClick={() => setEditorAberto(true)}
                    disabled={!!saving}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#1b2027]/10 hover:bg-[#1b2027]/15 disabled:opacity-50 text-white rounded-md transition-colors border border-white/15"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Ver campos preenchidos
                  </button>
                  {permite(step, "reabrir") && (
                    <button
                      onClick={handleReabrir}
                      disabled={!!saving}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#1b2027]/10 hover:bg-[#1b2027]/15 disabled:opacity-50 text-white rounded-md transition-colors border border-white/15"
                    >
                      {saving === "reabrindo" ? "Reabrindo…" : "↻ Reabrir etapa"}
                    </button>
                  )}
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
                  {/* Concluir — abre o editor da etapa, que valida e conclui */}
                  {permite(step, "concluir") && (
                    <button
                      onClick={handleConcluir}
                      disabled={!!saving}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#4ade80]/15 hover:bg-[#4ade80]/15 disabled:bg-[#4ade80]/15 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Concluir etapa
                    </button>
                  )}

                  {/* Abrir editor — sempre disponível: toda etapa publicada tem interface */}
                  <button
                    onClick={() => setEditorAberto(true)}
                    disabled={!!saving}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#1b2027]/10 hover:bg-[#1b2027]/15 disabled:opacity-50 text-white rounded-md transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Abrir editor
                  </button>

                  {/* Bloquear / Desbloquear */}
                  {permite(step, "desbloquear") ? (
                    <button
                      onClick={handleDesbloquear}
                      disabled={!!saving}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#7dd3fc] hover:bg-[#7dd3fc] disabled:opacity-50 text-white rounded-md transition-colors"
                    >
                      {saving === "desbloqueando" ? "Desbloqueando…" : "Desbloquear"}
                    </button>
                  ) : permite(step, "bloquear") ? (
                    <button
                      onClick={() => {
                        setShowBlockForm(!showBlockForm)
                        setShowTransferForm(false)
                        setShowForceForm(false)
                      }}
                      disabled={!!saving}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#1b2027]/10 hover:bg-[#1b2027]/15 disabled:opacity-50 text-white rounded-md transition-colors"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Bloquear
                    </button>
                  ) : null}

                  {/* Transferir */}
                  {permite(step, "transferir") && (
                    <button
                      onClick={() => {
                        setShowTransferForm(!showTransferForm)
                        setShowBlockForm(false)
                        setShowForceForm(false)
                      }}
                      disabled={!!saving}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#1b2027]/10 hover:bg-[#1b2027]/15 disabled:opacity-50 text-white rounded-md transition-colors"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                      Alterar executor
                    </button>
                  )}

                  {/* Forçar — função ADMINISTRATIVA auditada, só para quem tem a permissão.
                      Nunca é a saída para "falta editor": o editor existe sempre. */}
                  {permite(step, "forcar") && (
                    <button
                      onClick={() => {
                        setShowForceForm(!showForceForm)
                        setShowBlockForm(false)
                        setShowTransferForm(false)
                      }}
                      disabled={!!saving}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-[#d2a948]/20 hover:bg-[#d2a948]/30 disabled:opacity-50 text-[#d2a948] border border-[#d2a948]/30 rounded-md transition-colors"
                      title="Conclusão administrativa auditada — exige motivo e justificativa"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      Forçar
                    </button>
                  )}

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

              {/* Form inline: executor DA ETAPA — o dono da tarefa não muda aqui */}
              {showTransferForm && (
                <div className="mt-3 p-3 rounded-md border border-[#7dd3fc]/30 bg-[#7dd3fc]/10">
                  <label className="block text-[10px] uppercase font-semibold tracking-wider text-[#7dd3fc]/80 mb-1.5">
                    Quem executa esta etapa
                  </label>
                  <select
                    value={transferUserId ?? ""}
                    onChange={(e) =>
                      setTransferUserId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="w-full px-2.5 py-1.5 bg-[#1b2027]/5 border border-white/10 rounded text-[12px] text-white focus:outline-none focus:border-[#7dd3fc]/50"
                  >
                    <option value="" className="bg-[#20262e]">
                      — Selecione quem executa —
                    </option>
                    {usuarios.map((u) => (
                      <option key={u.id} value={u.id} className="bg-[#20262e]">
                        {u.nome}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleAlterarExecutor}
                      disabled={!!saving || !transferUserId}
                      className="px-3 py-1.5 text-[11px] font-semibold bg-[#7dd3fc] hover:bg-[#7dd3fc] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded"
                    >
                      {saving === "transferindo" ? "Alterando…" : "Confirmar"}
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

              {/* Form inline: Forçar (motivo + justificativa obrigatórios) */}
              {showForceForm && (
                <div className="mt-3 p-3 rounded-md border border-[#d2a948]/30 bg-[#d2a948]/10">
                  <div className="text-[11px] text-[#d2a948] mb-2 leading-relaxed">
                    Conclusão <strong>administrativa</strong>: marca a etapa como concluída sem a
                    execução normal. Fica registrada na auditoria com o seu usuário.
                  </div>
                  <label className="block text-[10px] uppercase font-semibold tracking-wider text-[#d2a948]/80 mb-1.5">
                    Motivo
                  </label>
                  <input
                    type="text"
                    value={forceMotivo}
                    onChange={(e) => setForceMotivo(e.target.value)}
                    placeholder="ex: etapa executada fora do sistema"
                    className="w-full px-2.5 py-1.5 bg-[#1b2027]/5 border border-white/10 rounded text-[12px] text-white placeholder-white/30 focus:outline-none focus:border-[#d2a948]/50"
                    autoFocus
                  />
                  <label className="block text-[10px] uppercase font-semibold tracking-wider text-[#d2a948]/80 mb-1.5 mt-2">
                    Justificativa
                  </label>
                  <textarea
                    rows={2}
                    value={forceJustificativa}
                    onChange={(e) => setForceJustificativa(e.target.value)}
                    placeholder="Explique por que a etapa está sendo concluída assim."
                    className="w-full px-2.5 py-1.5 bg-[#1b2027]/5 border border-white/10 rounded text-[12px] text-white placeholder-white/30 focus:outline-none focus:border-[#d2a948]/50 resize-none"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleForcar}
                      disabled={!!saving || !forceMotivo.trim() || !forceJustificativa.trim()}
                      className="px-3 py-1.5 text-[11px] font-semibold bg-[#d2a948] hover:bg-[#d2a948]/80 disabled:opacity-50 disabled:cursor-not-allowed text-[#161b22] rounded"
                    >
                      {saving === "forcando" ? "Forçando…" : "Confirmar conclusão forçada"}
                    </button>
                    <button
                      onClick={() => {
                        setShowForceForm(false)
                        setForceMotivo("")
                        setForceJustificativa("")
                      }}
                      className="px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:text-white"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Erro estruturado da última ação */}
              {erroAcao && (
                <div className="mt-3 p-2.5 rounded-md border border-[#f87171]/30 bg-[#f87171]/10 text-[12px] text-[#f87171]">
                  {erroAcao}
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
              className="flex-shrink-0 flex flex-wrap px-6 border-b border-white/10"
              style={{ background: "#11151b" }}
            >
              {(
                [
                  { id: "anexos" as TabId, label: "Anexos" },
                  { id: "comentarios" as TabId, label: "Observações" },
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
                  {"count" in t && typeof t.count === "number" && (
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
              {activeTab === "timeline" && <TabTimeline step={step} />}
              {activeTab === "anexos" && (
                // Escopo por ETAPA: mostra o requerimento anexado ao solicitar a
                // certidão e o que mais foi anexado aqui. Mesmo registro que a aba
                // do documento consolida — um arquivo, um binário, duas visões.
                <AbaAnexosDocumentais
                  documentoId={documentoId}
                  stepInstanceId={step.id}
                  podeAnexar={permite(step, "anexar")}
                  tipoPadrao="COMPROVANTE_CONTATO"
                />
              )}
              {activeTab === "comentarios" && (
                <AbaObservacoesDocumentais
                  documentoId={documentoId}
                  stepInstanceId={step.id}
                  podeRegistrar={permite(step, "registrar_observacao")}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* ============== EDITORES DE ETAPA (3º nível, empilhados) ============== */}
      {step && kindDoEditor(step) === "registral" && (
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

      {step && kindDoEditor(step) !== "registral" && (
        <StepEditorRouter
          stepKey={step.stepKey}
          editorKind={kindDoEditor(step)}
          stepTitle={step.title}
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
    </div>
  )
}

