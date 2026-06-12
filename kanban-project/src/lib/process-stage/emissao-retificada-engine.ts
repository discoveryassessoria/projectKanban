// src/lib/process-stage/emissao-retificada-engine.ts
//
// Motor PURO da fase EMISSÃO DOCUMENTAL RETIFICADA (sem Prisma — importável no client).
// Portado da lógica de completeRetifiedEmissionStep / transitionRectifiedEmissionStatus
// do mockup Operacional_bom.html.
//
// Fase POR DOCUMENTO: cada documento impactado pela retificação tem seu próprio
// workflow de 6 etapas (RE_STEPS). A fase conclui quando TODOS os documentos estão
// validados → quem chama (a rota) move o card para "Tradução juramentada".

// ============================================================
// CONSTANTES (literais do mockup)
// ============================================================

export const RE_STEPS: Array<[string, string]> = [
  ["enviar_pedido_averbacao", "Enviar pedido de averbação ao cartório"],
  ["solicitar_certidao_retificada", "Solicitar certidão retificada"],
  ["aguardar_retorno_cartorio_retificado", "Aguardar retorno do cartório"],
  ["receber_certidao_retificada", "Receber certidão retificada"],
  ["conferir_certidao_retificada", "Conferir certidão retificada"],
  ["validar_certidao_retificada", "Validar certidão retificada"],
]

// statusEmissaoRetificada possíveis (RE_LABEL no front)
export const RE_STATUS = {
  PENDENTE_AVERBACAO: "pendente_averbacao",
  AVERBACAO_ENVIADA: "averbacao_enviada",
  SOLICITADA: "solicitada",
  AGUARDANDO_RETORNO: "aguardando_retorno_concluido",
  RECEBIDA: "recebida",
  CONFERIDA: "conferida",
  VALIDADA: "validada",
  DIVERGENTE: "divergente",
  NOVA_VIA: "nova_via",
  REABRIR_AVERBACAO: "reabrir_averbacao",
} as const

// próxima ação exibida por etapa pendente
const NEXT_ACTION: Record<string, string> = {
  enviar_pedido_averbacao: "Enviar pedido de averbação ao cartório",
  solicitar_certidao_retificada: "Solicitar certidão retificada",
  aguardar_retorno_cartorio_retificado: "Aguardar retorno do cartório",
  receber_certidao_retificada: "Receber certidão retificada",
  conferir_certidao_retificada: "Conferir certidão retificada",
  validar_certidao_retificada: "Validar certidão retificada",
}

// ============================================================
// TIPOS
// ============================================================

export type ReStepStatus = "bloqueada" | "pendente" | "em_andamento" | "concluida"
export interface ReStep { id: string; title: string; status: ReStepStatus; doneAt: string | null }
export interface ReWorkflow {
  status: "em_andamento" | "concluido"
  currentStep: string
  steps: ReStep[]
  averbacao: Record<string, unknown>
  solicitation: Record<string, unknown>
  waitingReturn: Record<string, unknown>
  receipt: Record<string, unknown>
  conference: Record<string, unknown>
  validation: Record<string, unknown>
}

export interface ApplyResult {
  ok: boolean
  error?: string
  status: string              // novo statusEmissaoRetificada
  nextAction: string
  workflow: ReWorkflow
  validated: boolean          // documento validado (workflow concluído) nesta chamada
  rejected?: boolean          // divergente / nova_via / reabrir_averbacao (volta etapa)
}

// ============================================================
// HELPERS
// ============================================================

const today = () => new Date().toLocaleDateString("pt-BR")

export function buildInitialWorkflow(): ReWorkflow {
  return {
    status: "em_andamento",
    currentStep: RE_STEPS[0][0],
    steps: RE_STEPS.map((s, i) => ({ id: s[0], title: s[1], status: i === 0 ? "pendente" : "bloqueada", doneAt: null })),
    averbacao: {}, solicitation: {}, waitingReturn: {}, receipt: {}, conference: {}, validation: {},
  }
}

export function reProgress(wf: ReWorkflow): number {
  return Math.round((wf.steps.filter((s) => s.status === "concluida").length / 6) * 100)
}

function stepOf(wf: ReWorkflow, id: string) { return wf.steps.find((s) => s.id === id) }
function idx(id: string) { return RE_STEPS.findIndex((s) => s[0] === id) }

function concludeAndUnlock(wf: ReWorkflow, stepId: string) {
  const s = stepOf(wf, stepId)
  if (!s) return
  s.status = "concluida"; s.doneAt = today()
  const i = idx(stepId)
  if (wf.steps[i + 1]) { wf.steps[i + 1].status = "pendente"; wf.currentStep = wf.steps[i + 1].id }
}

// volta o workflow para uma etapa anterior (bloqueia as posteriores e reabre a alvo)
function rewindTo(wf: ReWorkflow, stepId: string) {
  const i = idx(stepId)
  wf.steps.forEach((s, j) => { if (j > i) s.status = "bloqueada" })
  const target = stepOf(wf, stepId)!
  target.status = "pendente"; target.doneAt = null
  wf.currentStep = stepId
}

// ============================================================
// applyStep — espelha completeRetifiedEmissionStep do mockup
// ============================================================

export function applyStep(wf: ReWorkflow, currentStatus: string, stepId: string, payload: Record<string, any> = {}): ApplyResult {
  const step = stepOf(wf, stepId)
  const base = (status: string, nextAction: string, validated = false, rejected = false): ApplyResult =>
    ({ ok: true, status, nextAction, workflow: wf, validated, rejected })
  const fail = (error: string): ApplyResult =>
    ({ ok: false, error, status: currentStatus, nextAction: NEXT_ACTION[wf.currentStep] || "", workflow: wf, validated: false })

  if (!step || step.status === "bloqueada") return fail("Esta etapa ainda está bloqueada.")

  switch (stepId) {
    case "enviar_pedido_averbacao": {
      if (!payload.cartorio || !payload.canal || !payload.dataEnvio || (!payload.protocolo && !payload.comprovante))
        return fail("Preencha cartório, canal, data de envio e protocolo ou comprovante.")
      wf.averbacao = payload
      concludeAndUnlock(wf, stepId)
      return base(RE_STATUS.AVERBACAO_ENVIADA, NEXT_ACTION[wf.currentStep])
    }
    case "solicitar_certidao_retificada": {
      if (!payload.canal || !payload.protocolo || !payload.comprovante)
        return fail("Informe canal, protocolo e comprovante da solicitação.")
      wf.solicitation = payload
      concludeAndUnlock(wf, stepId)
      return base(RE_STATUS.SOLICITADA, NEXT_ACTION[wf.currentStep])
    }
    case "aguardar_retorno_cartorio_retificado": {
      wf.waitingReturn = payload
      concludeAndUnlock(wf, stepId)
      return base(RE_STATUS.AGUARDANDO_RETORNO, NEXT_ACTION[wf.currentStep])
    }
    case "receber_certidao_retificada": {
      if (!payload.anexo || !payload.tipoMidia)
        return fail("Anexe a certidão retificada e selecione o tipo de mídia.")
      wf.receipt = payload
      concludeAndUnlock(wf, stepId)
      return base(RE_STATUS.RECEBIDA, NEXT_ACTION[wf.currentStep])
    }
    case "conferir_certidao_retificada": {
      if (!payload.resultado) return fail("Selecione o resultado da conferência.")
      if (payload.resultado === "divergente") {
        // não conclui a etapa; marca divergência e NÃO libera a validação
        return base(RE_STATUS.DIVERGENTE, "Resolver divergência pós-retificação", false, true)
      }
      if (payload.resultado === "nova_via") {
        // volta para Solicitar certidão retificada
        rewindTo(wf, "solicitar_certidao_retificada")
        return base(RE_STATUS.NOVA_VIA, NEXT_ACTION["solicitar_certidao_retificada"], false, true)
      }
      // aprovar
      wf.conference = payload
      concludeAndUnlock(wf, stepId)
      return base(RE_STATUS.CONFERIDA, NEXT_ACTION[wf.currentStep])
    }
    case "validar_certidao_retificada": {
      if (!payload.decision) return fail("Selecione a decisão final.")
      if (payload.decision === "nova_via") {
        rewindTo(wf, "solicitar_certidao_retificada")
        return base(RE_STATUS.NOVA_VIA, NEXT_ACTION["solicitar_certidao_retificada"], false, true)
      }
      if (payload.decision === "reabrir_averbacao") {
        rewindTo(wf, "enviar_pedido_averbacao")
        return base(RE_STATUS.REABRIR_AVERBACAO, "Reenviar pedido de averbação", false, true)
      }
      // aprovado / aprovado_ressalvas → documento validado, workflow concluído
      wf.validation = payload
      concludeAndUnlock(wf, stepId)
      wf.status = "concluido"
      return base(RE_STATUS.VALIDADA, "Documento validado", true)
    }
    default:
      return fail("Etapa desconhecida.")
  }
}

// todos os documentos validados? (a rota usa pra mover o card p/ Tradução)
export function allValidated(docs: Array<{ status: string }>): boolean {
  return docs.length > 0 && docs.every((d) => d.status === RE_STATUS.VALIDADA)
}