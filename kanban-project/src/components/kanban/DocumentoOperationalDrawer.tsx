// src/components/kanban/DocumentoOperationalDrawer.tsx

"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useApi } from "@/src/lib/dados"
import type { WorkflowShape } from "./TabOperationCockpit"
import { createPortal } from "react-dom"
import { X, Loader2, AlertTriangle, UserRound, Clock, CalendarDays, FileText } from "lucide-react"
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

// Mapeamento de cor da pílula por status (mockup): Solicitado = amber,
// Recebido/Entregue = verde, Inválido/Não encontrado = vermelho, restante neutro.
const STATUS_NEUTRAL_PILL = "bg-white/10 text-white/50"
const STATUS_PILL_CLS: Record<string, string> = {
  SOLICITADO: "bg-[#d2a948]/15 text-[#d2a948]",
  SOLICITAR: "bg-[#d2a948]/15 text-[#d2a948]",
  RECEBIDO: "bg-[#4ade80]/15 text-[#4ade80]",
  ENTREGUE: "bg-[#4ade80]/15 text-[#4ade80]",
  INVALIDO: "bg-[#f87171]/15 text-[#f87171]",
  NAO_ENCONTRADO: "bg-[#f87171]/15 text-[#f87171]",
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
  publicCode?: string | null
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
  /** Banner de contexto quando a MESMA tela oficial é aberta por uma Operação Antecipada. */
  bannerAntecipada?: string | null
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
  if (dias < -5) return { text: `${Math.abs(dias)}d crítico`, cls: "text-[#f87171]" }
  if (dias < 0) return { text: `${Math.abs(dias)}d atrasado`, cls: "text-[#f87171]" }
  if (dias < 1) return { text: "vence hoje", cls: "text-[#d2a948]" }
  return { text: `${dias} dia(s) restantes`, cls: "text-[#4ade80]" }
}

// Relativo "há Xmin/Xh/N dias" para a última movimentação.
const relativeTime = (s: string | null): string => {
  if (!s) return ""
  try {
    const diff = Math.max(0, Date.now() - new Date(s).getTime())
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "agora há pouco"
    if (mins < 60) return `há ${mins}min`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `há ${hrs}h`
    const days = Math.floor(hrs / 24)
    return `há ${days} dia${days === 1 ? "" : "s"}`
  } catch { return "" }
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

/**
 * Casca fina: o drawer só existe aberto, com identidade no documento. Substitui o
 * "Reset explícito ao (re)abrir" que zerava projeção, workflow, aba e estado antes de
 * cada carga — e que, entre abrir e o efeito rodar, deixava aparecer a projeção do
 * documento anterior.
 */
// A forma do workflow vem do próprio consumidor (o cockpit), em vez de ser
// redeclarada aqui: uma definição, não duas que podem divergir em silêncio. Antes isto
// trafegava como `any`.
type WorkflowDoDrawer = WorkflowShape

export function DocumentoOperationalDrawer(props: DocumentoOperationalDrawerProps) {
  if (!props.isOpen) return null
  return <ConteudoDrawer key={props.documentoId ?? 'sem-documento'} {...props} />
}

function ConteudoDrawer({
  documentoId,
  isOpen,
  onClose,
  onSave,
  onBack,
  backLabel,
  bannerAntecipada,
}: DocumentoOperationalDrawerProps) {
  const { pode } = usePermissoes()
  const [delegandoResp, setDelegandoResp] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>("operation")
  const [salvando, setSalvando] = useState(false)
  const [initModalOpen, setInitModalOpen] = useState(false)

  // FONTE ÚNICA: uma projeção agregada (cabeçalho + estado operacional), pela camada
  // oficial. O guard de corrida manual (contador de sequência + AbortController +
  // função `vigente()`) SAIU: a chave da consulta é o documento, então uma resposta
  // atrasada de outro documento não tem onde ser aplicada. Era código correto
  // resolvendo, à mão, o que a chave resolve por construção.
  const consulta = useApi<{
    document?: Documento | null
    workflow?: WorkflowDoDrawer | null
    projection?: DocumentOperationalProjection | null
  }>(documentoId ? `/api/documentos/${documentoId}/operational-projection` : null)
  const doc = consulta.dados?.document ?? null
  const workflow = consulta.dados?.workflow ?? null
  const projection = consulta.dados?.projection ?? null
  const carregar = consulta.recarregar
  const erro = !documentoId
    ? "Operação sem documento associado."
    : (consulta.erro ? "Erro ao carregar operação." : null)

  // Usuários para delegação — leitura independente, com o seu cache.
  const usuariosReq = useApi<{ usuarios?: Usuario[] } | Usuario[]>("/api/usuarios")
  const usuarios = useMemo<Usuario[]>(() => {
    const d = usuariosReq.dados
    if (!d) return []
    return Array.isArray(d) ? d : (d.usuarios ?? [])
  }, [usuariosReq.dados])

  // MÁQUINA DE ESTADOS EXPLÍCITA do Drawer — nunca inferir "sem operação" só porque a
  // projeção ainda não chegou. Agora ela é DERIVADA da consulta, e por isso não pode
  // mais divergir dela: LOADING enquanto não há resposta; ERROR em falha;
  // OPERATIONAL quando o backend confirma a operação; NOT_MATERIALIZED quando ele
  // confirma que não há.
  const opState: "LOADING" | "OPERATIONAL" | "NOT_MATERIALIZED" | "ERROR" =
    erro ? "ERROR"
      : !consulta.dados ? "LOADING"
      : projection?.state === "OPERATIONAL" ? "OPERATIONAL"
      : "NOT_MATERIALIZED"

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


  const sla = doc ? computeSla(doc.dataPrazoOperacao) : { text: "—", cls: "" }
  const statusCls = doc ? (STATUS_PILL_CLS[doc.status] || STATUS_NEUTRAL_PILL) : ""
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
        className="fixed top-0 right-0 h-screen z-[10001] flex flex-col text-white/70 font-sans shadow-[-30px_0_60px_rgba(0,0,0,0.4)] transition-transform duration-300"
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
            <div className="h-16 rounded-lg bg-[#161b21] animate-pulse" />
            <div className="h-24 rounded-lg bg-[#161b21] animate-pulse" />
            <div className="h-40 rounded-lg bg-[#161b21] animate-pulse" />
          </div>
        )}

        {/* ERROR — estado terminal fechável (falha ou documentoId inválido). */}
        {opState === "ERROR" && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/60 gap-3 p-6">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
            <p className="text-sm">{erro || "Não foi possível abrir a operação."}</p>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-[#20262e] hover:bg-[#252c35] rounded-md"
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
              {/* Breadcrumb + fechar */}
              <div className="flex items-center justify-between mb-4">
                {onBack ? (
                  <button
                    onClick={onBack}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/70 hover:text-white transition-colors -ml-1 px-1 py-0.5 rounded hover:bg-[#20262e]"
                  >
                    <span className="text-[14px] leading-none">←</span>
                    {backLabel || nomeCompleto(doc.pessoa)}
                  </button>
                ) : (
                  <div className="text-[10px] uppercase tracking-wide">
                    <span className="font-bold text-[#7dd3fc]">Central Operacional</span>
                    <span className="text-white/50"> · {nomeCompleto(doc.pessoa)}</span>
                  </div>
                )}
                <button
                  onClick={onClose}
                  className="w-[30px] h-[30px] rounded-md bg-[#20262e] hover:bg-[#252c35] flex items-center justify-center text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Identidade do documento: tile de ícone + título + pessoa */}
              <div className="flex items-center gap-3.5 mb-4">
                <div className="w-11 h-11 rounded-lg bg-[#20262e] border border-white/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-white/60" />
                </div>
                <div className="min-w-0">
                  <div className="text-[22px] font-bold tracking-tight leading-tight text-white truncate">
                    {tipoLabel}
                  </div>
                  <div className="text-sm text-white/50 truncate">
                    {nomeCompleto(doc.pessoa)}
                  </div>
                </div>
              </div>

              {bannerAntecipada && (
                <div className="mb-4 rounded-lg border border-violet-400/30 bg-[#a78bfa]/15 px-3 py-2 text-[12px] text-violet-100 flex items-start gap-2">
                  <span className="text-[13px] leading-none mt-0.5">⇄</span>
                  <span>{bannerAntecipada}</span>
                </div>
              )}

              {/* STATUS BAR — card sólido único, 4 colunas */}
              <div className="bg-[#161b21] border border-white/10 rounded-xl px-4 py-3.5 grid grid-cols-4 gap-4">
                {/* STATUS */}
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                    Status
                  </div>
                  <div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-wider ${statusCls}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {statusLabel}
                    </span>
                  </div>
                </div>
                {/* RESPONSÁVEL */}
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                    Responsável
                  </div>
                  <div className="flex items-center gap-1.5 text-[13px] text-white/85 min-w-0">
                    <UserRound className="w-4 h-4 text-white/50 flex-shrink-0" />
                    <span className="truncate">{doc.responsavel?.nome || "Não atribuído"}</span>
                  </div>
                  {delegandoResp ? (
                    <select
                      autoFocus
                      disabled={salvando}
                      value={doc.responsavelId ?? ""}
                      onChange={async (e) => { await putDoc({ responsavelId: e.target.value ? Number(e.target.value) : null }); setDelegandoResp(false) }}
                      onBlur={() => setDelegandoResp(false)}
                      className="self-start rounded-md border border-white/10 bg-[#12161c] px-1.5 py-1 text-[12px] text-white/85 focus:outline-none focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/25 disabled:opacity-50"
                    >
                      <option value="" className="bg-[#20262e]">— Não atribuído —</option>
                      {usuarios.map((u) => (
                        <option key={u.id} value={u.id} className="bg-[#20262e]">{u.nome}</option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => setDelegandoResp(true)}
                      className="self-start text-[#7dd3fc] text-[12px] hover:underline"
                    >
                      Delegar
                    </button>
                  )}
                </div>
                {/* SLA */}
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                    SLA
                  </div>
                  <div className={`flex items-center gap-1.5 text-[13px] font-semibold ${sla.cls || "text-white/85"}`}>
                    <Clock className="w-4 h-4 flex-shrink-0" />
                    <span>{sla.text}</span>
                  </div>
                  <div className="text-white/40 text-[11px]">
                    Prazo: {fmtDateTime(doc.dataPrazoOperacao)}
                  </div>
                </div>
                {/* ÚLTIMA MOVIMENTAÇÃO */}
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                    Última movimentação
                  </div>
                  <div className="flex items-center gap-1.5 text-[13px] text-white/85 min-w-0">
                    <CalendarDays className="w-4 h-4 text-white/50 flex-shrink-0" />
                    <span className="truncate">{fmtDateTime(doc.ultimaMovimentacao || doc.updatedAt)}</span>
                  </div>
                  <div className="text-white/40 text-[11px]">
                    {relativeTime(doc.ultimaMovimentacao || doc.updatedAt)}
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
                      ? "text-[#7dd3fc] border-[#7dd3fc]"
                      : "text-white/55 hover:text-white/80 border-transparent"
                  }`}
                >
                  {t.label}
                  {t.count !== undefined && (
                    <span className={`text-[9.5px] px-1.5 rounded-full font-bold ${
                      activeTab === t.id ? "bg-[#7dd3fc]/30 text-blue-200" : "bg-[#20262e] text-white/70"
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

// A antiga `TabOperation` (formulário simples de responsável/prazo/bloqueio) foi
// REMOVIDA aqui: quem renderiza a aba é `TabOperationCockpit`, em arquivo próprio,
// desde a reformulação do cockpit. A função tinha ficado órfã — 113 linhas mortas,
// com o sincronismo prop→estado que este trabalho está eliminando. Não havia o que
// migrar; havia o que apagar.

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
            <div key={i} className="flex items-start gap-3 p-2.5 rounded-md bg-[#161b21] border border-white/5">
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
      <div className="w-12 h-12 rounded-full bg-[#161b21] border border-white/10 flex items-center justify-center mb-4">
        <AlertTriangle className="w-5 h-5 text-amber-400/70" />
      </div>
      <div className="text-base font-semibold text-white mb-2">{titulo}</div>
      <div className="text-sm text-white/60 leading-relaxed mb-4">{descricao}</div>
      <div className="text-[11px] text-amber-300/80 bg-[#d2a948]/10 border border-amber-500/20 rounded-md px-3 py-2 leading-relaxed">
        ⚠ {pendencia}
      </div>
    </div>
  )
}