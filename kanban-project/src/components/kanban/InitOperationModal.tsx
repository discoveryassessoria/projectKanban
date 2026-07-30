// src/components/kanban/InitOperationModal.tsx

"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useApi } from "@/src/lib/dados"
import { createPortal } from "react-dom"
import {
  X,
  Search,
  Ban,
  AlertTriangle,
  Loader2,
} from "lucide-react"

// ============================================================
// TIPOS
// ============================================================

type TipoOperacao = "buscar" | "solicitar" | "receber" | "desnecessario"
type Prioridade = "normal" | "urgente" | "critica"

interface Usuario {
  id: number
  nome: string
  publicCode?: string | null
  email?: string | null
}

interface Documento {
  id: number
  tipo: string
  pessoa?: { nome: string; sobrenome: string | null } | null
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  termo?: string | null
  status?: string
}

interface InitOperationModalProps {
  documentoId: number | null
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

// ============================================================
// HELPERS
// ============================================================

const TIPO_LABELS_DOC: Record<string, string> = {
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

const tomorrowPlusDays = (days: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

/**
 * Casca fina: o conteúdo só existe aberto, com identidade no documento. É o que
 * substitui o "Reset state" que zerava cinco campos à mão antes de cada carga.
 */
export function InitOperationModal(props: InitOperationModalProps) {
  if (!props.isOpen || !props.documentoId) return null
  return <ConteudoModal key={props.documentoId} {...props} />
}

function ConteudoModal({
  documentoId,
  isOpen,
  onClose,
  onSuccess,
}: InitOperationModalProps) {
  const [saving, setSaving] = useState(false)

  // Estado do formulário
  const [tipoOperacao, setTipoOperacao] = useState<TipoOperacao | null>(null)
  const [responsavelId, setResponsavelId] = useState<string>("auto")
  const [dataPrazoInicial, setDataPrazoInicial] = useState<string>(tomorrowPlusDays(7))
  const [prioridade, setPrioridade] = useState<Prioridade>("normal")
  const [observacaoInicial, setObservacaoInicial] = useState<string>("")

  // Documento e usuários pela camada oficial: duas leituras independentes, cada uma
  // com o seu cache, em lugar do `Promise.all` dentro de um efeito. A lista de
  // usuários aceita os dois formatos que a rota já devolvia.
  const docReq = useApi<Documento>(documentoId ? `/api/documentos/${documentoId}` : null)
  const usuariosReq = useApi<{ usuarios?: Usuario[] } | Usuario[]>("/api/usuarios")
  const doc = docReq.dados ?? null
  const usuarios = useMemo<Usuario[]>(() => {
    const d = usuariosReq.dados
    if (!d) return []
    return Array.isArray(d) ? d : (d.usuarios ?? [])
  }, [usuariosReq.dados])
  const loading = docReq.carregando || usuariosReq.carregando
  // A falha que interessa é a do documento — sem ele o modal não tem o que abrir.
  const erro = docReq.erro ? "Erro ao carregar documento." : null

  // -- Trava scroll do body
  useEffect(() => {
    if (isOpen) {
      const orig = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = orig
      }
    }
  }, [isOpen])

  // -- ESC fecha
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose()
    }
    document.addEventListener("keydown", onEsc)
    return () => document.removeEventListener("keydown", onEsc)
  }, [isOpen, onClose])

  // -- Salva
  const handleConfirm = async () => {
    if (!documentoId || !tipoOperacao) return
    setSaving(true)
    try {
      const res = await fetch(`/api/documentos/${documentoId}/workflow`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({
          tipoOperacao,
          responsavelId: responsavelId === "auto" ? null : parseInt(responsavelId),
          dataPrazoInicial: dataPrazoInicial || null,
          prioridade,
          observacaoInicial: observacaoInicial.trim() || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      onSuccess?.()
      onClose()
    } catch (e) {
      console.warn("[InitOperationModal] confirmar:", e)
      alert(`Erro ao iniciar operação: ${e instanceof Error ? e.message : "desconhecido"}`)
    } finally {
      setSaving(false)
    }
  }


  // -- Opções disponíveis (apenas Buscar e Desnecessário)
  const opcoes: Array<{
    key: TipoOperacao
    label: string
    desc: string
    icon: React.ReactNode
    iconBg: string
    iconColor: string
    warning?: boolean
  }> = [
    {
      key: "buscar",
      label: "Buscar certidão",
      desc: "Pesquisar cartório e dados registrais (livro, folha, termo). Use quando ainda não sabe onde está o registro.",
      icon: <Search className="w-5 h-5" />,
      iconBg: "bg-[#d2a948]/15",
      iconColor: "text-[#d2a948]",
    },
    {
      key: "desnecessario",
      label: "Marcar como desnecessário",
      desc: "Cancelar este documento — não será mais cobrado.",
      icon: <Ban className="w-5 h-5" />,
      iconBg: "bg-[#f87171]/15",
      iconColor: "text-[#f87171]",
    },
  ]

  const tipoLabel = doc ? TIPO_LABELS_DOC[doc.tipo] || doc.tipo : ""
  const pessoaName = doc?.pessoa
    ? `${doc.pessoa.nome}${doc.pessoa.sobrenome ? " " + doc.pessoa.sobrenome : ""}`
    : "—"

  const modalContent = (
    <>
      {/* OVERLAY */}
      <div
        className="fixed inset-0 bg-black/50 z-[10010] transition-opacity duration-200"
        onClick={onClose}
      />

      {/* MODAL */}
      <div className="fixed inset-0 z-[10011] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-[#1b2027] rounded-xl shadow-2xl w-full max-w-[640px] max-h-[92vh] flex flex-col pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* HEADER */}
          <div className="px-6 pt-5 pb-4 border-b border-white/10">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white/95">Iniciar operação</h2>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-md hover:bg-[#252c35] flex items-center justify-center text-white/55"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-white/55 mt-1">
              {loading ? "Carregando…" : doc ? `${tipoLabel} · ${pessoaName}` : "—"}
            </div>
          </div>

          {/* BODY */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-white/40" />
              </div>
            ) : erro ? (
              <div className="bg-[#f87171]/12 border border-[#f87171]/30 rounded-lg px-4 py-3 text-sm text-[#f87171]">
                ⚠ {erro}
              </div>
            ) : doc ? (
              <>
                {/* SECTION 1: TIPO DE OPERAÇÃO */}
                <SectionTitle num={1}>Tipo de operação</SectionTitle>
                <div className="space-y-2 mb-6">
                  {opcoes.map((op) => {
                    const selected = tipoOperacao === op.key
                    return (
                      <button
                        key={op.key}
                        onClick={() => setTipoOperacao(op.key)}
                        className={`w-full flex items-start gap-3 px-3 py-3 rounded-lg border-2 transition-all text-left ${
                          selected
                            ? "border-blue-500 bg-[#7dd3fc]/12"
                            : "border-white/10 bg-[#1b2027] hover:border-white/15 hover:bg-[#20262e]"
                        }`}
                      >
                        <div
                          className={`w-10 h-10 rounded-lg ${op.iconBg} ${op.iconColor} flex items-center justify-center flex-shrink-0`}
                        >
                          {op.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-white/95">{op.label}</div>
                          <div
                            className={`text-xs mt-0.5 leading-relaxed ${
                              op.warning ? "text-[#d2a948]" : "text-white/68"
                            }`}
                          >
                            {op.desc}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* SECTION 2: ATRIBUIÇÃO INICIAL */}
                {tipoOperacao !== "desnecessario" && (
                  <>
                    <SectionTitle num={2}>Atribuição inicial</SectionTitle>
                    <div className="grid grid-cols-2 gap-3 mb-6">
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider font-semibold text-white/55 mb-1.5">
                          Responsável inicial
                        </label>
                        <select
                          value={responsavelId}
                          onChange={(e) => setResponsavelId(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-white/10 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-[#1b2027]"
                        >
                          <option value="auto">Auto (responsável padrão da etapa)</option>
                          {usuarios.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.nome}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider font-semibold text-white/55 mb-1.5">
                          Prazo inicial
                        </label>
                        <input
                          type="date"
                          value={dataPrazoInicial}
                          onChange={(e) => setDataPrazoInicial(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-white/10 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-[#1b2027]"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* SECTION 3: PRIORIDADE */}
                {tipoOperacao !== "desnecessario" && (
                  <>
                    <SectionTitle num={3}>Prioridade</SectionTitle>
                    <div className="grid grid-cols-3 gap-2 mb-6">
                      {(
                        [
                          { key: "normal", label: "Normal", bgActive: "bg-[#12161c] text-white", bgIdle: "bg-[#1b2027] text-white/80 border-white/10" },
                          { key: "urgente", label: "Urgente", bgActive: "bg-orange-500 text-white", bgIdle: "bg-[#1b2027] text-white/80 border-white/10" },
                          { key: "critica", label: "⚠ Crítica", bgActive: "bg-[#f87171] text-white", bgIdle: "bg-[#1b2027] text-white/80 border-white/10" },
                        ] as Array<{ key: Prioridade; label: string; bgActive: string; bgIdle: string }>
                      ).map((p) => {
                        const selected = prioridade === p.key
                        return (
                          <button
                            key={p.key}
                            onClick={() => setPrioridade(p.key)}
                            className={`px-3 py-2 rounded-md text-sm font-semibold border-2 transition-colors ${
                              selected ? p.bgActive + " border-transparent" : p.bgIdle + " hover:bg-[#20262e]"
                            }`}
                          >
                            {p.label}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}

                {/* SECTION 4: OBSERVAÇÃO */}
                <SectionTitle num={tipoOperacao === "desnecessario" ? 2 : 4}>
                  {tipoOperacao === "desnecessario"
                    ? "Motivo do cancelamento"
                    : "Observação inicial (opcional)"}
                </SectionTitle>
                <textarea
                  value={observacaoInicial}
                  onChange={(e) => setObservacaoInicial(e.target.value)}
                  rows={3}
                  placeholder={
                    tipoOperacao === "desnecessario"
                      ? "Por que este documento não é mais necessário?"
                      : "Contexto, instruções para quem vai iniciar, particularidades do caso…"
                  }
                  className="w-full px-3 py-2 text-sm border border-white/10 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 resize-none"
                />
              </>
            ) : null}
          </div>

          {/* FOOTER */}
          <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white/80 bg-[#1b2027] hover:bg-[#20262e] border border-white/10 rounded-md disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={!tipoOperacao || saving}
              className={`px-4 py-2 text-sm font-semibold text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 ${
                tipoOperacao === "desnecessario"
                  ? "bg-[#f87171] hover:bg-red-600"
                  : "bg-[#7dd3fc] hover:bg-[#7dd3fc]"
              }`}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {tipoOperacao === "desnecessario"
                ? "Confirmar cancelamento"
                : "▸ Iniciar operação"}
            </button>
          </div>
        </div>
      </div>
    </>
  )

  if (typeof window === "undefined") return null
  return createPortal(modalContent, document.body)
}

// ============================================================
// HELPERS DE LAYOUT
// ============================================================

function SectionTitle({ num, children }: { num: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-1">
      <span className="w-5 h-5 rounded-full bg-[#12161c] text-white text-[11px] font-bold flex items-center justify-center">
        {num}
      </span>
      <h3 className="text-[11px] uppercase font-bold tracking-wider text-white/95">{children}</h3>
    </div>
  )
}