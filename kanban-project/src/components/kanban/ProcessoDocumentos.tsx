// src/components/kanban/ProcessoDocumentos.tsx

"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  Search,
  Plus,
  Loader2,
  RefreshCw,
  X,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Star,
  Circle,
} from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import type { ProcessoWithStatus, Processo } from "@/src/types/kanban"
import { DocumentoOperationalDrawer } from "./DocumentoOperationalDrawer"
import { PessoaOperacionalDrawer } from "./PessoaOperacionalDrawer"

// ============================================================
// TIPOS (espelho do endpoint)
// ============================================================

interface DocCompact {
  id: number
  tipo: string
  tipoShort: string
  status: string
  statusShort: string
  statusClass: string
  isRecebido: boolean
}

interface Impediment {
  label: string
  severity: "crit" | "warn"
  detail?: string
}

interface PersonRow {
  pessoaId: number
  nome: string
  iniciais: string
  geracao: number | null
  isDirectLine: boolean
  papel: string
  transmissao: {
    state: "TRANSMITE" | "RISCO" | "BLOQUEADA" | "JUDICIAL" | "NA"
    label: string
    detail?: string
  }
  docs: DocCompact[]
  received: number
  total: number
  progressPct: number
  impedimentos: Impediment[]
  proximaAcao: {
    label: string
    severity: "info" | "warn" | "crit"
  } | null
  agingDays: number | null
  agingCls: "ok" | "warn" | "crit" | null
  ultimaMov: string | null
}

interface ProcessoDocumentosData {
  stats: {
    total: number
    recebidos: number
    emOperacao: number
    pendentes: number
  }
  linhaPrincipal: PersonRow[]
  conjuges: PersonRow[]
  outros: PersonRow[]
}

// ============================================================
// FILTROS
// ============================================================

type FilterId =
  | "all"
  | "line-direct"
  | "line-spouse"
  | "status-pending"
  | "status-searching"
  | "status-requesting"
  | "status-waiting"
  | "status-received"
  | "late"
  | "no-owner"
  | "no-att"
  | "no-proto"
  | "war-impede"
  | "war-devolvidos"
  | "war-divergentes"
  | "war-parado-7d"
  | "war-cartorio-sla"
  | "war-multiplas"
  | "war-risco"
  | "type-NASC"
  | "type-CAS"
  | "type-OBT"

interface ProcessoDocumentosProps {
  processo: ProcessoWithStatus | Processo
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function ProcessoDocumentos({ processo }: ProcessoDocumentosProps) {
  const { pode } = usePermissoes()
  const [data, setData] = useState<ProcessoDocumentosData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [searchTerm, setSearchTerm] = useState("")
  const [currentFilter, setCurrentFilter] = useState<FilterId>("all")
  const [denseMode, setDenseMode] = useState(false)
  const [drawerDocId, setDrawerDocId] = useState<number | null>(null)
  const [drawerPessoaId, setDrawerPessoaId] = useState<number | null>(null)
  const [voltarParaPessoa, setVoltarParaPessoa] = useState<{ id: number; nome: string } | null>(null)

  const carregar = useCallback(
    async (modoSilencioso = false) => {
      if (!modoSilencioso) setLoading(true)
      else setRefreshing(true)
      setErro(null)

      try {
        const res = await fetch(`/api/processos/${processo.id}/documentos`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
        })

        if (res.status === 404) {
          setErro("Endpoint /api/processos/[id]/documentos ainda não existe.")
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const json: ProcessoDocumentosData = await res.json()
        setData(json)
      } catch (e) {
        console.warn("[ProcessoDocumentos] falha:", e)
        setErro("Erro ao carregar Pasta Documental.")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [processo.id]
  )

  useEffect(() => {
    carregar()
  }, [carregar])

  // -- Filtragem cliente-side (busca + chips)
  const filteredRows = useMemo(() => {
    if (!data) return { linhaPrincipal: [], conjuges: [], outros: [] }

    const applyFilter = (row: PersonRow): boolean => {
      // Busca textual
      if (searchTerm) {
        const lower = searchTerm.toLowerCase()
        const hay = [
          row.nome,
          row.papel,
          ...row.docs.map((d) => d.tipoShort + " " + d.statusShort),
        ].join(" ").toLowerCase()
        if (!hay.includes(lower)) return false
      }

      switch (currentFilter) {
        case "all":
          return true
        case "line-direct":
          return row.isDirectLine
        case "line-spouse":
          return !row.isDirectLine
        case "status-pending":
          return row.docs.some((d) => d.status === "PENDENTE")
        case "status-searching":
          return row.docs.some((d) => d.status === "EM_BUSCA")
        case "status-requesting":
          return row.docs.some((d) => ["SOLICITAR", "SOLICITADO"].includes(d.status))
        case "status-waiting":
          return row.docs.some((d) => ["EM_ANALISE", "RETIFICANDO"].includes(d.status))
        case "status-received":
          return row.docs.some((d) => d.isRecebido)
        case "late":
          return row.agingCls === "crit" || row.impedimentos.some((i) => i.label === "SLA vencido")
        case "no-owner":
          return row.impedimentos.some((i) => i.label === "sem responsável")
        case "war-divergentes":
        case "war-impede":
        case "war-parado-7d":
          return row.impedimentos.some((i) => i.severity === "crit")
        case "war-risco":
          return row.transmissao.state === "BLOQUEADA" || row.impedimentos.some((i) => i.severity === "crit")
        case "type-NASC":
          return row.docs.some((d) => d.tipo.includes("NASCIMENTO"))
        case "type-CAS":
          return row.docs.some((d) => d.tipo.includes("CASAMENTO"))
        case "type-OBT":
          return row.docs.some((d) => d.tipo.includes("OBITO"))
        default:
          return true
      }
    }

    return {
      linhaPrincipal: data.linhaPrincipal.filter(applyFilter),
      conjuges: data.conjuges.filter(applyFilter),
      outros: data.outros.filter(applyFilter),
    }
  }, [data, searchTerm, currentFilter])

  // -- Renderização

  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

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

  const { stats } = data
  const { linhaPrincipal, conjuges, outros } = filteredRows
  const hasResults = linhaPrincipal.length + conjuges.length + outros.length > 0

  // Grid das colunas (modo padrão / denso)
  const gridCols = denseMode
    ? "36px minmax(180px,1.4fr) minmax(140px,1.1fr) minmax(180px,1.6fr) 110px minmax(140px,1.2fr) minmax(180px,1.4fr) 80px 100px"
    : "36px minmax(180px,1.4fr) minmax(140px,1.1fr) minmax(180px,1.6fr) 110px minmax(140px,1.2fr) minmax(180px,1.4fr) 80px 100px"

  return (
    <div className="h-full overflow-y-auto bg-gray-50/30">
      <div className="px-6 py-5">

        {/* ============== HEADER ============== */}
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight">Documentos</h3>
            <div className="text-xs text-gray-500 mt-0.5">
              <strong className="text-gray-900">{stats.total}</strong> documentos
              <span className="mx-1.5 text-gray-300">·</span>
              <strong className="text-emerald-700">{stats.recebidos}</strong> recebidos
              <span className="mx-1.5 text-gray-300">·</span>
              <strong className="text-amber-700">{stats.emOperacao}</strong> em operação
              <span className="mx-1.5 text-gray-300">·</span>
              <strong className="text-gray-500">{stats.pendentes}</strong> pendentes
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar pessoa, cartório, livro, termo…"
                className="pl-8 pr-8 py-1.5 text-xs border border-gray-200 rounded-lg w-64 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              onClick={() => setDenseMode(!denseMode)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                denseMode
                  ? "bg-slate-900 text-white"
                  : "text-gray-700 bg-white border border-gray-200 hover:bg-gray-50"
              }`}
              title="Mostrar SLA, cartório, origem, anexos, última mov."
            >
              Modo Denso
            </button>

            <button
              className="px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
              title="Seleção em lote"
              disabled
            >
              Lote
            </button>

            {pode("arvore.editar_documento") && (
              <button
                className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-md inline-flex items-center gap-1"
                disabled
                title="Em breve"
              >
                <Plus className="w-3 h-3" />
                Documento
              </button>
            )}

            <button
              onClick={() => carregar(true)}
              disabled={refreshing}
              className="p-1.5 text-gray-500 bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50"
              title="Atualizar"
            >
              {refreshing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* ============== FILTER CHIPS ============== */}
        <div className="flex items-center gap-1 flex-wrap pb-3 mb-3 border-b border-gray-200">
          <FilterGroup
            chips={[
              { id: "all", label: "Todos" },
              { id: "line-direct", label: "Linha principal" },
              { id: "line-spouse", label: "Fora da linha" },
            ]}
            current={currentFilter}
            onChange={setCurrentFilter}
          />
          <Divider />
          <FilterGroup
            chips={[
              { id: "status-pending", label: "Pendentes" },
              { id: "status-searching", label: "Em busca" },
              { id: "status-requesting", label: "Solicitados" },
              { id: "status-waiting", label: "Aguardando" },
              { id: "status-received", label: "Recebidos" },
            ]}
            current={currentFilter}
            onChange={setCurrentFilter}
          />
          <Divider />
          <FilterGroup
            chips={[
              { id: "late", label: "⚠ Atrasados" },
              { id: "no-owner", label: "Sem resp." },
            ]}
            current={currentFilter}
            onChange={setCurrentFilter}
          />
          <Divider />
          <FilterGroup
            war
            chips={[
              { id: "war-impede", label: "Impede protocolo" },
              { id: "war-divergentes", label: "Divergentes" },
              { id: "war-parado-7d", label: "Parado >7d" },
              { id: "war-risco", label: "Risco crítico" },
            ]}
            current={currentFilter}
            onChange={setCurrentFilter}
          />
          <Divider />
          <FilterGroup
            chips={[
              { id: "type-NASC", label: "Nasc." },
              { id: "type-CAS", label: "Cas." },
              { id: "type-OBT", label: "Óbito" },
            ]}
            current={currentFilter}
            onChange={setCurrentFilter}
          />
        </div>

        {/* ============== TABELA ============== */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">

          {/* Cabeçalho */}
          <div
            className="grid items-center gap-2.5 px-3 py-2.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider bg-gradient-to-b from-gray-50 to-slate-50 border-b border-gray-200"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div className="text-center">G</div>
            <div>Pessoa</div>
            <div>Transmissão</div>
            <div>Documentos</div>
            <div className="text-center">Progresso</div>
            <div>Impeditivos</div>
            <div>Próxima Ação</div>
            <div>Aging</div>
            <div />
          </div>

          {/* Empty state */}
          {!hasResults && (
            <div className="py-16 text-center text-gray-400">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-sm">Nenhuma pessoa corresponde aos filtros aplicados.</p>
              <button
                onClick={() => {
                  setCurrentFilter("all")
                  setSearchTerm("")
                }}
                className="mt-3 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50"
              >
                Limpar filtros
              </button>
            </div>
          )}

          {/* Grupo Linha Principal */}
          {linhaPrincipal.length > 0 && (
            <>
              <GroupHeader
                icon={<Star className="w-3 h-3" />}
                title="Linha principal · Transmissão de cidadania"
                count={linhaPrincipal.length}
                tone="direct"
              />
              {linhaPrincipal.map((row) => (
                <PersonRowComponent
                  key={row.pessoaId}
                  row={row}
                  gridCols={gridCols}
                  onAbrirPessoa={(pessoaId, pessoaNome) => {
                    setDrawerPessoaId(pessoaId)
                    setVoltarParaPessoa({ id: pessoaId, nome: pessoaNome })
                  }}
                />
              ))}
            </>
          )}

          {/* Grupo Cônjuges */}
          {conjuges.length > 0 && (
            <>
              <GroupHeader
                icon={<Circle className="w-3 h-3" />}
                title="Fora da linhagem · Cônjuges"
                count={conjuges.length}
                tone="outsider"
              />
              {conjuges.map((row) => (
                <PersonRowComponent
                  key={row.pessoaId}
                  row={row}
                  gridCols={gridCols}
                  onAbrirPessoa={(pessoaId, pessoaNome) => {
                    setDrawerPessoaId(pessoaId)
                    setVoltarParaPessoa({ id: pessoaId, nome: pessoaNome })
                  }}
                />
              ))}
            </>
          )}

          {/* Grupo Outros */}
          {outros.length > 0 && (
            <>
              <GroupHeader
                icon={<Circle className="w-3 h-3" />}
                title="Outras pessoas"
                count={outros.length}
                tone="outsider"
              />
              {outros.map((row) => (
                <PersonRowComponent
                  key={row.pessoaId}
                  row={row}
                  gridCols={gridCols}
                  onAbrirPessoa={(pessoaId, pessoaNome) => {
                    setDrawerPessoaId(pessoaId)
                    setVoltarParaPessoa({ id: pessoaId, nome: pessoaNome })
                  }}
                />
              ))}
            </>
          )}
        </div>

        {/* ============== DRAWER DA PESSOA (camada externa) ============== */}
        <PessoaOperacionalDrawer
          pessoaId={drawerPessoaId}
          isOpen={drawerPessoaId !== null}
          onClose={() => {
            setDrawerPessoaId(null)
            setVoltarParaPessoa(null)
          }}
          onClickDoc={(docId) => {
            // Esconde a sidebar da pessoa e abre a do documento (com breadcrumb pra voltar)
            setDrawerPessoaId(null)
            setDrawerDocId(docId)
          }}
        />

        {/* ============== DRAWER DO DOCUMENTO (camada interna) ============== */}
        <DocumentoOperationalDrawer
          documentoId={drawerDocId}
          isOpen={drawerDocId !== null}
          onClose={() => {
            setDrawerDocId(null)
            setVoltarParaPessoa(null)
          }}
          onSave={() => carregar(true)}
          onBack={
            voltarParaPessoa
              ? () => {
                  // Volta pra sidebar da pessoa
                  const p = voltarParaPessoa
                  setDrawerDocId(null)
                  setDrawerPessoaId(p.id)
                }
              : undefined
          }
          backLabel={voltarParaPessoa?.nome}
        />

      </div>
    </div>
  )
}

// ============================================================
// SUB-COMPONENTES
// ============================================================

function Divider() {
  return <div className="w-px h-4 bg-gray-200 mx-1.5" />
}

function FilterGroup({
  chips,
  current,
  onChange,
  war,
}: {
  chips: Array<{ id: FilterId; label: string }>
  current: FilterId
  onChange: (id: FilterId) => void
  war?: boolean
}) {
  return (
    <div className="inline-flex gap-1 items-center">
      {chips.map((c) => {
        const active = current === c.id
        return (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
              active
                ? war
                  ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                  : "bg-slate-900 text-white"
                : war
                ? "text-red-600 hover:bg-red-50"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )
}

function GroupHeader({
  icon,
  title,
  count,
  tone,
}: {
  icon: React.ReactNode
  title: string
  count: number
  tone: "direct" | "outsider"
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-wider border-b border-gray-100 ${
        tone === "direct"
          ? "bg-amber-50/40 text-amber-800"
          : "bg-slate-50 text-gray-600"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] ${
            tone === "direct" ? "bg-amber-500" : "bg-slate-400"
          }`}
        >
          {icon}
        </span>
        <span>{title}</span>
      </div>
      <span className="text-[10px] font-semibold text-gray-500 normal-case tracking-normal">
        {count} pessoa(s)
      </span>
    </div>
  )
}

function PersonRowComponent({
  row,
  gridCols,
  onAbrirPessoa,
}: {
  row: PersonRow
  gridCols: string
  onAbrirPessoa: (pessoaId: number, pessoaNome: string) => void
}) {
  // Cor de fundo da linha
  const rowCls = (() => {
    if (row.transmissao.state === "BLOQUEADA") return "border-l-4 border-red-400 bg-gradient-to-r from-red-50/50 to-white"
    if (row.transmissao.state === "RISCO") return "border-l-4 border-amber-400"
    if (row.transmissao.state === "TRANSMITE" && row.received === row.total) return "border-l-4 border-emerald-300"
    if (!row.isDirectLine) return "opacity-90"
    return ""
  })()

  // Cor da bolinha de transmissão
  const transDot = (() => {
    switch (row.transmissao.state) {
      case "TRANSMITE": return "bg-emerald-500"
      case "RISCO": return "bg-amber-500"
      case "BLOQUEADA": return "bg-red-500"
      case "JUDICIAL": return "bg-violet-500"
      default: return "bg-gray-300"
    }
  })()

  const transColor = (() => {
    switch (row.transmissao.state) {
      case "TRANSMITE": return "text-emerald-700"
      case "RISCO": return "text-amber-700"
      case "BLOQUEADA": return "text-red-700"
      case "JUDICIAL": return "text-violet-700"
      default: return "text-gray-400"
    }
  })()

  // Iniciais bg (cor por geração)
  const avatarBg = row.isDirectLine
    ? row.geracao === 0
      ? "bg-blue-100 text-blue-700"
      : "bg-slate-100 text-slate-700"
    : "bg-gray-100 text-gray-500"

  // Abre a sidebar da pessoa (não vai mais direto pro doc)
  const handleAbrir = () => {
    if (row.docs.length === 0) return
    onAbrirPessoa(row.pessoaId, row.nome)
  }

  // ✅ NOVO: handler de keyboard pra acessibilidade
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      handleAbrir()
    }
  }

  const docStateColorMap: Record<string, string> = {
    received: "text-emerald-700 font-semibold",
    pending: "text-gray-400",
    searching: "text-amber-700",
    requesting: "text-violet-700",
    waiting: "text-orange-700",
    returned: "text-red-700",
    other: "text-gray-500",
  }

  const docDotMap: Record<string, string> = {
    received: "bg-emerald-500",
    pending: "bg-gray-300",
    searching: "bg-amber-500",
    requesting: "bg-violet-500",
    waiting: "bg-orange-500",
    returned: "bg-red-500",
    other: "bg-gray-400",
  }

  const hasDocs = row.docs.length > 0

  return (
    <div
      // ✅ NOVO: linha inteira clicável
      onClick={handleAbrir}
      onKeyDown={handleKeyDown}
      role={hasDocs ? "button" : undefined}
      tabIndex={hasDocs ? 0 : -1}
      aria-label={hasDocs ? `Abrir documentos de ${row.nome}` : undefined}
      className={`grid items-center gap-2.5 px-3 py-2.5 text-xs border-b border-gray-100 transition-colors ${rowCls} ${
        hasDocs
          ? "cursor-pointer hover:bg-slate-100/80 focus:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-inset"
          : "cursor-default hover:bg-slate-50/70"
      }`}
    >
      {/* Col 1: Geração */}
      <div className="text-center">
        <span
          className={`inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-bold ${
            row.geracao === 0
              ? "bg-blue-500 text-white"
              : row.isDirectLine
              ? "bg-slate-200 text-slate-700"
              : "bg-gray-100 text-gray-400"
          }`}
        >
          {row.geracao === 0 ? "REQ" : row.isDirectLine ? `G${row.geracao}` : "·"}
        </span>
      </div>

      {/* Col 2: Pessoa (avatar + nome) */}
      <div className="flex items-center gap-2 overflow-hidden">
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ${avatarBg}`}
        >
          {row.iniciais}
        </div>
        <div className="overflow-hidden">
          <div className="font-semibold text-[12.5px] text-gray-900 truncate" title={row.nome}>
            {row.nome}
          </div>
          <div className="text-[10px] text-gray-500">{row.papel}</div>
        </div>
      </div>

      {/* Col 3: Transmissão */}
      <div className="flex flex-col gap-0.5 overflow-hidden">
        <div className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${transColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${transDot}`} />
          <span className="truncate">{row.transmissao.label}</span>
        </div>
        {row.transmissao.detail && row.transmissao.state !== "TRANSMITE" && (
          <div className="text-[10px] text-gray-500 truncate pl-3" title={row.transmissao.detail}>
            {row.transmissao.detail}
          </div>
        )}
      </div>

      {/* Col 4: Documentos compactos */}
      <div className="flex flex-col gap-0.5 overflow-hidden">
        {row.docs.length === 0 ? (
          <span className="text-[11px] text-gray-300">—</span>
        ) : (
          row.docs.slice(0, 3).map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-1.5 text-[11px]">
              <span className="text-gray-600 truncate">{d.tipoShort}</span>
              <span className="flex items-center gap-1 flex-shrink-0">
                <span className={`w-1.5 h-1.5 rounded-full ${docDotMap[d.statusClass]}`} />
                <span className={docStateColorMap[d.statusClass]}>{d.statusShort}</span>
              </span>
            </div>
          ))
        )}
        {row.docs.length > 3 && (
          <div className="text-[10px] text-gray-400 pl-1">+ {row.docs.length - 3} mais</div>
        )}
      </div>

      {/* Col 5: Progresso */}
      <div className="flex flex-col gap-1 items-center">
        <div className="text-[11px] font-mono font-bold text-gray-700">
          {row.received}<span className="text-gray-300 mx-0.5">/</span>{row.total}
        </div>
        <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${row.progressPct}%`,
              background:
                row.progressPct === 100
                  ? "#10b981"
                  : row.progressPct >= 50
                  ? "#f59e0b"
                  : "#dc2626",
            }}
          />
        </div>
      </div>

      {/* Col 6: Impeditivos */}
      <div className="flex flex-col gap-0.5 overflow-hidden">
        {row.impedimentos.length === 0 ? (
          <span className="text-[11px] text-gray-300">—</span>
        ) : (
          <>
            {row.impedimentos.slice(0, 2).map((imp, i) => (
              <span
                key={i}
                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium w-fit max-w-full truncate ${
                  imp.severity === "crit"
                    ? "bg-red-100 text-red-700"
                    : "bg-amber-100 text-amber-800"
                }`}
                title={imp.detail || imp.label}
              >
                {imp.label}
              </span>
            ))}
            {row.impedimentos.length > 2 && (
              <span className="text-[10px] text-gray-400">+{row.impedimentos.length - 2}</span>
            )}
          </>
        )}
      </div>

      {/* Col 7: Próxima ação */}
      <div className="overflow-hidden">
        {row.proximaAcao ? (
          <div
            className={`text-[11.5px] truncate ${
              row.proximaAcao.severity === "crit"
                ? "text-red-700 font-semibold"
                : row.proximaAcao.severity === "warn"
                ? "text-amber-700"
                : "text-gray-600"
            }`}
            title={row.proximaAcao.label}
          >
            {row.proximaAcao.label}
          </div>
        ) : (
          <span className="text-[11px] text-gray-300">—</span>
        )}
      </div>

      {/* Col 8: Aging */}
      <div className="text-center">
        {row.agingDays !== null ? (
          <span
            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
              row.agingCls === "crit"
                ? "bg-red-100 text-red-700"
                : row.agingCls === "warn"
                ? "bg-amber-100 text-amber-800"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {row.agingDays}d
          </span>
        ) : (
          <span className="text-[11px] text-gray-300">—</span>
        )}
      </div>

      {/* Col 9: Ação — botão mantido por affordance, mas linha inteira também clica */}
      <div className="flex justify-end">
        <button
          onClick={(e) => {
            // ✅ NOVO: evita disparar o click do <div> pai duas vezes
            e.stopPropagation()
            handleAbrir()
          }}
          disabled={!hasDocs}
          tabIndex={-1}
          aria-hidden="true"
          className="h-7 px-2.5 text-[10.5px] font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed rounded-md transition-colors whitespace-nowrap"
        >
          Abrir →
        </button>
      </div>
    </div>
  )
}