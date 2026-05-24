// src/components/kanban/ProcessoCentralOperacional.tsx

"use client"

import { useState, useEffect, useCallback } from "react"
import {
  RefreshCw,
  Loader2,
  Circle,
  Clock,
  AlertTriangle,
  FileText,
  Lock,
  Bell,
  Moon,
  User as UserIcon,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Inbox,
} from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import type { ProcessoWithStatus, Processo } from "@/src/types/kanban"
import { DocumentoOperationalDrawer } from "./DocumentoOperationalDrawer"
import { InitOperationModal } from "./InitOperationModal"

// ============================================================
// TIPOS (espelho do endpoint)
// ============================================================

type QueueId =
  | "all"
  | "pending"
  | "overdue"
  | "critical"
  | "waiting"
  | "blocked"
  | "no-owner"
  | "followup"
  | "stale"
  | "me"

type SortBy = "priority" | "sla" | "lineage"

interface MatrixByPerson {
  pessoaId: number
  nome: string
  generation: number
  completed: number
  total: number
  percentage: number
}

interface MatrixMissing {
  docId: number
  pessoaId: number
  pessoaNome: string
  docType: string
  status: string
  generation: number
}

interface CentralOpData {
  matrix: {
    percentage: number
    completed: number
    total: number
    directPeopleCount: number
    missingCount: number
    nameVariationsCount: number
    byPerson: MatrixByPerson[]
    missing: MatrixMissing[]
  }
  cards: {
    all: number
    pending: number
    overdue: number
    critical: number
    waiting: number
    blocked: number
    noOwner: number
    followup: number
    stale: number
  }
  queue: Array<{
    docId: number
    pessoaNome: string
    docType: string
    docTypeLabel: string
    status: string
    responsavelNome: string | null
    prazo: string | null
    diasParaPrazo: number | null
    motivoBloqueio: string | null
    ultimaMovimentacao: string | null
    isCritical: boolean
    isOverdue: boolean
    isBlocked: boolean
    noOwner: boolean
    proximoPasso: string | null
    generation: number
  }>
  queueTitle: string
  schemaCapabilities: {
    hasResponsavel: boolean
    hasPrazoOperacao: boolean
    hasMotivoBloqueio: boolean
    hasUltimaMovimentacao: boolean
  }
}

interface ProcessoCentralOperacionalProps {
  processo: ProcessoWithStatus | Processo
}

// ============================================================
// HELPERS DE UI
// ============================================================

const docIconChar = (tipo: string): string => {
  if (tipo.startsWith("CERTIDAO")) return "📜"
  if (tipo === "PASSAPORTE_BRASILEIRO" || tipo === "PASSAPORTE_ESTRANGEIRO") return "🛂"
  if (tipo === "RG" || tipo === "CPF" || tipo === "CNH") return "🆔"
  if (tipo === "TRADUCAO_JURAMENTADA") return "🌐"
  if (tipo === "APOSTILA_HAIA") return "🏛️"
  if (tipo === "PROCURACAO") return "✍️"
  return "📄"
}

const formatPrazo = (dias: number | null): { text: string; cls: string } => {
  if (dias === null) return { text: "—", cls: "text-gray-400" }
  if (dias < -5) return { text: `${Math.abs(dias)}d crit`, cls: "bg-red-600 text-white px-1.5 py-0.5 rounded animate-pulse inline-block" }
  if (dias < 0) return { text: `${Math.abs(dias)}d atr`, cls: "text-red-600 font-semibold" }
  if (dias < 1) return { text: "hoje", cls: "text-amber-700 font-semibold" }
  return { text: `${dias}d`, cls: "text-gray-600" }
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function ProcessoCentralOperacional({
  processo,
}: ProcessoCentralOperacionalProps) {
  const { pode } = usePermissoes()
  const [data, setData] = useState<CentralOpData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [queueFilter, setQueueFilter] = useState<QueueId>("all")
  const [sortBy, setSortBy] = useState<SortBy>("priority")
  const [matrixOpen, setMatrixOpen] = useState(false)
  const [drawerDocId, setDrawerDocId] = useState<number | null>(null)
  const [initModalDocId, setInitModalDocId] = useState<number | null>(null)

  // Recupera userId do localStorage (mesmo padrão do TarefaDetailModal)
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

  const carregar = useCallback(
    async (modoSilencioso = false) => {
      if (!modoSilencioso) setLoading(true)
      else setRefreshing(true)
      setErro(null)

      try {
        const userId = getUserId()
        const params = new URLSearchParams({
          queue: queueFilter,
          sort: sortBy,
        })
        if (userId) params.set("userId", String(userId))

        const res = await fetch(
          `/api/processos/${processo.id}/central-operacional?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("authToken")}`,
            },
          }
        )

        if (res.status === 404) {
          setErro(
            "Endpoint /api/processos/[id]/central-operacional ainda não existe."
          )
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const json: CentralOpData = await res.json()
        setData(json)
      } catch (e) {
        console.warn("[ProcessoCentralOperacional] falha:", e)
        setErro("Erro ao carregar Central Operacional.")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [processo.id, queueFilter, sortBy]
  )

  useEffect(() => {
    carregar()
  }, [carregar])

  // Loading inicial
  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  // Erro fatal
  if (erro && !data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          ⚠ {erro}
        </div>
      </div>
    )
  }

  if (!data) return null

  const { matrix, cards, queue, queueTitle, schemaCapabilities } = data

  // Lista de cards (mesma ordem do mockup HTML)
  const cardList: Array<{
    id: QueueId
    label: string
    icon: React.ReactNode
    val: number
    hint: string
    cls?: "alert" | "warn" | ""
    desabilitado?: boolean
  }> = [
    { id: "all", label: "Em operação", icon: <FileText className="w-3 h-3" />, val: cards.all, hint: "documentos ativos" },
    { id: "pending", label: "Pendentes", icon: <Circle className="w-3 h-3" />, val: cards.pending, hint: "sem operação", cls: cards.pending ? "warn" : "" },
    {
      id: "overdue",
      label: "Atrasados",
      icon: <Clock className="w-3 h-3" />,
      val: cards.overdue,
      hint: schemaCapabilities.hasPrazoOperacao ? "SLA vencido" : "(precisa migration)",
      cls: cards.overdue ? "warn" : "",
      desabilitado: !schemaCapabilities.hasPrazoOperacao,
    },
    {
      id: "critical",
      label: "Críticos",
      icon: <AlertTriangle className="w-3 h-3" />,
      val: cards.critical,
      hint: schemaCapabilities.hasPrazoOperacao ? ">5d de atraso" : "(precisa migration)",
      cls: cards.critical ? "alert" : "",
      desabilitado: !schemaCapabilities.hasPrazoOperacao,
    },
    { id: "waiting", label: "Aguardando cartório", icon: <Inbox className="w-3 h-3" />, val: cards.waiting, hint: "aguarda terceiro" },
    {
      id: "blocked",
      label: "Bloqueados",
      icon: <Lock className="w-3 h-3" />,
      val: cards.blocked,
      hint: schemaCapabilities.hasMotivoBloqueio ? "com motivo formal" : "(precisa migration)",
      cls: cards.blocked ? "warn" : "",
      desabilitado: !schemaCapabilities.hasMotivoBloqueio,
    },
    {
      id: "no-owner",
      label: "Sem responsável",
      icon: <AlertCircle className="w-3 h-3" />,
      val: cards.noOwner,
      hint: schemaCapabilities.hasResponsavel ? "precisa atribuição" : "(precisa migration)",
      cls: cards.noOwner ? "alert" : "",
      desabilitado: !schemaCapabilities.hasResponsavel,
    },
    {
      id: "followup",
      label: "Follow-ups hoje",
      icon: <Bell className="w-3 h-3" />,
      val: cards.followup,
      hint: "(modelo futuro)",
      desabilitado: true,
    },
    {
      id: "stale",
      label: "Sem movimento",
      icon: <Moon className="w-3 h-3" />,
      val: cards.stale,
      hint: "≥3d parado",
    },
    {
      id: "me",
      label: "Minhas",
      icon: <UserIcon className="w-3 h-3" />,
      val: 0, // este card precisa do count específico via userId; deixei zero por enquanto
      hint: schemaCapabilities.hasResponsavel ? "atribuídas a mim" : "(precisa migration)",
      desabilitado: !schemaCapabilities.hasResponsavel,
    },
  ]

  return (
    <div className="h-full overflow-y-auto bg-gray-50/30">
      <div className="px-6 py-5">

        {/* ============== HEADER ============== */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight">Central Operacional</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Fila de produção documental · todas as tarefas ativas do processo
            </p>
          </div>
          <button
            onClick={() => carregar(true)}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Atualizar
          </button>
        </div>

        {/* ============== MATRIZ DE COMPLETUDE ============== */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-xl p-5 mb-4 shadow-sm">
          <div className="grid grid-cols-[1.4fr_2fr_auto] gap-6 items-center max-md:grid-cols-1">
            {/* Esquerda — % */}
            <div>
              <div className="text-3xl font-bold tracking-tight mb-2">{matrix.percentage}%</div>
              <div className="h-1.5 bg-white/15 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-emerald-400 transition-all duration-500"
                  style={{ width: `${matrix.percentage}%` }}
                />
              </div>
              <div className="text-[11px] text-white/70">
                Linhagem · {matrix.completed} de {matrix.total} documentos validados
              </div>
            </div>

            {/* Centro — stats */}
            <div className="flex items-center gap-8 max-md:gap-4">
              <div>
                <div className="text-2xl font-bold">{matrix.directPeopleCount}</div>
                <div className="text-[10px] uppercase tracking-wider text-white/60">Pessoas linha direta</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{matrix.missingCount}</div>
                <div className="text-[10px] uppercase tracking-wider text-white/60">Documentos faltantes</div>
              </div>
              <div>
                <div className={`text-2xl font-bold ${matrix.nameVariationsCount ? "text-red-300" : ""}`}>
                  {matrix.nameVariationsCount}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-white/60">Variações nominais</div>
              </div>
            </div>

            {/* Direita — expand */}
            <button
              onClick={() => setMatrixOpen(!matrixOpen)}
              className="px-3 py-1.5 text-xs text-white/80 hover:text-white bg-white/10 hover:bg-white/15 rounded-lg transition-colors inline-flex items-center gap-1.5"
            >
              {matrixOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              detalhes
            </button>
          </div>

          {/* Detalhes expandidos */}
          {matrixOpen && (
            <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
              {/* Por pessoa */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/60 mb-2">
                  Por pessoa da linha direta
                </div>
                <div className="space-y-1.5">
                  {matrix.byPerson.map((p) => (
                    <div key={p.pessoaId} className="grid grid-cols-[40px_1fr_120px_50px] gap-2 items-center text-xs">
                      <span className="font-mono text-white/50">G{p.generation}</span>
                      <span className="text-white/90 truncate">{p.nome}</span>
                      <div className="h-1.5 bg-white/15 rounded-full overflow-hidden">
                        <div
                          className="h-full transition-all duration-500"
                          style={{
                            width: `${p.percentage}%`,
                            background: p.percentage === 100 ? "#10b981" : p.percentage >= 50 ? "#f59e0b" : "#dc2626",
                          }}
                        />
                      </div>
                      <span className="font-mono text-right text-white/70">
                        {p.completed}/{p.total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Faltantes */}
              {matrix.missing.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/60 mb-2">
                    Documentos faltantes ({matrix.missingCount})
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {matrix.missing.slice(0, 12).map((m) => (
                      <button
                        key={m.docId}
                        onClick={() => setDrawerDocId(m.docId)}
                        className="w-full text-left grid grid-cols-[36px_1.4fr_1.6fr_100px] gap-3 px-2 py-1.5 text-xs rounded hover:bg-white/5 transition-colors"
                      >
                        <span className="font-mono text-white/50">G{m.generation}</span>
                        <span className="text-white/85 truncate">{m.pessoaNome}</span>
                        <span className="text-white/70 truncate">{m.docType}</span>
                        <span className="text-white/50 text-right">{m.status}</span>
                      </button>
                    ))}
                    {matrix.missing.length > 12 && (
                      <div className="text-[10px] text-white/40 text-center pt-1">
                        + {matrix.missing.length - 12} outros
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ============== DASHBOARD DE CARDS ============== */}
        <div className="grid gap-2 mb-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))" }}>
          {cardList.map((c) => {
            const active = queueFilter === c.id
            const baseCls =
              "relative overflow-hidden bg-white border rounded-lg px-3.5 py-3 text-left transition-all"
            const stateCls = active
              ? "border-slate-900 shadow-[0_0_0_2px_rgb(15_23_42)] bg-gradient-to-b from-slate-50 to-white"
              : "border-gray-200 hover:border-gray-300 hover:-translate-y-px hover:shadow-md cursor-pointer"
            const disabledCls = c.desabilitado ? "opacity-40 cursor-not-allowed" : ""

            return (
              <button
                key={c.id}
                onClick={() => !c.desabilitado && setQueueFilter(c.id)}
                disabled={c.desabilitado}
                className={`${baseCls} ${stateCls} ${disabledCls}`}
                title={c.desabilitado ? "Requer migration do schema" : ""}
              >
                {/* Faixa colorida no topo */}
                {c.cls === "alert" && (
                  <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-red-600 to-orange-500" />
                )}
                {c.cls === "warn" && (
                  <span className="absolute inset-x-0 top-0 h-[3px] bg-amber-500" />
                )}

                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  {c.icon}
                  {c.label}
                </div>
                <div
                  className={`text-[22px] font-bold leading-tight tracking-tight tabular-nums ${
                    c.cls === "alert" ? "text-red-600" : c.cls === "warn" ? "text-amber-700" : "text-gray-900"
                  }`}
                >
                  {c.val}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">{c.hint}</div>
              </button>
            )
          })}
        </div>

        {/* ============== HEADER DA LISTA + SORT ============== */}
        <div className="flex items-center justify-between px-1 py-2 mb-2">
          <div>
            <strong className="text-sm font-bold text-gray-900 tracking-tight">{queueTitle}</strong>
            <span className="inline-flex items-center justify-center bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-[11px] font-bold ml-2">
              {queue.length}
            </span>
          </div>
          <div className="flex gap-1.5">
            {([
              { key: "priority", label: "⚠ Prioridade" },
              { key: "sla", label: "⏱ SLA" },
              { key: "lineage", label: "↓ Linhagem" },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSortBy(opt.key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  sortBy === opt.key
                    ? "bg-slate-900 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* ============== TABELA ============== */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Header */}
          <div
            className="grid items-center gap-2.5 px-3 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gradient-to-b from-gray-50 to-slate-50 border-b border-gray-200"
            style={{
              gridTemplateColumns:
                "18px minmax(170px,1.4fr) minmax(140px,1.2fr) minmax(140px,1fr) minmax(110px,.9fr) 90px 110px minmax(140px,1.2fr) 110px",
            }}
          >
            <div />
            <div>Tarefa</div>
            <div>Documento</div>
            <div>Pessoa</div>
            <div>Responsável</div>
            <div>Prazo</div>
            <div>Estado</div>
            <div>Próximo passo</div>
            <div />
          </div>

          {/* Body */}
          {queue.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <div className="text-3xl mb-2">✓</div>
              <p className="text-sm">Fila vazia. Nada precisa de atenção agora.</p>
            </div>
          ) : (
            queue.map((row) => {
              const prazo = formatPrazo(row.diasParaPrazo)
              const rowBg = row.isCritical
                ? "bg-gradient-to-r from-red-50 to-white hover:from-red-100"
                : row.isOverdue
                ? "bg-gradient-to-r from-amber-50 to-white"
                : row.isBlocked
                ? "bg-gradient-to-r from-amber-100/40 to-white"
                : row.noOwner
                ? "bg-gradient-to-r from-red-50 to-white"
                : "hover:bg-slate-50/70"

              const prioCor = row.isCritical || row.noOwner
                ? "bg-red-500"
                : row.isOverdue || row.isBlocked
                ? "bg-amber-500"
                : "bg-gray-300"

              return (
                <div
                  key={row.docId}
                  onClick={() => {
                    if (row.status === "PENDENTE") {
                      setInitModalDocId(row.docId)
                    } else {
                      setDrawerDocId(row.docId)
                    }
                  }}
                  className={`grid items-center gap-2.5 px-3 min-h-[52px] text-xs border-b border-gray-100 cursor-pointer transition-colors ${rowBg}`}
                  style={{
                    gridTemplateColumns:
                      "18px minmax(170px,1.4fr) minmax(140px,1.2fr) minmax(140px,1fr) minmax(110px,.9fr) 90px 110px minmax(140px,1.2fr) 110px",
                  }}
                >
                  {/* Prio dot */}
                  <div className="flex items-center justify-center">
                    <div className={`w-2 h-2 rounded-full ${prioCor}`} />
                  </div>

                  {/* Tarefa */}
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    <div className="font-bold text-[12.5px] text-gray-900 truncate">
                      {row.docTypeLabel}
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono">
                      {row.status}
                    </div>
                  </div>

                  {/* Documento */}
                  <div className="flex items-center gap-1.5 text-[11.5px] text-gray-600 overflow-hidden">
                    <span className="flex-shrink-0 text-sm opacity-80">{docIconChar(row.docType)}</span>
                    <span className="truncate">{row.docTypeLabel}</span>
                  </div>

                  {/* Pessoa */}
                  <div className="text-[11.5px] text-gray-600 truncate" title={row.pessoaNome}>
                    {row.pessoaNome}
                  </div>

                  {/* Responsável */}
                  <div className="text-[11.5px] truncate">
                    {row.responsavelNome ? (
                      <span className="text-gray-700">{row.responsavelNome}</span>
                    ) : (
                      <span className="text-red-600 text-[10px] font-semibold">⚠ Sem resp.</span>
                    )}
                  </div>

                  {/* Prazo */}
                  <div className={`font-mono text-[10.5px] font-bold ${prazo.cls}`}>
                    {prazo.text}
                  </div>

                  {/* Estado */}
                  <div>
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">
                      {row.status}
                    </span>
                  </div>

                  {/* Próximo passo */}
                  <div className="text-[11px] truncate">
                    {row.isCritical && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-600 text-white animate-pulse">
                        crítico
                      </span>
                    )}
                    {!row.isCritical && row.isOverdue && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800">
                        atrasado
                      </span>
                    )}
                    {!row.isCritical && !row.isOverdue && row.isBlocked && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                        {row.motivoBloqueio}
                      </span>
                    )}
                    {!row.isCritical && !row.isOverdue && !row.isBlocked && row.noOwner && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-800">
                        sem resp.
                      </span>
                    )}
                    {!row.isCritical && !row.isOverdue && !row.isBlocked && !row.noOwner && (
                      <span className="text-gray-400">{row.proximoPasso}</span>
                    )}
                  </div>

                  {/* Ação */}
                  <div className="flex justify-end">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (row.status === "PENDENTE") {
                          setInitModalDocId(row.docId)
                        } else {
                          setDrawerDocId(row.docId)
                        }
                      }}
                      className="h-7 px-2.5 text-[10.5px] font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap"
                    >
                      {row.status === "PENDENTE" ? "▸ Iniciar operação" : "▸ Abrir Central"}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* ============== AVISO sobre migration pendente ============== */}
        {!schemaCapabilities.hasResponsavel && (
          <div className="mt-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800">
            ⚠ Alguns cards estão desabilitados porque dependem de campos novos em <code className="font-mono">Documento</code>.
            Aplique a migration descrita em <code className="font-mono">schema-mudancas-central-operacional.md</code> e atualize o flag <code className="font-mono">schemaCapabilities</code> no endpoint.
          </div>
        )}

        <DocumentoOperationalDrawer                                   
          documentoId={drawerDocId}                                   
          isOpen={drawerDocId !== null}                               
          onClose={() => setDrawerDocId(null)}                   
          onSave={() => carregar(true)}               
        />

        {/* ============== MODAL DE INICIAR OPERAÇÃO ============== */}
        <InitOperationModal
          documentoId={initModalDocId}
          isOpen={initModalDocId !== null}
          onClose={() => setInitModalDocId(null)}
          onSuccess={() => {
            setInitModalDocId(null)
            carregar(true)  // recarrega a tabela
          }}
        />

      </div>
    </div>
  )
}