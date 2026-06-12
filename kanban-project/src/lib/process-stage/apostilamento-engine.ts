// ============================================================
// src/lib/process-stage/apostilamento-engine.ts
// ------------------------------------------------------------
// Cérebro PURO da fase "Apostilamento" (pasta única por processo).
// Clone do traducao-engine, espelhando completeApostilleStep (~3656).
// Sem Prisma, sem Next. As rotas chamam applyStep() e gravam.
// ============================================================

// ---- Listas autoritativas (AP_STEPS / AP_SHORT do mockup) ----
export const AP_STEPS = [
  ["montar_pasta_apostilamento", "Montar pasta de apostilamento"],
  ["enviar_para_apostilamento", "Enviar para apostilamento"],
  ["aguardar_retorno_apostilamento", "Aguardar retorno"],
  ["receber_documentos_apostilados", "Receber documentos apostilados"],
  ["conferir_apostilas", "Conferir apostilas"],
  ["validar_pasta_apostilada", "Validar pasta apostilada"],
] as const

export const AP_SHORT = [
  "Montar pasta", "Enviar p/ apostilamento", "Aguardar retorno",
  "Receber apostilados", "Conferir apostilas", "Validar pasta",
] as const

export const AP_DOC_LABEL: Record<string, string> = {
  pendente: "Pendente",
  incluido_na_pasta: "Incluído na pasta",
  enviado: "Enviado",
  apostila_recebida: "Apostila recebida",
  conferido: "Conferido",
  validado: "Validado",
  correcao_solicitada: "Correção solicitada",
  bloqueado: "Bloqueado",
}

export const DEFAULT_DOC_STATUS = "pendente"

export type ApStepId = (typeof AP_STEPS)[number][0]
export type ApStepStatus = "bloqueada" | "pendente" | "em_andamento" | "concluida"
export type ApDocStatus =
  | "pendente" | "incluido_na_pasta" | "enviado" | "apostila_recebida"
  | "conferido" | "validado" | "correcao_solicitada" | "bloqueado"

export interface ApWorkflowStep {
  id: ApStepId
  title: string
  status: ApStepStatus
  doneAt: string | null
}

export interface ApDoc {
  documentoId: number
  pessoaNome: string
  documentoTitulo: string
  origem: string
  status: ApDocStatus
  apostilledFile: string | null
  apostilleNumber: string | null
  apostilleDate: string | null
  issuingAuthority: string | null
  conferenceResult: string | null
  validationDecision: string | null
}

// Datas (sentAt/expectedDate/receivedAt) trafegam como "dd/mm/aaaa" cru;
// a ROTA converte para Date antes do Prisma. validatedAt é setado pela rota.
export interface ApFolder {
  status: string
  currentStep: ApStepId
  destinationCountry: string | null
  apostilleType: string | null
  authorityName: string | null
  attendant: string | null
  cost: string | null
  trackingCode: string | null
  sentAt: string | null
  expectedDate: string | null
  receivedAt: string | null
  workflow: ApWorkflowStep[]
}

export interface ApplyStepResult {
  ok: boolean
  error?: string
  folder?: ApFolder
  docs?: ApDoc[]
  completePhase?: boolean // aprovado → fase conclui e card avança p/ Aguardando protocolo
  rejected?: boolean      // correção/bloqueio → volta ao envio
  decision?: string
  historyMessage?: string
}

function brDate(): string {
  return new Date().toLocaleDateString("pt-BR")
}
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export function buildInitialWorkflow(): ApWorkflowStep[] {
  return AP_STEPS.map(([id, title], i) => ({
    id, title, status: i === 0 ? "pendente" : "bloqueada", doneAt: null,
  }))
}

export function calcProgress(workflow: ApWorkflowStep[]): number {
  if (!workflow.length) return 0
  return Math.round((workflow.filter((s) => s.status === "concluida").length / workflow.length) * 100)
}

function concludeAndUnlock(folder: ApFolder, stepId: ApStepId) {
  const i = folder.workflow.findIndex((s) => s.id === stepId)
  folder.workflow[i].status = "concluida"
  folder.workflow[i].doneAt = brDate()
  if (folder.workflow[i + 1]) {
    folder.workflow[i + 1].status = "pendente"
    folder.currentStep = folder.workflow[i + 1].id
  }
}

// ============================================================
// applyStep — espelha completeApostilleStep (~3656). Não muta os argumentos.
// ============================================================
export function applyStep(
  folderIn: ApFolder,
  docsIn: ApDoc[],
  stepId: ApStepId,
  payload: any = {},
): ApplyStepResult {
  const folder = clone(folderIn)
  const docs = clone(docsIn)
  const step = folder.workflow.find((s) => s.id === stepId)

  if (!step) return { ok: false, error: "Etapa inexistente." }
  if (step.status === "bloqueada") return { ok: false, error: "Esta etapa ainda está bloqueada." }

  const setAllDocs = (s: ApDocStatus) => docs.forEach((d) => { d.status = s })
  const done = (msg: string): ApplyStepResult => ({ ok: true, folder, docs, historyMessage: msg })
  const histStep = `Etapa "${step.title}" concluída no Apostilamento.`

  switch (stepId) {
    // 1) Montar pasta — exige país, tipo e checklist
    case "montar_pasta_apostilamento": {
      if (!docs.length || !payload.destinationCountry || !payload.apostilleType || !payload.checklistOk) {
        return { ok: false, error: "Revise documentos, país, tipo e checklist." }
      }
      folder.destinationCountry = payload.destinationCountry
      folder.apostilleType = payload.apostilleType
      setAllDocs("incluido_na_pasta")
      concludeAndUnlock(folder, stepId)
      return done(histStep)
    }

    // 2) Enviar para apostilamento — autoridade + envio + prazo + canal
    case "enviar_para_apostilamento": {
      if (!payload.authorityName || !payload.sentAt || !payload.expectedDate || !payload.sendMethod) {
        return { ok: false, error: "Preencha autoridade, data de envio, prazo e canal." }
      }
      folder.authorityName = String(payload.authorityName).trim()
      folder.attendant = payload.attendant || null
      folder.sentAt = payload.sentAt
      folder.expectedDate = payload.expectedDate
      folder.cost = payload.cost || null
      folder.trackingCode = payload.trackingCode || null
      setAllDocs("enviado")
      concludeAndUnlock(folder, stepId)
      return done(histStep)
    }

    // 3) Aguardar retorno — sem obrigatório
    case "aguardar_retorno_apostilamento": {
      concludeAndUnlock(folder, stepId)
      return done(histStep)
    }

    // 4) Receber apostilados — data + anexo de todos + nº/data por documento
    case "receber_documentos_apostilados": {
      if (!payload.receivedAt) return { ok: false, error: "Informe a data de recebimento." }
      const files: Record<string, string> = payload.files || {}
      const nums: Record<string, string> = payload.apostilleNumbers || {}
      const dates: Record<string, string> = payload.apostilleDates || {}
      const auths: Record<string, string> = payload.issuingAuthorities || {}
      const allFiles = docs.every((d) => d.apostilledFile || files[d.documentoId])
      if (!allFiles) return { ok: false, error: "Anexe o documento apostilado de todos os itens." }
      folder.receivedAt = payload.receivedAt
      folder.cost = payload.custoFinal || folder.cost
      docs.forEach((d) => {
        d.apostilledFile = d.apostilledFile || files[d.documentoId] || null
        d.apostilleNumber = nums[d.documentoId] || d.apostilleNumber
        d.apostilleDate = dates[d.documentoId] || d.apostilleDate
        d.issuingAuthority = auths[d.documentoId] || d.issuingAuthority
        d.status = "apostila_recebida"
      })
      concludeAndUnlock(folder, stepId)
      return done(histStep)
    }

    // 5) Conferir apostilas
    case "conferir_apostilas": {
      const results: Record<string, string> = payload.results || {}
      docs.forEach((d) => {
        if (results[d.documentoId]) d.conferenceResult = results[d.documentoId]
        if (!d.conferenceResult) d.conferenceResult = "aprovar"
      })
      const allConf = docs.every(
        (d) => d.conferenceResult &&
          d.conferenceResult !== "divergencia_critica" &&
          d.conferenceResult !== "correcao_solicitada",
      )
      if (!allConf) {
        return { ok: false, error: "Todos os documentos precisam estar conferidos sem correção pendente." }
      }
      setAllDocs("conferido")
      concludeAndUnlock(folder, stepId)
      return done(histStep)
    }

    // 6) Validar pasta apostilada
    case "validar_pasta_apostilada": {
      if (!payload.decision) return { ok: false, error: "Selecione a decisão final." }

      if (payload.decision === "solicitar_correcao" || payload.decision === "bloquear") {
        const iEnviar = folder.workflow.findIndex((s) => s.id === "enviar_para_apostilamento")
        folder.workflow.forEach((s, j) => { if (j > iEnviar) s.status = "bloqueada" })
        folder.workflow[iEnviar].status = "pendente"
        folder.currentStep = "enviar_para_apostilamento"
        folder.status = "bloqueada"
        docs.forEach((d) => { if (d.status === "validado") d.status = "enviado" })
        return {
          ok: true, folder, docs, rejected: true, decision: payload.decision,
          historyMessage: payload.decision === "bloquear"
            ? "Pasta bloqueada na validação." : "Correção solicitada.",
        }
      }

      step.status = "concluida"
      step.doneAt = brDate()
      folder.status = "concluida"
      docs.forEach((d) => { d.status = "validado"; d.validationDecision = payload.decision })
      return {
        ok: true, folder, docs, completePhase: true, decision: payload.decision,
        historyMessage: "Apostilamento concluído: pasta apostilada validada.",
      }
    }
  }

  return { ok: false, error: "Etapa desconhecida." }
}