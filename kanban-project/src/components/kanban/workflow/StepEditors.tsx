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

import * as React from "react"
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import PainelDeclarativoDaEtapa from "./PainelDeclarativoDaEtapa"
import { useApi } from "@/src/lib/dados"
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
  Paperclip,
} from "lucide-react"
import { uploadFiles, hashDoArquivo } from "@/src/lib/storage"
import { celebrar } from "@/src/lib/confetti"
import {
  resolveWorkflowStepEditor,
  type StepEditorKind,
} from "@/src/lib/process-stage/step-editor-registry"
import type { AcaoEtapa } from "@/src/lib/process-stage/acoes-etapa"
import {
  useAndamento,
  mensagemDoErro,
  BlocoContatos,
  LABEL_CANAL,
  fmtData,
  campoCls,
  Rotulo,
  ANDAMENTO_VIEW_VAZIO,
  type AndamentoView,
  type UsuarioResumo,
} from "./AndamentoEtapa"
import {
  AbaAnexosDocumentais,
  AbaObservacoesDocumentais,
  type SolicitacaoView,
} from "../documento/AbasDocumentais"
import { CANAIS_CONTATO, type CanalContato } from "@/src/lib/process-stage/andamento-etapa"
import {
  canalDoTexto,
  faltamCamposDoCanal,
  LABEL_CAMPO_FALTANDO,
  CANAIS_SOLICITACAO,
} from "@/src/lib/process-stage/canais-solicitacao"
import type { CanalSolicitacaoDocumento } from "@prisma/client"

/**
 * Erro do domínio → frase operacional. Códigos de campo faltando viram a lista
 * de campos, com o rótulo que o operador conhece — nunca o código cru.
 */
function mensagemDaSolicitacao(codigo: string | null | undefined): string {
  if (!codigo) return mensagemDoErro("INTERNAL_ERROR")
  const [base, detalhe] = codigo.split(":")
  if (base === "VALIDATION_ERROR" && detalhe) {
    const campos = detalhe.split(",").map((c) => LABEL_CAMPO_FALTANDO[c] ?? c)
    return `Falta preencher: ${campos.join(", ")}.`
  }
  return mensagemDoErro(base)
}

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
// CARREGAMENTO COMPARTILHADO DOS EDITORES
// ============================================================
//
// Os cinco editores liam as MESMAS duas coisas — o documento e a etapa dentro do
// workflow dele — cada um com o seu `carregar()` dentro de um efeito, e cada um
// semeando meia dúzia de `useState` a partir da resposta.
//
// Aqui a leitura é uma só, pela camada oficial: as chaves são as mesmas para todos os
// editores, então abrir um editor depois do outro no mesmo documento não refaz a
// requisição. E como a semente do formulário passa a ser o valor INICIAL de um
// componente montado por `key` (ver `versaoDe`), não sobra efeito nenhum.

/** Etapa do workflow como os editores a consomem. */
interface EtapaCarregada {
  id: number
  [campo: string]: unknown
}

function useDocumentoEEtapa(documentoId: number | null, stepId: number | null) {
  const docReq = useApi<Record<string, unknown>>(documentoId ? `/api/documentos/${documentoId}` : null)
  const wfReq = useApi<{ workflow?: { steps?: EtapaCarregada[] } }>(
    documentoId ? `/api/documentos/${documentoId}/workflow` : null,
  )
  const etapa = useMemo(
    () => wfReq.dados?.workflow?.steps?.find((s) => s.id === stepId) ?? null,
    [wfReq.dados, stepId],
  )
  // Alguns editores precisam de OUTRA etapa como contexto (o de validar mostra o que a
  // conferência decidiu), por isso a lista inteira também sai daqui.
  const etapas = wfReq.dados?.workflow?.steps ?? SEM_ETAPAS
  return {
    doc: docReq.dados ?? null,
    etapa,
    etapas,
    carregando: docReq.carregando || wfReq.carregando,
    recarregar: () => { void docReq.recarregar(); void wfReq.recarregar() },
  }
}

const SEM_ETAPAS: EtapaCarregada[] = []

// ── Leitura do que o SERVIDOR decidiu sobre a etapa ──────────────────────────
//
// Andamento, ações permitidas e versão vêm prontos no payload do workflow. A tela
// não infere permissão nem transição: se a ação não veio, o botão não existe.

const SEM_ACOES: AcaoEtapa[] = []

function andamentoDaEtapa(etapa: EtapaCarregada | null): AndamentoView {
  const a = etapa?.andamento
  if (!a || typeof a !== "object") return ANDAMENTO_VIEW_VAZIO
  return a as unknown as AndamentoView
}

function acoesDaEtapa(etapa: EtapaCarregada | null): AcaoEtapa[] {
  const a = etapa?.acoesPermitidas
  return Array.isArray(a) ? (a as AcaoEtapa[]) : SEM_ACOES
}

function versaoDaEtapa(etapa: EtapaCarregada | null): number | null {
  const v = etapa?.lockVersion
  return typeof v === "number" ? v : null
}

/** Equipe, para nomear autor de contato/observação/anexo. */
function useUsuarios(ativo: boolean): UsuarioResumo[] {
  const req = useApi<{ usuarios?: UsuarioResumo[] } | UsuarioResumo[]>(ativo ? "/api/usuarios" : null)
  return useMemo<UsuarioResumo[]>(() => {
    const d = req.dados
    if (!d) return []
    return Array.isArray(d) ? d : (d.usuarios ?? [])
  }, [req.dados])
}

// Leitores tolerantes do payload. Os editores liam `d.campo || ""` sobre um `any`; com
// a resposta tipada como `Record<string, unknown>`, a conversão fica explícita e num
// lugar só — sem `any` e sem repetir o mesmo `|| ""` em trinta pontos.
function texto(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v)
}
function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null
}
function numeroOuNulo(v: unknown): number | null {
  return typeof v === "number" ? v : null
}

/**
 * Identidade do que foi carregado. Serve de `key` do formulário: enquanto o servidor
 * devolve o mesmo conteúdo, o rascunho do usuário é preservado; quando devolve
 * conteúdo novo (recarga após salvar), o formulário renasce refletindo o gravado.
 */
function versaoDe(doc: unknown, etapa: unknown): string {
  return JSON.stringify([doc ?? null, etapa ?? null])
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

/**
 * PATCH do passo devolvendo o CÓDIGO do erro do domínio (STEP_NOT_AVAILABLE,
 * PERMISSION_REQUIRED, CONCURRENT_UPDATE, …) para a tela traduzir. Sem isto, todo
 * problema virava um `alert("erro, veja o console")` genérico.
 */
async function patchStepComErro(
  documentoId: number,
  stepId: number,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; codigo: string }> {
  try {
    const res = await fetch(
      `/api/documentos/${documentoId}/workflow/steps/${stepId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(body),
      },
    )
    if (res.ok) return { ok: true }
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, codigo: json.error ?? "INTERNAL_ERROR" }
  } catch {
    return { ok: false, codigo: "INTERNAL_ERROR" }
  }
}

async function patchStep(
  documentoId: number,
  stepId: number,
  body: Record<string, unknown>,
): Promise<boolean> {
  return (await patchStepComErro(documentoId, stepId, body)).ok
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
  headerGradient = "#161b21",
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
                className="w-8 h-8 rounded-md bg-[#161b21] hover:bg-[#252c35] flex items-center justify-center text-white flex-shrink-0"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 text-white/70">{children}</div>

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
      {required && <span className="text-[#d2a948] ml-1">*</span>}
    </label>
  )
}

const inputCls =
  "w-full px-3 py-2 bg-[#161b21] border border-white/10 rounded-md text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/30"

const inputClsInvalid =
  "w-full px-3 py-2 bg-[#161b21] border border-[#d2a948]/40 rounded-md text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#d2a948]/60 focus:ring-1 focus:ring-[#d2a948]/30"

function ReadOnlyBanner({ stepStatus }: { stepStatus: string }) {
  if (stepStatus !== "concluida") return null
  return (
    <div className="mb-5 p-3 rounded-lg border border-white/10 bg-[#161b21]">
      <div className="text-[12px] font-semibold text-[#7dd3fc] mb-0.5 flex items-center gap-1.5">
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
// ROUTER — monta o editor resolvido pelo REGISTRY OFICIAL
// ============================================================
//
// Antes isto era um `switch (stepKey)` com `default` caindo num modal de erro.
// Dois problemas de uma vez: os `case` usavam chaves LEGADAS (o passo publicado
// "aguardar_retorno_do_cartorio" nunca casava com a chave legada do switch), e
// "sem editor específico" era tratado como falha em vez de caso de uso do editor
// padrão. Agora a decisão é do registry — o servidor inclusive já a devolve
// resolvida em `step.editor.kind`, e este componente só confere o mesmo mapa.

export interface StepEditorRouterProps {
  stepKey: string
  /** Fase do passo — necessária para converter chave legada em publicada. */
  phaseKey?: string | null
  /** Resolução do editor vinda do servidor. Ausente = resolve localmente pelo mesmo registry. */
  editorKind?: StepEditorKind | null
  stepTitle?: string
  documentoId: number
  stepId: number
  stepStatus: string
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

/**
 * Decide entre o painel declarativo e o operacional PELO DADO: se a etapa tem
 * configuração cadastrada na versão dela, é ela que manda a tela. A pergunta é feita
 * ao servidor uma vez; enquanto ela não volta, nada pisca — o painel operacional já
 * é a resposta certa para a maioria das etapas hoje.
 */
function PainelDeclarativoComFallback({
  stepInstanceId, onExecutado, fallback,
}: { stepInstanceId: number; onExecutado?: () => void; fallback: React.ReactNode }) {
  const [temConfig, setTemConfig] = React.useState<boolean | null>(null)
  React.useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("token") : null
    fetch(`/api/workflow-step-instances/${stepInstanceId}/execucao`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setTemConfig(Boolean(j?.configuracao?.acoes?.length || j?.configuracao?.campos?.length)))
      .catch(() => setTemConfig(false))
  }, [stepInstanceId])
  if (temConfig === null) return <>{fallback}</>
  if (!temConfig) return <>{fallback}</>
  return <PainelDeclarativoDaEtapa stepInstanceId={stepInstanceId} onExecutado={onExecutado} />
}

export function StepEditorRouter(props: StepEditorRouterProps) {
  const { stepKey, phaseKey, editorKind, stepTitle, ...rest } = props
  const kind: StepEditorKind =
    editorKind ?? resolveWorkflowStepEditor({ stepKey, phaseKey }).kind

  switch (kind) {
    case "solicitacao_cartorio":
      return <EditorSolicitarCertidao {...rest} />
    case "acompanhamento_retorno":
      return <EditorAguardarRetorno {...rest} />
    case "recebimento_documento":
      return <EditorReceberCertidao {...rest} />
    case "conferencia_documento":
      return <EditorConferirCertidao {...rest} />
    case "validacao_juridica":
      return <EditorValidarCertidao {...rest} />
    case "registral":
      // O editor registral é montado pela Central da Etapa (ele tem contrato próprio).
      // Chegar aqui significaria montagem duplicada; nada a renderizar.
      return null
    case "padrao":
    default:
      // NÃO É ERRO. Toda etapa publicada tem interface executável — quando não há
      // editor específico, vale o painel declarativo, que desenha o que o CADASTRO
      // diz que esta etapa tem. É por causa dele que um passo criado pelo
      // administrador executa sem código: os campos, os resultados e o checklist vêm
      // da versão congelada, não daqui.
      //
      // Sem configuração cadastrada — etapa anterior ao versionamento —, o painel
      // operacional de sempre continua respondendo. As duas coisas convivem porque
      // são estados de dado diferentes, não dois caminhos para a mesma coisa.
      return (
        <PainelDeclarativoComFallback
          stepInstanceId={rest.stepId}
          onExecutado={rest.onSaved}
          fallback={<DefaultWorkflowStepEditor stepTitle={stepTitle ?? null} {...rest} />}
        />
      )
  }
}

// ============================================================
// ETAPA 2: SOLICITAR CERTIDÃO — versão completa (HTML-like)
// ============================================================
//
// Inclui: Resumo do Pedido (documento + pessoa + cartório + dados
// registrais + histórico + recomendação), 8 canais, evidências
// condicionais e Detalhes do Envio (atendente, custo, pagamento).

// CANAIS — DERIVADOS da configuração oficial compartilhada.
//
// Aqui existia uma segunda lista de canais, com as exigências escritas de novo — e
// ELA DISCORDAVA da oficial: marcava "protocolo obrigatório" em e-mail, WhatsApp,
// balcão, comune e Correios, canais que legitimamente podem não devolver número no
// envio. O servidor validava por uma regra e a tela cobrava outra; o operador via
// campo obrigatório que o backend não exigia.
//
// Agora a lista NASCE de `CANAIS_SOLICITACAO`. O que fica local é só o que é de
// tela: o ícone e a dica do campo de observação.

type CanalId = string

const ICONE_DO_CANAL: Record<CanalSolicitacaoDocumento, React.ComponentType<{ className?: string }>> = {
  CRC: Globe,
  ECARTORIO: Send,
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  BALCAO: MapPin,
  COMUNE: Globe,
  CORREIOS: Send,
  CONSULADO: MapPin,
}

/** Dica do campo de observação — texto de tela, sem efeito em regra nenhuma. */
const DICA_OBSERVACAO: Partial<Record<CanalSolicitacaoDocumento, string>> = {
  BALCAO: "Atendente, número do guichê, horário",
  CONSULADO: "Setor consular, atendente",
}

interface CanalConfig {
  /** Valor do domínio — a identidade estrutural do canal. */
  canal: CanalSolicitacaoDocumento
  /** Mesma chave em minúsculas que o form e o documento já gravam. */
  id: CanalId
  label: string
  desc: string
  icon: React.ComponentType<{ className?: string }>
  requires: {
    attachment: boolean
    attachmentLabel: string
    protocol: boolean
    trackingCode: boolean
    observation: boolean
    observationHint?: string
  }
}

const CANAIS: CanalConfig[] = CANAIS_SOLICITACAO.map((c) => ({
  canal: c.canal,
  id: c.canal.toLowerCase(),
  label: c.label,
  desc: c.descricao,
  icon: ICONE_DO_CANAL[c.canal],
  requires: {
    attachment: c.anexoObrigatorioLabel !== null,
    attachmentLabel: c.anexoObrigatorioLabel ?? "Comprovante do envio",
    protocol: c.protocoloObrigatorio,
    trackingCode: c.rastreioObrigatorio,
    observation: c.observacaoObrigatoria,
    observationHint: DICA_OBSERVACAO[c.canal],
  },
}))

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

/**
 * Contrato de leitura da exigência de evidência (espelho do DTO do serviço).
 * O que a tela usa daqui é o NOME e o CÓDIGO do cadastro mestre — para rotular o
 * campo com o documento oficial em vez de um texto solto.
 */
interface ExigenciasEtapaView {
  principal: {
    obrigatoria: boolean
    documentoMestre: { id: number; publicCode: string | null; code: string | null; name: string }
  } | null
  anexoAtual: { id: number; nome: string; url: string; documentoMestre: { publicCode: string | null; name: string } | null } | null
}

interface SolicitarFormState {
  canal: CanalId | null
  attachmentUrl: string
  /** Metadados REAIS do arquivo enviado — viram registro, não só nome na tela. */
  attachmentMeta: { name: string; size: number; type: string; hash: string | null } | null
  protocolo: string
  trackingCode: string
  observacao: string
  externalEntityName: string
  costPaid: string
  paymentMethod: string
  /** Cartório/destinatário e prazo esperado passam a ser campos do ato. */
  destinatario: string
  prazoEsperadoDias: string
}

const emptySolicitarForm = (): SolicitarFormState => ({
  canal: null,
  attachmentUrl: "",
  attachmentMeta: null,
  destinatario: "",
  prazoEsperadoDias: "",
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

/** Converte o documento cru no retrato que este editor usa. */
function lerDocSnapshot(bruto: Record<string, unknown> | null): DocSnapshot | null {
  if (!bruto) return null
  const p = bruto.pessoa as Record<string, unknown> | undefined
  return {
    id: Number(bruto.id),
    tipo: texto(bruto.tipo),
    cartorio: textoOuNulo(bruto.cartorio),
    livro: textoOuNulo(bruto.livro),
    folha: textoOuNulo(bruto.folha),
    termo: textoOuNulo(bruto.termo),
    nome_registrado: textoOuNulo(bruto.nome_registrado),
    data_evento: textoOuNulo(bruto.data_evento),
    pessoa: p ? { id: Number(p.id), nome: texto(p.nome), sobrenome: textoOuNulo(p.sobrenome) } : null,
    canal_solicitacao: textoOuNulo(bruto.canal_solicitacao),
    protocolo: textoOuNulo(bruto.protocolo),
    nro_pedido: textoOuNulo(bruto.nro_pedido),
    link_acompanhamento: textoOuNulo(bruto.link_acompanhamento),
    observacoes: textoOuNulo(bruto.observacoes),
  }
}

/** Casca: carrega, e monta o formulário com a semente já em mãos. */
export function EditorSolicitarCertidao(props: StepEditorBaseProps) {
  const { doc: bruto, etapa, carregando } = useDocumentoEEtapa(props.isOpen ? props.documentoId : null, props.stepId)
  const doc = useMemo(() => lerDocSnapshot(bruto), [bruto])
  if (!props.isOpen) return null
  return (
    <FormSolicitarCertidao
      key={versaoDe(doc, etapa)}
      {...props}
      doc={doc}
      etapa={etapa}
      loading={carregando}
    />
  )
}

function FormSolicitarCertidao({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
  doc,
  etapa,
  loading,
}: StepEditorBaseProps & { doc: DocSnapshot | null; etapa: EtapaCarregada | null; loading: boolean }) {
  // O formulário nasce do que está gravado. A PRÉ-SELEÇÃO do canal continua igual: se
  // não há canal salvo, vale o recomendado — é isso que faz as seções "Evidências" e
  // "Detalhes do envio" já aparecerem ao abrir.
  const [form, setForm] = useState<SolicitarFormState>(() => {
    if (!doc) return emptySolicitarForm()
    // A chave gravada passa pela ponte OFICIAL do domínio, não por comparação de
    // string: registro antigo com "e-cartorio" continua reconhecido.
    const canalSalvo = canalDoTexto(doc.canal_solicitacao)
    const canalValido = canalSalvo ? canalSalvo.toLowerCase() : null
    return {
      canal: canalValido || getRecomendacao(doc).canal,
      // O requerimento NÃO nasce mais de `link_acompanhamento`: aquele campo
      // significa link de acompanhamento, e usá-lo como esconderijo do arquivo
      // era exatamente o que fazia o anexo sumir de todas as abas.
      attachmentUrl: "",
      attachmentMeta: null,
      destinatario: doc.cartorio || "",
      prazoEsperadoDias: "",
      protocolo: doc.protocolo || texto(etapa?.externalProtocol),
      trackingCode: texto(etapa?.trackingCode),
      observacao: doc.observacoes || "",
      externalEntityName: texto(etapa?.externalEntityName),
      costPaid: etapa?.costPaid != null ? String(etapa.costPaid) : "",
      paymentMethod: texto(etapa?.paymentMethod),
    }
  })
  const [saving, setSaving] = useState(false)

  const readOnly = stepStatus === "concluida"

  const canalConfig = form.canal ? CANAIS.find((c) => c.id === form.canal)! : null
  const recomendacao = doc ? getRecomendacao(doc) : null

  // EXIGÊNCIA DE EVIDÊNCIA — QUAL documento mestre esta etapa pede. Vem do
  // servidor, que a lê da configuração oficial. A tela não decide isso por canal
  // nem por rótulo: ela pergunta, e usa o nome/código do cadastro na etiqueta do
  // campo. É o que faz o operador saber que está anexando o requerimento oficial.
  const exig = useApi<{ exigencias?: ExigenciasEtapaView }>(
    isOpen && documentoId && stepId
      ? `/api/documentos/${documentoId}/solicitacoes/exigencias?stepInstanceId=${stepId}${form.canal ? `&canal=${form.canal}` : ""}`
      : null,
  )
  const evidencia = exig.dados?.exigencias?.principal ?? null
  const anexoJaRegistrado = exig.dados?.exigencias?.anexoAtual ?? null

  // VALIDAÇÃO pela configuração OFICIAL do canal — a mesma que o servidor aplica.
  // Antes a regra vivia só aqui dentro; a rota aceitava qualquer coisa.
  const canalDominio = canalDoTexto(form.canal)
  const faltando = canalDominio
    ? faltamCamposDoCanal({
        canal: canalDominio,
        numeroProtocolo: form.protocolo,
        // O que já está REGISTRADO satisfaz a exigência: etapa reaberta não pede
        // de novo o arquivo que o sistema já tem.
        anexoUrl: form.attachmentUrl || anexoJaRegistrado?.url || "",
        codigoRastreio: form.trackingCode,
        observacao: form.observacao,
        destinatarioNome: form.destinatario,
      })
    : ["CANAL_INVALIDO"]
  const errosValidacao = faltando.map((f) => LABEL_CAMPO_FALTANDO[f] ?? f)
  const podeConcluir = errosValidacao.length === 0
  const [erroServidor, setErroServidor] = useState<string | null>(null)

  const handleSalvar = async () => {
    if (readOnly || saving) return
    if (!podeConcluir) {
      setErroServidor("Falta preencher: " + errosValidacao.join(", ") + ".")
      return
    }

    setSaving(true)
    setErroServidor(null)
    try {
      const cost = parseFloat(form.costPaid.replace(",", "."))
      // UMA requisição, UMA transação: solicitação + protocolo + requerimento +
      // observação + conclusão da etapa. O par PUT-documento/PATCH-passo que existia
      // aqui eram duas transações sem garantia de acontecerem juntas — e nenhuma
      // delas criava registro de solicitação, de protocolo ou de anexo.
      const res = await fetch(`/api/documentos/${documentoId}/solicitacoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({
          stepInstanceId: stepId,
          canal: form.canal,
          destinatarioNome: form.destinatario.trim() || null,
          atendente: form.externalEntityName.trim() || null,
          numeroProtocolo: form.protocolo.trim() || null,
          observacao: form.observacao.trim() || null,
          prazoEsperadoDias: form.prazoEsperadoDias.trim() || null,
          codigoRastreio: form.trackingCode.trim() || null,
          custoPago: !isNaN(cost) ? cost : null,
          formaPagamento: form.paymentMethod || null,
          // A CLASSIFICAÇÃO não vem daqui: o servidor resolve o documento mestre
          // pela configuração da etapa. A tela manda o arquivo e seus metadados
          // reais — inclusive o hash, calculado antes do upload.
          requerimento: form.attachmentUrl.trim()
            ? {
                url: form.attachmentUrl.trim(),
                nome: form.attachmentMeta?.name ?? null,
                mimeType: form.attachmentMeta?.type ?? null,
                tamanho: form.attachmentMeta?.size ?? null,
                hash: form.attachmentMeta?.hash ?? null,
              }
            : null,
          concluirEtapa: true,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setErroServidor(mensagemDaSolicitacao(json.error))
        return
      }
      // Só fecha e comemora DEPOIS que o servidor confirmou. Fechar antes era o que
      // fazia a etapa "parecer concluída" mesmo quando a gravação falhava.
      onClose()
      void celebrar()
      onSaved?.()
    } catch (e) {
      console.error("[EditorSolicitarCertidao] salvar:", e)
      setErroServidor(mensagemDaSolicitacao("INTERNAL_ERROR"))
    } finally {
      setSaving(false)
    }
  }

  const bannerErro = erroServidor ? (
    <div className="mb-4 rounded-md border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[12px] text-[#f87171]">
      {erroServidor}
    </div>
  ) : null

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
            className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-[#161b21] rounded-md disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving || readOnly || !podeConcluir}
            className="px-5 py-2 text-[12.5px] font-semibold bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#2563eb]/40 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2"
            title={!podeConcluir ? "Falta: " + errosValidacao.join(", ") : ""}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Confirmar envio · concluir etapa
          </button>
        </div>
      }
    >
      <ReadOnlyBanner stepStatus={stepStatus} />
      {bannerErro}

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-white/50" />
        </div>
      ) : doc ? (
        <>
          {/* ========================================================== */}
          {/* RESUMO DO PEDIDO                                            */}
          {/* ========================================================== */}
          <div className="mb-5 rounded-xl border border-white/10 bg-[#161b21] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/10 bg-[#1b2027] flex items-center gap-2">
              <span className="text-[16px]">📋</span>
              <span className="text-[12px] uppercase font-bold tracking-wider text-white/60">
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
                  <div className="text-[12px] text-[#d2a948]/85 italic">
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
                <div className="rounded-lg border border-white/10 bg-[#161b21] p-3 flex items-start gap-3">
                  <span className="text-[18px] mt-0.5">💡</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-white mb-0.5">
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
                      className="text-[10.5px] font-semibold px-2 py-1 bg-[#d2a948]/20 hover:bg-[#d2a948]/30 text-[#d2a948] rounded border border-[#d2a948]/30 whitespace-nowrap"
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
                      ? "border-[#7dd3fc]/60 bg-[#7dd3fc]/15 ring-1 ring-[#7dd3fc]/40"
                      : "border-white/10 bg-[#161b21] hover:bg-[#20262e]"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-[#7dd3fc]" : "text-white/60"}`} />
                    <span className={`text-[12px] font-semibold ${isSelected ? "text-white" : "text-white/80"}`}>
                      {canal.label}
                    </span>
                    {isSelected && <Check className="w-3 h-3 text-[#7dd3fc] ml-auto" />}
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
                {/* Anexo — rotulado pelo DOCUMENTO MESTRE que a configuração
                    exige. Sem exigência configurada, cai no rótulo do canal:
                    nenhum código é inventado para preencher a etiqueta. */}
                {canalConfig.requires.attachment && (
                  <>
                    <FileUploadField
                      label={
                        evidencia
                          ? `📎 ${evidencia.documentoMestre.name}${evidencia.documentoMestre.publicCode ? ` · ${evidencia.documentoMestre.publicCode}` : ""}`
                          : `📎 ${canalConfig.requires.attachmentLabel}`
                      }
                      required
                      invalid={!form.attachmentUrl.trim() && !anexoJaRegistrado}
                      value={form.attachmentUrl}
                      onChange={(url, meta) =>
                        setForm({
                          ...form,
                          attachmentUrl: url,
                          attachmentMeta: meta
                            ? { name: meta.name, size: meta.size, type: meta.type, hash: meta.hash ?? null }
                            : null,
                        })
                      }
                      disabled={readOnly}
                      prefix={`documentos/${documentoId}/solicitacao`}
                    />
                    {/* Já anexado numa execução anterior desta MESMA etapa: o
                        operador vê o que existe em vez de reenviar às cegas. */}
                    {anexoJaRegistrado && (
                      <div className="rounded-md border border-white/10 bg-[#12161c] px-2.5 py-2 flex items-center gap-2">
                        <Paperclip className="w-3.5 h-3.5 text-white/50 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <a
                            href={anexoJaRegistrado.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[12px] text-white/90 hover:text-white truncate block"
                          >
                            {anexoJaRegistrado.nome}
                          </a>
                          <div className="text-[10px] text-white/45">
                            já registrado nesta etapa
                            {anexoJaRegistrado.documentoMestre
                              ? ` · ${anexoJaRegistrado.documentoMestre.name}${anexoJaRegistrado.documentoMestre.publicCode ? ` (${anexoJaRegistrado.documentoMestre.publicCode})` : ""}`
                              : ""}
                            {form.attachmentUrl.trim() ? " · enviar substitui esta versão (a anterior fica no histórico)" : ""}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Protocolo */}
                {canalConfig.requires.protocol && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label className="text-[10px] uppercase font-semibold tracking-wider text-white/55">
                        🏷 Número do protocolo
                      </label>
                      <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#d2a948]/20 text-[#d2a948] border border-[#d2a948]/40">
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
                      <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#d2a948]/20 text-[#d2a948] border border-[#d2a948]/40">
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
                      <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#d2a948]/20 text-[#d2a948] border border-[#d2a948]/40">
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
                  <Label required>Cartório / destinatário</Label>
                  <input
                    type="text"
                    value={form.destinatario}
                    onChange={(e) => setForm({ ...form, destinatario: e.target.value })}
                    placeholder="ex: 2º Registro Civil de São Paulo"
                    disabled={readOnly}
                    className={form.destinatario.trim() ? inputCls : inputClsInvalid}
                  />
                </div>

                <div>
                  <Label>Atendente</Label>
                  <input
                    type="text"
                    value={form.externalEntityName}
                    onChange={(e) =>
                      setForm({ ...form, externalEntityName: e.target.value })
                    }
                    placeholder="ex: João Silva"
                    disabled={readOnly}
                    className={inputCls}
                  />
                </div>

                <div>
                  {/* Prazo REAL informado pelo cartório — era um campo desabilitado
                      com "~30 dias úteis" fixo, que não ia para lugar nenhum. */}
                  <Label>Prazo esperado (dias)</Label>
                  <input
                    type="number"
                    min={0}
                    value={form.prazoEsperadoDias}
                    onChange={(e) => setForm({ ...form, prazoEsperadoDias: e.target.value })}
                    placeholder="ex: 30"
                    disabled={readOnly}
                    className={inputCls}
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
                    <option value="" className="bg-[#20262e]">
                      — Selecione —
                    </option>
                    {FORMAS_PAGAMENTO.map((fp) => (
                      <option key={fp.id} value={fp.id} className="bg-[#20262e]">
                        {fp.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ========================================================== */}
              {/* ANEXOS DESTA ETAPA                                          */}
              {/* ========================================================== */}
              {/* A MESMA consulta da aba Anexos da etapa e da aba do documento,
                  escopada por stepInstanceId. O requerimento aparece aqui por
                  REFERÊNCIA ao mesmo registro — nenhuma cópia, nenhum upload
                  paralelo. Só leitura: quem anexa nesta etapa é o campo acima. */}
              <div className="mt-5 pt-4 border-t border-white/10">
                <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-2">
                  4. Anexos desta etapa
                </div>
                <AbaAnexosDocumentais documentoId={documentoId} stepInstanceId={stepId} />
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
    <div className="rounded-lg border border-white/10 bg-[#161b21] p-3">
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
//
// PAINEL OPERACIONAL DA ESPERA. Esta etapa é a que ficava sem editor: o passo
// publicado se chama "aguardar_retorno_do_cartorio" e o router antigo só conhecia
// a chave legada, então caía num modal de erro que instruía o operador a usar
// Forçar. Agora a resolução é do registry oficial e este editor é o específico
// da etapa.
//
// O QUE MUDA NA PERSISTÊNCIA
// --------------------------
// O histórico de contatos era texto corrido dentro de `notes`, remontado por
// regex: sem autor, sem estrutura, e sobrescrevível por qualquer edição da nota.
// Agora contatos, observações e anexos são coleções APPEND-ONLY validadas dentro
// do payload operacional do passo, gravadas pela rota transacional de andamento.
//
// PROTOCOLO
// ---------
// A etapa ACOMPANHA o protocolo aberto em "Solicitar certidão" — lê e exibe, e
// não cria nem duplica registro nenhum.

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
  requerimentoUrl: string | null
  trackingCode: string | null
}

const CANAL_LABEL: Record<string, string> = {
  crc: "🌐 CRC Nacional",
  "e-cartorio": "💻 E-cartório",
  ecartorio: "💻 E-cartório",
  email: "📧 E-mail",
  whatsapp: "💬 WhatsApp",
  balcao: "🏛 Balcão",
  comune: "🇮🇹 Comune italiana",
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

/** Casca: carrega, e monta o formulário com a semente já em mãos. */
export function EditorAguardarRetorno(props: StepEditorBaseProps) {
  const { doc, etapa, carregando, recarregar } = useDocumentoEEtapa(
    props.isOpen ? props.documentoId : null,
    props.stepId,
  )
  // A SOLICITAÇÃO vem do registro canônico, não da remontagem do payload da etapa
  // anterior: é o mesmo dado que a aba Protocolo do documento mostra, lido uma vez.
  const solicitacaoReq = useApi<{ resumo?: { solicitacoes: SolicitacaoView[] } }>(
    props.isOpen && props.documentoId ? `/api/documentos/${props.documentoId}/solicitacoes` : null,
  )
  const solicitacao = solicitacaoReq.dados?.resumo?.solicitacoes?.[0] ?? null
  const usuarios = useUsuarios(props.isOpen)
  if (!props.isOpen) return null
  return (
    <FormAguardarRetorno
      key={versaoDe(doc, [etapa, solicitacao])}
      {...props}
      doc={doc}
      etapa={etapa}
      solicitacao={solicitacao}
      usuarios={usuarios}
      loading={carregando || solicitacaoReq.carregando}
      recarregar={recarregar}
    />
  )
}

function FormAguardarRetorno({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
  doc,
  etapa,
  solicitacao,
  usuarios,
  loading,
  recarregar,
}: StepEditorBaseProps & {
  doc: Record<string, unknown> | null
  etapa: EtapaCarregada | null
  solicitacao: SolicitacaoView | null
  usuarios: UsuarioResumo[]
  loading: boolean
  recarregar: () => void
}) {
  const andamento = andamentoDaEtapa(etapa)
  const acoes = acoesDaEtapa(etapa)
  const lockVersion = versaoDaEtapa(etapa)
  const { registrar, salvando, erro } = useAndamento(documentoId, stepId, lockVersion)

  const readOnly = stepStatus === "concluida"
  const podeSalvar = acoes.includes("salvar_andamento") && !readOnly
  const podeConcluir = acoes.includes("concluir") && !readOnly

  // Rascunho dos campos de acompanhamento. Nasce do gravado (a `key` do
  // componente reinicia quando o servidor devolve conteúdo novo).
  const [prazoDias, setPrazoDias] = useState(
    andamento.prazoEstimadoDias != null ? String(andamento.prazoEstimadoDias) : "",
  )
  const [previsao, setPrevisao] = useState(andamento.previsaoRetorno ?? "")
  const [proximo, setProximo] = useState(andamento.proximoAcompanhamento ?? "")
  const [destinatario, setDestinatario] = useState(
    andamento.destinatario ?? textoOuNulo(doc?.cartorio) ?? "",
  )
  const [canalPref, setCanalPref] = useState<CanalContato | "">(andamento.canalPreferencial ?? "")
  const [semRetorno, setSemRetorno] = useState<boolean>(andamento.semRetornoDesde != null)
  const [trackingCode, setTrackingCode] = useState(() => texto(etapa?.trackingCode))
  const [concluindo, setConcluindo] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)

  // Retrato da solicitação — LEITURA do registro canônico. Antes era remontado a
  // partir de campos soltos do documento e do payload do passo anterior: a mesma
  // informação em dois lugares, e nenhum deles autoritativo.
  const solicit = useMemo<SolicitacaoSummary>(() => ({
    atendente: solicitacao?.atendente ?? null,
    cartorio: solicitacao?.destinatarioNome ?? textoOuNulo(doc?.cartorio),
    canal: solicitacao?.canalLabel ?? solicitacao?.canal ?? null,
    protocolo: solicitacao?.protocolos.find((p) => p.vigente)?.numero ?? null,
    link: solicitacao?.linkAcompanhamento ?? null,
    observacao: solicitacao?.observacao ?? null,
    sentAt: solicitacao?.dataEnvio ?? null,
    custoPago: solicitacao?.custoPago ?? null,
    formaPagamento: solicitacao?.formaPagamento ?? null,
    requerimentoUrl: solicitacao?.arquivos.find((a) => a.tipo === "REQUERIMENTO_ENVIADO")?.url ?? null,
    trackingCode: solicitacao?.codigoRastreio ?? null,
  }), [doc, solicitacao])

  const semProtocolo = !solicitacao

  const inicioEspera = textoOuNulo(etapa?.startedAt)
  const previsaoMostrada = previsao || andamento.previsaoEfetiva || ""
  // Instante de referência fixado na montagem: o relógio não é lido durante o
  // render (impuro) e o texto não muda sozinho entre renders.
  const [agoraRef] = useState(() => Date.now())
  const diasEsperando = useMemo(() => {
    if (!inicioEspera) return null
    const d = new Date(inicioEspera)
    if (Number.isNaN(d.getTime())) return null
    return Math.max(0, Math.floor((agoraRef - d.getTime()) / 86400000))
  }, [inicioEspera, agoraRef])

  const apos = async (ok: boolean) => {
    if (ok) { recarregar(); onSaved?.() }
    return ok
  }

  const salvarAndamento = async () => {
    if (!podeSalvar) return
    setFalha(null)
    // Só CAMPOS. Nada aqui conclui a etapa nem exige formulário completo.
    const ok = await registrar({
      campos: {
        prazoEstimadoDias: prazoDias.trim() === "" ? null : Number(prazoDias),
        previsaoRetorno: previsao || null,
        proximoAcompanhamento: proximo || null,
        destinatario: destinatario.trim() || null,
        canalPreferencial: canalPref || null,
        semRetornoDesde: semRetorno
          ? andamento.semRetornoDesde ?? new Date().toISOString().slice(0, 10)
          : null,
      },
    })
    if (!ok) return
    // O código de rastreio é campo do PASSO (não do andamento) e continua indo pelo PATCH.
    if (trackingCode.trim() !== texto(etapa?.trackingCode)) {
      const r = await patchStepComErro(documentoId, stepId, { trackingCode: trackingCode.trim() || null })
      if (!r.ok) { setFalha(mensagemDoErro(r.codigo)); return }
    }
    void apos(true)
  }

  const concluir = async () => {
    if (!podeConcluir || concluindo) return
    setConcluindo(true)
    setFalha(null)
    const r = await patchStepComErro(documentoId, stepId, {
      status: "concluida",
      trackingCode: trackingCode.trim() || null,
    })
    setConcluindo(false)
    if (!r.ok) { setFalha(mensagemDoErro(r.codigo)); return }
    void celebrar()
    onClose()
    onSaved?.()
  }

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Aguardar retorno do cartório"
      subtitle="Acompanhe o protocolo já aberto, registre os contatos e conclua quando o retorno chegar."
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={salvando || concluindo}
            className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-[#161b21] rounded-md disabled:opacity-50"
          >
            Fechar
          </button>
          {podeSalvar && (
            <button
              onClick={salvarAndamento}
              disabled={salvando || concluindo}
              className="px-4 py-2 text-[12.5px] font-semibold bg-[#20262e] hover:bg-[#252c35] disabled:opacity-50 text-white rounded-md inline-flex items-center gap-2"
            >
              {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Salvar andamento
            </button>
          )}
          {podeConcluir && (
            <button
              onClick={concluir}
              disabled={salvando || concluindo}
              className="px-5 py-2 text-[12.5px] font-semibold bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#2563eb]/40 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2"
            >
              {concluindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Confirmar retorno · concluir etapa
            </button>
          )}
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
          {(erro || falha) && (
            <div className="rounded-md border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[12px] text-[#f87171]">
              {falha || erro}
            </div>
          )}

          {/* 1. SITUAÇÃO DA ESPERA */}
          <div className="rounded-lg border border-white/10 bg-[#161b21] overflow-hidden">
            <div className="px-3.5 py-2 bg-[#1b2027] border-b border-white/10 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-[#7dd3fc]" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">
                Situação da espera
              </span>
            </div>
            <div className="p-3.5 grid grid-cols-3 gap-x-4 gap-y-2.5 text-[12px]">
              <SummaryField
                label="Esperando desde"
                value={
                  inicioEspera
                    ? `${new Date(inicioEspera).toLocaleDateString("pt-BR")}${
                        diasEsperando != null ? ` · há ${diasEsperando} dia(s)` : ""
                      }`
                    : null
                }
              />
              <SummaryField label="Previsão de retorno" value={previsaoMostrada ? fmtData(previsaoMostrada) : null} />
              <SummaryField
                label="Próximo acompanhamento"
                value={andamento.proximoAcompanhamento ? fmtData(andamento.proximoAcompanhamento) : null}
              />
              <SummaryField
                label="Último contato"
                value={
                  andamento.contatos.length > 0
                    ? new Date(andamento.contatos[andamento.contatos.length - 1].ocorridoEm).toLocaleString("pt-BR", {
                        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
                      })
                    : null
                }
              />
              <SummaryField label="Responsável" value={(etapa?.assignee as { nome?: string } | null)?.nome ?? null} />
              <SummaryField label="Prazo da etapa (SLA)" value={fmtPrazoSla(textoOuNulo(etapa?.dueAt), agoraRef)} />
            </div>
            {andamento.semRetornoDesde && (
              <div className="px-3.5 py-2 border-t border-[#d2a948]/20 text-[11px] text-[#d2a948] bg-[#d2a948]/5 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                Ausência de retorno registrada desde {fmtData(andamento.semRetornoDesde)}.
              </div>
            )}
          </div>

          {/* 2. PROTOCOLO DA SOLICITAÇÃO (somente leitura — não duplica nada) */}
          <div className="rounded-lg border border-white/10 bg-[#161b21] overflow-hidden">
            <div className="px-3.5 py-2 bg-[#1b2027] border-b border-white/10 flex items-center gap-2">
              <Send className="w-3.5 h-3.5 text-[#7dd3fc]" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">
                Protocolo da solicitação
              </span>
              <span className="ml-auto text-[10px] uppercase tracking-wider text-white/35">somente leitura</span>
            </div>
            <div className="p-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
              <SummaryField label="Cartório / destinatário" value={solicit.cartorio} />
              <SummaryField
                label="Canal da solicitação"
                value={solicit.canal ? CANAL_LABEL[solicit.canal] || solicit.canal : null}
              />
              <SummaryField label="Número do protocolo" value={solicit.protocolo} mono />
              <SummaryField label="Solicitado em" value={fmtDataHoraLonga(solicit.sentAt)} />
              <SummaryField label="Atendente" value={solicit.atendente} />
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
              {/* O REQUERIMENTO e o LINK DE ACOMPANHAMENTO são coisas diferentes
                  e voltam a ser exibidos como tais — juntar os dois num campo só
                  foi o que fez o arquivo enviado sumir de vista. */}
              {solicit.requerimentoUrl && (
                <div className="col-span-2">
                  <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">
                    Requerimento enviado ao cartório
                  </div>
                  <a
                    href={solicit.requerimentoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-[#7dd3fc] hover:underline inline-flex items-center gap-1 break-all"
                  >
                    <Paperclip className="w-3 h-3 flex-shrink-0" />
                    {solicitacao?.arquivos.find((a) => a.tipo === "REQUERIMENTO_ENVIADO")?.nome ?? solicit.requerimentoUrl}
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </a>
                </div>
              )}
              {solicit.link && (
                <div className="col-span-2">
                  <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">
                    Link de acompanhamento
                  </div>
                  <a
                    href={solicit.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-[#7dd3fc] hover:underline inline-flex items-center gap-1 break-all"
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
                  <div className="text-[12px] text-white/80 italic">&ldquo;{solicit.observacao}&rdquo;</div>
                </div>
              )}
            </div>
            {semProtocolo && (
              <div className="px-3.5 py-2 border-t border-[#d2a948]/20 text-[11px] text-[#d2a948] bg-[#d2a948]/5 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                A solicitação ainda não foi preenchida. Reabra a etapa anterior para registrar o protocolo.
              </div>
            )}
            {/* INFORMAR O NÚMERO QUE CHEGOU DEPOIS — é AQUI que o cartório
                responde, e por isso é aqui que o número se registra. Acrescenta
                ao histórico da MESMA solicitação: não cria uma segunda, não
                reenvia o requerimento, não sobrescreve o protocolo anterior. */}
            {solicitacao && (
              <InformarProtocoloInline
                documentoId={documentoId}
                solicitacaoId={solicitacao.id}
                jaTemProtocolo={solicitacao.protocolos.length > 0}
                onRegistrado={() => { recarregar(); onSaved?.() }}
              />
            )}
          </div>

          {/* 3. ACOMPANHAMENTO — campos editáveis, todos opcionais */}
          {podeSalvar && (
            <div>
              <TituloAcompanhamento />
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Prazo estimado (dias)</Label>
                  <input
                    type="number"
                    min={0}
                    value={prazoDias}
                    onChange={(e) => setPrazoDias(e.target.value)}
                    placeholder="15"
                    className={inputCls}
                  />
                </div>
                <div>
                  <Label>Previsão de retorno</Label>
                  <input
                    type="date"
                    value={previsao}
                    onChange={(e) => setPrevisao(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <Label>Próximo acompanhamento</Label>
                  <input
                    type="date"
                    value={proximo}
                    onChange={(e) => setProximo(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Cartório / destinatário do acompanhamento</Label>
                  <input
                    type="text"
                    value={destinatario}
                    onChange={(e) => setDestinatario(e.target.value)}
                    placeholder="Nome do cartório, setor ou e-mail"
                    className={inputCls}
                  />
                </div>
                <div>
                  <Label>Canal preferencial</Label>
                  <select
                    value={canalPref}
                    onChange={(e) => setCanalPref(e.target.value as CanalContato | "")}
                    className={inputCls}
                  >
                    <option value="" className="bg-[#20262e]">—</option>
                    {CANAIS_CONTATO.map((c) => (
                      <option key={c} value={c} className="bg-[#20262e]">
                        {LABEL_CANAL[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <Label>Código de rastreio (Correios, Sedex, motoboy)</Label>
                  <input
                    type="text"
                    value={trackingCode}
                    onChange={(e) => setTrackingCode(e.target.value)}
                    placeholder="ex: BR123456789BR"
                    className={`${inputCls} font-mono`}
                  />
                </div>
                <label className="col-span-3 flex items-center gap-2 text-[12px] text-white/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={semRetorno}
                    onChange={(e) => setSemRetorno(e.target.checked)}
                    className="accent-[#d2a948]"
                  />
                  Registrar AUSÊNCIA de retorno (cartório não respondeu no prazo informado)
                </label>
              </div>
            </div>
          )}

          {/* 4. HISTÓRICO DE CONTATOS */}
          <BlocoContatos
            contatos={andamento.contatos}
            usuarios={usuarios}
            podeRegistrar={acoes.includes("registrar_contato") && !readOnly}
            salvando={salvando}
            onRegistrar={async (contato) => apos(await registrar({ contato }))}
          />
          {/* OBSERVAÇÕES e ANEXOS — os MESMOS registros das abas do documento,
              escopados a esta etapa. Não existe cópia local do dado. */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/55 mb-2">Observações</div>
            <AbaObservacoesDocumentais
              documentoId={documentoId}
              stepInstanceId={stepId}
              podeRegistrar={acoes.includes("registrar_observacao") && !readOnly}
            />
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/55 mb-2">Anexos e comprovantes</div>
            <AbaAnexosDocumentais
              documentoId={documentoId}
              stepInstanceId={stepId}
              podeAnexar={acoes.includes("anexar") && !readOnly}
              tipoPadrao="COMPROVANTE_CONTATO"
            />
          </div>
        </div>
      )}
    </EditorShell>
  )
}

/**
 * INFORMAR PROTOCOLO DEPOIS — a ação que vivia na aba Protocolo do documento e
 * mudou para o lugar onde o fato acontece: a espera pelo cartório.
 *
 * Chama a MESMA rota canônica de antes (`.../solicitacoes/{id}/protocolos`), que
 * acrescenta o número ao histórico da solicitação e liga o requerimento já
 * registrado ao protocolo novo. Nada é duplicado e nada é sobrescrito.
 */
function InformarProtocoloInline({
  documentoId,
  solicitacaoId,
  jaTemProtocolo,
  onRegistrado,
}: {
  documentoId: number
  solicitacaoId: number
  jaTemProtocolo: boolean
  onRegistrado: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [numero, setNumero] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const registrar = async () => {
    const n = numero.trim()
    if (!n || salvando) return
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/documentos/${documentoId}/solicitacoes/${solicitacaoId}/protocolos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ numeroProtocolo: n }),
      })
      if (!res.ok) {
        setErro(res.status === 403 ? "Você não tem permissão para registrar protocolo." : "Não foi possível registrar agora.")
        return
      }
      setNumero("")
      setAberto(false)
      onRegistrado()
    } catch {
      setErro("Não foi possível registrar agora.")
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="px-3.5 py-2.5 border-t border-white/10">
      {!aberto ? (
        <button
          onClick={() => setAberto(true)}
          className="px-2.5 py-1 text-[11px] font-semibold bg-[#20262e] hover:bg-[#252c35] text-white/85 rounded"
        >
          {jaTemProtocolo ? "+ Informar novo protocolo" : "+ Informar protocolo"}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="Número devolvido pelo cartório"
            autoFocus
            className="flex-1 px-2.5 py-1.5 bg-[#12161c] border border-white/10 rounded text-[12px] text-white placeholder-white/30 focus:outline-none focus:border-[#7dd3fc]/50 font-mono"
          />
          <button
            onClick={registrar}
            disabled={salvando || !numero.trim()}
            className="px-3 py-1.5 text-[11px] font-semibold bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 text-white rounded inline-flex items-center gap-1.5"
          >
            {salvando && <Loader2 className="w-3 h-3 animate-spin" />}
            Registrar
          </button>
          <button
            onClick={() => { setAberto(false); setNumero(""); setErro(null) }}
            className="px-2 py-1.5 text-[11px] text-white/60 hover:text-white"
          >
            Cancelar
          </button>
        </div>
      )}
      {erro && <div className="mt-1.5 text-[11px] text-[#f87171]">{erro}</div>}
    </div>
  )
}

function TituloAcompanhamento() {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wider text-white/55 flex items-center gap-1.5 mb-2">
      <Clock className="w-3.5 h-3.5" />
      Acompanhamento
      <span className="ml-1 text-[9.5px] font-medium normal-case tracking-normal text-white/35">
        nenhum campo é obrigatório para salvar
      </span>
    </div>
  )
}

function fmtDataHoraLonga(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

function fmtPrazoSla(dueAt: string | null, agora: number): string | null {
  if (!dueAt) return null
  const d = new Date(dueAt)
  if (Number.isNaN(d.getTime())) return null
  const dias = Math.ceil((d.getTime() - agora) / 86400000)
  const data = d.toLocaleDateString("pt-BR")
  if (dias < 0) return `${data} · ${Math.abs(dias)}d em atraso`
  if (dias === 0) return `${data} · vence hoje`
  return `${data} · ${dias} dia(s)`
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

/** Casca: carrega, e monta o formulário com a semente já em mãos. */
export function EditorReceberCertidao(props: StepEditorBaseProps) {
  const { doc, etapa, carregando } = useDocumentoEEtapa(props.isOpen ? props.documentoId : null, props.stepId)
  if (!props.isOpen) return null
  return (
    <FormReceberCertidao
      key={versaoDe(doc, etapa)}
      {...props}
      doc={doc}
      etapa={etapa}
      loading={carregando}
    />
  )
}

function FormReceberCertidao({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
  doc,
  etapa,
  loading,
}: StepEditorBaseProps & { doc: Record<string, unknown> | null; etapa: EtapaCarregada | null; loading: boolean }) {
  // Os valores iniciais SÃO os do servidor. A ordem de precedência é a mesma de antes:
  // a etapa sobrepõe o documento em `physicalLocation` quando tem valor próprio.
  const [arquivoUrl, setArquivoUrl] = useState(() => texto(doc?.arquivo_url))
  const [arquivoNome, setArquivoNome] = useState(() => texto(doc?.arquivo_nome))
  const [arquivoTamanho, setArquivoTamanho] = useState<number | null>(() => numeroOuNulo(doc?.arquivo_tamanho))
  const [arquivoMime, setArquivoMime] = useState<string | null>(() => textoOuNulo(doc?.arquivo_mime_type))
  const [medium, setMedium] = useState<DocumentMedium | null>(
    () => (etapa?.documentMedium as DocumentMedium) || null,
  )
  const [physicalLocation, setPhysicalLocation] = useState(
    () => texto(etapa?.physicalLocation) || texto(doc?.localizacao_fisica),
  )
  const [observacao, setObservacao] = useState(() => texto(etapa?.stepObservation))
  const [saving, setSaving] = useState(false)
  const [erroServidor, setErroServidor] = useState<string | null>(null)

  const readOnly = stepStatus === "concluida"

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
    setErroServidor(null)
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
      const r = await patchStepComErro(documentoId, stepId, {
        status: "concluida",
        completedById: getUserId(),
        documentMedium: medium,
        physicalLocation: showPhysicalLocation ? (physicalLocation.trim() || null) : null,
        stepObservation: observacao.trim() || null,
      })
      if (!r.ok) {
        // A etapa NÃO concluiu: o modal fica aberto, com o motivo, e o
        // trabalho preenchido continua ali para uma nova tentativa.
        setErroServidor(mensagemDoErro(r.codigo))
        return
      }

      onSaved?.()
    } catch (e) {
      console.error("[EditorReceberCertidao] salvar:", e)
      // "A etapa foi marcada, mas houve erro" era falso nas duas metades: a
      // etapa NÃO foi marcada, e fechar o modal em seguida fazia a fila
      // recarregar como se tivesse dado certo.
      setErroServidor(mensagemDoErro("INTERNAL_ERROR"))
    } finally {
      setSaving(false)
    }
  }

  /**
   * O ERRO DO SERVIDOR PRECISA APARECER.
   *
   * Aqui a falha era `console.warn` seguido de `onSaved?.()`: o modal fechava,
   * a fila recarregava e o operador via sucesso. Um 403 de permissão, um 409 de
   * conflito ou um 422 de regra sumiam — e a etapa continuava aberta sem que
   * ninguém soubesse. Falso sucesso é pior que silêncio.
   */
  const bannerErro = erroServidor ? (
    <div className="mb-4 rounded-md border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[12px] text-[#f87171]">
      {erroServidor}
    </div>
  ) : null

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
            className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-[#161b21] rounded-md disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving || readOnly || !podeConcluir}
            className="px-5 py-2 text-[12.5px] font-semibold bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#2563eb]/40 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Confirmar recebimento · concluir etapa
          </button>
        </div>
      }
    >
      <ReadOnlyBanner stepStatus={stepStatus} />
      {bannerErro}

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
              <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#d2a948]/20 text-[#d2a948] border border-[#d2a948]/40">
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
                        ? "border-[#4ade80]/60 bg-[#4ade80]/10 ring-1 ring-[#4ade80]/30"
                        : "border-white/10 bg-[#161b21] hover:bg-[#20262e]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          ativo
                            ? "border-[#4ade80]/30 bg-[#4ade80]/15"
                            : "border-white/30 bg-transparent"
                        }`}
                      >
                        {ativo && (
                          <div className="w-2 h-2 rounded-full bg-[#1b2027]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-[12.5px] font-semibold flex items-center gap-1.5 ${
                            ativo ? "text-[#4ade80]" : "text-white/85"
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
            <div className="p-3 rounded-lg border border-white/10 bg-[#161b21]">
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

/** Casca: carrega, e monta o formulário com a semente já em mãos. */
export function EditorConferirCertidao(props: StepEditorBaseProps) {
  const { doc, etapa, carregando } = useDocumentoEEtapa(props.isOpen ? props.documentoId : null, props.stepId)
  if (!props.isOpen) return null
  return (
    <FormConferirCertidao
      key={versaoDe(doc, etapa)}
      {...props}
      doc={doc}
      etapa={etapa}
      loading={carregando}
    />
  )
}

/** Pessoa como o documento a traz, para comparar com o que está escrito na certidão. */
function lerPessoa(bruto: unknown): PessoaSummary | null {
  if (!bruto || typeof bruto !== "object") return null
  const p = bruto as Record<string, unknown>
  const parente = (v: unknown) => {
    if (!v || typeof v !== "object") return null
    const r = v as Record<string, unknown>
    return { nome: texto(r.nome), sobrenome: texto(r.sobrenome) }
  }
  return {
    nome: textoOuNulo(p.nome),
    sobrenome: textoOuNulo(p.sobrenome),
    pai: parente(p.pai),
    mae: parente(p.mae),
  }
}

function FormConferirCertidao({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
  doc,
  etapa,
  loading,
}: StepEditorBaseProps & { doc: Record<string, unknown> | null; etapa: EtapaCarregada | null; loading: boolean }) {
  // Dados literais (do documento) — valores iniciais, não cópia por efeito.
  const [nomeRegistrado, setNomeRegistrado] = useState(() => texto(doc?.nome_registrado))
  const [paiRegistrado, setPaiRegistrado] = useState(() => texto(doc?.pai_registrado))
  const [maeRegistrada, setMaeRegistrada] = useState(() => texto(doc?.mae_registrada))
  const [conjugeRegistrado, setConjugeRegistrado] = useState(() => texto(doc?.conjuge_registrado))
  const [dataEventoDoc, setDataEventoDoc] = useState(() => texto(doc?.data_evento_documento).slice(0, 10))
  const [dataRegistroDoc, setDataRegistroDoc] = useState(() => texto(doc?.data_registro_documento).slice(0, 10))

  // Contexto (só leitura — vem do documento)
  const docTipo = textoOuNulo(doc?.tipo)
  const arquivoUrl = textoOuNulo(doc?.arquivo_url)
  const arquivoNome = textoOuNulo(doc?.arquivo_nome)
  const pessoa = useMemo(() => lerPessoa(doc?.pessoa), [doc])

  // Checklist + resultado. O padrão só vale quando a etapa ainda não tem checklist
  // gravado — era o `if (step.reviewChecklist)` do carregador.
  const [checklist, setChecklist] = useState<ReviewChecklist>(() => {
    const gravado = etapa?.reviewChecklist as Record<string, unknown> | undefined
    if (!gravado) {
      return { legivel: true, integro: true, dados_minimos: true, apostila_ok: false, traducao_ok: false }
    }
    return {
      legivel: !!gravado.legivel,
      integro: !!gravado.integro,
      dados_minimos: !!gravado.dados_minimos,
      apostila_ok: !!gravado.apostila_ok,
      traducao_ok: !!gravado.traducao_ok,
    }
  })
  const [resultado, setResultado] = useState<ConferirResultado | null>(
    () => (etapa?.reviewResult as ConferirResultado) || null,
  )
  const [observacao, setObservacao] = useState(() => texto(etapa?.stepObservation))

  const [saving, setSaving] = useState(false)
  const [erroServidor, setErroServidor] = useState<string | null>(null)

  const readOnly = stepStatus === "concluida"

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
    setErroServidor(null)
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
      const r = await patchStepComErro(documentoId, stepId, {
        status: "concluida",
        completedById: getUserId(),
        reviewResult: resultado,
        reviewChecklist: checklist,
        stepObservation: observacao.trim() || null,
      })
      if (!r.ok) {
        // A etapa NÃO concluiu: o modal fica aberto, com o motivo, e o
        // trabalho preenchido continua ali para uma nova tentativa.
        setErroServidor(mensagemDoErro(r.codigo))
        return
      }

      onSaved?.()
    } catch (e) {
      console.error("[EditorConferirCertidao] salvar:", e)
      // "A etapa foi marcada, mas houve erro" era falso nas duas metades: a
      // etapa NÃO foi marcada, e fechar o modal em seguida fazia a fila
      // recarregar como se tivesse dado certo.
      setErroServidor(mensagemDoErro("INTERNAL_ERROR"))
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

  /**
   * O ERRO DO SERVIDOR PRECISA APARECER.
   *
   * Aqui a falha era `console.warn` seguido de `onSaved?.()`: o modal fechava,
   * a fila recarregava e o operador via sucesso. Um 403 de permissão, um 409 de
   * conflito ou um 422 de regra sumiam — e a etapa continuava aberta sem que
   * ninguém soubesse. Falso sucesso é pior que silêncio.
   */
  const bannerErro = erroServidor ? (
    <div className="mb-4 rounded-md border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[12px] text-[#f87171]">
      {erroServidor}
    </div>
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
            className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-[#161b21] rounded-md disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving || readOnly || !podeConcluir}
            className={`px-5 py-2 text-[12.5px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2 ${
              resultado === "aprovado"
                ? "bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#2563eb]/40"
                : resultado === "divergente"
                ? "bg-[#d2a948] hover:bg-[#d2a948]/15 disabled:bg-[#d2a948]/15"
                : resultado === "nova_via"
                ? "bg-rose-500 hover:bg-rose-600 disabled:bg-rose-900"
                : "bg-[#20262e]0 disabled:bg-[#20262e]"
            }`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCheck className="w-3.5 h-3.5" />}
            Registrar conferência · concluir etapa
          </button>
        </div>
      }
    >
      <ReadOnlyBanner stepStatus={stepStatus} />
      {bannerErro}

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-white/50" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Anexo da certidão (link) */}
          {arquivoUrl && (
            <div className="px-3 py-2 rounded-md border border-white/10 bg-[#161b21] flex items-center gap-2">
              <FileCheck className="w-3.5 h-3.5 text-[#7dd3fc] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-white/70">Anexo recebido</div>
                <a
                  href={arquivoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] text-[#7dd3fc] hover:text-[#7dd3fc] hover:underline inline-flex items-center gap-1"
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
              <div className="px-3 py-2 rounded-md bg-[#7dd3fc]/8 border border-[#7dd3fc]/20 mb-3">
                <div className="text-[10px] uppercase font-semibold tracking-wider text-[#7dd3fc] mb-1">
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
                        ? "border-[#4ade80]/40 bg-[#4ade80]/10"
                        : "border-white/10 bg-[#161b21] hover:bg-[#20262e]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          isChecked
                            ? "border-[#4ade80]/30 bg-[#4ade80]/15"
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
                            isChecked ? "text-[#4ade80]" : "text-white/85"
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
      ativo: "border-[#4ade80]/60 bg-[#4ade80]/15 text-[#4ade80]",
      icon: "text-[#4ade80]",
    },
    amber: {
      ativo: "border-[#d2a948]/60 bg-[#d2a948]/15 text-[#d2a948]",
      icon: "text-[#d2a948]",
    },
    red: {
      ativo: "border-[#f87171]/60 bg-[#f87171]/15 text-[#f87171]",
      icon: "text-[#f87171]",
    },
  }
  const cls = colorMap[cor]

  return (
    <button
      onClick={onClick}
      className={`px-3 py-3 rounded-md border text-center transition-all ${
        ativo ? cls.ativo + " ring-1 ring-current/40" : "border-white/10 bg-[#161b21] hover:bg-[#20262e] text-white/80"
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

/** Casca: carrega, e monta o formulário com a semente já em mãos. */
export function EditorValidarCertidao(props: StepEditorBaseProps) {
  const { doc, etapa, etapas, carregando } = useDocumentoEEtapa(props.isOpen ? props.documentoId : null, props.stepId)
  // A conferência (etapa anterior) é contexto de decisão desta tela.
  const conferenciaEtapa = etapas.find((s) => s.stepKey === "conferir_certidao") ?? null
  if (!props.isOpen) return null
  return (
    <FormValidarCertidao
      key={versaoDe(doc, [etapa, conferenciaEtapa])}
      {...props}
      doc={doc}
      etapa={etapa}
      conferenciaEtapa={conferenciaEtapa}
      loading={carregando}
    />
  )
}

function FormValidarCertidao({
  documentoId,
  stepId,
  stepStatus,
  isOpen,
  onClose,
  onSaved,
  doc,
  etapa,
  conferenciaEtapa,
  loading,
}: StepEditorBaseProps & {
  doc: Record<string, unknown> | null
  etapa: EtapaCarregada | null
  conferenciaEtapa: EtapaCarregada | null
  loading: boolean
}) {
  // Contexto vindo do documento — só leitura.
  const docTipo = textoOuNulo(doc?.tipo)
  const arquivoUrl = textoOuNulo(doc?.arquivo_url)
  const arquivoNome = textoOuNulo(doc?.arquivo_nome)
  const pessoaNome = useMemo(() => {
    const p = doc?.pessoa as Record<string, unknown> | undefined
    if (!p) return null
    return `${texto(p.nome)} ${texto(p.sobrenome)}`.trim() || null
  }, [doc])

  // O que a conferência decidiu, exibido como contexto.
  const conferencia = useMemo<ConferenciaSnapshot | null>(() => {
    if (!conferenciaEtapa) return null
    const completedBy = conferenciaEtapa.completedBy as Record<string, unknown> | undefined
    return {
      resultado: (conferenciaEtapa.reviewResult as ConferenciaSnapshot["resultado"]) || null,
      observacao: textoOuNulo(conferenciaEtapa.stepObservation),
      completedBy: completedBy ? textoOuNulo(completedBy.nome) : null,
      completedAt: (conferenciaEtapa.completedAt as string) || null,
    }
  }, [conferenciaEtapa])

  // Decisão: o que já está gravado na etapa; se não há nada gravado, a SUGESTÃO derivada
  // da conferência. Antes isso eram dois efeitos em sequência — carregar e depois
  // pré-selecionar — e a tela mostrava "nenhuma decisão" no meio do caminho.
  const [decisao, setDecisao] = useState<ValidarDecisao | null>(() => {
    const gravada = (etapa?.validationResult as ValidarDecisao) || null
    if (gravada) return gravada
    if (conferenciaEtapa?.reviewResult === "aprovado") return "aprovado"
    if (conferenciaEtapa?.reviewResult === "divergente") return "rejeitado"
    if (conferenciaEtapa?.reviewResult === "nova_via") return "nova_via"
    return null
  })
  const [parecer, setParecer] = useState(() => texto(etapa?.legalOpinion))
  const [saving, setSaving] = useState(false)
  const [erroServidor, setErroServidor] = useState<string | null>(null)

  const readOnly = stepStatus === "concluida"

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
    setErroServidor(null)
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
      const r = await patchStepComErro(documentoId, stepId, {
        status: "concluida",
        completedById: getUserId(),
        validationResult: decisao,
        legalOpinion: parecer.trim() || null,
      })
      if (!r.ok) {
        // A etapa NÃO concluiu: o modal fica aberto, com o motivo, e o
        // trabalho preenchido continua ali para uma nova tentativa.
        setErroServidor(mensagemDoErro(r.codigo))
        return
      }

      onSaved?.()
    } catch (e) {
      console.error("[EditorValidarCertidao] salvar:", e)
      // "A etapa foi marcada, mas houve erro" era falso nas duas metades: a
      // etapa NÃO foi marcada, e fechar o modal em seguida fazia a fila
      // recarregar como se tivesse dado certo.
      setErroServidor(mensagemDoErro("INTERNAL_ERROR"))
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

  /**
   * O ERRO DO SERVIDOR PRECISA APARECER.
   *
   * Aqui a falha era `console.warn` seguido de `onSaved?.()`: o modal fechava,
   * a fila recarregava e o operador via sucesso. Um 403 de permissão, um 409 de
   * conflito ou um 422 de regra sumiam — e a etapa continuava aberta sem que
   * ninguém soubesse. Falso sucesso é pior que silêncio.
   */
  const bannerErro = erroServidor ? (
    <div className="mb-4 rounded-md border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[12px] text-[#f87171]">
      {erroServidor}
    </div>
  ) : null

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title="Validar certidão"
      subtitle="Decisão jurídica final. Ao confirmar, o documento muda de status e o workflow finaliza."
      headerGradient="#161b21"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-[#161b21] rounded-md disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving || readOnly || !podeConcluir}
            className={`px-5 py-2 text-[12.5px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2 ${
              decisao === "aprovado"
                ? "bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#2563eb]/40"
                : decisao === "aprovado_ressalvas"
                ? "bg-[#7dd3fc] hover:bg-[#7dd3fc] disabled:bg-[#7dd3fc]/15"
                : decisao === "nova_via"
                ? "bg-[#d2a948] hover:bg-[#d2a948]/15 disabled:bg-[#d2a948]/15"
                : decisao === "rejeitado"
                ? "bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#2563eb]/40"
                : "bg-[#20262e]0 disabled:bg-[#20262e]"
            }`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scale className="w-3.5 h-3.5" />}
            Confirmar decisão · finalizar etapa
          </button>
        </div>
      }
    >
      <ReadOnlyBanner stepStatus={stepStatus} />
      {bannerErro}

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-white/50" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ═══════════════════════════════════════════════════════
              1. CONTEXTO DA DECISÃO (read-only)
             ═══════════════════════════════════════════════════════ */}
          <div className="rounded-lg border border-white/10 bg-[#161b21] overflow-hidden">
            <div className="px-3.5 py-2 bg-[#1b2027] border-b border-white/10 flex items-center gap-2">
              <Scale className="w-3.5 h-3.5 text-[#d2a948]" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#d2a948]">
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
                    className="text-[12px] text-[#7dd3fc] hover:text-[#7dd3fc] hover:underline inline-flex items-center gap-1 truncate"
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
                  emerald: ativo ? "border-[#4ade80]/60 bg-[#4ade80]/10 ring-1 ring-[#4ade80]/30" : "",
                  blue: ativo ? "border-[#7dd3fc]/60 bg-[#7dd3fc]/10 ring-1 ring-[#7dd3fc]/30" : "",
                  amber: ativo ? "border-[#d2a948]/60 bg-[#d2a948]/10 ring-1 ring-[#d2a948]/30" : "",
                  red: ativo ? "border-[#f87171]/60 bg-[#f87171]/10 ring-1 ring-[#f87171]/30" : "",
                }
                const iconColorMap = {
                  emerald: ativo ? "text-[#4ade80]" : "text-white/60",
                  blue: ativo ? "text-[#7dd3fc]" : "text-white/60",
                  amber: ativo ? "text-[#d2a948]" : "text-white/60",
                  red: ativo ? "text-[#f87171]" : "text-white/60",
                }
                const textColorMap = {
                  emerald: ativo ? "text-[#4ade80]" : "text-white/85",
                  blue: ativo ? "text-[#7dd3fc]" : "text-white/85",
                  amber: ativo ? "text-[#d2a948]" : "text-white/85",
                  red: ativo ? "text-[#f87171]" : "text-white/85",
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
                        : "border-white/10 bg-[#161b21] hover:bg-[#20262e]"
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
                        {ativo && <div className="w-2 h-2 rounded-full bg-[#1b2027]" />}
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
                <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#d2a948]/20 text-[#d2a948] border border-[#d2a948]/40">
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
              <div className="text-[10.5px] text-[#d2a948] mt-1 italic">
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
    meta?: { name: string; size: number; type: string; key: string; hash: string | null } | null,
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
      // Hash ANTES do upload: a impressão digital é do arquivo que o operador
      // escolheu, não do que voltou do storage.
      const hash = await hashDoArquivo(file)
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
          hash,
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
          <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#d2a948]/20 text-[#d2a948] border border-[#d2a948]/40">
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
        <div className="px-3 py-2.5 bg-[#161b21] border border-[#7dd3fc]/40 rounded-md">
          <div className="flex items-center gap-2.5 mb-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7dd3fc] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-white truncate">{fileName}</div>
              <div className="text-[10px] text-white/55">
                Enviando... {progress}% · {formatBytes(fileSize)}
              </div>
            </div>
          </div>
          <div className="h-1 bg-[#20262e] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#2563eb] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : value ? (
        // 2. ARQUIVO CARREGADO
        <div className="px-3 py-2.5 bg-[#4ade80]/5 border border-[#4ade80]/30 rounded-md">
          <div className="flex items-center gap-2.5">
            <FileCheck className="w-4 h-4 text-[#4ade80] flex-shrink-0" />
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
                  className="text-[#7dd3fc] hover:text-[#7dd3fc] hover:underline inline-flex items-center gap-0.5"
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
                  className="text-[10.5px] font-semibold px-2 py-1 bg-[#20262e] hover:bg-[#252c35] rounded text-white"
                >
                  Trocar
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="text-[10.5px] font-semibold px-2 py-1 bg-[#f87171]/15 hover:bg-[#f87171]/25 rounded text-[#f87171] inline-flex items-center gap-1"
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
          className={`w-full px-3 py-3.5 bg-[#161b21] border border-dashed rounded-md text-left hover:bg-[#20262e] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            invalid ? "border-[#d2a948]/40" : "border-white/15"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Upload className={`w-4 h-4 ${invalid ? "text-[#d2a948]" : "text-white/60"}`} />
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
// EDITOR PADRÃO DE ETAPA
// ============================================================
//
// Interface executável de QUALQUER etapa publicada que não tenha editor próprio.
// Substitui o antigo modal de editor ausente, que mandava o operador usar o
// botão Forçar — ou seja, transformava uma lacuna de implementação em obrigação
// de burlar o fluxo.
//
// Ele NÃO adivinha nada sobre a etapa: mostra o que o motor já sabe (situação,
// responsável, prazo, prazo do catálogo), oferece os blocos operacionais comuns
// (contatos, observações, anexos) e conclui — tudo condicionado às AÇÕES que o
// servidor autorizou.

export function DefaultWorkflowStepEditor(
  props: StepEditorBaseProps & { stepTitle?: string | null },
) {
  const { doc, etapa, carregando, recarregar } = useDocumentoEEtapa(
    props.isOpen ? props.documentoId : null,
    props.stepId,
  )
  const usuarios = useUsuarios(props.isOpen)
  if (!props.isOpen) return null
  return (
    <FormPadrao
      key={versaoDe(doc, etapa)}
      {...props}
      etapa={etapa}
      usuarios={usuarios}
      loading={carregando}
      recarregar={recarregar}
    />
  )
}

function FormPadrao({
  documentoId,
  stepId,
  stepStatus,
  stepTitle,
  isOpen,
  onClose,
  onSaved,
  etapa,
  usuarios,
  loading,
  recarregar,
}: StepEditorBaseProps & {
  stepTitle?: string | null
  etapa: EtapaCarregada | null
  usuarios: UsuarioResumo[]
  loading: boolean
  recarregar: () => void
}) {
  const andamento = andamentoDaEtapa(etapa)
  const acoes = acoesDaEtapa(etapa)
  const lockVersion = versaoDaEtapa(etapa)
  const { registrar, salvando, erro } = useAndamento(documentoId, stepId, lockVersion)
  const [concluindo, setConcluindo] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)

  const titulo = stepTitle || texto(etapa?.title) || "Etapa do workflow"
  const readOnly = stepStatus === "concluida"
  const podeConcluir = acoes.includes("concluir")

  const apos = async (ok: boolean) => {
    if (ok) { recarregar(); onSaved?.() }
    return ok
  }

  const concluir = async () => {
    if (!podeConcluir || concluindo) return
    setConcluindo(true)
    setFalha(null)
    const resultado = await patchStepComErro(documentoId, stepId, { status: "concluida" })
    setConcluindo(false)
    if (!resultado.ok) { setFalha(mensagemDoErro(resultado.codigo)); return }
    void celebrar()
    onClose()
    onSaved?.()
  }

  return (
    <EditorShell
      isOpen={isOpen}
      onClose={onClose}
      title={titulo}
      subtitle={
        texto(etapa?.description) ||
        "Registre o andamento desta etapa e conclua quando o trabalho estiver feito."
      }
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-[#161b21] rounded-md"
          >
            Fechar
          </button>
          {podeConcluir && (
            <button
              onClick={concluir}
              disabled={concluindo}
              className="px-5 py-2 text-[12.5px] font-semibold bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2"
            >
              {concluindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Concluir etapa
            </button>
          )}
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
          <SituacaoDaEtapa etapa={etapa} usuarios={usuarios} />

          {(erro || falha) && (
            <div className="rounded-md border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[12px] text-[#f87171]">
              {falha || erro}
            </div>
          )}

          <BlocoContatos
            contatos={andamento.contatos}
            usuarios={usuarios}
            podeRegistrar={acoes.includes("registrar_contato") && !readOnly}
            salvando={salvando}
            onRegistrar={async (contato) => apos(await registrar({ contato }))}
          />
          {/* OBSERVAÇÕES e ANEXOS — os MESMOS registros das abas do documento,
              escopados a esta etapa. Não existe cópia local do dado. */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/55 mb-2">Observações</div>
            <AbaObservacoesDocumentais
              documentoId={documentoId}
              stepInstanceId={stepId}
              podeRegistrar={acoes.includes("registrar_observacao") && !readOnly}
            />
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/55 mb-2">Anexos e comprovantes</div>
            <AbaAnexosDocumentais
              documentoId={documentoId}
              stepInstanceId={stepId}
              podeAnexar={acoes.includes("anexar") && !readOnly}
              tipoPadrao="COMPROVANTE_CONTATO"
            />
          </div>
        </div>
      )}
    </EditorShell>
  )
}

/** Situação atual da etapa — só leitura, direto do motor. */
function SituacaoDaEtapa({
  etapa,
  usuarios,
}: {
  etapa: EtapaCarregada | null
  usuarios: UsuarioResumo[]
}) {
  const responsavelId = numeroOuNulo(etapa?.assigneeId)
  const responsavel =
    (etapa?.assignee as { nome?: string } | null)?.nome ??
    (responsavelId != null ? usuarios.find((u) => u.id === responsavelId)?.nome : null) ??
    null
  const prazoDias = numeroOuNulo(etapa?.slaDays)
  return (
    <div className="rounded-lg border border-white/10 bg-[#161b21] overflow-hidden">
      <div className="px-3.5 py-2 bg-[#1b2027] border-b border-white/10 flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-[#7dd3fc]" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">Situação atual</span>
      </div>
      <div className="p-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
        <SummaryField label="Responsável" value={responsavel} />
        <SummaryField label="Iniciada em" value={fmtDataHoraCurta(textoOuNulo(etapa?.startedAt))} />
        <SummaryField label="Prazo da etapa" value={fmtDataHoraCurta(textoOuNulo(etapa?.dueAt))} />
        <SummaryField label="SLA previsto" value={prazoDias != null ? `${prazoDias} dia(s)` : null} />
      </div>
    </div>
  )
}

function fmtDataHoraCurta(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}