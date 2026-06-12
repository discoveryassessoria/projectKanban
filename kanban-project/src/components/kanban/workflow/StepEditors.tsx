// src/components/kanban/workflow/StepEditors.tsx
//
// Editores específicos para cada etapa do Workflow Documental.
// Cada editor é um modal centralizado (z-10005), empilhado por cima da
// Central da Etapa (z-10003), espelhando o padrão do EditorRegistralModal.
//
// Exporta:
//   - StepEditorRouter   → dispatcher por stepKey
//   - EditorSolicitarCertidao   (etapa 2)
//   - EditorAguardarRetorno     (etapa 3)
//   - EditorReceberCertidao     (etapa 4)
//   - EditorConferirCertidao    (etapa 5)
//   - EditorValidarCertidao     (etapa 6)

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import {
  X,
  Loader2,
  AlertTriangle,
  Check,
  Send,
  Clock,
  Mail,
  MessageCircle,
  MapPin,
  Globe,
  Upload,
  FileCheck,
  Scale,
  XCircle,
  AlertCircle,
  Trash2,
  ExternalLink,
} from "lucide-react"
import { uploadFiles } from "@/src/lib/storage"
import { celebrar } from "@/src/lib/confetti"

// ============================================================
// TIPOS COMPARTILHADOS
// ============================================================

interface StepEditorBaseProps {
  documentoId: number
  stepId: number
  stepStatus: string // "em_andamento" | "concluida" | etc
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

interface UserBrief {
  id: number
}

// ============================================================
// HELPERS
// ============================================================

const getUserId = (): number | null => {
  try {
    const stored = localStorage.getItem("user")
    if (stored) {
      const u = JSON.parse(stored) as UserBrief
      return u.id ?? null
    }
  } catch {}
  return null
}

const authHeader = () => ({
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") : ""}`,
})

async function putDocumento(
  documentoId: number,
  body: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(`/api/documentos/${documentoId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(body),
  })
  return res.ok
}

async function patchStep(
  documentoId: number,
  stepId: number,
  body: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(
    `/api/documentos/${documentoId}/workflow/steps/${stepId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    },
  )
  return res.ok
}

// ============================================================
// SHELL DO MODAL — usado por todos os editores
// ============================================================

interface ShellProps {
  isOpen: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  footer: React.ReactNode
  headerGradient?: string
}

function EditorShell({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  headerGradient = "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)",
}: ShellProps) {
  // ESC + scroll lock
  useEffect(() => {
    if (!isOpen) return
    const orig = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onEsc)
    return () => {
      document.body.style.overflow = orig
      document.removeEventListener("keydown", onEsc)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const content = (
    <>
      <div
        className="fixed inset-0 bg-black/65 z-[10004] transition-opacity"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-[10005] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-xl overflow-hidden shadow-2xl pointer-events-auto"
          style={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {/* Header */}
          <div
            className="flex-shrink-0 px-6 py-4 border-b border-white/10"
            style={{ background: headerGradient }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-bold text-white mb-0.5">{title}</div>
                {subtitle && (
                  <div className="text-[12px] text-white/70 leading-snug">{subtitle}</div>
                )}
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/15 flex items-center justify-center text-white flex-shrink-0"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 text-slate-200">{children}</div>

          {/* Footer */}
          <div className="flex-shrink-0 px-6 py-4 border-t border-white/10 bg-[#11151b]">
            {footer}
          </div>
        </div>
      </div>
    </>
  )

  if (typeof window === "undefined") return null
  return createPortal(content, document.body)
}

// ============================================================
// PRIMITIVOS DE FORMULÁRIO
// ============================================================

function Label({
  children,
  required,
}: {
  children: React.ReactNode
  required?: boolean
}) {
  return (
    <label className="block text-[10px] uppercase font-semibold tracking-wider text-white/55 mb-1.5">
      {children}
      {required && <span className="text-amber-300 ml-1">*</span>}
    </label>
  )
}

const inputCls =
  "w-full px-3 py-2 bg-white/5 border border-white/10 rounded-md text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"

const inputClsInvalid =
  "w-full px-3 py-2 bg-white/5 border border-amber-500/40 rounded-md text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30"

function ReadOnlyBanner({ stepStatus }: { stepStatus: string }) {
  if (stepStatus !== "concluida") return null
  return (
    <div className="mb-5 p-3 rounded-lg border border-blue-500/30 bg-blue-500/10">
      <div className="text-[12px] font-semibold text-blue-300 mb-0.5 flex items-center gap-1.5">
        <AlertCircle className="w-3.5 h-3.5" />
        Etapa já concluída
      </div>
      <div className="text-[11px] text-white/70 leading-relaxed">
        Para editar campos desta etapa, use <strong>↻ Reabrir etapa</strong> primeiro.
        Os campos abaixo estão em modo leitura.
      </div>
    </div>
  )
}

// ============================================================
// ROUTER — escolhe o editor certo baseado no stepKey
// ============================================================

export interface StepEditorRouterProps {
  stepKey: string
  documentoId: number
  stepId: number
  stepStatus: string
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

export function StepEditorRouter(props: StepEditorRouterProps) {
  const { stepKey, ...rest } = props

  switch (stepKey) {
    case "solicitar_certidao":
      return <EditorSolicitarCertidao {...rest} />
    case "aguardar_retorno":
      return <EditorAguardarRetorno {...rest} />
    case "receber_certidao":
      return <EditorReceberCertidao {...rest} />
    case "conferir_certidao":
      return <EditorConferirCertidao {...rest} />
    case "validar_certidao":
      return <EditorValidarCertidao {...rest} />
    default:
      // Etapas sem editor implementado: modal placeholder
      return <EditorPlaceholder stepKey={stepKey} {...rest} />
  }
}

// ============================================================
// ETAPA 2: SOLICITAR CERTIDÃO — versão completa (HTML-like)
// ============================================================
//
// Inclui: Resumo do Pedido (documento + pessoa + cartório + dados
// registrais + histórico + recomendação), 8 canais, evidências
// condicionais e Detalhes do Envio (atendente, custo, pagamento).

type CanalId =
  | "crc"
  | "e-cartorio"
  | "email"
  | "whatsapp"
  | "balcao"
  | "comune"
  | "correios"
  | "consulado"

interface CanalRequirements {
  attachment: boolean
  attachmentLabel: string
  protocol: boolean
  trackingCode?: boolean
  observation?: boolean
  observationHint?: string
}

interface CanalConfig {
  id: CanalId
  label: string
  desc: string
  icon: React.ComponentType<{ className?: string }>
  requires: CanalRequirements
}

const CANAIS: CanalConfig[] = [
  {
    id: "crc",
    label: "CRC Nacional",
    desc: "Central Nacional de Registro Civil — integração eletrônica",
    icon: Globe,
    requires: { attachment: true, attachmentLabel: "Print do protocolo CRC", protocol: true },
  },
  {
    id: "e-cartorio",
    label: "E-cartório",
    desc: "Portal eletrônico do cartório",
    icon: Send,
    requires: { attachment: true, attachmentLabel: "PDF do pedido eletrônico", protocol: true },
  },
  {
    id: "email",
    label: "E-mail",
    desc: "Pedido por e-mail direto ao cartório",
    icon: Mail,
    requires: { attachment: true, attachmentLabel: "Requerimento PDF enviado", protocol: true },
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    desc: "WhatsApp Business do cartório",
    icon: MessageCircle,
    requires: { attachment: true, attachmentLabel: "Screenshot da conversa", protocol: true },
  },
  {
    id: "balcao",
    label: "Balcão",
    desc: "Atendimento presencial",
    icon: MapPin,
    requires: {
      attachment: true,
      attachmentLabel: "Comprovante de protocolo (papel digitalizado)",
      protocol: true,
      observation: true,
      observationHint: "Atendente, número do guichê, horário",
    },
  },
  {
    id: "comune",
    label: "Comune italiana",
    desc: "Pedido direto à comune (Italia)",
    icon: Globe,
    requires: { attachment: true, attachmentLabel: "PEC enviada ou modulo richiesta", protocol: true },
  },
  {
    id: "correios",
    label: "Correios",
    desc: "Pedido via correios com AR",
    icon: Send,
    requires: {
      attachment: true,
      attachmentLabel: "Comprovante AR",
      protocol: true,
      trackingCode: true,
    },
  },
  {
    id: "consulado",
    label: "Consulado",
    desc: "Via consulado italiano no Brasil",
    icon: MapPin,
    requires: {
      attachment: true,
      attachmentLabel: "Comprovante consular",
      protocol: true,
      observation: true,
      observationHint: "Setor consular, atendente",
    },
  },
]

// Custo estimado por tipo de documento (referência média de mercado)
const CUSTO_ESTIMADO: Record<string, number> = {
  CERTIDAO_NASCIMENTO: 80,
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: 150,
  CERTIDAO_CASAMENTO: 80,
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: 150,
  CERTIDAO_OBITO: 80,
  CERTIDAO_OBITO_INTEIRO_TEOR: 150,
  CERTIDAO_BATISMO: 50,
}

const FORMAS_PAGAMENTO: Array<{ id: string; label: string }> = [
  { id: "pix", label: "PIX" },
  { id: "boleto", label: "Boleto" },
  { id: "debito", label: "Débito automático" },
  { id: "dinheiro", label: "Dinheiro (balcão)" },
  { id: "cortesia", label: "Cortesia / isento" },
]

const TIPO_LABEL: Record<string, string> = {
  CERTIDAO_NASCIMENTO: "Certidão de Nascimento",
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: "Certidão de Nascimento (Inteiro Teor)",
  CERTIDAO_CASAMENTO: "Certidão de Casamento",
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: "Certidão de Casamento (Inteiro Teor)",
  CERTIDAO_OBITO: "Certidão de Óbito",
  CERTIDAO_OBITO_INTEIRO_TEOR: "Certidão de Óbito (Inteiro Teor)",
  CERTIDAO_BATISMO: "Certidão de Batismo",
}

interface DocSnapshot {
  id: number
  tipo: string
  cartorio: string | null
  livro: string | null
  folha: string | null
  termo: string | null
  nome_registrado: string | null
  data_evento: string | null
  pessoa: { id: number; nome: string; sobrenome: string | null } | null
  // Já salvos da etapa atual (se editor já tiver sido aberto antes)
  canal_solicitacao: string | null
  protocolo: string | null
  nro_pedido: string | null
  link_acompanhamento: string | null
  observacoes: string | null
}

interface SolicitarFormState {
  canal: CanalId | null
  attachmentUrl: string
  protocolo: string
  trackingCode: string
  observacao: string
  externalEntityName: string
  costPaid: string
  paymentMethod: string
}

const emptySolicitarForm = (): SolicitarFormState => ({
  canal: null,
  attachmentUrl: "",
  protocolo: "",
  trackingCode: "",
  observacao: "",
  externalEntityName: "",
  costPaid: "",
  paymentMethod: "",
})

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

// Recomendação de canal — heurística simples
function getRecomendacao(doc: DocSnapshot): { canal: CanalId; razao: string } {
  // Por enquanto, sem tabela de canais por cartório → e-mail como default formal
  if (!doc.cartorio) {
    return {
      canal: "email",
      razao: "Cartório ainda não definido — e-mail é o canal mais formal e auditável.",
    }
  }
  // Heurística: nomes que indicam cartório moderno → CRC
  const cartorioLower = doc.cartorio.toLowerCase()
  if (cartorioLower.includes("são paulo") || cartorioLower.includes("rio de janeiro")) {
    return {
      canal: "crc",
      razao: "Cartórios de capital geralmente têm integração CRC ativa — mais rápido e rastreável.",
    }
  }
  return {
    canal: "email",
    razao: "Cartório sem canal automatizável conhecido — e-mail é o mais formal.",
  }
}

export function EditorSolicitarCertidao({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
}: StepEditorBaseProps) {
  const [doc, setDoc] = useState<DocSnapshot | null>(null)
  const [form, setForm] = useState<SolicitarFormState>(emptySolicitarForm())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const readOnly = stepStatus === "concluida"

  // Carrega doc + step
  const carregar = useCallback(async () => {
    if (!documentoId || !isOpen) return
    setLoading(true)
    try {
      // Doc
      const resDoc = await fetch(`/api/documentos/${documentoId}`, { headers: authHeader() })
      if (resDoc.ok) {
        const d = await resDoc.json()
        const snap: DocSnapshot = {
          id: d.id,
          tipo: d.tipo,
          cartorio: d.cartorio,
          livro: d.livro,
          folha: d.folha,
          termo: d.termo,
          nome_registrado: d.nome_registrado,
          data_evento: d.data_evento,
          pessoa: d.pessoa
            ? { id: d.pessoa.id, nome: d.pessoa.nome, sobrenome: d.pessoa.sobrenome }
            : null,
          canal_solicitacao: d.canal_solicitacao,
          protocolo: d.protocolo,
          nro_pedido: d.nro_pedido,
          link_acompanhamento: d.link_acompanhamento,
          observacoes: d.observacoes,
        }
        setDoc(snap)

        // Carrega step pra recuperar detalhes do envio se já tiver sido salvo
        const resWf = await fetch(`/api/documentos/${documentoId}/workflow`, {
          headers: authHeader(),
        })
        let stepData: {
          externalEntityName?: string | null
          costPaid?: string | number | null
          paymentMethod?: string | null
          trackingCode?: string | null
          externalProtocol?: string | null
        } = {}
        if (resWf.ok) {
          const wfData = await resWf.json()
          stepData =
            wfData.workflow?.steps?.find((s: { id: number }) => s.id === stepId) || {}
        }

        // Determina canal salvo (se houver) — só aceita se for canal válido
        const canalSalvo = (snap.canal_solicitacao || "").toLowerCase()
        const canalValido = CANAIS.find((c) => c.id === canalSalvo)?.id || null

        // ✅ PRÉ-SELEÇÃO: se não há canal salvo, usa o recomendado
        // (mesma lógica do HTML — assim as seções "Evidências" e
        //  "Detalhes do envio" aparecem automaticamente ao abrir)
        const canalInicial = canalValido || getRecomendacao(snap).canal

        setForm({
          canal: canalInicial,
          attachmentUrl: snap.link_acompanhamento || "",
          protocolo: snap.protocolo || stepData.externalProtocol || "",
          trackingCode: stepData.trackingCode || "",
          observacao: snap.observacoes || "",
          externalEntityName: stepData.externalEntityName || "",
          costPaid: stepData.costPaid != null ? String(stepData.costPaid) : "",
          paymentMethod: stepData.paymentMethod || "",
        })
      }
    } catch (e) {
      console.warn("[EditorSolicitarCertidao] carregar:", e)
    } finally {
      setLoading(false)
    }
  }, [documentoId, isOpen, stepId])

  useEffect(() => {
    if (isOpen) carregar()
  }, [isOpen, carregar])

  const canalConfig = form.canal ? CANAIS.find((c) => c.id === form.canal)! : null
  const recomendacao = doc ? getRecomendacao(doc) : null

  // Validação completa
  const errosValidacao: string[] = []
  if (!canalConfig) {
    errosValidacao.push("Selecione um canal de solicitação")
  } else {
    const r = canalConfig.requires
    if (r.attachment && !form.attachmentUrl.trim()) {
      errosValidacao.push(`${r.attachmentLabel} (anexo)`)
    }
    if (r.protocol && !form.protocolo.trim()) {
      errosValidacao.push("Número do protocolo")
    }
    if (r.trackingCode && !form.trackingCode.trim()) {
      errosValidacao.push("Código de rastreio")
    }
    if (r.observation && !form.observacao.trim()) {
      errosValidacao.push("Observação")
    }
  }
  const podeConcluir = errosValidacao.length === 0

  const handleSalvar = async () => {
    if (readOnly) return
    if (!podeConcluir) {
      alert("Falta preencher:\n• " + errosValidacao.join("\n• "))
      return
    }

    // ⚡ fecha o modal e comemora NA HORA; o salvamento roda em 2º plano
    onClose()
    void celebrar()

    setSaving(true)
    try {
      // PUT no doc
      const okDoc = await putDocumento(documentoId, {
        canal_solicitacao: form.canal,
        protocolo: form.protocolo.trim() || null,
        link_acompanhamento: form.attachmentUrl.trim() || null,
        observacoes: form.observacao.trim() || null,
        status: "SOLICITADO",
      })
      if (!okDoc) throw new Error("PUT doc falhou")

      // PATCH no step com todos os detalhes
      const cost = parseFloat(form.costPaid.replace(",", "."))
      const okStep = await patchStep(documentoId, stepId, {
        status: "concluida",
        completedById: getUserId(),
        requestChannel: form.canal,
        externalProtocol: form.protocolo.trim() || null,
        trackingCode: form.trackingCode.trim() || null,
        externalEntityName: form.externalEntityName.trim() || null,
        costPaid: !isNaN(cost) ? cost : null,
        paymentMethod: form.paymentMethod || null,
        notes: form.observacao.trim() || null,
      })
      if (!okStep) console.warn("[EditorSolicitarCertidao] step não concluiu")

      onSaved?.()
    } catch (e) {
      console.error("[EditorSolicitarCertidao] salvar:", e)
      alert("A etapa foi marcada, mas houve erro ao salvar no servidor. Atualize a página e confira. (console)")
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  const tipoLabel = doc ? TIPO_LABEL[doc.tipo] || doc.tipo : ""
  const pessoaNome = doc?.pessoa
    ? `${doc.pessoa.nome}${doc.pessoa.sobrenome ? " " + doc.pessoa.sobrenome : ""}`
    : "—"
  const custoEstimado = doc ? CUSTO_ESTIMADO[doc.tipo] || 100 : 0

  // Dados registrais já localizados?
  const temDadosRegistrais = doc && (doc.livro || doc.folha || doc.termo)
  const refTxt = doc
    ? [
        doc.livro ? `Livro ${doc.livro}` : null,
        doc.folha ? `Folha ${doc.folha}` : null,
        doc.termo ? `Termo ${doc.termo}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : ""

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title={doc ? `Solicitar certidão — ${tipoLabel}` : "Solicitar certidão"}
      subtitle={
        doc
          ? `${pessoaNome} · ${doc.cartorio || "(cartório a definir)"} · custo estimado: ${fmtBRL(custoEstimado)}`
          : "Carregando…"
      }
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-white/5 rounded-md disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving || readOnly || !podeConcluir}
            className="px-5 py-2 text-[12.5px] font-semibold bg-red-500 hover:bg-red-600 disabled:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2"
            title={!podeConcluir ? "Falta: " + errosValidacao.join(", ") : ""}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Confirmar envio · concluir etapa
          </button>
        </div>
      }
    >
      <ReadOnlyBanner stepStatus={stepStatus} />

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-white/50" />
        </div>
      ) : doc ? (
        <>
          {/* ========================================================== */}
          {/* RESUMO DO PEDIDO                                            */}
          {/* ========================================================== */}
          <div className="mb-5 rounded-xl border border-indigo-500/25 bg-indigo-500/5 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-indigo-500/20 bg-indigo-500/10 flex items-center gap-2">
              <span className="text-[16px]">📋</span>
              <span className="text-[12px] uppercase font-bold tracking-wider text-indigo-200">
                Resumo do pedido
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 p-4">
              {/* Card DOCUMENTO */}
              <ResumoCard label="Documento">
                <div className="text-[13px] font-semibold text-white leading-tight">
                  {tipoLabel}
                </div>
                <div className="text-[11px] text-white/60 mt-1">
                  Custo estimado:{" "}
                  <strong className="text-white/85">{fmtBRL(custoEstimado)}</strong>
                </div>
              </ResumoCard>

              {/* Card PESSOA */}
              <ResumoCard label="Pessoa">
                <div className="text-[13px] font-semibold text-white leading-tight">
                  {pessoaNome}
                </div>
                <div className="text-[11px] text-white/60 mt-1">
                  Sujeito do registro
                </div>
              </ResumoCard>

              {/* Card CARTÓRIO */}
              <ResumoCard label="Cartório">
                <div className="text-[13px] font-semibold text-white leading-tight">
                  {doc.cartorio || "—"}
                </div>
                <div className="text-[11px] text-white/60 mt-1">
                  SLA típico: <strong className="text-white/85">~30d</strong>
                </div>
              </ResumoCard>

              {/* Card DADOS REGISTRAIS */}
              <ResumoCard
                label={
                  temDadosRegistrais ? "Dados registrais (já localizados)" : "Dados registrais"
                }
              >
                {temDadosRegistrais ? (
                  <>
                    <div className="text-[13px] font-semibold text-white leading-tight">
                      {refTxt}
                    </div>
                    {doc.nome_registrado && (
                      <div className="text-[10.5px] text-white/55 mt-1 truncate">
                        Nome registrado: {doc.nome_registrado}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[12px] text-amber-300/85 italic">
                    Não localizados na etapa anterior
                  </div>
                )}
              </ResumoCard>
            </div>

            {/* Histórico Discovery × cartório (placeholder por enquanto) */}
            <div className="px-4 pb-3">
              <div className="text-[10.5px] text-white/45 leading-relaxed">
                📊 Histórico Discovery × {doc.cartorio || "este cartório"}:{" "}
                <span className="italic">cálculo de insights na próxima rodada</span>
              </div>
            </div>

            {/* Recomendação */}
            {recomendacao && (
              <div className="px-4 pb-4">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-3">
                  <span className="text-[18px] mt-0.5">💡</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-amber-200 mb-0.5">
                      Recomendação: canal{" "}
                      <strong className="text-white">
                        {CANAIS.find((c) => c.id === recomendacao.canal)?.label}
                      </strong>
                    </div>
                    <div className="text-[11px] text-white/70 leading-relaxed">
                      {recomendacao.razao}
                    </div>
                  </div>
                  {!readOnly && form.canal !== recomendacao.canal && (
                    <button
                      onClick={() => setForm({ ...form, canal: recomendacao.canal })}
                      className="text-[10.5px] font-semibold px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded border border-amber-500/30 whitespace-nowrap"
                    >
                      Usar este
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ========================================================== */}
          {/* CANAL DE SOLICITAÇÃO                                        */}
          {/* ========================================================== */}
          <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-1.5">
            1. Canal de solicitação
          </div>
          <div className="text-[11px] italic text-white/45 mb-3">
            Cada canal exige evidências diferentes — os campos abaixo se ajustam à sua escolha.
          </div>

          <div className="grid grid-cols-2 gap-2 mb-5">
            {CANAIS.map((canal) => {
              const Icon = canal.icon
              const isSelected = form.canal === canal.id
              return (
                <button
                  key={canal.id}
                  onClick={() => !readOnly && setForm({ ...form, canal: canal.id })}
                  disabled={readOnly}
                  className={`px-3 py-2.5 rounded-md border text-left transition-all disabled:cursor-not-allowed ${
                    isSelected
                      ? "border-blue-500/60 bg-blue-500/15 ring-1 ring-blue-500/40"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-blue-300" : "text-white/60"}`} />
                    <span className={`text-[12px] font-semibold ${isSelected ? "text-white" : "text-white/80"}`}>
                      {canal.label}
                    </span>
                    {isSelected && <Check className="w-3 h-3 text-blue-300 ml-auto" />}
                  </div>
                  <div className="text-[10px] text-white/55 leading-snug">{canal.desc}</div>
                </button>
              )
            })}
          </div>

          {/* ========================================================== */}
          {/* EVIDÊNCIAS DO CANAL                                         */}
          {/* ========================================================== */}
          {canalConfig && (
            <>
              <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-3">
                2. Evidências obrigatórias para canal &quot;{canalConfig.label}&quot;
              </div>

              <div className="space-y-3 mb-5">
                {/* Anexo */}
                {canalConfig.requires.attachment && (
                  <FileUploadField
                    label={`📎 ${canalConfig.requires.attachmentLabel}`}
                    required
                    invalid={!form.attachmentUrl.trim()}
                    value={form.attachmentUrl}
                    onChange={(url) => setForm({ ...form, attachmentUrl: url })}
                    disabled={readOnly}
                    prefix={`documentos/${documentoId}/solicitacao`}
                  />
                )}

                {/* Protocolo */}
                {canalConfig.requires.protocol && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label className="text-[10px] uppercase font-semibold tracking-wider text-white/55">
                        🏷 Número do protocolo
                      </label>
                      <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        obrigatório
                      </span>
                    </div>
                    <input
                      type="text"
                      value={form.protocolo}
                      onChange={(e) => setForm({ ...form, protocolo: e.target.value })}
                      placeholder="Número retornado pelo canal"
                      disabled={readOnly}
                      className={form.protocolo.trim() ? inputCls : inputClsInvalid}
                    />
                  </div>
                )}

                {/* Tracking code (correios) */}
                {canalConfig.requires.trackingCode && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label className="text-[10px] uppercase font-semibold tracking-wider text-white/55">
                        📦 Código de rastreio
                      </label>
                      <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        obrigatório
                      </span>
                    </div>
                    <input
                      type="text"
                      value={form.trackingCode}
                      onChange={(e) => setForm({ ...form, trackingCode: e.target.value })}
                      placeholder="ex: BR123456789XX"
                      disabled={readOnly}
                      className={form.trackingCode.trim() ? inputCls : inputClsInvalid}
                    />
                  </div>
                )}

                {/* Observação */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <label className="text-[10px] uppercase font-semibold tracking-wider text-white/55">
                      📝 Observação
                    </label>
                    {canalConfig.requires.observation ? (
                      <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        obrigatória
                      </span>
                    ) : (
                      <span className="text-[8.5px] uppercase tracking-wider text-white/40">
                        opcional
                      </span>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    value={form.observacao}
                    onChange={(e) => setForm({ ...form, observacao: e.target.value })}
                    placeholder={
                      canalConfig.requires.observationHint || "Detalhes do envio…"
                    }
                    disabled={readOnly}
                    className={`${
                      canalConfig.requires.observation && !form.observacao.trim()
                        ? inputClsInvalid
                        : inputCls
                    } resize-none`}
                  />
                </div>
              </div>

              {/* ========================================================== */}
              {/* DETALHES DO ENVIO                                           */}
              {/* ========================================================== */}
              <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-3">
                3. Detalhes do envio
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nome do cartório / atendente</Label>
                  <input
                    type="text"
                    value={form.externalEntityName}
                    onChange={(e) =>
                      setForm({ ...form, externalEntityName: e.target.value })
                    }
                    placeholder="ex: 2º Cartório / João Silva"
                    disabled={readOnly}
                    className={inputCls}
                  />
                </div>

                <div>
                  <Label>Prazo esperado (SLA do cartório)</Label>
                  <input
                    type="text"
                    value="~30 dias úteis"
                    disabled
                    className="w-full px-3 py-2 bg-white/3 border border-white/10 rounded-md text-sm text-white/50 cursor-not-allowed"
                  />
                </div>

                <div>
                  <Label>Custo cobrado pelo cartório (R$)</Label>
                  <input
                    type="text"
                    value={form.costPaid}
                    onChange={(e) => setForm({ ...form, costPaid: e.target.value })}
                    placeholder="ex: 380,00"
                    disabled={readOnly}
                    className={inputCls}
                  />
                </div>

                <div>
                  <Label>Forma de pagamento</Label>
                  <select
                    value={form.paymentMethod}
                    onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                    disabled={readOnly}
                    className={inputCls}
                  >
                    <option value="" className="bg-slate-800">
                      — Selecione —
                    </option>
                    {FORMAS_PAGAMENTO.map((fp) => (
                      <option key={fp.id} value={fp.id} className="bg-slate-800">
                        {fp.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="py-12 text-center text-white/55">
          Documento não encontrado.
        </div>
      )}
    </EditorShell>
  )
}

// --- helper local ao editor: card do Resumo do Pedido
function ResumoCard({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-[9.5px] uppercase font-bold tracking-wider text-white/45 mb-1.5">
        {label}
      </div>
      {children}
    </div>
  )
}

// ============================================================
// ETAPA 3: AGUARDAR RETORNO DO CARTÓRIO
// ============================================================

// ============================================================
// ETAPA 3: AGUARDAR RETORNO DO CARTÓRIO
// ============================================================
//
// Estrutura inspirada no HTML de referência do Marco:
//   - Resumo da solicitação (read-only, dados recuperados da Etapa 2)
//   - Histórico de contatos (follow-ups) com cartório
//   - Formulário inline pra adicionar novo contato
//   - Código de rastreio (correios/sedex/motoboy)
//
// Os follow-ups são salvos em step.notes em formato linha-por-linha:
//   [2026-05-26 14:30] LIGACAO: Maria atendeu, pediu 7 dias úteis
//   [2026-06-02 09:15] WHATSAPP: Confirmaram que documento foi assinado
//
// Isso evita migração de schema agora. Quando criarmos WorkflowStepComment
// numa rodada futura, dá pra migrar os existentes via parsing simples.

type FollowupKind = "LIGACAO" | "EMAIL" | "WHATSAPP" | "CARTORIO" | "CORREIOS" | "OUTRO"

interface Followup {
  iso: string
  date: string
  time: string
  kind: FollowupKind
  description: string
}

const FOLLOWUP_KINDS: {
  value: FollowupKind
  label: string
  icon: string
  pillClass: string
}[] = [
  { value: "LIGACAO", label: "Ligação", icon: "📞", pillClass: "bg-indigo-500/20 text-indigo-200 border-indigo-500/30" },
  { value: "EMAIL", label: "E-mail", icon: "📧", pillClass: "bg-blue-500/20 text-blue-200 border-blue-500/30" },
  { value: "WHATSAPP", label: "WhatsApp", icon: "💬", pillClass: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30" },
  { value: "CARTORIO", label: "Cartório presencial", icon: "🏛", pillClass: "bg-amber-500/20 text-amber-200 border-amber-500/30" },
  { value: "CORREIOS", label: "Correios", icon: "📬", pillClass: "bg-rose-500/20 text-rose-200 border-rose-500/30" },
  { value: "OUTRO", label: "Outro", icon: "🔔", pillClass: "bg-white/10 text-white/80 border-white/20" },
]

function getFollowupMeta(kind: FollowupKind) {
  return FOLLOWUP_KINDS.find((k) => k.value === kind) || FOLLOWUP_KINDS[5]
}

function parseFollowups(notes: string): Followup[] {
  if (!notes) return []
  const lines = notes.split("\n").map((l) => l.trim()).filter(Boolean)
  const out: Followup[] = []
  const re = /^\[(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?\]\s+([A-Z_]+):\s*(.*)$/
  const validKinds: FollowupKind[] = ["LIGACAO", "EMAIL", "WHATSAPP", "CARTORIO", "CORREIOS", "OUTRO"]
  for (const line of lines) {
    const m = line.match(re)
    if (m) {
      const [, date, time = "00:00", kindStr, desc] = m
      const kind = validKinds.includes(kindStr as FollowupKind) ? (kindStr as FollowupKind) : "OUTRO"
      out.push({
        iso: `${date}T${time}:00`,
        date,
        time,
        kind,
        description: desc.trim(),
      })
    }
  }
  // Mais recente primeiro
  out.sort((a, b) => b.iso.localeCompare(a.iso))
  return out
}

function formatFollowupLine(date: string, kind: FollowupKind, desc: string): string {
  const time = new Date().toTimeString().slice(0, 5) // HH:mm local
  return `[${date} ${time}] ${kind}: ${desc.trim()}`
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface SolicitacaoSummary {
  atendente: string | null
  canal: string | null
  protocolo: string | null
  link: string | null
  observacao: string | null
  sentAt: string | null
  custoPago: number | null
  formaPagamento: string | null
  cartorio: string | null
}

const CANAL_LABEL: Record<string, string> = {
  crc: "🌐 CRC Nacional",
  ecartorio: "💻 E-cartório",
  email: "📧 E-mail",
  whatsapp: "💬 WhatsApp",
  balcao: "🏛 Balcão",
  comune_italiana: "🇮🇹 Comune italiana",
  correios: "📬 Correios",
  consulado: "🏛 Consulado",
}

const PAGAMENTO_LABEL: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  debito: "Débito",
  dinheiro: "Dinheiro",
  cortesia: "Cortesia",
}

export function EditorAguardarRetorno({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
}: StepEditorBaseProps) {
  const [trackingCode, setTrackingCode] = useState("")
  const [notes, setNotes] = useState("")
  const [solicit, setSolicit] = useState<SolicitacaoSummary | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  // Form pra adicionar follow-up
  const [newDate, setNewDate] = useState<string>(todayIso())
  const [newKind, setNewKind] = useState<FollowupKind>("LIGACAO")
  const [newDesc, setNewDesc] = useState("")
  const [addingFollowup, setAddingFollowup] = useState(false)

  const readOnly = stepStatus === "concluida"

  const carregar = useCallback(async () => {
    if (!documentoId || !stepId || !isOpen) return
    setLoading(true)
    try {
      const [resWf, resDoc] = await Promise.all([
        fetch(`/api/documentos/${documentoId}/workflow`, { headers: authHeader() }),
        fetch(`/api/documentos/${documentoId}`, { headers: authHeader() }),
      ])

      let currentStep: Record<string, unknown> | null = null
      let prevStep: Record<string, unknown> | null = null
      if (resWf.ok) {
        const d = await resWf.json()
        const steps = d.workflow?.steps || []
        currentStep = steps.find((s: { id: number }) => s.id === stepId) || null
        prevStep = steps.find((s: { stepKey: string }) => s.stepKey === "solicitar_certidao") || null
      }
      if (currentStep) {
        setTrackingCode((currentStep.trackingCode as string) || "")
        setNotes((currentStep.notes as string) || "")
      }

      let doc: Record<string, unknown> = {}
      if (resDoc.ok) doc = await resDoc.json()

      setSolicit({
        atendente: (prevStep?.externalEntityName as string) || null,
        cartorio: (doc.cartorio as string) || null,
        canal:
          (doc.canal_solicitacao as string) ||
          (prevStep?.requestChannel as string) ||
          null,
        protocolo:
          (doc.protocolo as string) ||
          (prevStep?.externalProtocol as string) ||
          null,
        link: (doc.link_acompanhamento as string) || null,
        observacao: (doc.observacoes as string) || null,
        sentAt:
          (prevStep?.completedAt as string) ||
          (prevStep?.startedAt as string) ||
          null,
        custoPago: (prevStep?.costPaid as number) ?? null,
        formaPagamento: (prevStep?.paymentMethod as string) || null,
      })
    } catch (e) {
      console.warn("[EditorAguardarRetorno]", e)
    } finally {
      setLoading(false)
    }
  }, [documentoId, stepId, isOpen])

  useEffect(() => {
    if (isOpen) carregar()
  }, [isOpen, carregar])

  const followups = parseFollowups(notes)

  const handleAddFollowup = async () => {
    if (readOnly) return
    if (!newDesc.trim()) {
      alert("Descreva o contato antes de adicionar.")
      return
    }
    setAddingFollowup(true)
    try {
      const line = formatFollowupLine(newDate, newKind, newDesc)
      const newNotes = notes ? `${notes}\n${line}` : line
      const ok = await patchStep(documentoId, stepId, { notes: newNotes })
      if (!ok) throw new Error("PATCH falhou")
      setNotes(newNotes)
      setNewDesc("")
      setNewKind("LIGACAO")
      setNewDate(todayIso())
      onSaved?.()
    } catch (e) {
      console.error("[EditorAguardarRetorno] addFollowup:", e)
      alert("Erro ao adicionar contato. Veja o console.")
    } finally {
      setAddingFollowup(false)
    }
  }

  const handleSalvar = async (concluir: boolean) => {
    if (readOnly) return

    // ⚡ fecha na hora; comemora só quando CONCLUI a etapa
    onClose()
    if (concluir) void celebrar()

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        trackingCode: trackingCode.trim() || null,
        notes: notes.trim() || null,
      }
      if (concluir) {
        body.status = "concluida"
        body.completedById = getUserId()
      }
      const ok = await patchStep(documentoId, stepId, body)
      if (!ok) throw new Error("PATCH falhou")
      onSaved?.()
    } catch (e) {
      console.error("[EditorAguardarRetorno] salvar:", e)
      alert("Houve erro ao salvar no servidor. Atualize a página e confira. (console)")
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  const fmtDateTime = (iso: string | null) => {
    if (!iso) return "—"
    try {
      const d = new Date(iso)
      return d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    } catch {
      return iso
    }
  }

  const fmtRelative = (iso: string) => {
    try {
      const d = new Date(iso)
      const diffMs = Date.now() - d.getTime()
      const diffH = Math.floor(diffMs / (1000 * 60 * 60))
      const diffD = Math.floor(diffH / 24)
      if (diffD === 0 && diffH === 0) return "agora há pouco"
      if (diffD === 0) return `há ${diffH}h`
      if (diffD === 1) return "ontem"
      if (diffD < 7) return `há ${diffD} dias`
      return d.toLocaleDateString("pt-BR")
    } catch {
      return iso
    }
  }

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Aguardar retorno do cartório"
      subtitle="Acompanhe a solicitação e registre os contatos feitos com o cartório enquanto espera o retorno."
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-white/5 rounded-md disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => handleSalvar(false)}
            disabled={saving || readOnly}
            className="px-4 py-2 text-[12.5px] font-semibold bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white rounded-md"
          >
            Salvar (sem concluir)
          </button>
          <button
            onClick={() => handleSalvar(true)}
            disabled={saving || readOnly}
            className="px-5 py-2 text-[12.5px] font-semibold bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Confirmar retorno · concluir etapa
          </button>
        </div>
      }
    >
      <ReadOnlyBanner stepStatus={stepStatus} />

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-white/50" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ═══════════════════════════════════════════════════════
              1. RESUMO DA SOLICITAÇÃO (read-only, vem da Etapa 2)
             ═══════════════════════════════════════════════════════ */}
          {solicit && (
            <div className="rounded-lg border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-blue-500/5 overflow-hidden">
              <div className="px-3.5 py-2 bg-indigo-500/15 border-b border-indigo-500/20 flex items-center gap-2">
                <Send className="w-3.5 h-3.5 text-indigo-200" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-100">
                  Resumo da solicitação
                </span>
              </div>
              <div className="p-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
                <SummaryField label="Cartório" value={solicit.cartorio} />
                <SummaryField
                  label="Canal"
                  value={
                    solicit.canal
                      ? CANAL_LABEL[solicit.canal] || solicit.canal
                      : null
                  }
                />
                <SummaryField label="Atendente" value={solicit.atendente} />
                <SummaryField label="Protocolo" value={solicit.protocolo} mono />
                <SummaryField label="Enviado em" value={fmtDateTime(solicit.sentAt)} />
                <SummaryField
                  label="Custo pago"
                  value={
                    solicit.custoPago != null
                      ? `R$ ${solicit.custoPago.toFixed(2).replace(".", ",")}${
                          solicit.formaPagamento
                            ? ` · ${PAGAMENTO_LABEL[solicit.formaPagamento] || solicit.formaPagamento}`
                            : ""
                        }`
                      : null
                  }
                />
                {solicit.link && (
                  <div className="col-span-2">
                    <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">
                      Link de acompanhamento
                    </div>
                    <a
                      href={solicit.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-blue-300 hover:text-blue-200 hover:underline inline-flex items-center gap-1 break-all"
                    >
                      {solicit.link}
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    </a>
                  </div>
                )}
                {solicit.observacao && (
                  <div className="col-span-2">
                    <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">
                      Observação da solicitação
                    </div>
                    <div className="text-[12px] text-white/80 italic">
                      &ldquo;{solicit.observacao}&rdquo;
                    </div>
                  </div>
                )}
              </div>
              {!solicit.canal && !solicit.protocolo && !solicit.atendente && (
                <div className="px-3.5 py-2 border-t border-indigo-500/20 text-[11px] text-amber-200 bg-amber-500/5 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  Solicitação ainda não preenchida na Etapa 2. Reabra a etapa anterior para preencher.
                </div>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              2. HISTÓRICO DE CONTATOS (timeline de follow-ups)
             ═══════════════════════════════════════════════════════ */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/55 flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5" />
                Histórico de contatos
                {followups.length > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/10 text-white/70">
                    {followups.length}
                  </span>
                )}
              </div>
            </div>

            {followups.length === 0 ? (
              <div className="px-3 py-4 rounded-md bg-white/5 border border-dashed border-white/15 text-center">
                <div className="text-[11.5px] text-white/55 italic">
                  Nenhum contato registrado ainda.
                </div>
                <div className="text-[10.5px] text-white/40 mt-0.5">
                  Use o formulário abaixo para registrar ligações, e-mails ou visitas.
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {followups.map((f, i) => {
                  const meta = getFollowupMeta(f.kind)
                  return (
                    <div
                      key={`${f.iso}-${i}`}
                      className="rounded-md border border-white/10 bg-white/5 p-2.5"
                    >
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span
                          className={`text-[10.5px] font-semibold px-2 py-0.5 rounded border ${meta.pillClass} inline-flex items-center gap-1`}
                        >
                          <span>{meta.icon}</span>
                          <span>{meta.label}</span>
                        </span>
                        <span className="text-[10.5px] text-white/60 font-mono">
                          {f.date.split("-").reverse().join("/")} · {f.time}
                        </span>
                        <span className="text-[10px] text-white/40">
                          ({fmtRelative(f.iso)})
                        </span>
                      </div>
                      <div className="text-[12.5px] text-white/85 leading-snug whitespace-pre-wrap">
                        {f.description}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════
              3. ADICIONAR NOVO CONTATO
             ═══════════════════════════════════════════════════════ */}
          {!readOnly && (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-200 mb-2.5 flex items-center gap-1.5">
                <span>+</span>
                <span>Adicionar contato</span>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-2.5">
                <div>
                  <Label>Data</Label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    max={todayIso()}
                    className={inputCls}
                  />
                </div>
                <div>
                  <Label>Tipo de contato</Label>
                  <select
                    value={newKind}
                    onChange={(e) => setNewKind(e.target.value as FollowupKind)}
                    className={inputCls}
                  >
                    {FOLLOWUP_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.icon} {k.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mb-2.5">
                <Label>Descrição do contato</Label>
                <textarea
                  rows={2}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Ex: Maria atendeu, pediu 7 dias úteis. Vai retornar até sexta."
                  className={`${inputCls} resize-none`}
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleAddFollowup}
                  disabled={addingFollowup || !newDesc.trim()}
                  className="px-3.5 py-1.5 text-[11.5px] font-semibold bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-1.5"
                >
                  {addingFollowup ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <span>+</span>
                  )}
                  Adicionar contato
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              4. CÓDIGO DE RASTREIO (correios/sedex/motoboy)
             ═══════════════════════════════════════════════════════ */}
          <div>
            <Label>Código de rastreio (Correios, Sedex, motoboy)</Label>
            <input
              type="text"
              value={trackingCode}
              onChange={(e) => setTrackingCode(e.target.value)}
              placeholder="ex: BR123456789BR"
              disabled={readOnly}
              className={`${inputCls} font-mono`}
            />
            <div className="text-[10.5px] text-white/40 mt-1 italic">
              Opcional. Use só quando a entrega é por transportadora física.
            </div>
          </div>
        </div>
      )}
    </EditorShell>
  )
}

function SummaryField({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  return (
    <div>
      <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">
        {label}
      </div>
      <div
        className={`text-[12px] ${mono ? "font-mono" : ""} ${
          value ? "text-white/90" : "text-white/30 italic"
        }`}
      >
        {value || "—"}
      </div>
    </div>
  )
}

// ============================================================
// ETAPA 4: RECEBER CERTIDÃO
// ============================================================

// ============================================================
// ETAPA 4: RECEBER CERTIDÃO (upload + tipo de mídia)
// ============================================================
//
// Inspirado no openReceiveCertificateModal do HTML do Marco:
//   - Upload obrigatório do PDF/imagem (já implementado via FileUploadField)
//   - Tipo de mídia: Físico (papel) / Digital (eletrônico) / Ambos
//   - Localização física: aparece SÓ se mídia = Físico ou Ambos
//   - Observação do recebimento

type DocumentMedium = "fisico" | "digital" | "ambos"

const MEDIUM_OPTIONS: {
  value: DocumentMedium
  icon: string
  label: string
  desc: string
}[] = [
  {
    value: "fisico",
    icon: "📄",
    label: "Físico (papel original)",
    desc: "Recebido por correio ou balcão · precisa ser guardado e digitalizado",
  },
  {
    value: "digital",
    icon: "💻",
    label: "Digital (PDF eletrônico)",
    desc: "Certidão eletrônica com assinatura digital · não há papel",
  },
  {
    value: "ambos",
    icon: "📄💻",
    label: "Ambos",
    desc: "Recebido em papel + também há versão eletrônica",
  },
]

export function EditorReceberCertidao({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
}: StepEditorBaseProps) {
  const [arquivoUrl, setArquivoUrl] = useState("")
  const [arquivoNome, setArquivoNome] = useState("")
  const [arquivoTamanho, setArquivoTamanho] = useState<number | null>(null)
  const [arquivoMime, setArquivoMime] = useState<string | null>(null)
  const [medium, setMedium] = useState<DocumentMedium | null>(null)
  const [physicalLocation, setPhysicalLocation] = useState("")
  const [observacao, setObservacao] = useState("")
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const readOnly = stepStatus === "concluida"

  const carregar = useCallback(async () => {
    if (!documentoId || !stepId || !isOpen) return
    setLoading(true)
    try {
      const [resDoc, resWf] = await Promise.all([
        fetch(`/api/documentos/${documentoId}`, { headers: authHeader() }),
        fetch(`/api/documentos/${documentoId}/workflow`, { headers: authHeader() }),
      ])
      if (resDoc.ok) {
        const d = await resDoc.json()
        setArquivoUrl(d.arquivo_url || "")
        setArquivoNome(d.arquivo_nome || "")
        setArquivoTamanho(d.arquivo_tamanho ?? null)
        setArquivoMime(d.arquivo_mime_type ?? null)
        setPhysicalLocation(d.localizacao_fisica || "")
      }
      if (resWf.ok) {
        const d = await resWf.json()
        const step = d.workflow?.steps?.find((s: { id: number }) => s.id === stepId)
        if (step) {
          setMedium((step.documentMedium as DocumentMedium) || null)
          if (step.physicalLocation) setPhysicalLocation(step.physicalLocation)
          if (step.stepObservation) setObservacao(step.stepObservation)
        }
      }
    } catch (e) {
      console.warn("[EditorReceberCertidao]", e)
    } finally {
      setLoading(false)
    }
  }, [documentoId, stepId, isOpen])

  useEffect(() => {
    if (isOpen) carregar()
  }, [isOpen, carregar])

  const showPhysicalLocation = medium === "fisico" || medium === "ambos"
  const podeConcluir =
    arquivoUrl.trim().length > 0 &&
    medium !== null

  const handleSalvar = async () => {
    if (readOnly) return
    if (!arquivoUrl.trim()) {
      alert("Anexe o arquivo recebido antes de concluir.")
      return
    }
    if (!medium) {
      alert("Marque se o documento é físico, digital ou ambos.")
      return
    }
    // ⚡ fecha o modal e comemora NA HORA; salva em 2º plano
    onClose()
    void celebrar()

    setSaving(true)
    try {
      // 1. Persiste no documento
      const okDoc = await putDocumento(documentoId, {
        arquivo_url: arquivoUrl.trim(),
        arquivo_nome: arquivoNome.trim() || "certidao.pdf",
        arquivo_tamanho: arquivoTamanho,
        arquivo_mime_type: arquivoMime,
        localizacao_fisica: showPhysicalLocation ? (physicalLocation.trim() || null) : null,
        status: "RECEBIDO",
      })
      if (!okDoc) throw new Error("PUT doc falhou")

      // 2. Persiste no step + conclui
      const okStep = await patchStep(documentoId, stepId, {
        status: "concluida",
        completedById: getUserId(),
        documentMedium: medium,
        physicalLocation: showPhysicalLocation ? (physicalLocation.trim() || null) : null,
        stepObservation: observacao.trim() || null,
      })
      if (!okStep) console.warn("[EditorReceberCertidao] step não concluiu")

      onSaved?.()
    } catch (e) {
      console.error("[EditorReceberCertidao] salvar:", e)
      alert("A etapa foi marcada, mas houve erro ao salvar no servidor. Atualize a página e confira. (console)")
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Receber certidão"
      subtitle="Anexe o arquivo recebido do cartório e marque se é físico, digital ou ambos."
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-white/5 rounded-md disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving || readOnly || !podeConcluir}
            className="px-5 py-2 text-[12.5px] font-semibold bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Confirmar recebimento · concluir etapa
          </button>
        </div>
      }
    >
      <ReadOnlyBanner stepStatus={stepStatus} />

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-white/50" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ═══════════════════════════════════════════════════════
              1. ANEXO DA CERTIDÃO
             ═══════════════════════════════════════════════════════ */}
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-2">
              1. Anexo da certidão
            </div>
            <FileUploadField
              label="Arquivo da certidão"
              required
              invalid={!arquivoUrl.trim()}
              value={arquivoUrl}
              onChange={(url, meta) => {
                setArquivoUrl(url)
                if (meta) {
                  setArquivoNome(meta.name)
                  setArquivoTamanho(meta.size)
                  setArquivoMime(meta.type)
                } else if (!url) {
                  setArquivoNome("")
                  setArquivoTamanho(null)
                  setArquivoMime(null)
                }
              }}
              disabled={readOnly}
              prefix={`documentos/${documentoId}/certidao`}
            />
          </div>

          {/* ═══════════════════════════════════════════════════════
              2. TIPO DE MÍDIA (obrigatório)
             ═══════════════════════════════════════════════════════ */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <div className="text-[10px] uppercase font-bold tracking-wider text-white/45">
                2. Tipo de mídia
              </div>
              <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                obrigatório
              </span>
            </div>
            <div className="text-[11px] text-white/55 mb-2 leading-snug">
              Marque se a certidão recebida é física (papel original) ou digital (arquivo eletrônico com assinatura).
            </div>
            <div className="grid gap-2">
              {MEDIUM_OPTIONS.map((opt) => {
                const ativo = medium === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => !readOnly && setMedium(opt.value)}
                    disabled={readOnly}
                    className={`text-left px-3.5 py-2.5 rounded-md border transition-all disabled:cursor-not-allowed ${
                      ativo
                        ? "border-emerald-500/60 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          ativo
                            ? "border-emerald-400 bg-emerald-500"
                            : "border-white/30 bg-transparent"
                        }`}
                      >
                        {ativo && (
                          <div className="w-2 h-2 rounded-full bg-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-[12.5px] font-semibold flex items-center gap-1.5 ${
                            ativo ? "text-emerald-100" : "text-white/85"
                          }`}
                        >
                          <span>{opt.icon}</span>
                          <span>{opt.label}</span>
                        </div>
                        <div className="text-[10.5px] text-white/55 mt-0.5 leading-snug">
                          {opt.desc}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              3. LOCALIZAÇÃO FÍSICA (condicional)
             ═══════════════════════════════════════════════════════ */}
          {showPhysicalLocation && (
            <div className="p-3 rounded-lg border border-amber-500/25 bg-amber-500/5">
              <Label>📍 Localização física do papel</Label>
              <input
                type="text"
                value={physicalLocation}
                onChange={(e) => setPhysicalLocation(e.target.value)}
                placeholder="ex: Pasta 23 · Arquivo Discovery · prateleira 4"
                disabled={readOnly}
                className={inputCls}
              />
              <div className="text-[10.5px] text-white/55 mt-1.5 italic leading-snug">
                Onde o documento físico está guardado fisicamente no escritório? Essencial pra recuperação futura.
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              4. OBSERVAÇÃO
             ═══════════════════════════════════════════════════════ */}
          <div>
            <Label>Observação do recebimento</Label>
            <textarea
              rows={3}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Recebido por correios em 28/05/2026, sem avarias..."
              disabled={readOnly}
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>
      )}
    </EditorShell>
  )
}

// ============================================================
// ETAPA 5: CONFERIR CERTIDÃO (dados literais + checklist + resultado)
// ============================================================
//
// Inspirado no openReviewCertificateModal do HTML do Marco:
//   1. Dados literais: nome do titular, pai, mãe, cônjuge, datas
//      "exatamente como aparecem na certidão" (vs o que está na árvore)
//   2. Hint de referência: mostra os nomes da árvore pro operador comparar
//   3. Checklist operacional: legibilidade, integridade, dados mínimos,
//      apostila Haia (se exigida), tradução juramentada (se exigida)
//   4. Resultado: Aprovado / Divergente / Nova via
//   5. Observação livre
//
// Os dados literais ficam no Documento (campos nome_registrado, pai_registrado,
// mae_registrada, conjuge_registrado, data_evento_documento, data_registro_documento).
// O checklist + observação ficam no WorkflowStep (reviewChecklist, stepObservation).

interface ReviewChecklist {
  legivel: boolean
  integro: boolean
  dados_minimos: boolean
  apostila_ok: boolean
  traducao_ok: boolean
}

const CHECKLIST_ITEMS: Array<{
  id: keyof ReviewChecklist
  label: string
  desc: string
}> = [
  {
    id: "legivel",
    label: "Legibilidade",
    desc: "Texto claro, sem rasuras, manchas ou áreas borradas.",
  },
  {
    id: "integro",
    label: "Integridade do documento",
    desc: "Sem páginas faltando, sem cortes. PDF abre sem corrupção.",
  },
  {
    id: "dados_minimos",
    label: "Dados mínimos presentes",
    desc: "Nome, data, cartório, livro/folha/termo visíveis.",
  },
  {
    id: "apostila_ok",
    label: "Apostila de Haia (se exigida)",
    desc: "Caso o destino exija apostila, ela está presente e legível. Marque também se NÃO for exigida.",
  },
  {
    id: "traducao_ok",
    label: "Tradução juramentada (se exigida)",
    desc: "Caso o destino exija tradução, ela está presente. Marque também se NÃO for exigida.",
  },
]

type ConferirResultado = "aprovado" | "divergente" | "nova_via"

interface PessoaSummary {
  nome: string | null
  sobrenome: string | null
  pai: { nome: string | null; sobrenome: string | null } | null
  mae: { nome: string | null; sobrenome: string | null } | null
}

const isCasamento = (tipo: string | null | undefined): boolean => {
  return !!tipo && tipo.includes("CASAMENTO")
}

function fullName(p: { nome: string | null; sobrenome: string | null } | null): string {
  if (!p) return ""
  return `${p.nome || ""} ${p.sobrenome || ""}`.trim()
}

export function EditorConferirCertidao({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
}: StepEditorBaseProps) {
  // Dados literais (do documento)
  const [nomeRegistrado, setNomeRegistrado] = useState("")
  const [paiRegistrado, setPaiRegistrado] = useState("")
  const [maeRegistrada, setMaeRegistrada] = useState("")
  const [conjugeRegistrado, setConjugeRegistrado] = useState("")
  const [dataEventoDoc, setDataEventoDoc] = useState("")
  const [dataRegistroDoc, setDataRegistroDoc] = useState("")

  // Contexto
  const [docTipo, setDocTipo] = useState<string | null>(null)
  const [arquivoUrl, setArquivoUrl] = useState<string | null>(null)
  const [arquivoNome, setArquivoNome] = useState<string | null>(null)
  const [pessoa, setPessoa] = useState<PessoaSummary | null>(null)

  // Checklist + resultado
  const [checklist, setChecklist] = useState<ReviewChecklist>({
    legivel: true,
    integro: true,
    dados_minimos: true,
    apostila_ok: false,
    traducao_ok: false,
  })
  const [resultado, setResultado] = useState<ConferirResultado | null>(null)
  const [observacao, setObservacao] = useState("")

  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const readOnly = stepStatus === "concluida"

  const carregar = useCallback(async () => {
    if (!documentoId || !stepId || !isOpen) return
    setLoading(true)
    try {
      const [resDoc, resWf] = await Promise.all([
        fetch(`/api/documentos/${documentoId}`, { headers: authHeader() }),
        fetch(`/api/documentos/${documentoId}/workflow`, { headers: authHeader() }),
      ])

      if (resDoc.ok) {
        const d = await resDoc.json()
        setDocTipo(d.tipo || null)
        setArquivoUrl(d.arquivo_url || null)
        setArquivoNome(d.arquivo_nome || null)
        setNomeRegistrado(d.nome_registrado || "")
        setPaiRegistrado(d.pai_registrado || "")
        setMaeRegistrada(d.mae_registrada || "")
        setConjugeRegistrado(d.conjuge_registrado || "")
        setDataEventoDoc(
          d.data_evento_documento ? d.data_evento_documento.slice(0, 10) : "",
        )
        setDataRegistroDoc(
          d.data_registro_documento ? d.data_registro_documento.slice(0, 10) : "",
        )
        if (d.pessoa) {
          setPessoa({
            nome: d.pessoa.nome || null,
            sobrenome: d.pessoa.sobrenome || null,
            pai: d.pessoa.pai
              ? { nome: d.pessoa.pai.nome, sobrenome: d.pessoa.pai.sobrenome }
              : null,
            mae: d.pessoa.mae
              ? { nome: d.pessoa.mae.nome, sobrenome: d.pessoa.mae.sobrenome }
              : null,
          })
        }
      }
      if (resWf.ok) {
        const d = await resWf.json()
        const step = d.workflow?.steps?.find((s: { id: number }) => s.id === stepId)
        if (step) {
          if (step.reviewChecklist) {
            setChecklist({
              legivel: !!step.reviewChecklist.legivel,
              integro: !!step.reviewChecklist.integro,
              dados_minimos: !!step.reviewChecklist.dados_minimos,
              apostila_ok: !!step.reviewChecklist.apostila_ok,
              traducao_ok: !!step.reviewChecklist.traducao_ok,
            })
          }
          if (step.reviewResult) {
            setResultado(step.reviewResult as ConferirResultado)
          }
          if (step.stepObservation) {
            setObservacao(step.stepObservation)
          }
        }
      }
    } catch (e) {
      console.warn("[EditorConferirCertidao]", e)
    } finally {
      setLoading(false)
    }
  }, [documentoId, stepId, isOpen])

  useEffect(() => {
    if (isOpen) carregar()
  }, [isOpen, carregar])

  const ehCasamento = isCasamento(docTipo)
  const podeConcluir = nomeRegistrado.trim().length > 0 && resultado !== null

  const handleSalvar = async () => {
    if (readOnly) return
    if (!nomeRegistrado.trim()) {
      alert("O nome do titular como aparece no documento é obrigatório.")
      return
    }
    if (!resultado) {
      alert("Escolha o resultado da conferência.")
      return
    }

    // ⚡ fecha o modal e comemora NA HORA; salva em 2º plano
    onClose()
    void celebrar()

    setSaving(true)
    try {
      // 1. Persiste dados literais no documento + status
      let docStatus: string | null = null
      if (resultado === "aprovado") docStatus = "RECEBIDO"
      else if (resultado === "divergente") docStatus = "RETIFICANDO"
      else if (resultado === "nova_via") docStatus = "SOLICITAR"

      const okDoc = await putDocumento(documentoId, {
        nome_registrado: nomeRegistrado.trim() || null,
        pai_registrado: paiRegistrado.trim() || null,
        mae_registrada: maeRegistrada.trim() || null,
        conjuge_registrado: ehCasamento ? (conjugeRegistrado.trim() || null) : null,
        data_evento_documento: dataEventoDoc || null,
        data_registro_documento: dataRegistroDoc || null,
        ...(docStatus ? { status: docStatus } : {}),
      })
      if (!okDoc) throw new Error("PUT doc falhou")

      // 2. Persiste checklist + resultado no step + conclui
      const okStep = await patchStep(documentoId, stepId, {
        status: "concluida",
        completedById: getUserId(),
        reviewResult: resultado,
        reviewChecklist: checklist,
        stepObservation: observacao.trim() || null,
      })
      if (!okStep) console.warn("[EditorConferirCertidao] step não concluiu")

      onSaved?.()
    } catch (e) {
      console.error("[EditorConferirCertidao] salvar:", e)
      alert("A etapa foi marcada, mas houve erro ao salvar no servidor. Atualize a página e confira. (console)")
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  const treeRef = pessoa ? (
    <>
      <span className="font-semibold text-white/90">{fullName(pessoa)}</span>
      {pessoa.pai && <span> · pai: <span className="text-white/80">{fullName(pessoa.pai)}</span></span>}
      {pessoa.mae && <span> · mãe: <span className="text-white/80">{fullName(pessoa.mae)}</span></span>}
    </>
  ) : null

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Conferir certidão"
      subtitle="Capture os dados literais do documento e marque o resultado da inspeção operacional."
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-white/5 rounded-md disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving || readOnly || !podeConcluir}
            className={`px-5 py-2 text-[12.5px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2 ${
              resultado === "aprovado"
                ? "bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-900"
                : resultado === "divergente"
                ? "bg-amber-500 hover:bg-amber-600 disabled:bg-amber-900"
                : resultado === "nova_via"
                ? "bg-rose-500 hover:bg-rose-600 disabled:bg-rose-900"
                : "bg-slate-500 disabled:bg-slate-700"
            }`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCheck className="w-3.5 h-3.5" />}
            Registrar conferência · concluir etapa
          </button>
        </div>
      }
    >
      <ReadOnlyBanner stepStatus={stepStatus} />

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-white/50" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Anexo da certidão (link) */}
          {arquivoUrl && (
            <div className="px-3 py-2 rounded-md border border-blue-500/25 bg-blue-500/5 flex items-center gap-2">
              <FileCheck className="w-3.5 h-3.5 text-blue-300 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-white/70">Anexo recebido</div>
                <a
                  href={arquivoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] text-blue-300 hover:text-blue-200 hover:underline inline-flex items-center gap-1"
                >
                  {arquivoNome || "Abrir arquivo"}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
              1. DADOS LITERAIS DO DOCUMENTO
             ═══════════════════════════════════════════════════════ */}
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-1.5">
              1. Dados literais do documento
            </div>
            <div className="text-[11px] text-white/55 leading-snug mb-2">
              Digite <strong>EXATAMENTE</strong> como aparece na certidão. Divergências
              de nomes com a árvore vão ser detectadas e tratadas no fluxo de validação jurídica.
            </div>

            {/* Hint árvore */}
            {treeRef && (
              <div className="px-3 py-2 rounded-md bg-indigo-500/8 border border-indigo-500/20 mb-3">
                <div className="text-[10px] uppercase font-semibold tracking-wider text-indigo-300 mb-1">
                  Nomes na árvore (referência)
                </div>
                <div className="text-[11.5px] text-white/75 leading-snug">{treeRef}</div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label required>Nome do titular (como aparece no documento)</Label>
                <input
                  type="text"
                  value={nomeRegistrado}
                  onChange={(e) => setNomeRegistrado(e.target.value)}
                  placeholder={fullName(pessoa) || "Ex: João Silva da Costa"}
                  disabled={readOnly}
                  className={nomeRegistrado.trim() ? inputCls : inputClsInvalid}
                />
              </div>

              <div>
                <Label>Pai (como aparece no documento)</Label>
                <input
                  type="text"
                  value={paiRegistrado}
                  onChange={(e) => setPaiRegistrado(e.target.value)}
                  placeholder={fullName(pessoa?.pai ?? null) || "—"}
                  disabled={readOnly}
                  className={inputCls}
                />
              </div>

              <div>
                <Label>Mãe (como aparece no documento)</Label>
                <input
                  type="text"
                  value={maeRegistrada}
                  onChange={(e) => setMaeRegistrada(e.target.value)}
                  placeholder={fullName(pessoa?.mae ?? null) || "—"}
                  disabled={readOnly}
                  className={inputCls}
                />
              </div>

              {ehCasamento && (
                <div className="col-span-2">
                  <Label>Cônjuge (como aparece no documento)</Label>
                  <input
                    type="text"
                    value={conjugeRegistrado}
                    onChange={(e) => setConjugeRegistrado(e.target.value)}
                    placeholder="Nome do cônjuge na certidão de casamento"
                    disabled={readOnly}
                    className={inputCls}
                  />
                </div>
              )}

              <div>
                <Label>Data do evento (do documento)</Label>
                <input
                  type="date"
                  value={dataEventoDoc}
                  onChange={(e) => setDataEventoDoc(e.target.value)}
                  disabled={readOnly}
                  className={inputCls}
                />
              </div>

              <div>
                <Label>Data do registro (do documento)</Label>
                <input
                  type="date"
                  value={dataRegistroDoc}
                  onChange={(e) => setDataRegistroDoc(e.target.value)}
                  disabled={readOnly}
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              2. CHECKLIST OPERACIONAL
             ═══════════════════════════════════════════════════════ */}
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-1.5">
              2. Checklist de inspeção
            </div>
            <div className="text-[11px] text-white/55 leading-snug mb-2">
              Marque cada item conforme a inspeção do documento.
            </div>
            <div className="space-y-2">
              {CHECKLIST_ITEMS.map((item) => {
                const isChecked = checklist[item.id]
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      !readOnly && setChecklist({ ...checklist, [item.id]: !isChecked })
                    }
                    disabled={readOnly}
                    className={`w-full text-left px-3 py-2.5 rounded-md border transition-all disabled:cursor-not-allowed ${
                      isChecked
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          isChecked
                            ? "border-emerald-400 bg-emerald-500"
                            : "border-white/30 bg-transparent"
                        }`}
                      >
                        {isChecked && (
                          <Check className="w-3 h-3 text-white" strokeWidth={3} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-[12.5px] font-semibold ${
                            isChecked ? "text-emerald-100" : "text-white/85"
                          }`}
                        >
                          {item.label}
                        </div>
                        <div className="text-[10.5px] text-white/55 mt-0.5 leading-snug">
                          {item.desc}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              3. RESULTADO DA CONFERÊNCIA
             ═══════════════════════════════════════════════════════ */}
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-1.5">
              3. Resultado da conferência
            </div>
            <div className="text-[11px] text-white/55 leading-snug mb-2">
              Se aprovado, o documento segue para validação jurídica final. Se divergente
              ou nova via, o fluxo é redirecionado conforme a decisão.
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ResultadoBtn
                ativo={resultado === "aprovado"}
                onClick={() => !readOnly && setResultado("aprovado")}
                cor="emerald"
                icon={<Check className="w-4 h-4" />}
                label="Aprovar"
                desc="libera para Validar"
              />
              <ResultadoBtn
                ativo={resultado === "divergente"}
                onClick={() => !readOnly && setResultado("divergente")}
                cor="amber"
                icon={<AlertTriangle className="w-4 h-4" />}
                label="Divergente"
                desc="vai para Retificação"
              />
              <ResultadoBtn
                ativo={resultado === "nova_via"}
                onClick={() => !readOnly && setResultado("nova_via")}
                cor="red"
                icon={<XCircle className="w-4 h-4" />}
                label="Nova via"
                desc="pede novo ao cartório"
              />
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              4. OBSERVAÇÃO
             ═══════════════════════════════════════════════════════ */}
          <div>
            <Label>Observação da conferência</Label>
            <textarea
              rows={3}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Anotações da inspeção, ressalvas, divergências menores observadas..."
              disabled={readOnly}
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>
      )}
    </EditorShell>
  )
}

function ResultadoBtn({
  ativo,
  onClick,
  cor,
  icon,
  label,
  desc,
}: {
  ativo: boolean
  onClick: () => void
  cor: "emerald" | "amber" | "red"
  icon: React.ReactNode
  label: string
  desc: string
}) {
  const colorMap = {
    emerald: {
      ativo: "border-emerald-500/60 bg-emerald-500/15 text-emerald-200",
      icon: "text-emerald-300",
    },
    amber: {
      ativo: "border-amber-500/60 bg-amber-500/15 text-amber-200",
      icon: "text-amber-300",
    },
    red: {
      ativo: "border-red-500/60 bg-red-500/15 text-red-200",
      icon: "text-red-300",
    },
  }
  const cls = colorMap[cor]

  return (
    <button
      onClick={onClick}
      className={`px-3 py-3 rounded-md border text-center transition-all ${
        ativo ? cls.ativo + " ring-1 ring-current/40" : "border-white/10 bg-white/5 hover:bg-white/10 text-white/80"
      }`}
    >
      <div className={`flex justify-center mb-1.5 ${ativo ? cls.icon : "text-white/60"}`}>{icon}</div>
      <div className="text-[12.5px] font-semibold mb-0.5">{label}</div>
      <div className={`text-[10px] ${ativo ? "opacity-90" : "text-white/50"}`}>{desc}</div>
    </button>
  )
}

// ============================================================
// ETAPA 6: VALIDAR CERTIDÃO (decisão jurídica final)
// ============================================================
//
// Inspirado no openValidateCertificateModal do HTML do Marco:
//   1. Banner Contexto: documento + resultado da conferência + observação anterior
//   2. Decisão: Aprovado / Aprovado com ressalvas / Nova via / Rejeitado
//   3. Parecer jurídico (obrigatório quando decisão ≠ Aprovado puro)
//   4. Efeito no status do Documento (RECEBIDO / SOLICITAR / INVALIDO)

type ValidarDecisao = "aprovado" | "aprovado_ressalvas" | "nova_via" | "rejeitado"

const DECISAO_OPTIONS: {
  value: ValidarDecisao
  icon: React.ReactNode
  label: string
  desc: string
  cor: "emerald" | "blue" | "amber" | "red"
}[] = [
  {
    value: "aprovado",
    icon: <Check className="w-4 h-4" />,
    label: "Aprovado",
    desc: "Documento serve · status RECEBIDO · workflow finaliza",
    cor: "emerald",
  },
  {
    value: "aprovado_ressalvas",
    icon: <AlertCircle className="w-4 h-4" />,
    label: "Aprovado com ressalvas",
    desc: "Usável mas com observações · status RECEBIDO · divergências ficam registradas",
    cor: "blue",
  },
  {
    value: "nova_via",
    icon: <Send className="w-4 h-4" />,
    label: "Solicitar nova via",
    desc: "Pedir novo documento ao cartório · status SOLICITAR · workflow volta",
    cor: "amber",
  },
  {
    value: "rejeitado",
    icon: <XCircle className="w-4 h-4" />,
    label: "Rejeitado · retificação",
    desc: "Documento inadequado · status INVALIDO · workflow pausa pra análise",
    cor: "red",
  },
]

interface ConferenciaSnapshot {
  resultado: string | null
  observacao: string | null
  completedBy: string | null
  completedAt: string | null
}

export function EditorValidarCertidao({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
}: StepEditorBaseProps) {
  const [decisao, setDecisao] = useState<ValidarDecisao | null>(null)
  const [parecer, setParecer] = useState("")
  const [docTipo, setDocTipo] = useState<string | null>(null)
  const [arquivoUrl, setArquivoUrl] = useState<string | null>(null)
  const [arquivoNome, setArquivoNome] = useState<string | null>(null)
  const [conferencia, setConferencia] = useState<ConferenciaSnapshot | null>(null)
  const [pessoaNome, setPessoaNome] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const readOnly = stepStatus === "concluida"

  const carregar = useCallback(async () => {
    if (!documentoId || !stepId || !isOpen) return
    setLoading(true)
    try {
      const [resDoc, resWf] = await Promise.all([
        fetch(`/api/documentos/${documentoId}`, { headers: authHeader() }),
        fetch(`/api/documentos/${documentoId}/workflow`, { headers: authHeader() }),
      ])

      if (resDoc.ok) {
        const d = await resDoc.json()
        setDocTipo(d.tipo || null)
        setArquivoUrl(d.arquivo_url || null)
        setArquivoNome(d.arquivo_nome || null)
        if (d.pessoa) {
          setPessoaNome(
            `${d.pessoa.nome || ""} ${d.pessoa.sobrenome || ""}`.trim() || null,
          )
        }
      }

      if (resWf.ok) {
        const d = await resWf.json()
        const steps = d.workflow?.steps || []

        // Recupera o step atual (validar)
        const current = steps.find((s: { id: number }) => s.id === stepId)
        if (current) {
          if (current.validationResult) {
            setDecisao(current.validationResult as ValidarDecisao)
          }
          if (current.legalOpinion) {
            setParecer(current.legalOpinion)
          }
        }

        // Recupera o step anterior (conferir) pra exibir como contexto
        const conf = steps.find(
          (s: { stepKey: string }) => s.stepKey === "conferir_certidao",
        )
        if (conf) {
          setConferencia({
            resultado: conf.reviewResult || null,
            observacao: conf.stepObservation || null,
            completedBy: conf.completedBy?.nome || null,
            completedAt: conf.completedAt || null,
          })
        }
      }
    } catch (e) {
      console.warn("[EditorValidarCertidao]", e)
    } finally {
      setLoading(false)
    }
  }, [documentoId, stepId, isOpen])

  useEffect(() => {
    if (isOpen) carregar()
  }, [isOpen, carregar])

  // Pré-seleção: se conferência aprovou, sugere aprovado puro; se divergente, sugere rejeitado
  useEffect(() => {
    if (decisao || !conferencia?.resultado || loading) return
    if (conferencia.resultado === "aprovado") setDecisao("aprovado")
    else if (conferencia.resultado === "divergente") setDecisao("rejeitado")
    else if (conferencia.resultado === "nova_via") setDecisao("nova_via")
  }, [conferencia, decisao, loading])

  const precisaParecer = decisao !== null && decisao !== "aprovado"
  const podeConcluir =
    decisao !== null && (!precisaParecer || parecer.trim().length >= 5)

  const handleSalvar = async () => {
    if (readOnly) return
    if (!decisao) {
      alert("Escolha a decisão jurídica.")
      return
    }
    if (precisaParecer && parecer.trim().length < 5) {
      alert("Parecer jurídico obrigatório quando a decisão não é 'Aprovado puro'.")
      return
    }

    // ⚡ fecha o modal e comemora NA HORA; salva em 2º plano
    onClose()
    void celebrar()

    setSaving(true)
    try {
      // 1. Atualiza status do documento conforme a decisão
      let docStatus: string | null = null
      if (decisao === "aprovado" || decisao === "aprovado_ressalvas") docStatus = "RECEBIDO"
      else if (decisao === "nova_via") docStatus = "SOLICITAR"
      else if (decisao === "rejeitado") docStatus = "INVALIDO"

      if (docStatus) {
        await putDocumento(documentoId, { status: docStatus })
      }

      // 2. Persiste decisão + parecer no step + conclui
      const okStep = await patchStep(documentoId, stepId, {
        status: "concluida",
        completedById: getUserId(),
        validationResult: decisao,
        legalOpinion: parecer.trim() || null,
      })
      if (!okStep) console.warn("[EditorValidarCertidao] step não concluiu")

      onSaved?.()
    } catch (e) {
      console.error("[EditorValidarCertidao] salvar:", e)
      alert("A etapa foi marcada, mas houve erro ao salvar no servidor. Atualize a página e confira. (console)")
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  const fmtDateTime = (iso: string | null) => {
    if (!iso) return "—"
    try {
      const d = new Date(iso)
      return d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    } catch {
      return iso
    }
  }

  const conferenciaLabel = (r: string | null) => {
    if (!r) return "—"
    if (r === "aprovado") return "✓ Aprovado pela equipe"
    if (r === "divergente") return "⚠ Divergente"
    if (r === "nova_via") return "↻ Nova via solicitada"
    return r
  }

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Validar certidão"
      subtitle="Decisão jurídica final. Ao confirmar, o documento muda de status e o workflow finaliza."
      headerGradient="linear-gradient(135deg,#7c2d12 0%,#451a03 100%)"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-white/5 rounded-md disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving || readOnly || !podeConcluir}
            className={`px-5 py-2 text-[12.5px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2 ${
              decisao === "aprovado"
                ? "bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-900"
                : decisao === "aprovado_ressalvas"
                ? "bg-blue-500 hover:bg-blue-600 disabled:bg-blue-900"
                : decisao === "nova_via"
                ? "bg-amber-500 hover:bg-amber-600 disabled:bg-amber-900"
                : decisao === "rejeitado"
                ? "bg-red-500 hover:bg-red-600 disabled:bg-red-900"
                : "bg-slate-500 disabled:bg-slate-700"
            }`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scale className="w-3.5 h-3.5" />}
            Confirmar decisão · finalizar etapa
          </button>
        </div>
      }
    >
      <ReadOnlyBanner stepStatus={stepStatus} />

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-white/50" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ═══════════════════════════════════════════════════════
              1. CONTEXTO DA DECISÃO (read-only)
             ═══════════════════════════════════════════════════════ */}
          <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/5 overflow-hidden">
            <div className="px-3.5 py-2 bg-amber-500/15 border-b border-amber-500/20 flex items-center gap-2">
              <Scale className="w-3.5 h-3.5 text-amber-200" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-100">
                Contexto da decisão
              </span>
            </div>
            <div className="p-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
              <div>
                <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">
                  Documento
                </div>
                <div className="text-[12px] text-white/90 font-medium">
                  {docTipo || "—"}
                </div>
                {pessoaNome && (
                  <div className="text-[10.5px] text-white/55 mt-0.5">{pessoaNome}</div>
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">
                  Anexo
                </div>
                {arquivoUrl ? (
                  <a
                    href={arquivoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-blue-300 hover:text-blue-200 hover:underline inline-flex items-center gap-1 truncate"
                  >
                    📎 {arquivoNome || "Abrir"}
                    <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                  </a>
                ) : (
                  <div className="text-[12px] text-white/30 italic">Sem anexo</div>
                )}
              </div>
              <div className="col-span-2">
                <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">
                  Resultado da conferência operacional
                </div>
                <div className="text-[12.5px] text-white/90 font-medium">
                  {conferenciaLabel(conferencia?.resultado ?? null)}
                </div>
                {conferencia?.completedBy && (
                  <div className="text-[10.5px] text-white/55 mt-0.5">
                    Por <strong className="text-white/75">{conferencia.completedBy}</strong>
                    {conferencia.completedAt && (
                      <span> em {fmtDateTime(conferencia.completedAt)}</span>
                    )}
                  </div>
                )}
                {conferencia?.observacao && (
                  <div className="mt-1.5 px-2.5 py-1.5 rounded bg-black/20 text-[11px] text-white/75 italic leading-snug">
                    &ldquo;{conferencia.observacao}&rdquo;
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              2. DECISÃO JURÍDICA
             ═══════════════════════════════════════════════════════ */}
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-2">
              1. Decisão
            </div>
            <div className="space-y-2">
              {DECISAO_OPTIONS.map((opt) => {
                const ativo = decisao === opt.value
                const colorMap = {
                  emerald: ativo ? "border-emerald-500/60 bg-emerald-500/10 ring-1 ring-emerald-500/30" : "",
                  blue: ativo ? "border-blue-500/60 bg-blue-500/10 ring-1 ring-blue-500/30" : "",
                  amber: ativo ? "border-amber-500/60 bg-amber-500/10 ring-1 ring-amber-500/30" : "",
                  red: ativo ? "border-red-500/60 bg-red-500/10 ring-1 ring-red-500/30" : "",
                }
                const iconColorMap = {
                  emerald: ativo ? "text-emerald-300" : "text-white/60",
                  blue: ativo ? "text-blue-300" : "text-white/60",
                  amber: ativo ? "text-amber-300" : "text-white/60",
                  red: ativo ? "text-red-300" : "text-white/60",
                }
                const textColorMap = {
                  emerald: ativo ? "text-emerald-100" : "text-white/85",
                  blue: ativo ? "text-blue-100" : "text-white/85",
                  amber: ativo ? "text-amber-100" : "text-white/85",
                  red: ativo ? "text-red-100" : "text-white/85",
                }
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => !readOnly && setDecisao(opt.value)}
                    disabled={readOnly}
                    className={`w-full text-left px-3.5 py-2.5 rounded-md border transition-all disabled:cursor-not-allowed ${
                      ativo
                        ? colorMap[opt.cor]
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          ativo
                            ? `border-${opt.cor}-400 bg-${opt.cor}-500`
                            : "border-white/30 bg-transparent"
                        }`}
                      >
                        {ativo && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-[12.5px] font-semibold flex items-center gap-1.5 ${textColorMap[opt.cor]}`}>
                          <span className={iconColorMap[opt.cor]}>{opt.icon}</span>
                          <span>{opt.label}</span>
                        </div>
                        <div className="text-[10.5px] text-white/55 mt-0.5 leading-snug">
                          {opt.desc}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════
              3. PARECER JURÍDICO
             ═══════════════════════════════════════════════════════ */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Label>
                Parecer jurídico
              </Label>
              {precisaParecer && (
                <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  obrigatório
                </span>
              )}
              {!precisaParecer && decisao && (
                <span className="text-[10px] text-white/45 italic">opcional</span>
              )}
            </div>
            <textarea
              rows={5}
              value={parecer}
              onChange={(e) => setParecer(e.target.value)}
              placeholder={
                decisao === "aprovado"
                  ? "Documento atende aos requisitos. Sem ressalvas."
                  : decisao === "aprovado_ressalvas"
                  ? "Documento usável, com a seguinte ressalva: ..."
                  : decisao === "nova_via"
                  ? "Solicitar nova via porque ... [motivo, divergência específica, etc.]"
                  : decisao === "rejeitado"
                  ? "Documento rejeitado porque ... [referências legais, motivo material, etc.]"
                  : "Fundamentação da decisão · referências legais · ressalvas"
              }
              disabled={readOnly}
              className={`${
                precisaParecer && parecer.trim().length < 5 ? inputClsInvalid : inputCls
              } resize-none`}
            />
            {precisaParecer && parecer.trim().length > 0 && parecer.trim().length < 5 && (
              <div className="text-[10.5px] text-amber-200 mt-1 italic">
                Parecer muito curto. Mínimo 5 caracteres.
              </div>
            )}
          </div>
        </div>
      )}
    </EditorShell>
  )
}

// ============================================================
// FILE UPLOAD FIELD — upload real para CloudFlare R2 via presigned URL
// ============================================================
//
// Usa o helper uploadFiles de @/lib/storage que orquestra:
//   1. Pede presigned URL pro endpoint /api/storage/presign
//   2. Faz PUT direto no R2 (com progresso via XHR)
//   3. Retorna { url, key, name, size, type }
//
// Limites do endpoint (já enforced server-side):
//   - 64MB por arquivo
//   - Tipos: PNG, JPG, GIF, WEBP, PDF, DOC, DOCX, XLS, XLSX

interface FileUploadFieldProps {
  label: string
  required?: boolean
  invalid?: boolean
  value: string
  onChange: (
    url: string,
    meta?: { name: string; size: number; type: string; key: string } | null,
  ) => void
  disabled?: boolean
  /** Pasta lógica no bucket. Ex: "documentos/123/solicitacao" */
  prefix?: string
}

const ACCEPT_ATTR =
  "image/png,image/jpeg,image/jpg,image/gif,image/webp," +
  "application/pdf," +
  "application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes < 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split("/").pop() || ""
    // o key tem prefixo "timestamp-uuid-nome.ext" — extrai só o nome
    const parts = last.split("-")
    if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
      return parts.slice(2).join("-")
    }
    return last
  } catch {
    return url
  }
}

function FileUploadField({
  label,
  required,
  invalid,
  value,
  onChange,
  disabled,
  prefix,
}: FileUploadFieldProps) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Quando recebe um valor já salvo (sem nome local), tenta extrair do URL
  const displayName =
    fileName || (value ? fileNameFromUrl(value) : null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setProgress(0)
    setFileName(file.name)
    setFileSize(file.size)

    try {
      const result = await uploadFiles([file], {
        prefix,
        onProgress: (_, p) => setProgress(p),
      })
      const uploaded = result[0]
      if (uploaded) {
        onChange(uploaded.url, {
          name: uploaded.name,
          size: uploaded.size,
          type: uploaded.type,
          key: uploaded.key,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro no upload"
      alert(`Erro ao enviar arquivo: ${msg}`)
      setFileName(null)
      setFileSize(null)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleRemove = () => {
    onChange("", null)
    setFileName(null)
    setFileSize(null)
    setProgress(0)
  }

  const openPicker = () => {
    if (disabled || uploading) return
    fileInputRef.current?.click()
  }

  return (
    <div>
      {/* Label */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-[10px] uppercase font-semibold tracking-wider text-white/55">
          {label}
        </label>
        {required && (
          <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
            obrigatório
          </span>
        )}
      </div>

      {/* Input file escondido */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFile}
        accept={ACCEPT_ATTR}
        className="hidden"
        disabled={disabled || uploading}
      />

      {/* Estados */}
      {uploading ? (
        // 1. SUBINDO
        <div className="px-3 py-2.5 bg-white/5 border border-blue-500/40 rounded-md">
          <div className="flex items-center gap-2.5 mb-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-300 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-white truncate">{fileName}</div>
              <div className="text-[10px] text-white/55">
                Enviando... {progress}% · {formatBytes(fileSize)}
              </div>
            </div>
          </div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : value ? (
        // 2. ARQUIVO CARREGADO
        <div className="px-3 py-2.5 bg-emerald-500/5 border border-emerald-500/30 rounded-md">
          <div className="flex items-center gap-2.5">
            <FileCheck className="w-4 h-4 text-emerald-300 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-white truncate font-medium">
                {displayName || "Arquivo enviado"}
              </div>
              <div className="text-[10px] text-white/55 flex items-center gap-2">
                {fileSize != null && <span>{formatBytes(fileSize)}</span>}
                <a
                  href={value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-300 hover:text-blue-200 hover:underline inline-flex items-center gap-0.5"
                >
                  Abrir <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
            {!disabled && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={openPicker}
                  className="text-[10.5px] font-semibold px-2 py-1 bg-white/10 hover:bg-white/15 rounded text-white"
                >
                  Trocar
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="text-[10.5px] font-semibold px-2 py-1 bg-red-500/15 hover:bg-red-500/25 rounded text-red-200 inline-flex items-center gap-1"
                  title="Remover anexo"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        // 3. VAZIO — botão de seleção
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          className={`w-full px-3 py-3.5 bg-white/5 border border-dashed rounded-md text-left hover:bg-white/10 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            invalid ? "border-amber-500/40" : "border-white/15"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Upload className={`w-4 h-4 ${invalid ? "text-amber-300" : "text-white/60"}`} />
            <div className="flex-1">
              <div className="text-[12px] text-white/85 font-medium">
                Selecionar arquivo
              </div>
              <div className="text-[10px] text-white/45 mt-0.5">
                PNG, JPG, PDF, DOC, XLS · máx 64MB
              </div>
            </div>
          </div>
        </button>
      )}
    </div>
  )
}

// ============================================================
// PLACEHOLDER — fallback para stepKeys sem editor implementado
// ============================================================

function EditorPlaceholder({
  stepKey,
  isOpen,
  onClose,
}: { stepKey: string } & Omit<StepEditorBaseProps, "documentoId" | "stepId" | "stepStatus">) {
  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Editor não disponível"
      subtitle={`A etapa "${stepKey}" ainda não tem editor específico implementado.`}
      footer={
        <div className="flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[12.5px] font-semibold bg-white/10 hover:bg-white/15 text-white rounded-md"
          >
            Fechar
          </button>
        </div>
      }
    >
      <div className="py-8 text-center text-white/55">
        <AlertCircle className="w-10 h-10 text-amber-400/60 mx-auto mb-3" />
        <p className="text-sm">
          Use o botão <strong>⚡ Forçar</strong> no header se quiser concluir esta etapa sem editor.
        </p>
      </div>
    </EditorShell>
  )
}