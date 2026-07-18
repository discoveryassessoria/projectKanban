// src/lib/process-stage/resolve-fase-progresso.ts
//
// FONTE OFICIAL ÚNICA do progresso da fase documental (por-documento), consumida por
// TODOS: Central Operacional, cabeçalho (PhaseProgressHeader), Workflow Macro, Kanban.
// Lê as instâncias V2 reais (PhaseWorkflowStepInstance) da FASE ATUAL persistida do
// processo — nunca o status mestre do documento, nunca lista fixa. "Concluiu a fase" =
// última etapa (maior ordem) do Workflow Interno do documento concluída (ex.: Emissão =
// validar_certidao). Sem cálculo duplicado em outro lugar.

import { prisma } from "@/lib/prisma"
import { phaseKeyToFaseCode, getStepsForFase } from "./fases-catalog"
import { escopoDaFase } from "@/src/lib/motor/resolve-passos-bloqueantes"
import { itemCatalogosDeCertidao } from "@/src/lib/documentos/natureza-certidao"
import type { FaseCode } from "@prisma/client"

const stepConcluidoRe = (status: string) => /conclu|finaliz/i.test(String(status))

export interface WfDocSteps {
  documentoId: number
  faseCode: FaseCode | null
  steps: Array<{ ordem: number; stepKey: string; status: string; assigneeId: number | null; assignee: { nome: string } | null }>
}

export interface ProgressoFaseDoc {
  faseCode: FaseCode | null
  faseMacroKey: string | null
  total: number   // documentos obrigatórios (linha reta) elegíveis — denominador
  done: number    // documentos que concluíram a fase (última etapa concluída) — numerador
  percent: number
  counts: { solicitados: number; aguardando: number; recebidos: number; conferidos: number; validados: number }
  faseSteps: Array<{ ordem: number; stepKey: string; title: string; status: "concluida" | "em_andamento" | "bloqueada"; concluidos: number; total: number }>
  docsNaFase: number
  // por-documento (para a fila / próxima ação / responsável do passo ativo)
  wfPorDoc: Map<number, WfDocSteps>
  concluidosPorDoc: Set<number>
  proximaAcaoPorDoc: Map<number, string | null> // título da 1ª etapa não concluída; null = sem operação
  stepOwnerPorDoc: Map<number, { id: number; nome: string }>
}

export async function resolveProgressoFaseDocumento(processoId: number): Promise<ProgressoFaseDoc> {
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, arvoreId: true, faseAtualKey: true },
  })
  const faseMacroKey = processo?.faseAtualKey ?? null
  const faseCode = phaseKeyToFaseCode(faseMacroKey)

  // Instâncias V2 da FASE ATUAL (ativas). Escopo por faseMacroKey → não mistura fases;
  // exclui SUPERSEDIDO/CANCELADO históricos.
  const stepInstancesRaw = (processo && faseMacroKey)
    ? await prisma.phaseWorkflowStepInstance.findMany({
        where: {
          processoId,
          faseMacroKey,
          // passos vinculados a ENTIDADE (documento OU necessidade) — genéricos ficam de fora.
          OR: [{ documentoId: { not: null } }, { necessidadeId: { not: null } }],
          status: { notIn: ["SUPERSEDIDO", "CANCELADO"] },
        },
        select: { documentoId: true, necessidadeId: true, faseMacroKey: true, stepKey: true, ordem: true, status: true, responsavelId: true, ciclo: true, updatedAt: true },
        orderBy: [{ documentoId: "asc" }, { ordem: "asc" }],
      })
    : []

  // Responsáveis em LOTE (responsavelId é ref solta a Usuario, sem relation) — sem N+1.
  const respIds = [...new Set(stepInstancesRaw.map((s) => s.responsavelId).filter((x): x is number => x != null))]
  const respNomes = respIds.length
    ? new Map((await prisma.usuario.findMany({ where: { id: { in: respIds } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]))
    : new Map<number, string>()

  // Dedup por (documento, stepKey): mantém a instância mais recente (maior ciclo, depois updatedAt).
  const melhor = new Map<string, (typeof stepInstancesRaw)[number]>()
  for (const s of stepInstancesRaw) {
    if (s.documentoId == null) continue
    const k = `${s.documentoId}|${s.stepKey}`
    const prev = melhor.get(k)
    const maisRecente = !prev
      || (s.ciclo ?? 0) > (prev.ciclo ?? 0)
      || ((s.ciclo ?? 0) === (prev.ciclo ?? 0) && (s.updatedAt?.getTime() ?? 0) >= (prev.updatedAt?.getTime() ?? 0))
    if (maisRecente) melhor.set(k, s)
  }
  const wfPorDoc = new Map<number, WfDocSteps>()
  for (const s of melhor.values()) {
    const docId = s.documentoId as number
    let e = wfPorDoc.get(docId)
    if (!e) { e = { documentoId: docId, faseCode: phaseKeyToFaseCode(s.faseMacroKey), steps: [] }; wfPorDoc.set(docId, e) }
    e.steps.push({
      ordem: s.ordem, stepKey: s.stepKey, status: s.status,
      assigneeId: s.responsavelId,
      assignee: s.responsavelId != null ? { nome: respNomes.get(s.responsavelId) ?? "" } : null,
    })
  }
  for (const e of wfPorDoc.values()) e.steps.sort((a, b) => a.ordem - b.ordem)

  // Documentos obrigatórios da LINHA RETA (denominador) — mesma régua da Central/gate.
  const pessoas = processo?.arvoreId
    ? await prisma.pessoa.findMany({
        where: { arvoreId: processo.arvoreId, linhaReta: true },
        select: { id: true, documentos: { select: { id: true, status: true } } },
      })
    : []
  // só docs que TÊM operação materializada na fase atual OU status não cancelado; o
  // denominador são as certidões da linha reta que participam da fase (têm workflow na fase).
  const docIdsComWf = new Set(wfPorDoc.keys())
  // Denominador = documentos obrigatórios da LINHA RETA (mesma régua da Central:
  // linhaRetaDocs), excluindo CANCELADO. Doc sem workflow materializado ainda conta no
  // total (e como NÃO concluído) — não infla nem esconde o denominador.
  const linhaRetaDocIds: number[] = []
  for (const p of pessoas) for (const d of p.documentos) {
    if (d.status === "CANCELADO") continue
    linhaRetaDocIds.push(d.id)
  }

  const concluiuDoc = (docId: number): boolean => {
    const steps = wfPorDoc.get(docId)?.steps ?? []
    if (steps.length === 0) return false
    const ultima = steps.reduce((a, b) => (b.ordem > a.ordem ? b : a))
    return stepConcluidoRe(ultima.status)
  }
  const catSteps = faseCode ? getStepsForFase(faseCode) : []
  const tituloStep = (k: string) => catSteps.find((c) => c.stepKey === k)?.title ?? k
  const proximaAcao = (docId: number): string | null => {
    const steps = [...(wfPorDoc.get(docId)?.steps ?? [])].sort((a, b) => a.ordem - b.ordem)
    if (steps.length === 0) return null
    const prox = steps.find((s) => !stepConcluidoRe(s.status))
    return prox ? tituloStep(prox.stepKey) : "Concluído"
  }

  const concluidosPorDoc = new Set<number>(linhaRetaDocIds.filter(concluiuDoc))
  const proximaAcaoPorDoc = new Map<number, string | null>()
  for (const id of docIdsComWf) proximaAcaoPorDoc.set(id, proximaAcao(id))

  // responsável do passo ATIVO por doc
  const stepOwnerPorDoc = new Map<number, { id: number; nome: string }>()
  for (const [docId, wf] of wfPorDoc) {
    const comResp = wf.steps.filter((s) => s.assigneeId && s.assignee?.nome)
    if (!comResp.length) continue
    const escolhida = comResp.find((s) => !stepConcluidoRe(s.status)) ?? comResp[0]
    if (escolhida?.assigneeId) stepOwnerPorDoc.set(docId, { id: escolhida.assigneeId, nome: escolhida.assignee!.nome })
  }

  // contadores por stepKey (docs da linha reta na fase)
  const contarKey = (k: string) => linhaRetaDocIds.filter((id) => (wfPorDoc.get(id)?.steps ?? []).some((s) => s.stepKey === k && stepConcluidoRe(s.status))).length
  const counts = {
    solicitados: contarKey("solicitar_certidao"),
    aguardando: Math.max(0, contarKey("solicitar_certidao") - contarKey("receber_certidao")),
    recebidos: contarKey("receber_certidao"),
    conferidos: contarKey("conferir_certidao"),
    validados: contarKey("validar_certidao"),
  }

  // passos da fase (ordem do catálogo) com estado agregado
  const totalPorKey = new Map<string, number>()
  const conclPorKey = new Map<string, number>()
  for (const id of linhaRetaDocIds) for (const s of wfPorDoc.get(id)?.steps ?? []) {
    totalPorKey.set(s.stepKey, (totalPorKey.get(s.stepKey) ?? 0) + 1)
    if (stepConcluidoRe(s.status)) conclPorKey.set(s.stepKey, (conclPorKey.get(s.stepKey) ?? 0) + 1)
  }
  let frontier = false
  const faseSteps = catSteps.map((sc) => {
    const c = conclPorKey.get(sc.stepKey) ?? 0
    const t = totalPorKey.get(sc.stepKey) ?? 0
    let status: "concluida" | "em_andamento" | "bloqueada"
    if (t > 0 && c >= t) status = "concluida"
    else if (!frontier) { frontier = true; status = "em_andamento" }
    else status = "bloqueada"
    return { ordem: sc.ordem, stepKey: sc.stepKey, title: sc.title, status, concluidos: c, total: t }
  })

  // ESCOPO OPERACIONAL define numerador/denominador (fonte canônica única):
  //  - NECESSIDADE (Genealogia): denominador = necessidades OBRIGATÓRIAS de CERTIDÃO NÃO
  //    dispensadas; numerador = as com localizar_registro concluído. NUNCA conta documentos
  //    (evita 3/6 quando há certidões duplicadas por pessoa) — dá 3/3 = 100% quando as 3
  //    obrigatórias foram validadas.
  //  - DOCUMENTO (Emissão) / PROCESSO: documentos obrigatórios da linha reta concluídos.
  let total: number
  let done: number
  if (escopoDaFase(stepInstancesRaw) === "NECESSIDADE") {
    const certItens = await itemCatalogosDeCertidao(prisma)
    const necsAll = await prisma.necessidadeDocumental.findMany({
      where: { processoId },
      select: { id: true, status: true, obrigatoriedade: true, itemCatalogoId: true },
    })
    const obrig = necsAll.filter(
      (n) => n.obrigatoriedade === "OBRIGATORIA" && certItens.has(n.itemCatalogoId) && n.status !== "DISPENSADA",
    )
    const concluidoPorNec = new Map<number, boolean>()
    for (const s of stepInstancesRaw) {
      if (s.necessidadeId == null) continue
      concluidoPorNec.set(s.necessidadeId, (concluidoPorNec.get(s.necessidadeId) ?? false) || stepConcluidoRe(s.status))
    }
    total = obrig.length
    done = obrig.filter((n) => concluidoPorNec.get(n.id) === true).length
  } else {
    total = linhaRetaDocIds.length
    done = concluidosPorDoc.size
  }
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  return {
    faseCode, faseMacroKey, total, done, percent, counts, faseSteps,
    docsNaFase: docIdsComWf.size, wfPorDoc, concluidosPorDoc, proximaAcaoPorDoc, stepOwnerPorDoc,
  }
}
