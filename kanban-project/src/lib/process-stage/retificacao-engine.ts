// ============================================================
// src/lib/process-stage/retificacao-engine.ts
// ------------------------------------------------------------
// Cérebro PURO da fase "Retificação de registros" (por PACOTES).
// Espelha RET_STEPS (~2031) e completeRetificationPackageStep (~2293)
// + os modais step* (~2304-2392). Sem Prisma, sem Next.
//
// ESCOPO: núcleo visível — criar pacote, 6 passos jud/adm,
// movimentações/anexos como listas, validar. FORA: auditoria de
// transição, modais de ação sensível (cancelar/reabrir/trocar tipo).
// ============================================================

export const RET_STEPS: Array<[string, string]> = [
  ["definir_estrategia", "Definir estratégia"],
  ["montar_dossie", "Montar dossiê"],
  ["protocolar", "Protocolar retificação"],
  ["acompanhar", "Acompanhar andamento"],
  ["receber_decisao", "Receber decisão / averbação"],
  ["validar_registros", "Validar registros corrigidos"],
]
export const RET_STEP_IDS = RET_STEPS.map((s) => s[0])

export const RET_STATUS_LABEL: Record<string, string> = {
  em_preparacao: "Em preparação",
  protocolado: "Protocolado",
  em_exigencia: "Em exigência",
  decisao_recebida: "Decisão recebida",
  validado: "Validado",
  bloqueado: "Bloqueado",
}

export interface RetWorkflowStep {
  id: string
  title: string
  status: "bloqueada" | "pendente" | "em_andamento" | "concluida"
  doneAt: string | null
}
export interface RetMovement { data: string; tipo: string; desc: string; resp?: string; prox?: string }
export interface RetAttachment { nome: string; cat: string; data: string; por?: string; obs?: string }

// Forma "plana" do pacote (colunas + Json já parseado) que a rota monta.
export interface RetPkg {
  tipo: string
  status: string
  currentStep: string
  motivo: string | null
  prioridade: string | null
  proxAcao: string | null
  processoNum: string | null
  tribunal: string | null
  vara: string | null
  comarca: string | null
  advogado: string | null
  oab: string | null
  statusProc: string | null
  cartorio: string | null
  canal: string | null
  protocolo: string | null
  dataProtocolo: string | null
  atendente: string | null
  prazo: string | null
  statusAdm: string | null
  workflow: RetWorkflowStep[]
  movements: RetMovement[]
  attachments: RetAttachment[]
  validacao: Record<string, unknown> | null
}

export interface RetApplyResult {
  ok: boolean
  error?: string
  patch?: Record<string, unknown> // campos a gravar (nomes = colunas Prisma)
  validated?: boolean             // pacote virou "validado"
  recordedOnly?: boolean          // reabrir/nova análise: nada concluído
  historyMessage?: string
}

const brDate = () => new Date().toLocaleDateString("pt-BR")

export function buildInitialWorkflow(): RetWorkflowStep[] {
  return RET_STEPS.map(([id, title], i) => ({
    id, title, status: i === 0 ? "pendente" : "bloqueada", doneAt: null,
  }))
}
export function pkgProgress(workflow: RetWorkflowStep[]): number {
  if (!workflow?.length) return 0
  return Math.round((workflow.filter((s) => s.status === "concluida").length / workflow.length) * 100)
}
export function phaseProgress(pkgs: { workflow: RetWorkflowStep[] }[]): number {
  if (!pkgs.length) return 0
  return Math.round(pkgs.reduce((a, p) => a + pkgProgress(p.workflow), 0) / pkgs.length)
}
export function allValidated(pkgs: { status: string }[]): boolean {
  return pkgs.length > 0 && pkgs.every((p) => p.status === "validado")
}

export function applyStep(pkg: RetPkg, stepId: string, payload: any = {}): RetApplyResult {
  const wf = (pkg.workflow || buildInitialWorkflow()).map((s) => ({ ...s }))
  const idx = wf.findIndex((s) => s.id === stepId)
  if (idx < 0) return { ok: false, error: "Etapa inexistente." }
  if (wf[idx].status === "bloqueada") return { ok: false, error: "Esta etapa ainda está bloqueada." }
  const jud = pkg.tipo === "judicial"

  const conclude = () => {
    wf[idx].status = "concluida"
    wf[idx].doneAt = brDate()
    if (wf[idx + 1]) wf[idx + 1].status = "pendente"
  }
  const nextId = () => (wf[idx + 1] ? wf[idx + 1].id : stepId)
  const done = (extra: Record<string, unknown>, msg: string, flags: Partial<RetApplyResult> = {}): RetApplyResult => {
    conclude()
    return { ok: true, patch: { workflow: wf, currentStep: nextId(), ...extra }, historyMessage: msg, ...flags }
  }

  switch (stepId) {
    case "definir_estrategia":
      return done(
        {
          tipo: payload.tipo || pkg.tipo,
          motivo: payload.motivo ?? pkg.motivo,
          prioridade: payload.prioridade || pkg.prioridade || "Média",
          proxAcao: "Montar dossiê",
        },
        `Estratégia definida (${(payload.tipo || pkg.tipo) === "judicial" ? "judicial" : "administrativa"}).`
      )

    case "montar_dossie":
      return done({ proxAcao: "Protocolar retificação" }, "Dossiê montado.")

    case "protocolar": {
      const att: RetAttachment = {
        nome: jud ? "peticao_inicial.pdf" : "requerimento.pdf",
        cat: jud ? "Petição inicial" : "Requerimento administrativo",
        data: brDate(),
      }
      const attachments = [...(pkg.attachments || []), att]
      const extra = jud
        ? {
            processoNum: payload.processoNum ?? pkg.processoNum,
            tribunal: payload.tribunal ?? pkg.tribunal,
            vara: payload.vara ?? pkg.vara,
            advogado: payload.advogado ?? pkg.advogado,
            statusProc: "Distribuído",
            status: "protocolado",
            proxAcao: "Acompanhar andamento",
            attachments,
          }
        : {
            cartorio: payload.cartorio ?? pkg.cartorio,
            canal: payload.canal ?? pkg.canal,
            protocolo: payload.protocolo ?? pkg.protocolo,
            atendente: payload.atendente ?? pkg.atendente,
            dataProtocolo: payload.dataProtocolo ?? pkg.dataProtocolo,
            statusAdm: "Protocolado",
            status: "protocolado",
            proxAcao: "Acompanhar andamento",
            attachments,
          }
      return done(extra, `Protocolo ${jud ? "judicial" : "administrativo"} registrado.`)
    }

    case "acompanhar": {
      if (!payload.movDesc || !String(payload.movDesc).trim()) {
        return { ok: false, error: "Registre uma movimentação (descrição) antes de avançar." }
      }
      const mv: RetMovement = {
        data: payload.movData || brDate(),
        tipo: payload.movTipo || "andamento",
        desc: String(payload.movDesc).trim(),
        resp: payload.movResp || "",
        prox: "",
      }
      const movements = [mv, ...(pkg.movements || [])]
      return done({ movements, proxAcao: "Receber decisão / averbação" }, `Movimentação "${mv.tipo}" registrada.`)
    }

    case "receber_decisao": {
      const resTxt = payload.resTxt || payload.resultado || ""
      const att: RetAttachment = {
        nome: jud ? "sentenca.pdf" : "termo_averbacao.pdf",
        cat: jud ? "Sentença" : "Termo de averbação",
        data: brDate(),
      }
      const attachments = [...(pkg.attachments || []), att]
      const validacao = {
        ...(pkg.validacao || {}),
        decision: {
          tipo: jud ? "Sentença" : "Averbação",
          resultado: payload.resultado || "",
          resTxt,
          data: payload.data || brDate(),
          desc: payload.obs || "",
          cartorio: payload.cartorio || "",
        },
      }
      const extra: Record<string, unknown> = {
        status: "decisao_recebida",
        proxAcao: "Validar registros corrigidos",
        attachments,
        validacao,
      }
      extra[jud ? "statusProc" : "statusAdm"] = resTxt
      return done(extra, `Decisão recebida (${resTxt || "—"}).`)
    }

    case "validar_registros": {
      const dec = payload.decision || "validar"
      if (dec === "reabrir" || dec === "nova_analise") {
        return {
          ok: true, recordedOnly: true,
          historyMessage: dec === "reabrir" ? "Retificação reaberta." : "Enviado para nova análise.",
        }
      }
      const validacao = {
        ...(pkg.validacao || {}),
        validado: true,
        ressalva: dec === "ressalva",
        em: brDate(),
      }
      return done(
        { status: "validado", proxAcao: "Pacote validado", validacao },
        "Pacote de retificação validado.",
        { validated: true }
      )
    }
  }

  return { ok: false, error: "Etapa desconhecida." }
}