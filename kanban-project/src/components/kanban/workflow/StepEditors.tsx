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

import { useState, useEffect, useCallback } from "react"
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
} from "lucide-react"

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
      onClose()
    } catch (e) {
      console.error("[EditorSolicitarCertidao] salvar:", e)
      alert("Erro ao salvar. Veja o console.")
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
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label className="text-[10px] uppercase font-semibold tracking-wider text-white/55">
                        📎 {canalConfig.requires.attachmentLabel}
                      </label>
                      <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        obrigatório
                      </span>
                    </div>
                    <input
                      type="text"
                      value={form.attachmentUrl}
                      onChange={(e) => setForm({ ...form, attachmentUrl: e.target.value })}
                      placeholder="Cole o link do PDF/imagem (Google Drive / Dropbox por enquanto)"
                      disabled={readOnly}
                      className={form.attachmentUrl.trim() ? inputCls : inputClsInvalid}
                    />
                    <div className="text-[10px] text-white/40 mt-1 italic">
                      Upload direto na interface vem na próxima rodada — por enquanto cole a URL.
                    </div>
                  </div>
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
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const readOnly = stepStatus === "concluida"

  const carregar = useCallback(async () => {
    if (!documentoId || !stepId || !isOpen) return
    setLoading(true)
    try {
      const res = await fetch(`/api/documentos/${documentoId}/workflow`, {
        headers: authHeader(),
      })
      if (res.ok) {
        const d = await res.json()
        const step = d.workflow?.steps?.find((s: { id: number }) => s.id === stepId)
        if (step) {
          setTrackingCode(step.trackingCode || "")
          setNotes(step.notes || "")
        }
      }
    } catch (e) {
      console.warn("[EditorAguardarRetorno]", e)
    } finally {
      setLoading(false)
    }
  }, [documentoId, stepId, isOpen])

  useEffect(() => {
    if (isOpen) carregar()
  }, [isOpen, carregar])

  const handleSalvar = async (concluir: boolean) => {
    if (readOnly) return
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
      onClose()
    } catch (e) {
      console.error("[EditorAguardarRetorno] salvar:", e)
      alert("Erro ao salvar. Veja o console.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Aguardar retorno do cartório"
      subtitle="Registre código de rastreio e histórico de follow-ups feitos com o cartório."
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
            className="px-5 py-2 text-[12.5px] font-semibold bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-md inline-flex items-center gap-2"
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
        <div className="space-y-4">
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
            <div className="text-[12px] font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Etapa de aguardo
            </div>
            <div className="text-[11px] text-white/75 leading-relaxed">
              Esta etapa não tem evidência obrigatória — você pode salvar e voltar depois.
              Conclua aqui só quando confirmar que o cartório respondeu (na próxima etapa, faça o upload).
            </div>
          </div>

          <div>
            <Label>Código de rastreio (correios, sedex, motoboy)</Label>
            <input
              type="text"
              value={trackingCode}
              onChange={(e) => setTrackingCode(e.target.value)}
              placeholder="ex: BR123456789BR"
              disabled={readOnly}
              className={inputCls}
            />
          </div>

          <div>
            <Label>Notas de follow-up</Label>
            <textarea
              rows={6}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                "Registre aqui os contatos feitos com o cartório:\n\n" +
                "26/05 - Ligação atendida por Maria. Pediu 7 dias úteis.\n" +
                "02/06 - WhatsApp confirmou que o documento foi assinado e está aguardando postagem.\n" +
                "..."
              }
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
// ETAPA 4: RECEBER CERTIDÃO
// ============================================================

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
  const [observacao, setObservacao] = useState("")
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  const readOnly = stepStatus === "concluida"

  const carregar = useCallback(async () => {
    if (!documentoId || !isOpen) return
    setLoading(true)
    try {
      const res = await fetch(`/api/documentos/${documentoId}`, { headers: authHeader() })
      if (res.ok) {
        const d = await res.json()
        setArquivoUrl(d.arquivo_url || "")
        setArquivoNome(d.arquivo_nome || "")
      }
    } catch (e) {
      console.warn("[EditorReceberCertidao]", e)
    } finally {
      setLoading(false)
    }
  }, [documentoId, isOpen])

  useEffect(() => {
    if (isOpen) carregar()
  }, [isOpen, carregar])

  const podeConcluir = arquivoUrl.trim().length > 0

  const handleSalvar = async () => {
    if (readOnly) return
    if (!podeConcluir) {
      alert("Cole o link do arquivo recebido antes de concluir.")
      return
    }
    setSaving(true)
    try {
      const okDoc = await putDocumento(documentoId, {
        arquivo_url: arquivoUrl.trim(),
        arquivo_nome: arquivoNome.trim() || "certidao.pdf",
        status: "RECEBIDO",
      })
      if (!okDoc) throw new Error("PUT doc falhou")

      const okStep = await patchStep(documentoId, stepId, {
        status: "concluida",
        completedById: getUserId(),
        notes: observacao.trim() || null,
      })
      if (!okStep) console.warn("[EditorReceberCertidao] step não concluiu")

      onSaved?.()
      onClose()
    } catch (e) {
      console.error("[EditorReceberCertidao] salvar:", e)
      alert("Erro ao salvar. Veja o console.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Receber certidão"
      subtitle="Anexe o arquivo (PDF) recebido do cartório."
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
            Marcar como recebido · concluir etapa
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
        <div className="space-y-4">
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
            <div className="text-[12px] font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Upload via interface — próxima rodada
            </div>
            <div className="text-[11px] text-white/75 leading-relaxed">
              Por enquanto, faça o upload do PDF no Google Drive / Dropbox e cole o link
              abaixo. Em uma próxima rodada vou plugar upload direto na interface.
            </div>
          </div>

          <div>
            <Label required>Link do arquivo</Label>
            <input
              type="text"
              value={arquivoUrl}
              onChange={(e) => setArquivoUrl(e.target.value)}
              placeholder="https://drive.google.com/..."
              disabled={readOnly}
              className={arquivoUrl.trim() ? inputCls : inputClsInvalid}
            />
          </div>

          <div>
            <Label>Nome do arquivo</Label>
            <input
              type="text"
              value={arquivoNome}
              onChange={(e) => setArquivoNome(e.target.value)}
              placeholder="ex: nasc-raphael-alba.pdf"
              disabled={readOnly}
              className={inputCls}
            />
          </div>

          <div>
            <Label>Observações do recebimento</Label>
            <textarea
              rows={3}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Recebido por correios em 28/05/2026, sem avarias."
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
// ETAPA 5: CONFERIR CERTIDÃO (checklist operacional)
// ============================================================

interface ChecklistState {
  legivel: boolean
  integro: boolean
  dados_minimos: boolean
  apostila_ok: boolean
  traducao_ok: boolean
}

type ConferirResultado = "aprovado" | "reprovado" | "requer_retificacao"

const CHECKLIST_ITEMS: Array<{ id: keyof ChecklistState; label: string; descricao: string }> = [
  {
    id: "legivel",
    label: "Documento legível",
    descricao: "Texto claro, sem manchas, riscos ou áreas borradas.",
  },
  {
    id: "integro",
    label: "Arquivo íntegro",
    descricao: "PDF abre normalmente, sem corrupção. Todas as páginas presentes.",
  },
  {
    id: "dados_minimos",
    label: "Dados registrais mínimos presentes",
    descricao: "Nome, data do evento, cartório e referência (livro/folha/termo) visíveis.",
  },
  {
    id: "apostila_ok",
    label: "Apostila de Haia (se exigida)",
    descricao: "Caso o destino exija apostila, ela está presente e legível. Marque também quando NÃO for exigida.",
  },
  {
    id: "traducao_ok",
    label: "Tradução (se exigida)",
    descricao: "Caso o destino exija tradução juramentada, ela está presente. Marque também quando NÃO for exigida.",
  },
]

export function EditorConferirCertidao({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
}: StepEditorBaseProps) {
  const [checklist, setChecklist] = useState<ChecklistState>({
    legivel: false,
    integro: false,
    dados_minimos: false,
    apostila_ok: false,
    traducao_ok: false,
  })
  const [resultado, setResultado] = useState<ConferirResultado | null>(null)
  const [justificativa, setJustificativa] = useState("")
  const [saving, setSaving] = useState(false)

  const readOnly = stepStatus === "concluida"

  // Reset ao abrir
  useEffect(() => {
    if (isOpen) {
      setChecklist({
        legivel: false,
        integro: false,
        dados_minimos: false,
        apostila_ok: false,
        traducao_ok: false,
      })
      setResultado(null)
      setJustificativa("")
    }
  }, [isOpen])

  const todosChecks = Object.values(checklist).every(Boolean)
  const algumCheckFalhou = !todosChecks

  // Auto-resultado baseado nos checks (mas usuário pode override)
  useEffect(() => {
    if (resultado !== null) return // não sobrescreve escolha manual
    if (todosChecks) setResultado("aprovado")
  }, [todosChecks, resultado])

  const precisaJustificativa =
    resultado === "reprovado" || resultado === "requer_retificacao"
  const podeConcluir =
    resultado !== null && (!precisaJustificativa || justificativa.trim().length > 0)

  const handleSalvar = async () => {
    if (readOnly) return
    if (!podeConcluir) {
      alert("Escolha o resultado da conferência (e justifique, se for reprovação/retificação).")
      return
    }
    setSaving(true)
    try {
      // Status do doc conforme resultado
      let docStatus: string | null = null
      if (resultado === "aprovado") docStatus = "RECEBIDO"
      else if (resultado === "reprovado") docStatus = "INVALIDO"
      else if (resultado === "requer_retificacao") docStatus = "RETIFICANDO"

      if (docStatus) {
        await putDocumento(documentoId, { status: docStatus })
      }

      // Serializa o checklist nas notes pra rastreabilidade
      const checklistTxt = CHECKLIST_ITEMS.map(
        (item) => `${checklist[item.id] ? "✓" : "✗"} ${item.label}`,
      ).join("\n")
      const fullNotes =
        `[Conferência] ${resultado.toUpperCase()}\n\n` +
        checklistTxt +
        (justificativa.trim() ? `\n\nJustificativa:\n${justificativa.trim()}` : "")

      const okStep = await patchStep(documentoId, stepId, {
        status: "concluida",
        completedById: getUserId(),
        reviewResult: resultado,
        notes: fullNotes,
      })
      if (!okStep) console.warn("[EditorConferirCertidao] step não concluiu")

      onSaved?.()
      onClose()
    } catch (e) {
      console.error("[EditorConferirCertidao] salvar:", e)
      alert("Erro ao salvar. Veja o console.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Conferir certidão"
      subtitle="Inspeção operacional. Não é decisão jurídica — apenas checagem de integridade e dados mínimos."
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
                : resultado === "reprovado"
                ? "bg-red-500 hover:bg-red-600 disabled:bg-red-900"
                : resultado === "requer_retificacao"
                ? "bg-amber-500 hover:bg-amber-600 disabled:bg-amber-900"
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

      <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-2">
        1. Checklist operacional
      </div>
      <div className="space-y-2 mb-5">
        {CHECKLIST_ITEMS.map((item) => {
          const isChecked = checklist[item.id]
          return (
            <button
              key={item.id}
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
                  {isChecked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[12.5px] font-semibold ${isChecked ? "text-emerald-200" : "text-white/80"}`}>
                    {item.label}
                  </div>
                  <div className="text-[10.5px] text-white/55 mt-0.5 leading-snug">
                    {item.descricao}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-2">
        2. Resultado da conferência
      </div>

      {algumCheckFalhou && (
        <div className="mb-3 p-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-200">
          Nem todos os itens foram marcados. Você pode aprovar mesmo assim se for legítimo,
          mas considere se vale a pena reprovar ou pedir retificação.
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-3">
        <ResultadoBtn
          ativo={resultado === "aprovado"}
          onClick={() => !readOnly && setResultado("aprovado")}
          cor="emerald"
          icon={<Check className="w-4 h-4" />}
          label="Aprovar"
          desc="doc fica como Recebido"
        />
        <ResultadoBtn
          ativo={resultado === "requer_retificacao"}
          onClick={() => !readOnly && setResultado("requer_retificacao")}
          cor="amber"
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Pedir retificação"
          desc="doc vira Retificando"
        />
        <ResultadoBtn
          ativo={resultado === "reprovado"}
          onClick={() => !readOnly && setResultado("reprovado")}
          cor="red"
          icon={<XCircle className="w-4 h-4" />}
          label="Reprovar"
          desc="doc vira Inválido"
        />
      </div>

      {precisaJustificativa && (
        <div>
          <Label required>Justificativa</Label>
          <textarea
            rows={3}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            placeholder={
              resultado === "reprovado"
                ? "Por que esse documento não serve? (ex: nome com erro grave, livro/folha ilegíveis...)"
                : "O que precisa ser retificado? (ex: data de nascimento divergente da árvore, sobrenome materno errado...)"
            }
            disabled={readOnly}
            className={`${justificativa.trim() ? inputCls : inputClsInvalid} resize-none`}
          />
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

type ValidarResultado = "validado" | "invalido" | "divergente"

export function EditorValidarCertidao({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
}: StepEditorBaseProps) {
  const [resultado, setResultado] = useState<ValidarResultado | null>(null)
  const [parecer, setParecer] = useState("")
  const [saving, setSaving] = useState(false)

  const readOnly = stepStatus === "concluida"

  useEffect(() => {
    if (isOpen) {
      setResultado(null)
      setParecer("")
    }
  }, [isOpen])

  const podeConcluir = resultado !== null && parecer.trim().length > 0

  const handleSalvar = async () => {
    if (readOnly) return
    if (!podeConcluir) {
      alert("Escolha a decisão jurídica e registre um parecer antes de concluir.")
      return
    }
    setSaving(true)
    try {
      // Status do doc conforme decisão final
      let docStatus: string | null = null
      if (resultado === "validado") docStatus = "RECEBIDO"
      else if (resultado === "invalido") docStatus = "INVALIDO"
      else if (resultado === "divergente") docStatus = "RETIFICANDO"

      if (docStatus) {
        await putDocumento(documentoId, { status: docStatus })
      }

      const fullNotes = `[Validação jurídica] ${resultado.toUpperCase()}\n\n${parecer.trim()}`

      const okStep = await patchStep(documentoId, stepId, {
        status: "concluida",
        completedById: getUserId(),
        validationResult: resultado,
        notes: fullNotes,
      })
      if (!okStep) console.warn("[EditorValidarCertidao] step não concluiu")

      onSaved?.()
      onClose()
    } catch (e) {
      console.error("[EditorValidarCertidao] salvar:", e)
      alert("Erro ao salvar. Veja o console.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Validar certidão"
      subtitle="Decisão jurídica final. Esta é a última etapa do workflow — ao concluir, o ciclo fecha."
      headerGradient="linear-gradient(135deg,#312e81 0%,#1e1b4b 100%)"
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
              resultado === "validado"
                ? "bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-900"
                : resultado === "divergente"
                ? "bg-amber-500 hover:bg-amber-600 disabled:bg-amber-900"
                : resultado === "invalido"
                ? "bg-red-500 hover:bg-red-600 disabled:bg-red-900"
                : "bg-slate-500 disabled:bg-slate-700"
            }`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scale className="w-3.5 h-3.5" />}
            Registrar decisão · fechar workflow
          </button>
        </div>
      }
    >
      <ReadOnlyBanner stepStatus={stepStatus} />

      <div className="p-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 mb-5">
        <div className="text-[12px] font-semibold text-indigo-300 mb-1 flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5" />
          Decisão jurídica
        </div>
        <div className="text-[11px] text-white/75 leading-relaxed">
          A conferência operacional já foi feita na etapa anterior. Aqui é a decisão final
          sobre se o documento serve juridicamente para o processo de cidadania.
        </div>
      </div>

      <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-2">
        1. Decisão
      </div>
      <div className="grid grid-cols-3 gap-2 mb-5">
        <ResultadoBtn
          ativo={resultado === "validado"}
          onClick={() => !readOnly && setResultado("validado")}
          cor="emerald"
          icon={<Check className="w-4 h-4" />}
          label="Validar"
          desc="serve para o processo"
        />
        <ResultadoBtn
          ativo={resultado === "divergente"}
          onClick={() => !readOnly && setResultado("divergente")}
          cor="amber"
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Divergente"
          desc="precisa retificação"
        />
        <ResultadoBtn
          ativo={resultado === "invalido"}
          onClick={() => !readOnly && setResultado("invalido")}
          cor="red"
          icon={<XCircle className="w-4 h-4" />}
          label="Inválido"
          desc="não serve"
        />
      </div>

      <div>
        <Label required>Parecer jurídico</Label>
        <textarea
          rows={6}
          value={parecer}
          onChange={(e) => setParecer(e.target.value)}
          placeholder={
            resultado === "validado"
              ? "Documento atende aos requisitos para transmissão de cidadania. Sem ressalvas..."
              : resultado === "divergente"
              ? "Nome materno consta como 'Maria Aparecida' no doc e 'Maria Ap. Silva' na árvore. Necessária retificação extrajudicial..."
              : resultado === "invalido"
              ? "Documento apresenta erros materiais que comprometem sua validade. Recomenda-se nova busca por inteiro teor..."
              : "Registre seu parecer técnico-jurídico sobre o documento."
          }
          disabled={readOnly}
          className={`${parecer.trim() ? inputCls : inputClsInvalid} resize-none`}
        />
      </div>
    </EditorShell>
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