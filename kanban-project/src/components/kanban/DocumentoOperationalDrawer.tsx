// src/components/kanban/DocumentoOperationalDrawer.tsx

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, AlertTriangle } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { WorkflowTab } from "./workflow/WorkflowTab"
import { InitOperationModal } from "./InitOperationModal"
import { WorkflowControls } from "./WorkflowControls"
import { TabOperationCockpit } from "./TabOperationCockpit"

// ============================================================
// LABELS (mantidos no componente porque o GET retorna o documento cru)
// ============================================================
const TIPO_LABELS: Record<string, string> = {
  CERTIDAO_NASCIMENTO: "Certidão de Nascimento",
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: "Certidão de Nascimento (IT)",
  CERTIDAO_CASAMENTO: "Certidão de Casamento",
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: "Certidão de Casamento (IT)",
  CERTIDAO_OBITO: "Certidão de Óbito",
  CERTIDAO_OBITO_INTEIRO_TEOR: "Certidão de Óbito (IT)",
  CERTIDAO_BATISMO: "Certidão de Batismo",
  CNN: "CNN",
  CARTA_NATURALIZACAO: "Carta de Naturalização",
  RG: "RG",
  CPF: "CPF",
  CNH: "CNH",
  PASSAPORTE_BRASILEIRO: "Passaporte BR",
  TITULO_ELEITOR: "Título de Eleitor",
  RESERVISTA: "Reservista",
  PASSAPORTE_ESTRANGEIRO: "Passaporte Estrangeiro",
  CERTIDAO_CIDADANIA_ESTRANGEIRA: "Certidão de Cidadania",
  COMPROVANTE_RESIDENCIA: "Comprovante de Residência",
  TRADUCAO_JURAMENTADA: "Tradução Juramentada",
  APOSTILA_HAIA: "Apostila de Haia",
  FOTO_3X4: "Foto 3x4",
  PROCURACAO: "Procuração",
  ARVORE_GENEALOGICA_DOC: "Árvore Genealógica",
  OUTRO: "Outro",
}

const STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente",
  SOLICITADO: "Solicitado",
  EM_BUSCA: "Em busca",
  SOLICITAR: "Solicitar",
  RECEBIDO: "Recebido",
  EM_ANALISE: "Em análise",
  RETIFICANDO: "Retificando",
  EM_TRADUCAO: "Em tradução",
  TRADUZIDO: "Traduzido",
  EM_APOSTILAMENTO: "Em apostilamento",
  APOSTILADO: "Apostilado",
  ENTREGUE: "Entregue",
  INVALIDO: "Inválido",
  NAO_ENCONTRADO: "Não encontrado",
}

const STATUS_PILL_CLS: Record<string, string> = {
  PENDENTE: "bg-slate-400/20 text-slate-300",
  SOLICITADO: "bg-violet-500/20 text-violet-300",
  EM_BUSCA: "bg-amber-500/20 text-amber-300",
  SOLICITAR: "bg-violet-500/20 text-violet-300",
  RECEBIDO: "bg-emerald-500/20 text-emerald-300",
  EM_ANALISE: "bg-blue-500/20 text-blue-300",
  RETIFICANDO: "bg-orange-500/20 text-orange-300",
  EM_TRADUCAO: "bg-cyan-500/20 text-cyan-300",
  TRADUZIDO: "bg-emerald-500/20 text-emerald-300",
  EM_APOSTILAMENTO: "bg-cyan-500/20 text-cyan-300",
  APOSTILADO: "bg-emerald-500/20 text-emerald-300",
  ENTREGUE: "bg-emerald-500/20 text-emerald-300",
  INVALIDO: "bg-red-500/20 text-red-300",
  NAO_ENCONTRADO: "bg-slate-500/20 text-slate-400",
}

// ============================================================
// TIPOS (forma crua do documento que vem do GET)
// ============================================================

interface Pessoa {
  id: number
  nome: string
  sobrenome: string | null
  numeroLinhagem?: number | null
  requerente?: string | null
}

interface Documento {
  id: number
  tipo: string
  status: string
  descricao: string | null

  cartorio: string | null
  livro: string | null
  folha: string | null
  termo: string | null
  numero_registro: string | null
  data_registro: string | null
  data_evento: string | null
  cidade_registro: string | null
  estado_registro: string | null
  pais_registro: string | null

  numero: string | null
  orgao_emissor: string | null
  data_emissao: string | null
  data_validade: string | null

  arquivo_url: string | null
  arquivo_nome: string | null

  traduzido: boolean
  tradutor: string | null
  data_traducao: string | null

  apostilado: boolean
  data_apostila: string | null

  observacoes: string | null

  responsavelId: number | null
  responsavel?: { id: number; nome: string; email: string | null } | null
  dataInicioOperacao: string | null
  dataPrazoOperacao: string | null
  ultimaMovimentacao: string | null
  motivoBloqueio: string | null

  createdAt: string
  updatedAt: string

  pessoa: Pessoa | null
}

interface Usuario {
  id: number
  nome: string
  email?: string | null
}

interface DocumentoOperationalDrawerProps {
  documentoId: number | null
  isOpen: boolean
  onClose: () => void
  onSave?: () => void
  /** Se passado, mostra um botão "← {backLabel}" no topo do header e chama onBack ao clicar */
  onBack?: () => void
  backLabel?: string
}

type TabId =
  | "operation"
  | "workflow"
  | "registry"
  | "divergences"
  | "history"
  | "attach"
  | "observ"
  | "protocol"
  | "returns"
  | "attempts"
  | "audit"

// Projeção operacional oficial do documento (espelho do contrato do backend
// resolveDocumentOperationalProjection). Fonte ÚNICA de estado/próxima ação do Drawer.
interface DocumentOperationalProjection {
  processId: string
  phaseId: string
  documentId: string
  state: "OPERATIONAL" | "NOT_MATERIALIZED"
  workflowInstanceId: string | null
  stepInstanceId: string | null
  currentStep: { key: string; label: string; status: string } | null
  nextAction: { key: string; label: string } | null
  permissions: {
    canStart: boolean
    canOperate: boolean
    canPause: boolean
    canCancel: boolean
    canInvalidate: boolean
  }
}

// ============================================================
// HELPERS
// ============================================================

const nomeCompleto = (p: Pessoa | null): string =>
  p ? `${p.nome}${p.sobrenome ? " " + p.sobrenome : ""}` : "—"

const fmtDate = (s: string | null): string => {
  if (!s) return "—"
  try { return new Date(s).toLocaleDateString("pt-BR") } catch { return "—" }
}

const fmtDateTime = (s: string | null): string => {
  if (!s) return "—"
  try {
    const d = new Date(s)
    return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
  } catch { return "—" }
}

const diffDays = (a: Date, b: Date) =>
  Math.floor((a.getTime() - b.getTime()) / 86400000)

const computeSla = (prazo: string | null): { text: string; cls: string } => {
  if (!prazo) return { text: "—", cls: "" }
  const d = new Date(prazo), now = new Date()
  const dias = diffDays(d, now)
  if (dias < -5) return { text: `${Math.abs(dias)}d crítico`, cls: "text-red-300" }
  if (dias < 0) return { text: `${Math.abs(dias)}d atrasado`, cls: "text-red-300" }
  if (dias < 1) return { text: "vence hoje", cls: "text-amber-300" }
  return { text: `${dias} dia(s) restantes`, cls: "text-emerald-300" }
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function DocumentoOperationalDrawer({
  documentoId,
  isOpen,
  onClose,
  onSave,
  onBack,
  backLabel,
}: DocumentoOperationalDrawerProps) {
  const { pode } = usePermissoes()
  const [doc, setDoc] = useState<Documento | null>(null)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>("operation")
  const [salvando, setSalvando] = useState(false)
  const [initModalOpen, setInitModalOpen] = useState(false)
  const [workflow, setWorkflow] = useState<any | null>(null)
  const [projection, setProjection] = useState<DocumentOperationalProjection | null>(null)

  // MÁQUINA DE ESTADOS EXPLÍCITA do Drawer — nunca inferir "sem operação" só porque a
  // projeção ainda não chegou. LOADING = resolvendo; OPERATIONAL = operação materializada;
  // NOT_MATERIALIZED = backend CONFIRMOU que não há operação; ERROR = falha.
  const [opState, setOpState] = useState<"LOADING" | "OPERATIONAL" | "NOT_MATERIALIZED" | "ERROR">("LOADING")

  // Guard de corrida por seq + AbortController: ao trocar rápido de documento ou fechar,
  // a requisição anterior é CANCELADA e respostas antigas são DESCARTADAS (nunca aplicadas
  // sobre uma seleção mais recente nem sobre outro documento).
  const reqSeq = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const carregar = useCallback(async () => {
    if (!documentoId) {
      setErro("Operação sem documento associado.")
      setOpState("ERROR")
      return
    }
    // Cancela a requisição anterior (troca rápida / reabertura).
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++reqSeq.current
    const meuDoc = documentoId
    const vigente = () => seq === reqSeq.current && meuDoc === documentoId && !controller.signal.aborted
    setOpState("LOADING")
    setErro(null)
    try {
      // FONTE ÚNICA: uma única projeção agregada (cabeçalho + estado operacional).
      const res = await fetch(`/api/documentos/${documentoId}/operational-projection`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        signal: controller.signal,
      })
      if (!vigente()) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (!vigente()) return
      const proj: DocumentOperationalProjection | null = json.projection ?? null
      setDoc(json.document ?? null)
      setWorkflow(json.workflow ?? null)
      setProjection(proj)
      setOpState(proj?.state === "OPERATIONAL" ? "OPERATIONAL" : "NOT_MATERIALIZED")
    } catch (e) {
      if (controller.signal.aborted) return // resposta cancelada — ignora silenciosamente
      console.warn("[DocumentoOperationalDrawer] falha:", e)
      if (vigente()) {
        setErro("Erro ao carregar operação.")
        setOpState("ERROR")
      }
    }
  }, [documentoId])

  // Lista de usuários (uma vez, ao abrir)
  useEffect(() => {
    if (!isOpen) return
    fetch("/api/usuarios", {
      headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
    })
      .then((r) => r.json())
      .then((d) => setUsuarios(d.usuarios || d || []))
      .catch(console.error)
  }, [isOpen])

  useEffect(() => {
    if (isOpen && documentoId) {
      setActiveTab("operation")
      // Reset explícito ao (re)abrir: entra em LOADING, nunca herda projeção antiga.
      setProjection(null)
      setWorkflow(null)
      setOpState("LOADING")
      carregar()
    }
    // Cancela a requisição em voo ao fechar/trocar/desmontar — resposta atrasada
    // NUNCA é aplicada depois de fechar nem sobre outra seleção.
    return () => { abortRef.current?.abort() }
  }, [isOpen, documentoId, carregar])

  // Trava scroll do body
  useEffect(() => {
    if (isOpen) {
      const orig = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return () => { document.body.style.overflow = orig }
    }
  }, [isOpen])

  // ESC fecha
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose()
    }
    document.addEventListener("keydown", onEsc)
    return () => document.removeEventListener("keydown", onEsc)
  }, [isOpen, onClose])

  // Atribui/troca o responsável do passo (mesmo endpoint do "Transferir" da Central
  // da Etapa). Reusa o contrato existente; recarrega o drawer ao concluir.
  const atribuirResponsavel = async (stepId: number, responsavelId: number | null) => {
    if (!documentoId) return
    try {
      await fetch(`/api/documentos/${documentoId}/workflow/steps/${stepId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({ assigneeId: responsavelId }),
      })
      await carregar()
      onSave?.()
    } catch (e) {
      console.error("[DocumentoOperationalDrawer] atribuir:", e)
    }
  }

  // Salva via PUT (usa o endpoint que já existe)
  const putDoc = async (patch: Record<string, any>) => {
    if (!documentoId) return
    setSalvando(true)
    try {
      await fetch(`/api/documentos/${documentoId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify(patch),
      })
      await carregar()
      onSave?.()
    } catch (e) {
      console.error(e)
    } finally {
      setSalvando(false)
    }
  }

  if (!isOpen) return null

  const sla = doc ? computeSla(doc.dataPrazoOperacao) : { text: "—", cls: "" }
  const statusCls = doc ? (STATUS_PILL_CLS[doc.status] || "bg-slate-500/20 text-slate-300") : ""
  const tipoLabel = doc ? (TIPO_LABELS[doc.tipo] || doc.tipo) : ""
  const statusLabel = doc ? (STATUS_LABELS[doc.status] || doc.status) : ""

  const tabsAll: Array<{ id: TabId; label: string; count?: number; danger?: boolean }> = [
    { id: "operation", label: "Operação" },
    { id: "workflow", label: "Workflow" },
    { id: "registry", label: "Dados Registrais" },
    { id: "divergences", label: "Divergências" },
    { id: "history", label: "Histórico" },
    { id: "attach", label: "Anexos" },
    { id: "observ", label: "Observações" },
    { id: "protocol", label: "Protocolo" },
    { id: "returns", label: "Devoluções" },
    { id: "attempts", label: "Tentativas" },
    { id: "audit", label: "Auditoria" },
  ]
  // A Central não depende de lista fixa por fase: recebe a fase (workflow.faseCode)
  // e ajusta as abas. Na Genealogia, abas de outra natureza (Divergências, Anexos,
  // Tentativas, Auditoria) ficam fora — preservando Operação, Workflow, Dados
  // Registrais, Histórico, Observações, Protocolo e Devoluções.
  const ehGenealogia = String((workflow as { faseCode?: string } | null)?.faseCode ?? "").toUpperCase() === "GENEALOGIA"
  const OCULTAS_GENEALOGIA = new Set<TabId>(["divergences", "attach", "attempts", "audit"])
  const tabs = ehGenealogia ? tabsAll.filter((t) => !OCULTAS_GENEALOGIA.has(t.id)) : tabsAll

  const drawerContent = (
    <>
      <div
        className="fixed inset-0 bg-black/45 z-[10000] transition-opacity duration-200"
        onClick={onClose}
        />

      <div
        className="fixed top-0 right-0 h-screen z-[10001] flex flex-col text-slate-200 font-sans shadow-[-30px_0_60px_rgba(0,0,0,0.4)] transition-transform duration-300"
        style={{
          width: "45vw", minWidth: "680px", maxWidth: "920px",
          background: "#0f1419", transform: "translateX(0)",
        }}
      >
        {/* LOADING — enquanto a projeção operacional oficial não resolve. Só skeleton:
            nunca "Sem operação ativa", nunca botão "Iniciar operação", nenhuma ação. */}
        {opState === "LOADING" && (
          <div className="flex-1 flex flex-col gap-4 p-6">
            <div className="flex items-center gap-2 text-white/50">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[12px]">Carregando operação…</span>
            </div>
            <div className="h-16 rounded-lg bg-white/5 animate-pulse" />
            <div className="h-24 rounded-lg bg-white/5 animate-pulse" />
            <div className="h-40 rounded-lg bg-white/5 animate-pulse" />
          </div>
        )}

        {/* ERROR — estado terminal fechável (falha ou documentoId inválido). */}
        {opState === "ERROR" && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/60 gap-3 p-6">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
            <p className="text-sm">{erro || "Não foi possível abrir a operação."}</p>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/15 rounded-md"
            >
              Fechar
            </button>
          </div>
        )}

        {(opState === "OPERATIONAL" || opState === "NOT_MATERIALIZED") && doc && (
          <>
            {/* HEADER */}
            <div
              className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-white/10"
              style={{ background: "linear-gradient(180deg,#181d24 0%,#11151b 100%)" }}
            >
              <div className="flex items-center justify-between mb-3.5">
                {onBack ? (
                  <button
                    onClick={onBack}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/70 hover:text-white transition-colors -ml-1 px-1 py-0.5 rounded hover:bg-white/5"
                  >
                    <span className="text-[14px] leading-none">←</span>
                    {backLabel || nomeCompleto(doc.pessoa)}
                  </button>
                ) : (
                  <div className="text-[10px] uppercase font-semibold tracking-wider text-white/50">
                    Central Operacional · {nomeCompleto(doc.pessoa)}
                  </div>
                )}
                <button
                  onClick={onClose}
                  className="w-[30px] h-[30px] rounded-md bg-white/5 hover:bg-white/15 flex items-center justify-center text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-[18px] font-bold tracking-tight leading-tight text-white mb-0.5">
                {tipoLabel}
              </div>
              <div className="text-[13px] text-white/65 mb-3.5">
                {nomeCompleto(doc.pessoa)}
              </div>

              <div className="grid grid-cols-4 gap-3.5 mb-3">
                <div className="flex flex-col gap-0.5">
                  <div className="text-[9.5px] uppercase font-semibold tracking-wider text-white/45">
                    Status
                  </div>
                  <div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-wider ${statusCls}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {statusLabel}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="text-[9.5px] uppercase font-semibold tracking-wider text-white/45">
                    Responsável
                  </div>
                  <div className="text-[13px] font-semibold text-white truncate">
                    {doc.responsavel?.nome || "Não atribuído"}
                  </div>
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="text-[9.5px] uppercase font-semibold tracking-wider text-white/45">
                    SLA
                  </div>
                  <div className={`text-[13px] font-semibold ${sla.cls || "text-white"}`}>
                    {sla.text}
                  </div>
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="text-[9.5px] uppercase font-semibold tracking-wider text-white/45">
                    Última movimentação
                  </div>
                  <div className="text-[11.5px] font-bold text-white font-mono">
                    {fmtDateTime(doc.ultimaMovimentacao || doc.updatedAt)}
                  </div>
                </div>
              </div>

              {doc.motivoBloqueio && (
                <div className="mt-3 p-2.5 rounded-md border border-amber-400/30 bg-amber-400/10 text-[11.5px] text-amber-200">
                  <strong className="font-semibold">Bloqueado:</strong> {doc.motivoBloqueio}
                </div>
              )}
            </div>

            {/* CONTROLES DO WORKFLOW (barra de progresso + botões pausar/cancelar/invalidar) */}
            <WorkflowControls
              documentoId={documentoId}
              workflow={workflow}
              onChange={() => { carregar(); onSave?.() }}
            />

            {/* TABS */}
            <div
              className="flex-shrink-0 flex overflow-x-auto px-6 border-b border-white/10"
              style={{ background: "#11151b" }}
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 text-[11.5px] font-semibold border-b-2 transition-colors -mb-px ${
                    activeTab === t.id
                      ? "text-white border-blue-500"
                      : "text-white/55 hover:text-white border-transparent"
                  }`}
                >
                  {t.label}
                  {t.count !== undefined && (
                    <span className={`text-[9.5px] px-1.5 rounded-full font-bold ${
                      activeTab === t.id ? "bg-blue-500/30 text-blue-200" : "bg-white/10 text-white/70"
                    }`}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* BODY */}
            <div className="flex-1 overflow-y-auto px-6 py-5" style={{ background: "#0f1419" }}>
              {activeTab === "operation" && (
                <TabOperationCockpit
                  doc={doc as any}
                  workflow={workflow}
                  documentoId={documentoId}
                  usuarios={usuarios}
                  onAtribuir={atribuirResponsavel}
                  onAbrirIniciar={() => setInitModalOpen(true)}
                  onTrocarAba={(tab) => setActiveTab(tab as TabId)}
                  onAbrirCentralDaEtapa={() => {
                    setActiveTab("workflow")
                  }}
                  // Estado CONFIRMADO pela projeção (nunca durante LOADING). O empty-state
                  // só aparece quando o backend confirmou NOT_MATERIALIZED; o botão de início
                  // só quando canStart e usa a ação inicial do Workflow Interno.
                  notMaterialized={opState === "NOT_MATERIALIZED"}
                  canStart={projection?.permissions.canStart ?? false}
                  nextActionLabel={projection?.nextAction?.label ?? null}
                />
              )}
              {activeTab === "registry" && <TabRegistry doc={doc} tipoLabel={tipoLabel} />}
              {activeTab === "history" && <TabHistory doc={doc} />}
              {activeTab === "workflow" && (
                <WorkflowTab
                  documentoId={doc.id}
                  onChange={() => {
                    onSave?.()
                    carregar()
                  }}
                />
              )}
              {activeTab === "divergences" && (
                <Placeholder
                  titulo="Divergências"
                  descricao="Inconsistências detectadas entre os dados do documento e a árvore (nome divergente, data conflitante, vínculo inválido)."
                  pendencia="Requer modelo Divergencia no schema."
                />
              )}
              {activeTab === "attach" && (
                <Placeholder
                  titulo="Anexos"
                  descricao="Arquivos anexados ao longo da operação (rascunho, comprovante de pedido, certidão recebida, tradução, apostila)."
                  pendencia="O Documento já tem arquivo_url / arquivo_traducao_url / arquivo_apostila_url, mas o histórico de anexos por etapa requer modelo WorkflowStepAttachment."
                />
              )}
              {activeTab === "observ" && (
                <Placeholder
                  titulo="Observações"
                  descricao="Comentários da equipe sobre cada etapa da operação."
                  pendencia="Requer modelo WorkflowStepComment no schema."
                />
              )}
              {activeTab === "protocol" && (
                <Placeholder
                  titulo="Protocolo"
                  descricao="Protocolos consulares vinculados a este documento."
                  pendencia="O modelo Protocolo existe, mas está vinculado a Processo. Para vincular por documento, seria preciso uma tabela de junção."
                />
              )}
              {activeTab === "returns" && (
                <Placeholder
                  titulo="Devoluções"
                  descricao="Devoluções do cartório com motivo, gravidade e número de tentativas."
                  pendencia="Requer modelo RegistryReturn no schema."
                />
              )}
              {activeTab === "attempts" && (
                <Placeholder
                  titulo="Tentativas"
                  descricao="Tentativas de localização/emissão do documento em diferentes cartórios e canais."
                  pendencia="Requer modelo DocumentAttempt no schema."
                />
              )}
              {activeTab === "audit" && (
                <Placeholder
                  titulo="Auditoria"
                  descricao="Log completo de quem fez o quê e quando neste documento."
                  pendencia="O modelo LogAuditoria é genérico — para auditoria específica por documento, será necessário filtrar por entidade='Documento' e entidadeId."
                />
              )}
            </div>
            <InitOperationModal
              documentoId={documentoId}
              isOpen={initModalOpen}
              onClose={() => setInitModalOpen(false)}
              onSuccess={() => {
                setInitModalOpen(false)
                carregar()
                onSave?.()
              }}
            />
          </>
        )}
      </div>
    </>
  )

  if (typeof window === "undefined") return null
  return createPortal(drawerContent, document.body)
}

// ============================================================
// ABA: OPERAÇÃO
// ============================================================
function TabOperation({
  doc, usuarios, salvando, onSave, podeEditar, onOpenInitModal,
}: {
  doc: Documento
  usuarios: Usuario[]
  salvando: boolean
  onSave: (p: Record<string, any>) => Promise<void>
  podeEditar: boolean
  onOpenInitModal: () => void
}) {
  const [responsavelId, setResponsavelId] = useState<string>(doc.responsavelId?.toString() || "")
  const [dataPrazoOperacao, setDataPrazoOperacao] = useState<string>(
    doc.dataPrazoOperacao ? doc.dataPrazoOperacao.split("T")[0] : ""
  )
  const [motivoBloqueio, setMotivoBloqueio] = useState<string>(doc.motivoBloqueio || "")

  useEffect(() => {
    setResponsavelId(doc.responsavelId?.toString() || "")
    setDataPrazoOperacao(doc.dataPrazoOperacao ? doc.dataPrazoOperacao.split("T")[0] : "")
    setMotivoBloqueio(doc.motivoBloqueio || "")
  }, [doc.id, doc.responsavelId, doc.dataPrazoOperacao, doc.motivoBloqueio])

  const handleSave = () => {
    onSave({
      responsavelId: responsavelId ? parseInt(responsavelId) : null,
      dataPrazoOperacao: dataPrazoOperacao || null,
      motivoBloqueio: motivoBloqueio || null,
    })
  }

  const inputDarkCls =
    "w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"

  return (
    <div className="space-y-5">
      <Section title="Estado da operação">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Iniciada em" value={fmtDateTime(doc.dataInicioOperacao)} />
          <Field label="Última movimentação" value={fmtDateTime(doc.ultimaMovimentacao || doc.updatedAt)} />
        </div>
        {!doc.dataInicioOperacao && podeEditar && (
          <button
            onClick={onOpenInitModal}
            disabled={salvando}
            className="w-full mt-2 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold rounded-md"
          >
            ▸ Iniciar operação
          </button>
        )}
      </Section>

      <Section title="Atribuição e prazo">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] uppercase font-semibold tracking-wider text-white/50 mb-1.5">
              Responsável
            </label>
            <select
              value={responsavelId}
              onChange={(e) => setResponsavelId(e.target.value)}
              disabled={!podeEditar}
              className={inputDarkCls}
            >
              <option value="">— Não atribuído —</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id} className="bg-slate-800">{u.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase font-semibold tracking-wider text-white/50 mb-1.5">
              Prazo
            </label>
            <input
              type="date"
              value={dataPrazoOperacao}
              onChange={(e) => setDataPrazoOperacao(e.target.value)}
              disabled={!podeEditar}
              className={inputDarkCls}
            />
          </div>
        </div>
      </Section>

      <Section title="Bloqueio">
        <label className="block text-[10px] uppercase font-semibold tracking-wider text-white/50 mb-1.5">
          Motivo de bloqueio (deixe vazio se não está bloqueado)
        </label>
        <textarea
          value={motivoBloqueio}
          onChange={(e) => setMotivoBloqueio(e.target.value)}
          disabled={!podeEditar}
          rows={2}
          placeholder="Ex: aguardando cliente decidir se vai retificar"
          className={inputDarkCls + " resize-none"}
        />
      </Section>

      {podeEditar && (
        <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
          <button
            onClick={handleSave}
            disabled={salvando}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold rounded-md flex items-center gap-2"
          >
            {salvando ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Salvar
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// ABA: DADOS REGISTRAIS
// ============================================================
function TabRegistry({ doc, tipoLabel }: { doc: Documento; tipoLabel: string }) {
  const isCertidao = doc.tipo.startsWith("CERTIDAO")

  if (isCertidao) {
    return (
      <div className="space-y-5">
        <Section title="Identificação">
          <GridFields fields={[
            ["Pessoa (na árvore)", nomeCompleto(doc.pessoa)],
            ["Tipo", tipoLabel],
            ["Descrição", doc.descricao],
          ]}/>
        </Section>
        <Section title="Evento">
          <GridFields fields={[
            ["Data do evento", fmtDate(doc.data_evento)],
            ["Data do registro", fmtDate(doc.data_registro)],
          ]}/>
        </Section>
        <Section title="Localidade">
          <GridFields fields={[
            ["País", doc.pais_registro],
            ["Estado/Província", doc.estado_registro],
            ["Cidade", doc.cidade_registro],
            ["Cartório", doc.cartorio],
          ]}/>
        </Section>
        <Section title="Referência registral">
          <GridFields fields={[
            ["Livro", doc.livro],
            ["Folha", doc.folha],
            ["Termo", doc.termo],
            ["Nº registro", doc.numero_registro],
          ]}/>
        </Section>
        {doc.observacoes && (
          <Section title="Observações">
            <div className="text-sm text-white/80 whitespace-pre-wrap">{doc.observacoes}</div>
          </Section>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Section title="Identificação">
        <GridFields fields={[
          ["Pessoa (na árvore)", nomeCompleto(doc.pessoa)],
          ["Tipo", tipoLabel],
          ["Descrição", doc.descricao],
        ]}/>
      </Section>
      <Section title="Documento">
        <GridFields fields={[
          ["Número", doc.numero],
          ["Órgão emissor", doc.orgao_emissor],
          ["Data de emissão", fmtDate(doc.data_emissao)],
          ["Data de validade", fmtDate(doc.data_validade)],
        ]}/>
      </Section>
      {doc.observacoes && (
        <Section title="Observações">
          <div className="text-sm text-white/80 whitespace-pre-wrap">{doc.observacoes}</div>
        </Section>
      )}
    </div>
  )
}

// ============================================================
// ABA: HISTÓRICO
// ============================================================
function TabHistory({ doc }: { doc: Documento }) {
  const eventos: Array<{ data: string; label: string }> = []
  if (doc.createdAt) eventos.push({ data: doc.createdAt, label: "Documento criado" })
  if (doc.dataInicioOperacao) eventos.push({ data: doc.dataInicioOperacao, label: "Operação iniciada" })
  if (doc.data_registro) eventos.push({ data: doc.data_registro, label: "Data de registro no cartório" })
  if (doc.data_traducao) eventos.push({ data: doc.data_traducao, label: "Documento traduzido" })
  if (doc.data_apostila) eventos.push({ data: doc.data_apostila, label: "Documento apostilado" })
  if (doc.updatedAt && doc.updatedAt !== doc.createdAt) eventos.push({ data: doc.updatedAt, label: "Última atualização" })

  eventos.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())

  if (eventos.length === 0) {
    return (
      <div className="text-center py-12 text-white/40">
        <p className="text-sm">Nenhum evento registrado ainda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Section title="Timeline do documento">
        <div className="space-y-2.5">
          {eventos.map((e, i) => (
            <div key={i} className="flex items-start gap-3 p-2.5 rounded-md bg-white/5 border border-white/5">
              <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white">{e.label}</div>
                <div className="text-[11px] text-white/50 font-mono mt-0.5">{fmtDateTime(e.data)}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <div className="text-[11px] text-white/40 px-2 pt-2">
        Histórico básico baseado nos timestamps do documento. Para um log completo de eventos
        (mudanças de status, atribuições, cobranças), será necessário um modelo DocumentoHistorico no schema.
      </div>
    </div>
  )
}

// ============================================================
// HELPERS DE LAYOUT
// ============================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-bold tracking-wider text-white/40 mb-2.5">
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">
        {label}
      </div>
      <div className={`text-sm ${value ? "text-white" : "text-white/30 italic"}`}>
        {value || "—"}
      </div>
    </div>
  )
}

function GridFields({ fields }: { fields: Array<[string, string | null | undefined]> }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {fields.map(([label, value], i) => (
        <Field key={i} label={label} value={value} />
      ))}
    </div>
  )
}

function Placeholder({ titulo, descricao, pendencia }: { titulo: string; descricao: string; pendencia: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
      <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4">
        <AlertTriangle className="w-5 h-5 text-amber-400/70" />
      </div>
      <div className="text-base font-semibold text-white mb-2">{titulo}</div>
      <div className="text-sm text-white/60 leading-relaxed mb-4">{descricao}</div>
      <div className="text-[11px] text-amber-300/80 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2 leading-relaxed">
        ⚠ {pendencia}
      </div>
    </div>
  )
}