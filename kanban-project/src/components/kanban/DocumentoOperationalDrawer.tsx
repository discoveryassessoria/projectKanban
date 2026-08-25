// src/components/kanban/DocumentoOperationalDrawer.tsx

"use client"

import { estadoTemporal } from "@/lib/operacional/tempo-operacional"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useApi } from "@/src/lib/dados"
import { createPortal } from "react-dom"
import { X, Loader2, AlertTriangle, UserRound, Clock, CalendarDays, FileText } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { WorkflowTab, type ContextoAntecipada } from "./workflow/WorkflowTab"
import { InitOperationModal } from "./InitOperationModal"
import { WorkflowControls } from "./WorkflowControls"

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
const STATUS_NEUTRAL_PILL = "bg-[var(--surface-primary)] text-[var(--text-secondary)]"
const STATUS_PILL_CLS: Record<string, string> = {
  SOLICITADO: "bg-[var(--accent-primary)]/15 text-[var(--accent-text)]",
  SOLICITAR: "bg-[var(--accent-primary)]/15 text-[var(--accent-text)]",
  RECEBIDO: "bg-[var(--surface-secondary)] text-green-800",
  ENTREGUE: "bg-[var(--surface-secondary)] text-green-800",
  INVALIDO: "bg-[var(--surface-secondary)] text-red-700",
  NAO_ENCONTRADO: "bg-[var(--surface-secondary)] text-red-700",
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
  /**
   * Contexto da OPERAÇÃO ANTECIPADA deste documento (alvo + permissões), repassado
   * à aba Workflow. Quem abriu o documento sabe qual é a necessidade dele; o drawer
   * só encaminha, sem resolver nada por texto.
   */
  contextoAntecipada?: ContextoAntecipada
}

import {
  AbaAnexosDocumentais,
  AbaObservacoesDocumentais,
} from "./documento/AbasDocumentais"

// ABAS DO DOCUMENTO — as cinco que o operador realmente usa, nesta ordem.
//
// A primeira é o WORKFLOW, porque é onde o trabalho acontece. Saiu a aba
// "Operação": um cockpit com Status documental, Próxima ação, Responsável, SLA,
// Aging, Prioridade, impeditivos e atalhos para as outras abas. Tudo o que a
// linha da Central já responde, respondido de novo — e com régua de prazo
// própria (`Math.round(diff / 86400000)`), que é como a mesma etapa conseguia
// dizer "sem prazo" aqui e "atrasada" na tabela.
//
// O QUE ERA EXCLUSIVO DELE FICOU: "Iniciar operação" para o documento ainda não
// materializado virou o corpo do painel, com a mesma ação inicial vinda do
// Workflow Interno. A delegação por PASSO não ficou de propósito — o responsável
// pelo trabalho é o da TAREFA, e ele se transfere pela porta de tarefa; quem
// executa cada etapa continua sendo dito e trocado na Central da Etapa.
//
// Antes já haviam saído: Divergências, Devoluções, Tentativas e Auditoria (eram
// placeholders — a aba existia, o conteúdo não) e Protocolo, cujos dados são
// canônicos mas já aparecem onde o trabalho acontece.
//
// NADA foi apagado do domínio: SolicitacaoDocumento, Protocolo, o requerimento e
// o LogAuditoria continuam intactos e consultáveis. O que saiu foi a exposição.
type TabId =
  | "workflow"
  | "registry"
  | "history"
  | "attach"
  | "observ"

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
  /** A TAREFA canônica deste documento — fonte única de responsável/prazo/status. */
  tarefa: {
    taskId: number
    statusTarefa: string
    responsavelId: number | null
    responsavelNome: string | null
    dataPrazo: string | null
    rotuloDoPrazo: string
    atrasado: boolean
    venceHoje: boolean
    diasParaPrazo: number | null
  } | null
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

/**
 * O PRAZO, DITO COMO O RESTO DO SISTEMA DIZ.
 *
 * Este drawer tinha a própria régua: blocos de 24h a partir do instante, com
 * uma faixa "crítico" acima de cinco dias que não existia em lugar nenhum. Para
 * o mesmo prazo, esta tela dizia "3d atrasado", a fila dizia "Atrasada há 3
 * dias" e a Central dizia outra coisa ainda.
 *
 * A conta e a frase vêm da régua canônica; aqui fica só a cor.
 */
/**
 * O STATUS OPERACIONAL DA TAREFA em português — o MESMO vocabulário da tabela da
 * fase e da Minha Fila. O cabeçalho mostrava o estado DOCUMENTAL ("Solicitado")
 * no campo "Status", e por isso a mesma certidão era "Em andamento" na linha e
 * "Solicitado" no painel.
 */
const ROTULO_STATUS_TAREFA: Record<string, string> = {
  NAO_INICIADA: "A fazer",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_CLIENTE: "Aguardando terceiro",
  AGUARDANDO_TERCEIRO: "Aguardando terceiro",
  BLOQUEADA: "Bloqueada",
  CONCLUIDO_RECEBIDO: "Concluída",
  CONCLUIDO_NAO_POSSUI: "Concluída",
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
// A FORMA DO WORKFLOW que este painel repassa aos controles do topo.
//
// Morava em `TabOperationCockpit`, que era o único consumidor além daqui e foi
// removido junto com a segunda Central. O tipo continua sendo o espelho do que o
// backend devolve — nunca `any`, que é o que fazia a divergência ficar invisível
// até alguém ler o JSON na mão.
interface StepDoDrawer {
  id: number
  ordem: number
  stepKey: string
  title: string
  description: string | null
  weight: number
  status: string
  ownerKey: string
  dueAt: string | Date | null
  startedAt: string | Date | null
  completedAt: string | Date | null
  assignee?: { id: number; nome: string } | null
  notes?: string | null
  externalProtocol?: string | null
}

interface WorkflowDoDrawer {
  id: number
  status: string
  progress: number
  prioridade?: string | null
  startedAt: string | Date | null
  cancelledAt?: string | Date | null
  steps: StepDoDrawer[]
}

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
  contextoAntecipada,
}: DocumentoOperationalDrawerProps) {
  const { pode } = usePermissoes()
  const [delegandoResp, setDelegandoResp] = useState(false)
  // O DOCUMENTO ABRE NO SEU WORKFLOW.
  //
  // A aba de entrada era "Operação": um segundo cockpit com status, próxima
  // ação, responsável, SLA, aging, impeditivos e atalhos — tudo o que a linha da
  // Central já diz, dito outra vez, com uma régua de prazo própria. Clicar em
  // "Continuar" abria uma Central dentro da Central e ainda exigia mais um
  // clique para chegar onde o trabalho acontece.
  const [activeTab, setActiveTab] = useState<TabId>("workflow")
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

  // ────────────────────────────────────────────────────────────────────────────
  // DELEGAR = TRANSFERIR A TAREFA, pela porta canônica.
  //
  // Aqui havia `atribuirResponsavel(stepId, …)`, que fazia PATCH em
  // `…/workflow/steps/{id}` com `assigneeId` — e isso move o executor DAQUELE
  // PASSO, não o responsável pelo trabalho. Duas telas ofereciam "delegar" e
  // cada uma escrevia num lugar: o passo, o documento. A Tarefa, que é a
  // unidade operacional e a que a Minha Fila lê, não era tocada por nenhuma.
  //
  // A porta é `POST /api/tarefas/{id}/atribuir` → `atribuirTarefa`, que já faz
  // auditoria, notificação e trava otimista. Este componente não decide nada
  // sobre atribuição: só chama.
  // ────────────────────────────────────────────────────────────────────────────
  const delegarTarefa = async (responsavelId: number) => {
    const taskId = projection?.tarefa?.taskId
    if (!taskId) return
    setSalvando(true)
    try {
      const r = await fetch(`/api/tarefas/${taskId}/atribuir`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({ responsavelId }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => null)
        console.error("[DocumentoOperationalDrawer] delegar:", j?.error ?? r.status)
      }
      await carregar()
      onSave?.()
    } catch (e) {
      console.error("[DocumentoOperationalDrawer] delegar:", e)
    } finally {
      setSalvando(false)
    }
  }


  // ────────────────────────────────────────────────────────────────────────────
  // O CABEÇALHO FALA DA TAREFA — a mesma que a linha da Central mostra.
  //
  // Ele lia os três do próprio `Documento`: `responsavelId`, `dataPrazoOperacao`
  // e `status`. São campos do REGISTRO. Em produção o documento 2111 tinha
  // `dataPrazoOperacao` nulo enquanto a Tarefa dele estava atrasada — o Drawer
  // dizia "SLA —" e a tabela da fase dizia "Atrasada". Uma tarefa não pode estar
  // sem prazo numa tela e vencida na outra.
  //
  // O ESTADO DOCUMENTAL não sumiu: continua abaixo, dito como o que é.
  // ────────────────────────────────────────────────────────────────────────────
  const tarefa = projection?.tarefa ?? null
  const sla = tarefa
    ? {
        text: tarefa.rotuloDoPrazo,
        cls: tarefa.atrasado ? "text-red-700" : tarefa.venceHoje ? "text-[var(--accent-text)]" : "text-green-800",
      }
    : { text: "Sem tarefa nesta fase", cls: "text-[var(--text-secondary)]" }
  const statusCls = doc ? (STATUS_PILL_CLS[doc.status] || STATUS_NEUTRAL_PILL) : ""
  const tipoLabel = doc ? (TIPO_LABELS[doc.tipo] || doc.tipo) : ""
  const statusDocumentalLabel = doc ? (STATUS_LABELS[doc.status] || doc.status) : ""
  const statusLabel = tarefa ? ROTULO_STATUS_TAREFA[tarefa.statusTarefa] ?? tarefa.statusTarefa : "Sem tarefa"

  const tabsAll: Array<{ id: TabId; label: string; count?: number; danger?: boolean }> = [
    { id: "workflow", label: "Workflow" },
    { id: "registry", label: "Dados Registrais" },
    { id: "history", label: "Histórico" },
    { id: "attach", label: "Anexos" },
    { id: "observ", label: "Observações" },
  ]
  // A Central não depende de lista fixa por fase: recebe a fase (workflow.faseCode)
  // e ajusta as abas. Na Genealogia, Anexos fica fora — ali o documento ainda não
  // tem arquivo operacional próprio. As demais permanecem.
  const ehGenealogia = String((workflow as { faseCode?: string } | null)?.faseCode ?? "").toUpperCase() === "GENEALOGIA"
  const OCULTAS_GENEALOGIA = new Set<TabId>(["attach"])
  const tabs = ehGenealogia ? tabsAll.filter((t) => !OCULTAS_GENEALOGIA.has(t.id)) : tabsAll

  const drawerContent = (
    <>
      <div
        className="fixed inset-0 bg-[var(--overlay-modal)] z-[10000] transition-opacity duration-200"
        onClick={onClose}
        />

      <div
        className="fixed top-0 right-0 h-screen z-[10001] flex flex-col text-white/70 font-sans shadow-[var(--elev-2)] transition-transform duration-300"
        style={{
          width: "45vw", minWidth: "680px", maxWidth: "920px",
          background: "var(--surface-overlay)", transform: "translateX(0)",
        }}
      >
        {/* LOADING — enquanto a projeção operacional oficial não resolve. Só skeleton:
            nunca "Sem operação ativa", nunca botão "Iniciar operação", nenhuma ação. */}
        {opState === "LOADING" && (
          <div className="flex-1 flex flex-col gap-4 p-6">
            <div className="flex items-center gap-2 text-[var(--text-secondary)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[12px]">Carregando operação…</span>
            </div>
            <div className="h-16 rounded-lg bg-[var(--surface-overlay)] animate-pulse" />
            <div className="h-24 rounded-lg bg-[var(--surface-overlay)] animate-pulse" />
            <div className="h-40 rounded-lg bg-[var(--surface-overlay)] animate-pulse" />
          </div>
        )}

        {/* ERROR — estado terminal fechável (falha ou documentoId inválido). */}
        {opState === "ERROR" && (
          <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)] gap-3 p-6">
            <AlertTriangle className="w-8 h-8 text-amber-800" />
            <p className="text-sm">{erro || "Não foi possível abrir a operação."}</p>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)] rounded-md"
            >
              Fechar
            </button>
          </div>
        )}

        {(opState === "OPERATIONAL" || opState === "NOT_MATERIALIZED") && doc && (
          <>
            {/* HEADER */}
            <div
              className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-[var(--border-default)]"
              style={{ background: "linear-gradient(180deg,#181d24 0%,#11151b 100%)" }}
            >
              {/* Breadcrumb + fechar */}
              <div className="flex items-center justify-between mb-4">
                {onBack ? (
                  <button
                    onClick={onBack}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/70 hover:text-[var(--text-primary)] transition-colors -ml-1 px-1 py-0.5 rounded hover:bg-[var(--surface-secondary)]"
                  >
                    <span className="text-[14px] leading-none">←</span>
                    {backLabel || nomeCompleto(doc.pessoa)}
                  </button>
                ) : (
                  <div className="text-[10px] uppercase tracking-wide">
                    <span className="font-bold text-[var(--text-secondary)]">Central Operacional</span>
                    <span className="text-[var(--text-secondary)]"> · {nomeCompleto(doc.pessoa)}</span>
                  </div>
                )}
                <button
                  onClick={onClose}
                  className="w-[30px] h-[30px] rounded-md bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)] flex items-center justify-center text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Identidade do documento: tile de ícone + título + pessoa */}
              <div className="flex items-center gap-3.5 mb-4">
                <div className="w-11 h-11 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-default)] flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-[var(--text-secondary)]" />
                </div>
                <div className="min-w-0">
                  <div className="text-[22px] font-bold tracking-tight leading-tight text-white truncate">
                    {tipoLabel}
                  </div>
                  <div className="text-sm text-[var(--text-secondary)] truncate">
                    {nomeCompleto(doc.pessoa)}
                  </div>
                </div>
              </div>

              {bannerAntecipada && (
                <div className="mb-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-[12px] text-[var(--text-secondary)] flex items-start gap-2">
                  <span className="text-[13px] leading-none mt-0.5">⇄</span>
                  <span>{bannerAntecipada}</span>
                </div>
              )}

              {/* STATUS BAR — card sólido único, 4 colunas */}
              <div className="bg-[var(--surface-overlay)] border border-[var(--border-default)] rounded-xl px-4 py-3.5 grid grid-cols-4 gap-4">
                {/* STATUS */}
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Status
                  </div>
                  <div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-wider ${
                      tarefa ? "bg-[var(--surface-secondary)] text-[var(--text-secondary)]" : STATUS_NEUTRAL_PILL
                    }`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {statusLabel}
                    </span>
                  </div>
                  {/* ESTADO DOCUMENTAL — o que o registro é hoje. Informação
                      secundária: acompanha o status do trabalho, não o substitui.
                      Era ele que ocupava o campo "Status" e fazia a mesma certidão
                      ser "Em andamento" na linha e "Solicitado" aqui. */}
                  <div className={`text-[10.5px] truncate ${statusCls ? "text-[var(--text-muted)]" : "text-[var(--text-muted)]"}`}>
                    Documento: {statusDocumentalLabel}
                  </div>
                </div>
                {/* RESPONSÁVEL */}
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Responsável
                  </div>
                  <div className="flex items-center gap-1.5 text-[13px] text-white/85 min-w-0">
                    <UserRound className="w-4 h-4 text-[var(--text-secondary)] flex-shrink-0" />
                    <span className="truncate">{tarefa?.responsavelNome || "Não atribuído"}</span>
                  </div>
                  {delegandoResp ? (
                    <select
                      autoFocus
                      disabled={salvando}
                      value={tarefa?.responsavelId ?? ""}
                      onChange={async (e) => {
                        if (e.target.value) await delegarTarefa(Number(e.target.value))
                        setDelegandoResp(false)
                      }}
                      onBlur={() => setDelegandoResp(false)}
                      className="self-start rounded-md border border-[var(--border-default)] bg-[var(--app-background)] px-1.5 py-1 text-[12px] text-white/85 focus:outline-none focus:border-[var(--border-default)] focus:ring-1 focus:border-[var(--border-default)] disabled:opacity-50"
                    >
                      <option value="" className="bg-[var(--surface-secondary)]">— selecione —</option>
                      {usuarios.map((u) => (
                        <option key={u.id} value={u.id} className="bg-[var(--surface-secondary)]">{u.nome}</option>
                      ))}
                    </select>
                  ) : (
                    /* DELEGAR MOVE A TAREFA — pela porta canônica de atribuição, a
                       mesma que a tela de Tarefas usa. Este botão escrevia
                       `Documento.responsavelId`: um TERCEIRO lugar para guardar de
                       quem é o trabalho, que a linha da Central não lê e ninguém
                       sabia qual valia. Sem tarefa não há a quem delegar — e isso
                       é dito, não escondido atrás de um botão que não faz nada. */
                    <button
                      onClick={() => tarefa && setDelegandoResp(true)}
                      disabled={!tarefa || salvando}
                      title={tarefa ? "Transferir a tarefa deste documento" : "Sem tarefa nesta fase para delegar"}
                      className="self-start text-[var(--text-secondary)] text-[12px] hover:underline disabled:text-[var(--text-muted)] disabled:no-underline disabled:cursor-not-allowed"
                    >
                      Delegar
                    </button>
                  )}
                </div>
                {/* SLA */}
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    SLA
                  </div>
                  <div className={`flex items-center gap-1.5 text-[13px] font-semibold ${sla.cls || "text-white/85"}`}>
                    <Clock className="w-4 h-4 flex-shrink-0" />
                    <span>{sla.text}</span>
                  </div>
                  <div className="text-[var(--text-muted)] text-[11px]">
                    Prazo: {fmtDateTime(tarefa?.dataPrazo ?? null)}
                  </div>
                </div>
                {/* ÚLTIMA MOVIMENTAÇÃO */}
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Última movimentação
                  </div>
                  <div className="flex items-center gap-1.5 text-[13px] text-white/85 min-w-0">
                    <CalendarDays className="w-4 h-4 text-[var(--text-secondary)] flex-shrink-0" />
                    <span className="truncate">{fmtDateTime(doc.ultimaMovimentacao || doc.updatedAt)}</span>
                  </div>
                  <div className="text-[var(--text-muted)] text-[11px]">
                    {relativeTime(doc.ultimaMovimentacao || doc.updatedAt)}
                  </div>
                </div>
              </div>

              {/* BLOQUEIO É ESTADO ATUAL; O RESTO É HISTÓRICO — e os dois não
                  podem usar a mesma frase.

                  `Documento.motivoBloqueio` guarda o motivo da última operação
                  que foi bloqueada OU CANCELADA, e ninguém o apaga quando uma
                  operação NOVA começa. Em produção o documento 2111 exibia
                  "Bloqueado: Operação cancelada: Documento incorreto" ao mesmo
                  tempo em que a tarefa estava EM ANDAMENTO e a etapa EM
                  EXECUÇÃO: o texto era de uma operação encerrada às 20h54, e o
                  trabalho vivo tinha começado às 22h11, em outra fase.

                  Quem diz se ESTE trabalho está travado é a TAREFA. Sem ela
                  travada, o texto continua visível — jogar fora seria esconder
                  o que aconteceu — mas dito como o que é: registro anterior. */}
              {doc.motivoBloqueio && (
                tarefa?.statusTarefa === "BLOQUEADA" ? (
                  <div className="mt-3 p-2.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] text-[11.5px] text-amber-800">
                    <strong className="font-semibold">Bloqueado:</strong> {doc.motivoBloqueio}
                  </div>
                ) : (
                  <div className="mt-3 p-2.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] text-[11.5px] text-[var(--text-secondary)]">
                    <strong className="font-semibold text-[var(--text-secondary)]">Registro anterior:</strong> {doc.motivoBloqueio}
                    <span className="block text-[10.5px] text-[var(--text-muted)] mt-0.5">
                      Refere-se a uma operação encerrada — não impede o trabalho atual.
                    </span>
                  </div>
                )
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
              className="flex-shrink-0 flex flex-wrap px-6 border-b border-[var(--border-default)]"
              style={{ background: "var(--surface-secondary)" }}
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-[11.5px] font-semibold whitespace-nowrap border-b-2 transition-colors -mb-px ${
                    activeTab === t.id
                      ? "text-[var(--text-secondary)] border-[var(--border-default)]"
                      : "text-[var(--text-secondary)] hover:text-white/80 border-transparent"
                  }`}
                >
                  {t.label}
                  {t.count !== undefined && (
                    <span className={`text-[9.5px] px-1.5 rounded-full font-bold ${
                      activeTab === t.id ? "bg-[var(--surface-secondary)] text-[var(--text-secondary)]" : "bg-[var(--surface-secondary)] text-white/70"
                    }`}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* BODY */}
            <div className="flex-1 overflow-y-auto px-6 py-5" style={{ background: "var(--surface-overlay)" }}>
              {/* OPERAÇÃO NÃO MATERIALIZADA — estado do DOCUMENTO, não uma aba.
                  Era a única coisa que só existia no cockpit removido: o convite
                  a iniciar a operação da fase quando ela ainda não existe. Vira
                  o corpo do painel, porque é o que há para fazer — e some
                  sozinho assim que a operação passa a existir. */}
              {opState === "NOT_MATERIALIZED" && (
                <div className="mb-4 bg-[var(--surface-overlay)] border border-[var(--border-default)] rounded-xl p-6 text-center">
                  <h4 className="text-sm font-bold text-white mb-1">
                    {projection?.permissions.canStart ? "Operação não iniciada" : "Sem operação nesta fase"}
                  </h4>
                  <p className="text-[12px] text-[var(--text-secondary)] mb-4">
                    {projection?.permissions.canStart
                      ? "Este documento ainda não tem operação materializada na fase atual."
                      : "Este documento não é operado por workflow de documento na fase atual."}
                  </p>
                  {projection?.permissions.canStart && (
                    <button
                      onClick={() => setInitModalOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[var(--action-primary-ink)] bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] rounded-md transition-colors"
                    >
                      {projection?.nextAction?.label ? `Iniciar: ${projection.nextAction.label}` : "Iniciar operação"}
                    </button>
                  )}
                </div>
              )}
              {activeTab === "registry" && <TabRegistry doc={doc} tipoLabel={tipoLabel} />}
              {activeTab === "history" && <TabHistory doc={doc} />}
              {activeTab === "workflow" && (
                <WorkflowTab
                  documentoId={doc.id}
                  contextoAntecipada={contextoAntecipada}
                  onChange={() => {
                    onSave?.()
                    carregar()
                  }}
                />
              )}
              {activeTab === "attach" && (
                <AbaAnexosDocumentais documentoId={documentoId} podeAnexar />
              )}
              {activeTab === "observ" && (
                <AbaObservacoesDocumentais documentoId={documentoId} podeRegistrar />
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
      <div className="text-center py-12 text-[var(--text-muted)]">
        <p className="text-sm">Nenhum evento registrado ainda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Section title="Timeline do documento">
        <div className="space-y-2.5">
          {eventos.map((e, i) => (
            <div key={i} className="flex items-start gap-3 p-2.5 rounded-md bg-[var(--surface-overlay)] border border-[var(--border-subtle)]">
              <div className="w-2 h-2 rounded-full bg-[var(--text-muted)] mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white">{e.label}</div>
                <div className="text-[11px] text-[var(--text-secondary)] font-mono mt-0.5">{fmtDateTime(e.data)}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <div className="text-[11px] text-[var(--text-muted)] px-2 pt-2">
        Marcos do documento. O diário completo da operação (contatos, observações e
        anexos, com autor e data) fica nas abas Observações e Anexos.
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
      <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] mb-2.5">
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-semibold tracking-wider text-[var(--text-secondary)] mb-0.5">
        {label}
      </div>
      <div className={`text-sm ${value ? "text-white" : "text-[var(--text-muted)] italic"}`}>
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
