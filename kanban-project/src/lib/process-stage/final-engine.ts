// ============================================================
// src/lib/process-stage/final-engine.ts
// ------------------------------------------------------------
// Cérebro PURO das 3 fases finais (Aguardando protocolo / Protocolado /
// Finalizado). Espelha FINAL_CFG (~3103) e completeFinalStep (~3351).
// Sem Prisma, sem Next — importável também no client (a tela usa FINAL_CFG).
//
// ESCOPO: só o workflow visível das fases. O "motor de protocolo"
// (devolução automática por exigência) NÃO está aqui — é máquina à parte.
// ============================================================

export type FaseKey = "waitingProtocol" | "protocolado" | "finalizado"

export interface FinalStepDef {
  id: string
  title: string
  desc: string
  req?: string[]      // campos obrigatórios (fnNum, fnData, fnOrgao...)
  needsChk?: boolean  // exige checklist marcado
  isDecision?: boolean // etapa de decisão (deferido/exigencia/indeferido)
}
export interface FinalCfg {
  key: FaseKey
  faseCode: string
  phaseName: string
  next: string | null // faseCode destino ao concluir (null = fim)
  icon: string
  obj: string
  ctxTitle: string
  ctxText: string
  advanceMsg: string
  steps: FinalStepDef[]
}

export const FINAL_CFG: Record<FaseKey, FinalCfg> = {
  waitingProtocol: {
    key: "waitingProtocol", faseCode: "AGUARDANDO_PROTOCOLO", phaseName: "Aguardando protocolo",
    next: "PROTOCOLADO", icon: "📋",
    obj: "Reunir o dossiê final apostilado e protocolar o pedido no órgão de destino (consulado, comune ou tribunal).",
    ctxTitle: "Protocolo do processo",
    ctxText: "Todos os documentos finais (traduzidos e apostilados) são reunidos em um dossiê único e protocolados no órgão competente. A fase conclui quando o protocolo é confirmado.",
    advanceMsg: "Pedido protocolado. Processo movido para Protocolado.",
    steps: [
      { id: "montar_dossie_final", title: "Montar dossiê final", desc: "Reúna todos os documentos apostilados e traduzidos do processo em um dossiê único.", needsChk: true },
      { id: "agendar_protocolo", title: "Agendar protocolo", desc: "Defina o órgão de destino, a data e o canal de protocolo.", req: ["fnOrgao", "fnData"] },
      { id: "protocolar_pedido", title: "Protocolar pedido", desc: "Registre o protocolo do pedido no órgão (número/recibo).", req: ["fnNum", "fnData"] },
    ],
  },
  protocolado: {
    key: "protocolado", faseCode: "PROTOCOLADO", phaseName: "Protocolado",
    next: "FINALIZADO", icon: "📨",
    obj: "Acompanhar o andamento do pedido protocolado junto ao órgão até a decisão final.",
    ctxTitle: "Acompanhamento do protocolo",
    ctxText: "O pedido foi protocolado e aguarda análise do órgão. Acompanhe exigências, prazos e registre a decisão quando ela chegar.",
    advanceMsg: "Decisão favorável recebida. Processo movido para Finalizado.",
    steps: [
      { id: "registrar_protocolo", title: "Registrar nº do protocolo", desc: "Confirme o número/recibo do protocolo e a data de entrada no órgão.", req: ["fnNum"] },
      { id: "acompanhar_andamento", title: "Acompanhar andamento", desc: "Registre exigências, contatos e movimentações junto ao órgão." },
      { id: "receber_decisao", title: "Receber decisão", desc: "Registre o resultado: deferido, exigência ou indeferido.", isDecision: true },
    ],
  },
  finalizado: {
    key: "finalizado", faseCode: "FINALIZADO", phaseName: "Finalizado",
    next: null, icon: "🏁",
    obj: "Confirmar o reconhecimento, entregar a documentação ao cliente e encerrar o processo.",
    ctxTitle: "Encerramento do processo",
    ctxText: "O reconhecimento foi deferido. Entregue a documentação final ao cliente e arquive o processo.",
    advanceMsg: "Processo finalizado e arquivado.",
    steps: [
      { id: "confirmar_deferimento", title: "Confirmar deferimento", desc: "Confirme o reconhecimento da cidadania / deferimento do pedido." },
      { id: "entregar_documentacao", title: "Entregar documentação ao cliente", desc: "Registre a entrega da documentação final ao requerente.", req: ["fnData"] },
      { id: "encerrar_processo", title: "Encerrar e arquivar", desc: "Encerre o processo e arquive toda a documentação.", needsChk: true },
    ],
  },
}

const FASECODE_TO_KEY: Record<string, FaseKey> = {
  AGUARDANDO_PROTOCOLO: "waitingProtocol",
  PROTOCOLADO: "protocolado",
  FINALIZADO: "finalizado",
}
export function keyFromFaseCode(faseCode: string | null | undefined): FaseKey | null {
  return faseCode ? FASECODE_TO_KEY[faseCode] ?? null : null
}

export interface FinalWorkflowStep {
  id: string
  title: string
  status: "bloqueada" | "pendente" | "em_andamento" | "concluida"
  doneAt: string | null
}
export interface FinalState {
  status: string
  currentStep: string
  data: Record<string, unknown>
  workflow: FinalWorkflowStep[]
}

export interface FinalApplyResult {
  ok: boolean
  error?: string
  state?: FinalState
  completePhase?: boolean       // fase concluiu
  advanceToFaseCode?: string | null // coluna destino (null = não move)
  recordedOnly?: boolean        // exigência/indeferido: registrou mas não concluiu
  historyMessage?: string
}

const brDate = () => new Date().toLocaleDateString("pt-BR")
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

export function buildInitialWorkflow(key: FaseKey): FinalWorkflowStep[] {
  return FINAL_CFG[key].steps.map((s, i) => ({
    id: s.id, title: s.title, status: i === 0 ? "pendente" : "bloqueada", doneAt: null,
  }))
}
export function calcProgress(workflow: FinalWorkflowStep[]): number {
  if (!workflow.length) return 0
  return Math.round((workflow.filter((s) => s.status === "concluida").length / workflow.length) * 100)
}

export function applyStep(
  key: FaseKey,
  stateIn: FinalState,
  stepId: string,
  payload: any = {},
): FinalApplyResult {
  const cfg = FINAL_CFG[key]
  const state = clone(stateIn)
  const sdef = cfg.steps.find((s) => s.id === stepId)
  const step = state.workflow.find((s) => s.id === stepId)
  if (!sdef || !step) return { ok: false, error: "Etapa inexistente." }
  if (step.status === "bloqueada") return { ok: false, error: "Esta etapa ainda está bloqueada." }

  const has = (k: string) => {
    const v = payload[k]
    return typeof v === "string" ? v.trim().length > 0 : !!v
  }

  // validações
  if (sdef.needsChk && !payload.chkOk) return { ok: false, error: "Confirme o checklist desta etapa." }
  if (sdef.req && !sdef.req.every(has)) return { ok: false, error: "Preencha os campos obrigatórios." }

  // etapa de decisão (receber_decisao)
  if (sdef.isDecision) {
    if (!payload.decision) return { ok: false, error: "Selecione o resultado da decisão." }
    if (payload.decision !== "deferido") {
      state.data.lastDecision = payload.decision
      state.data[`obs_${stepId}`] = payload.fnF1 || ""
      // NÃO conclui a etapa: fase aguarda deferimento
      return {
        ok: true, state, recordedOnly: true,
        historyMessage: `Protocolado: decisão "${payload.decision}" registrada (fase não conclui).`,
      }
    }
  }

  // grava os campos preenchidos no saco de dados
  for (const k of ["fnNum", "fnData", "fnOrgao", "fnCanal", "fnF1", "decision"]) {
    if (payload[k] !== undefined && payload[k] !== "") state.data[k] = payload[k]
  }

  // conclui a etapa e libera a próxima
  step.status = "concluida"
  step.doneAt = brDate()
  const i = state.workflow.findIndex((s) => s.id === stepId)
  if (state.workflow[i + 1]) {
    state.workflow[i + 1].status = "pendente"
    state.currentStep = state.workflow[i + 1].id
  }

  const isLast = cfg.steps[cfg.steps.length - 1].id === stepId
  if (isLast) {
    state.status = "concluida"
    return {
      ok: true, state, completePhase: true, advanceToFaseCode: cfg.next,
      historyMessage: cfg.next ? `${cfg.phaseName} concluída. ${cfg.advanceMsg}` : cfg.advanceMsg,
    }
  }

  return { ok: true, state, historyMessage: `Etapa "${sdef.title}" concluída em ${cfg.phaseName}.` }
}