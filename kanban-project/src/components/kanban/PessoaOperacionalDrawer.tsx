// src/components/kanban/PessoaOperacionalDrawer.tsx

"use client"

import { useState, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, AlertTriangle, Plus, Pencil, Trash2, FileText, ChevronRight, PlayCircle } from "lucide-react"

// ============================================================
// LABELS (mantidos no componente — fontes de verdade locais)
// ============================================================

const TIPO_LABELS: Record<string, string> = {
  CERTIDAO_NASCIMENTO: "Certidão de Nascimento",
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: "Certidão de Nascimento (Inteiro Teor)",
  CERTIDAO_CASAMENTO: "Certidão de Casamento",
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: "Certidão de Casamento (Inteiro Teor)",
  CERTIDAO_OBITO: "Certidão de Óbito",
  CERTIDAO_OBITO_INTEIRO_TEOR: "Certidão de Óbito (Inteiro Teor)",
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
  SOLICITAR: "Solicitar",
  SOLICITADO: "Solicitado",
  EM_BUSCA: "Em busca",
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
  CANCELADO: "Cancelado",
}

const STATUS_PILL_CLS: Record<string, string> = {
  PENDENTE: "bg-slate-400/20 text-slate-300",
  SOLICITAR: "bg-violet-500/20 text-violet-300",
  SOLICITADO: "bg-violet-500/20 text-violet-300",
  EM_BUSCA: "bg-amber-500/20 text-amber-300",
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
  CANCELADO: "bg-slate-500/20 text-slate-400",
}

const STATUS_RECEBIDO = new Set([
  "RECEBIDO",
  "EM_TRADUCAO",
  "TRADUZIDO",
  "EM_APOSTILAMENTO",
  "APOSTILADO",
  "ENTREGUE",
])

const STATUS_EM_OPERACAO = new Set([
  "EM_BUSCA",
  "SOLICITAR",
  "SOLICITADO",
  "EM_ANALISE",
  "RETIFICANDO",
])

// ============================================================
// TIPOS
// ============================================================

interface Documento {
  id: number
  tipo: string
  status: string
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  termo?: string | null
  numero_registro?: string | null
  dataPrazoOperacao?: string | null
  workflow?: { progress: number } | null
}

interface Pessoa {
  id: number
  nome: string
  sobrenome: string | null
  numeroLinhagem: number | null
  requerente: string | null
  documentos: Documento[]
}

type TabId = "docs" | "transmissao" | "divergencias" | "estrategia" | "dependencias" | "historico"

export interface PessoaOperacionalDrawerProps {
  pessoaId: number | null
  isOpen: boolean
  onClose: () => void
  /** Abrir sidebar do documento (DocumentoOperationalDrawer) com breadcrumb pra voltar pra esta pessoa */
  onClickDoc: (docId: number) => void
  /** Editar pessoa (opcional — botão só aparece se passado) */
  onEdit?: (pessoaId: number) => void
  /** Remover pessoa (opcional) */
  onDelete?: (pessoaId: number) => void
  onAddPai?: (pessoaId: number) => void
  onAddMae?: (pessoaId: number) => void
  onAddConjuge?: (pessoaId: number) => void
  onAddFilho?: (pessoaId: number) => void
}

// ============================================================
// HELPERS
// ============================================================

const nomeCompleto = (p: Pessoa | null): string =>
  p ? `${p.nome}${p.sobrenome ? " " + p.sobrenome : ""}` : "—"

const linhagemLabel = (p: Pessoa): string => {
  const parts: string[] = []
  if (p.numeroLinhagem != null) parts.push(`Linhagem ${p.numeroLinhagem}`)
  if (p.requerente === "sim") parts.push("requerente")
  else if (p.requerente === "maior") parts.push("requerente · maior")
  else if (p.requerente === "menor") parts.push("requerente · menor")
  return parts.length > 0 ? parts.join(" · ") : "fora da linha direta"
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function PessoaOperacionalDrawer({
  pessoaId,
  isOpen,
  onClose,
  onClickDoc,
  onEdit,
  onDelete,
  onAddPai,
  onAddMae,
  onAddConjuge,
  onAddFilho,
}: PessoaOperacionalDrawerProps) {
  const [pessoa, setPessoa] = useState<Pessoa | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>("docs")
  const [confirmDelete, setConfirmDelete] = useState(false)

  const carregar = useCallback(async () => {
    if (!pessoaId) return
    setLoading(true)
    setErro(null)
    try {
      const res = await fetch(`/api/pessoas/${pessoaId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: Pessoa = await res.json()
      setPessoa({
        ...data,
        documentos: data.documentos || [],
      })
    } catch (e) {
      console.warn("[PessoaOperacionalDrawer] falha:", e)
      setErro("Erro ao carregar pessoa.")
    } finally {
      setLoading(false)
    }
  }, [pessoaId])

  useEffect(() => {
    if (isOpen && pessoaId) {
      setActiveTab("docs")
      setConfirmDelete(false)
      carregar()
    }
  }, [isOpen, pessoaId, carregar])

  // Trava scroll do body
  useEffect(() => {
    if (isOpen) {
      const orig = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = orig
      }
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

  if (!isOpen) return null

  // Stats
  const docs = pessoa?.documentos || []
  const total = docs.length
  const recebidos = docs.filter((d) => STATUS_RECEBIDO.has(d.status)).length
  const emOperacao = docs.filter((d) => STATUS_EM_OPERACAO.has(d.status)).length
  const pendentes = docs.filter((d) => d.status === "PENDENTE").length
  const progresso = total > 0 ? Math.round((recebidos / total) * 100) : 0

  // SLA crítico: algum doc tem prazo vencido em mais de 5 dias?
  const slaCritico = docs.some((d) => {
    if (!d.dataPrazoOperacao) return false
    const dias = Math.floor(
      (new Date(d.dataPrazoOperacao).getTime() - Date.now()) / 86400000
    )
    return dias < -5
  })

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: "docs", label: "Documentos", count: total },
    { id: "transmissao", label: "Transmissão" },
    { id: "divergencias", label: "Divergências" },
    { id: "estrategia", label: "Estratégia" },
    { id: "dependencias", label: "Dependências" },
    { id: "historico", label: "Histórico" },
  ]

  const handleDeleteClick = () => {
    if (!pessoa) return
    if (confirmDelete) {
      onDelete?.(pessoa.id)
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 4000)
    }
  }

  const drawerContent = (
    <>
      <div
        className="fixed inset-0 bg-black/45 z-[10000] transition-opacity duration-200"
        onClick={onClose}
      />

      <div
        className="fixed top-0 right-0 h-screen z-[10001] flex flex-col text-slate-200 font-sans shadow-[-30px_0_60px_rgba(0,0,0,0.4)] transition-transform duration-300"
        style={{
          width: "45vw",
          minWidth: "680px",
          maxWidth: "920px",
          background: "#0f1419",
          transform: "translateX(0)",
        }}
      >
        {loading && !pessoa && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-white/50" />
          </div>
        )}

        {erro && !pessoa && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/60 gap-3 p-6">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
            <p className="text-sm">{erro}</p>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/15 rounded-md"
            >
              Fechar
            </button>
          </div>
        )}

        {pessoa && (
          <>
            {/* ============== HEADER ============== */}
            <div
              className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-white/10"
              style={{ background: "linear-gradient(180deg,#181d24 0%,#11151b 100%)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] uppercase font-semibold tracking-wider text-white/50">
                  Central Operacional · Pessoa
                </div>
                <button
                  onClick={onClose}
                  className="w-[30px] h-[30px] rounded-md bg-white/5 hover:bg-white/15 flex items-center justify-center text-white"
                  aria-label="Fechar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-[20px] font-bold tracking-tight leading-tight text-white mb-0.5">
                {nomeCompleto(pessoa)}
              </div>
              <div className="text-[12px] text-white/55 mb-4">
                {linhagemLabel(pessoa)}
              </div>

              {/* ============== 4 CARDS DE STATS ============== */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                <StatCard value={total} label="Documentos" />
                <StatCard value={recebidos} label="Recebidos" tone={recebidos > 0 ? "ok" : undefined} />
                <StatCard value={emOperacao} label="Em operação" tone={emOperacao > 0 ? "warn" : undefined} />
                <StatCard value={pendentes} label="Pendentes" tone={pendentes > 0 ? "alert" : undefined} />
              </div>

              {/* ============== PROGRESSO DOCUMENTAL ============== */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-1.5">
                  <span>Progresso documental</span>
                  <span>
                    {progresso}% · SLA crítico:{" "}
                    <span className={slaCritico ? "text-red-300" : "text-emerald-300"}>
                      {slaCritico ? "SIM" : "NÃO"}
                    </span>
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${progresso}%`,
                      background:
                        progresso === 100
                          ? "#10b981"
                          : progresso >= 50
                          ? "#f59e0b"
                          : "#3b82f6",
                    }}
                  />
                </div>
              </div>

              {/* ============== AÇÕES (família + editar + remover) ============== */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {onAddPai && (
                  <ActionButton onClick={() => onAddPai(pessoa.id)} icon={<Plus className="w-3 h-3" />} label="Pai" />
                )}
                {onAddMae && (
                  <ActionButton onClick={() => onAddMae(pessoa.id)} icon={<Plus className="w-3 h-3" />} label="Mãe" />
                )}
                {onAddConjuge && (
                  <ActionButton onClick={() => onAddConjuge(pessoa.id)} icon={<Plus className="w-3 h-3" />} label="Cônjuge" />
                )}
                {onAddFilho && (
                  <ActionButton onClick={() => onAddFilho(pessoa.id)} icon={<Plus className="w-3 h-3" />} label="Filho(a)" />
                )}
                {onEdit && (
                  <ActionButton onClick={() => onEdit(pessoa.id)} icon={<Pencil className="w-3 h-3" />} label="Editar pessoa" />
                )}
                {onDelete && (
                  <button
                    onClick={handleDeleteClick}
                    className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                      confirmDelete
                        ? "bg-red-500 text-white hover:bg-red-600"
                        : "bg-red-500/10 text-red-300 hover:bg-red-500/20"
                    }`}
                  >
                    <Trash2 className="w-3 h-3" />
                    {confirmDelete ? "Confirmar?" : "Remover"}
                  </button>
                )}
              </div>
            </div>

            {/* ============== TABS ============== */}
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
                    <span
                      className={`text-[9.5px] px-1.5 rounded-full font-bold ${
                        activeTab === t.id ? "bg-blue-500/30 text-blue-200" : "bg-white/10 text-white/70"
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
              {activeTab === "docs" && <TabDocs docs={docs} onClickDoc={onClickDoc} />}
              {activeTab === "transmissao" && (
                <Placeholder
                  titulo="Transmissão"
                  descricao="Visão da transmissão de cidadania por esta pessoa (estado da linhagem, bloqueios, dependências externas)."
                  pendencia="Requer cálculo agregado no backend."
                />
              )}
              {activeTab === "divergencias" && (
                <Placeholder
                  titulo="Divergências"
                  descricao="Inconsistências detectadas entre documentos da pessoa (nomes divergentes, datas conflitantes)."
                  pendencia="Requer modelo Divergencia no schema."
                />
              )}
              {activeTab === "estrategia" && (
                <Placeholder
                  titulo="Estratégia"
                  descricao="Plano de ataque para esta pessoa: ordem de busca, cartórios prioritários, vias judiciais."
                  pendencia="Modelo futuro."
                />
              )}
              {activeTab === "dependencias" && (
                <Placeholder
                  titulo="Dependências"
                  descricao="Outras pessoas/documentos que dependem deste para serem processados."
                  pendencia="Requer cálculo de grafo de dependências no backend."
                />
              )}
              {activeTab === "historico" && (
                <Placeholder
                  titulo="Histórico"
                  descricao="Timeline de eventos da pessoa (criação, edições, documentos gerados, atribuições)."
                  pendencia="Filtrar LogAuditoria por entidade='Pessoa'."
                />
              )}
            </div>
          </>
        )}
      </div>
    </>
  )

  if (typeof window === "undefined") return null
  return createPortal(drawerContent, document.body)
}

// ============================================================
// SUB-COMPONENTES
// ============================================================

function StatCard({
  value,
  label,
  tone,
}: {
  value: number
  label: string
  tone?: "ok" | "warn" | "alert"
}) {
  const valueCls =
    tone === "alert"
      ? "text-red-300"
      : tone === "warn"
      ? "text-amber-300"
      : tone === "ok"
      ? "text-emerald-300"
      : "text-white"

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
      <div className={`text-[22px] font-bold leading-none mb-1 tabular-nums ${valueCls}`}>
        {value}
      </div>
      <div className="text-[9.5px] uppercase font-semibold tracking-wider text-white/50">
        {label}
      </div>
    </div>
  )
}

function ActionButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-white/5 text-white/85 hover:bg-white/12 hover:text-white transition-colors"
    >
      {icon}
      {label}
    </button>
  )
}

// ============================================================
// TAB: DOCUMENTOS
// ============================================================

function TabDocs({
  docs,
  onClickDoc,
}: {
  docs: Documento[]
  onClickDoc: (docId: number) => void
}) {
  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-white/40">
        <FileText className="w-10 h-10 text-white/20 mb-3" />
        <p className="text-sm">Nenhum documento cadastrado para esta pessoa.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {docs.map((doc) => (
        <DocCard key={doc.id} doc={doc} onClick={() => onClickDoc(doc.id)} />
      ))}
    </div>
  )
}

function DocCard({ doc, onClick }: { doc: Documento; onClick: () => void }) {
  const tipoLabel = TIPO_LABELS[doc.tipo] || doc.tipo
  const statusLabel = STATUS_LABELS[doc.status] || doc.status
  const statusCls = STATUS_PILL_CLS[doc.status] || "bg-slate-500/20 text-slate-300"

  const isPendente = doc.status === "PENDENTE"
  const isRecebido = STATUS_RECEBIDO.has(doc.status)

  const registralInfo = [
    doc.cartorio,
    doc.livro && `Livro ${doc.livro}`,
    doc.folha && `Folha ${doc.folha}`,
    doc.termo && `Termo ${doc.termo}`,
  ]
    .filter(Boolean)
    .join(" · ")

  const progress = doc.workflow?.progress ?? (isRecebido ? 100 : 0)

  return (
    <button
      onClick={onClick}
      className="group w-full text-left p-3.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/[0.08] hover:border-white/20 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[13.5px] text-white leading-tight truncate">
            {tipoLabel}
          </div>
          {registralInfo && (
            <div className="text-[11px] text-white/55 font-mono mt-1 truncate">
              {registralInfo}
            </div>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex-shrink-0 ${statusCls}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {statusLabel}
        </span>
      </div>

      {/* Progress bar fino (só se houver workflow ou estiver concluído) */}
      {!isPendente && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[10px] text-white/45 mb-1">
            <span>{progress}% concluído</span>
            <ChevronRight className="w-3 h-3 text-white/30 group-hover:text-white/60 transition-colors" />
          </div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                background:
                  progress === 100 ? "#10b981" : progress >= 50 ? "#f59e0b" : "#3b82f6",
              }}
            />
          </div>
        </div>
      )}

      {/* CTA pra Pendente */}
      {isPendente && (
        <div className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-blue-300">
          <PlayCircle className="w-3.5 h-3.5" />
          Iniciar operação
        </div>
      )}
    </button>
  )
}

// ============================================================
// PLACEHOLDER (igual ao do DocumentoOperationalDrawer)
// ============================================================

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