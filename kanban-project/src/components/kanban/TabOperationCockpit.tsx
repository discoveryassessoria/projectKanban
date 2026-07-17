// src/components/kanban/TabOperationCockpit.tsx
//
// Substitui a função TabOperation antiga (form simples) por um
// cockpit executivo fiel ao mockup HTML:
//
//   [BLOCO 1] Estado operacional — grid 3×2 com 6 cards
//             (Status / Próxima ação / Responsável / SLA / Aging / Prioridade)
//             + botão "Painel completo da etapa →"
//
//   [BLOCO 2] Impeditivos ativos (lista colorida)
//
//   [BLOCO 3] Cards-resumo com atalho pras abas específicas
//             (Dados Registrais · Anexos · Divergências · Protocolo · Devoluções)
//
// Empty states cobertos: sem workflow / workflow concluído.

"use client"

import { Play, AlertCircle, CheckCircle2, ChevronRight, FileText, Paperclip, AlertTriangle, FileSignature, Inbox } from "lucide-react"

// ============================================================
// TIPOS — espelho do que o endpoint retorna
// ============================================================

interface DocumentoShape {
  id: number
  status: string                              // PENDENTE | EM_BUSCA | SOLICITAR | RECEBIDO | ...
  tipoDocumento?: string | null
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  numero?: string | null
  dataAto?: string | Date | null
  responsavel?: { id: number; nome: string } | null
}

interface StepShape {
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

interface WorkflowShape {
  id: number
  status: string
  progress: number
  prioridade?: string | null      // normal | urgente | critica
  startedAt: string | Date | null
  steps: StepShape[]
}

interface Props {
  doc: DocumentoShape | null
  workflow: WorkflowShape | null
  documentoId: number | null
  onAbrirIniciar: () => void                          // abre o InitOperationModal
  onTrocarAba: (tab: "registry" | "history" | "workflow") => void  // troca pra aba interna
  onAbrirCentralDaEtapa: (stepId: number) => void     // abre o editor inline da etapa (na aba Workflow)
  usuarios?: Array<{ id: number; nome: string }>       // p/ delegar o responsável do passo ativo
  onAtribuir?: (stepId: number, responsavelId: number | null) => void | Promise<void>
}

// ============================================================
// MAPS DE LABEL
// ============================================================

const STATUS_LABEL: Record<string, string> = {
  PENDENTE: "Pendente",
  SOLICITADO: "Solicitado",
  EM_BUSCA: "Em busca",
  SOLICITAR: "Em solicitação",
  RECEBIDO: "Recebido",
  EM_ANALISE: "Em análise",
  RETIFICANDO: "Em retificação",
  EM_TRADUCAO: "Em tradução",
  TRADUZIDO: "Traduzido",
  EM_APOSTILAMENTO: "Em apostilamento",
  APOSTILADO: "Apostilado",
  ENTREGUE: "Entregue",
  INVALIDO: "Inválido",
  NAO_ENCONTRADO: "Não encontrado",
  CANCELADO: "Cancelado",
}

const STATUS_PILL_CLS: Record<string, string> = {
  PENDENTE:           "bg-gray-100 text-gray-700",
  SOLICITADO:         "bg-blue-100 text-blue-800",
  EM_BUSCA:           "bg-amber-100 text-amber-800",
  SOLICITAR:          "bg-purple-100 text-purple-800",
  RECEBIDO:           "bg-emerald-100 text-emerald-800",
  EM_ANALISE:         "bg-sky-100 text-sky-800",
  RETIFICANDO:        "bg-orange-100 text-orange-800",
  EM_TRADUCAO:        "bg-indigo-100 text-indigo-800",
  TRADUZIDO:          "bg-indigo-100 text-indigo-800",
  EM_APOSTILAMENTO:   "bg-violet-100 text-violet-800",
  APOSTILADO:         "bg-violet-100 text-violet-800",
  ENTREGUE:           "bg-emerald-100 text-emerald-800",
  INVALIDO:           "bg-red-100 text-red-800",
  NAO_ENCONTRADO:     "bg-red-100 text-red-800",
  CANCELADO:          "bg-gray-200 text-gray-700",
}

const OWNER_LABEL: Record<string, string> = {
  equipe_documental: "Equipe Documental",
  daniela_brait:     "Daniela Brait",
  marco_rovatti:     "Marco Rovatti",
  sistema:           "Sistema",
}

const PRIO_PILL: Record<string, { label: string; cls: string }> = {
  critica:  { label: "CRÍTICA",  cls: "bg-red-600 text-white" },
  urgente:  { label: "ALTA",     cls: "bg-orange-500 text-white" },
  normal:   { label: "NORMAL",   cls: "bg-gray-100 text-gray-700 border border-gray-200" },
}

// ============================================================
// HELPERS
// ============================================================

function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—"
  const date = typeof d === "string" ? new Date(d) : d
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

function relativeAging(startedAt: string | Date | null | undefined): string {
  if (!startedAt) return "—"
  const start = typeof startedAt === "string" ? new Date(startedAt) : startedAt
  const diffMs = Date.now() - start.getTime()
  if (diffMs < 0) return "agora"
  const hours = Math.round(diffMs / 3600000)
  if (hours < 1) return "há poucos minutos"
  if (hours < 24) return `há ${hours}h`
  const days = Math.round(hours / 24)
  return `há ${days}d`
}

function slaInfo(dueAt: string | Date | null | undefined): { text: string; cls: string } {
  if (!dueAt) return { text: "sem prazo", cls: "text-gray-500" }
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt
  const diffDays = Math.round((due.getTime() - Date.now()) / 86400000)
  if (diffDays < 0) return { text: `${Math.abs(diffDays)} dia(s) vencido`, cls: "text-red-700 font-bold" }
  if (diffDays === 0) return { text: "vence hoje", cls: "text-amber-700 font-bold" }
  return { text: `${diffDays} dia(s) restantes`, cls: "text-emerald-700 font-semibold" }
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function TabOperationCockpit({
  doc,
  workflow,
  documentoId,
  onAbrirIniciar,
  onTrocarAba,
  onAbrirCentralDaEtapa,
  usuarios,
  onAtribuir,
}: Props) {
  if (!doc || !documentoId) {
    return (
      <div className="p-6 text-center text-white/40 text-sm">
        Carregando…
      </div>
    )
  }

  // ============================================================
  // 1) EMPTY STATE: sem workflow
  // ============================================================
  if (!workflow) {
    return (
      <div className="p-5 space-y-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
          <Play className="w-8 h-8 text-white/30 mx-auto mb-3" />
          <h4 className="text-sm font-bold text-white mb-1">Sem operação ativa</h4>
          <p className="text-[12px] text-white/50 mb-4">
            Este documento ainda não tem fluxo iniciado.
          </p>
          <button
            onClick={onAbrirIniciar}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
          >
            <Play className="w-4 h-4" />
            Iniciar operação
          </button>
        </div>

        <ShortcutsBlock doc={doc} workflow={null} onTrocarAba={onTrocarAba} />
      </div>
    )
  }

  // Identifica etapa ativa
  const activeStep = workflow.steps.find(
    (s) => s.status === "em_andamento" || s.status === "aguardando_terceiro"
  )
  const allDone = workflow.steps.every((s) => s.status === "concluida")

  // ============================================================
  // 2) EMPTY STATE: workflow concluído (todas as etapas done)
  // ============================================================
  if (allDone) {
    return (
      <div className="p-5 space-y-4">
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
          <h4 className="text-sm font-bold text-emerald-300 mb-1">✓ Operação concluída</h4>
          <p className="text-[12px] text-white/60">
            Todas as 6 etapas foram finalizadas. Documento marcado como Recebido.
          </p>
        </div>

        <ShortcutsBlock doc={doc} workflow={workflow} onTrocarAba={onTrocarAba} />
      </div>
    )
  }

  // ============================================================
  // 3) ESTADO ATIVO (caso principal)
  // ============================================================
  if (!activeStep) {
    // Workflow existe mas nenhuma etapa ativa: provavelmente está pausado/cancelado
    return (
      <div className="p-5 space-y-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
          <p className="text-[12px] text-white/50">
            Workflow {workflow.status}. Use os controles no topo da sidebar para retomar.
          </p>
        </div>

        <ShortcutsBlock doc={doc} workflow={workflow} onTrocarAba={onTrocarAba} />
      </div>
    )
  }

  const sla = slaInfo(activeStep.dueAt)
  const aging = relativeAging(activeStep.startedAt)
  const ownerLabel = activeStep.assignee?.nome || OWNER_LABEL[activeStep.ownerKey] || activeStep.ownerKey
  const statusLabel = STATUS_LABEL[doc.status] || doc.status
  const statusPill = STATUS_PILL_CLS[doc.status] || "bg-gray-100 text-gray-700"

  const prio = PRIO_PILL[workflow.prioridade || "normal"] || PRIO_PILL.normal

  // Computa impeditivos
  const blockers: Array<{ sev: "crit" | "warn"; label: string }> = []
  if (!activeStep.assignee && activeStep.ownerKey === "sistema") {
    blockers.push({ sev: "warn", label: "Sem responsável humano definido" })
  }
  if (activeStep.status === "bloqueada") {
    blockers.push({ sev: "crit", label: `Etapa bloqueada · ${activeStep.notes || "sem detalhes"}` })
  }
  const isOverdue = activeStep.dueAt && new Date(activeStep.dueAt) < new Date()
  if (isOverdue) {
    blockers.push({ sev: "crit", label: "SLA vencido — etapa precisa de atenção" })
  }

  return (
    <div className="p-5 space-y-4">

      {/* ============== BLOCO 1: ESTADO OPERACIONAL ============== */}
      <div className={`rounded-xl border p-4 ${
        isOverdue
          ? "bg-red-500/10 border-red-500/30"
          : activeStep.status === "bloqueada"
          ? "bg-amber-500/10 border-amber-500/30"
          : "bg-white/5 border-white/10"
      }`}>
        <div className="grid grid-cols-3 gap-4 mb-4 max-md:grid-cols-2">
          <Cell label="Status documental">
            <span className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded ${statusPill}`}>
              {statusLabel}
            </span>
          </Cell>
          <Cell label="Próxima ação">
            <span className="text-white text-[13px] font-medium">{activeStep.title}</span>
          </Cell>
          <Cell label="Responsável">
            {onAtribuir && usuarios && usuarios.length > 0 ? (
              <select
                value={activeStep.assignee?.id ?? ""}
                onChange={(e) => onAtribuir(activeStep.id, e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-1 text-[12.5px] text-white focus:outline-none focus:border-blue-500/50"
                title="Delegar responsável"
              >
                <option value="" className="bg-slate-800">Delegar…</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id} className="bg-slate-800">{u.nome}</option>
                ))}
              </select>
            ) : (
              <span className="text-white/85 text-[13px]">{ownerLabel}</span>
            )}
          </Cell>
          <Cell label="SLA" sub={formatDateTime(activeStep.dueAt)}>
            <span className={`text-[13px] ${sla.cls}`}>{sla.text}</span>
          </Cell>
          <Cell label="Aging" sub={`etapa ${activeStep.ordem} de ${workflow.steps.length}`}>
            <span className="text-white/85 text-[13px]">{aging}</span>
          </Cell>
          <Cell label="Prioridade">
            <span className={`inline-block px-2 py-0.5 text-[10px] font-bold tracking-wider rounded ${prio.cls}`}>
              {prio.label}
            </span>
          </Cell>
        </div>

        <button
          onClick={() => { onTrocarAba("workflow"); onAbrirCentralDaEtapa(activeStep.id) }}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
        >
          Painel completo da etapa
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ============== BLOCO 2: IMPEDITIVOS ============== */}
      {blockers.length > 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            Impeditivos ativos ({blockers.length})
          </div>
          <div className="space-y-1.5">
            {blockers.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${b.sev === "crit" ? "bg-red-500" : "bg-amber-500"}`} />
                <span className={b.sev === "crit" ? "text-red-300" : "text-amber-300"}>{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          <div className="text-[12px] text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <strong>Sem impeditivos</strong> — etapa pode ser concluída
          </div>
        </div>
      )}

      {/* ============== BLOCO 3: SHORTCUTS ============== */}
      <ShortcutsBlock doc={doc} workflow={workflow} onTrocarAba={onTrocarAba} />
    </div>
  )
}

// ============================================================
// SUBCOMPONENTES
// ============================================================

function Cell({
  label,
  children,
  sub,
}: {
  label: string
  children: React.ReactNode
  sub?: string
}) {
  return (
    <div>
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-white/40 mb-1.5">
        {label}
      </div>
      <div>{children}</div>
      {sub && (
        <div className="text-[10px] text-white/40 mt-1 font-mono">{sub}</div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------
// Cards-resumo (Bloco 3)
// ----------------------------------------------------------------

function ShortcutsBlock({
  doc,
  workflow,
  onTrocarAba,
}: {
  doc: DocumentoShape
  workflow: WorkflowShape | null
  onTrocarAba: (tab: "registry" | "history" | "workflow") => void
}) {

  // === Dados Registrais ===
  const regFields = {
    cartorio: doc.cartorio,
    livro: doc.livro,
    folha: doc.folha,
    numero: doc.numero,
    dataAto: doc.dataAto,
  }
  const regFilled = Object.values(regFields).filter((v) => v && String(v).trim()).length
  const regTotal = Object.keys(regFields).length
  const regSev: Sev = regFilled === 0
    ? "pending"
    : regFilled < regTotal / 2
    ? "warn"
    : regFilled === regTotal
    ? "ok"
    : "warn"
  const regLabel = regFilled === 0
    ? "pendente"
    : regFilled === regTotal
    ? `completo (${regFilled}/${regTotal})`
    : `parcial (${regFilled}/${regTotal})`

  // === Anexos ===
  // (esquema de anexos ainda não implementado — placeholder)
  const attCount = 0
  const attSev: Sev = "pending"
  const attLabel = "nenhum anexo"

  // === Divergências ===
  // (esquema de divergências ainda não implementado — placeholder)
  const divSev: Sev = "ok"
  const divLabel = "nenhuma"

  // === Protocolo ===
  const protoStep = (workflow?.steps || []).find((s) => s.externalProtocol)
  const protoLabel = protoStep ? `protocolado · ${protoStep.externalProtocol}` : "não registrado"
  const protoSev: Sev = protoStep ? "ok" : "pending"

  return (
    <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
      <ShortcutCard
        icon={<FileSignature className="w-3.5 h-3.5" />}
        label="Dados Registrais"
        value={regLabel}
        sev={regSev}
        onClick={() => onTrocarAba("registry")}
      />
      <ShortcutCard
        icon={<Paperclip className="w-3.5 h-3.5" />}
        label="Anexos"
        value={attLabel}
        sev={attSev}
        disabled
      />
      <ShortcutCard
        icon={<AlertCircle className="w-3.5 h-3.5" />}
        label="Divergências"
        value={divLabel}
        sev={divSev}
        disabled
      />
      <ShortcutCard
        icon={<FileText className="w-3.5 h-3.5" />}
        label="Protocolo"
        value={protoLabel}
        sev={protoSev}
        disabled
      />
    </div>
  )
}

type Sev = "ok" | "warn" | "crit" | "pending"

const SEV_BORDER: Record<Sev, string> = {
  ok:      "border-emerald-500/30 hover:border-emerald-500/50",
  warn:    "border-amber-500/30 hover:border-amber-500/50",
  crit:    "border-red-500/30 hover:border-red-500/50",
  pending: "border-white/10 hover:border-white/20",
}
const SEV_DOT: Record<Sev, string> = {
  ok: "bg-emerald-400", warn: "bg-amber-400", crit: "bg-red-400", pending: "bg-white/30",
}
const SEV_VAL: Record<Sev, string> = {
  ok: "text-emerald-300", warn: "text-amber-300", crit: "text-red-300", pending: "text-white/50",
}

function ShortcutCard({
  icon,
  label,
  value,
  sev,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sev: Sev
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-between gap-2 px-3 py-2.5 bg-white/5 border rounded-lg text-left transition-colors ${SEV_BORDER[sev]} ${
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEV_DOT[sev]}`} />
        <span className="text-white/70">{icon}</span>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/50">{label}</div>
          <div className={`text-[12px] font-medium truncate ${SEV_VAL[sev]}`}>{value}</div>
        </div>
      </div>
      {!disabled && <ChevronRight className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />}
    </button>
  )
}