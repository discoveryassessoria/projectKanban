// src/services/tarefa-transversal.ts
//
// TAREFA TRANSVERSAL — ação operacional ANTECIPADA de OUTRA fase, executada para resolver
// uma necessidade da fase ATUAL, SEM avançar o Macro Workflow. É uma Tarefa oficial
// (tipo=TRANSVERSAL) estendida — NÃO é uma WorkflowStepInstance da fase futura (isso
// iniciaria indevidamente o workflow da fase seguinte). O documento e seu workflow oficial
// continuam sendo a execução real; a Transversal é o VÍNCULO + objetivo.
//
// Regras: nunca altera a fase ativa; nunca materializa a fase futura; ao concluir com
// resolução da necessidade, chama os MOTORES OFICIAIS (atenderNecessidade → BlockingEngine
// via projeção → PhaseAdvanceService via tentarAvancoAutomatico). Idempotente onde aplicável.

import { prisma } from "@/lib/prisma"
import { Prisma, type FaseCode } from "@prisma/client"
import { atenderNecessidade } from "@/src/services/necessidade-documental"
import { tentarAvancoAutomatico } from "@/src/lib/motor/auto-avanco"
import { phaseKeyToFaseCode, FASES } from "@/src/lib/process-stage/fases-catalog"

const INSTANCIA_ATIVA = ["ATIVO", "AGUARDANDO", "BLOQUEADO"] as const

// faseMacroKey ISOLADA — nunca casa com nenhum gate de fase (que consulta as chaves reais do
// macro). Assim a operação da transversal NÃO conta no progresso nem bloqueia o avanço da fase.
export const FASE_TRANSVERSAL = "transversal"

// Workflow PADRÃO da operação transversal (documento-alvo): Solicitar → Aguardar → Receber →
// Conferir → Validar. Não gera Tarefa (geraTarefa=false) — a execução é o próprio stepper.
const PASSOS_TRANSVERSAL: Array<{ stepKey: string; title: string; sla: number }> = [
  { stepKey: "solicitar", title: "Solicitar", sla: 3 },
  { stepKey: "aguardar", title: "Aguardar retorno", sla: 15 },
  { stepKey: "receber", title: "Receber", sla: 3 },
  { stepKey: "conferir", title: "Conferir", sla: 2 },
  { stepKey: "validar", title: "Validar", sla: 2 },
]

async function audit(acao: string, tarefaId: number, descricao: string, usuarioId?: number | null) {
  await prisma.logAuditoria.create({
    data: { acao, entidade: "TAREFA_TRANSVERSAL", entidadeId: tarefaId, descricao: descricao.slice(0, 500), usuarioId: usuarioId ?? null },
  }).catch(() => {})
}

/** Ações de catálogo válidas de uma fase (steps + processSteps). Sem texto livre. */
export function acoesDaFase(faseCode: FaseCode): Array<{ stepKey: string; title: string }> {
  const def = FASES[faseCode]
  if (!def) return []
  const de = (arr: Array<{ stepKey: string; title: string }> | undefined) => (arr ?? []).map((s) => ({ stepKey: s.stepKey, title: s.title }))
  return [...de(def.steps as never), ...de(def.processSteps as never)]
}

export interface CriarTransversalInput {
  processoId: number
  necessidadeOrigemId: number
  faseReferenciaCode: string
  acaoStepKey: string
  pessoaId?: number | null
  documentoId?: number | null
  tipoDocumentoId?: number | null
  motivo?: string | null
  resultadoEsperado?: string | null
  responsavelId?: number | null
  prazo?: Date | null
  titulo?: string
  usuarioId?: number | null
}

export async function criarTarefaTransversal(input: CriarTransversalInput) {
  const proc = await prisma.processo.findUnique({ where: { id: input.processoId }, select: { id: true, faseAtualKey: true } })
  if (!proc) throw new Error("Processo não encontrado")

  const faseRefCode = phaseKeyToFaseCode(input.faseReferenciaCode) ?? (FASES[input.faseReferenciaCode as FaseCode] ? (input.faseReferenciaCode as FaseCode) : null)
  if (!faseRefCode) throw new Error(`Fase de referência inválida: ${input.faseReferenciaCode}`)
  // ação DEVE existir no catálogo da fase de referência (não permitir texto livre)
  const acaoOk = acoesDaFase(faseRefCode).some((a) => a.stepKey === input.acaoStepKey)
  if (!acaoOk) throw new Error(`Ação "${input.acaoStepKey}" não existe no catálogo da fase ${faseRefCode}`)

  // necessidade de origem tem de pertencer ao processo
  const nec = await prisma.necessidadeDocumental.findUnique({ where: { id: input.necessidadeOrigemId }, select: { id: true, processoId: true, pessoaId: true } })
  if (!nec || nec.processoId !== input.processoId) throw new Error("Necessidade de origem não pertence ao processo")

  const faseOrigemKey = proc.faseAtualKey ?? null
  const faseOrigemCode = phaseKeyToFaseCode(faseOrigemKey)
  const inst = faseOrigemKey
    ? await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: input.processoId, faseMacroKey: faseOrigemKey, status: { in: INSTANCIA_ATIVA as unknown as never } }, orderBy: { ciclo: "desc" }, select: { id: true } })
    : null

  const labelRef = FASES[faseRefCode]?.label ?? faseRefCode
  const titulo = (input.titulo ?? `Transversal · ${input.acaoStepKey} (${labelRef})`).slice(0, 200)

  const t = await prisma.tarefa.create({
    data: {
      titulo, tipo: "TRANSVERSAL", processoId: input.processoId,
      faseOrigemCode: (faseOrigemCode ?? faseOrigemKey) ?? null, faseReferenciaCode: faseRefCode,
      workflowInstanceOrigemId: inst?.id ?? null, faseMacroKey: faseOrigemKey,
      necessidadeId: input.necessidadeOrigemId, pessoaId: input.pessoaId ?? nec.pessoaId ?? null,
      documentoId: input.documentoId ?? null, tipoDocumentoId: input.tipoDocumentoId ?? null,
      acaoStepKey: input.acaoStepKey, motivo: input.motivo ?? null, resultadoEsperado: input.resultadoEsperado ?? null,
      responsavelId: input.responsavelId ?? null, dataPrazo: input.prazo ?? null,
      statusTarefa: "NAO_INICIADA", origem: "TRANSVERSAL", createdBy: input.usuarioId ?? null,
    },
  })
  // OPERAÇÃO DOCUMENTAL COMPLETA: cria o documento-alvo + workflow padrão (Solicitar→…→Validar),
  // operado no stepper da transversal. NÃO entra no gate da fase atual (faseMacroKey isolada).
  // Requer pessoa (Documento.pessoaId é obrigatório) — usa a pessoa da necessidade de origem.
  let documentoId: number | null = null
  if (t.pessoaId != null) {
    documentoId = await materializarOperacaoTransversal(t.id, input.processoId, t.pessoaId, input.tipoDocumentoId ?? null, titulo)
  }
  await audit("CRIADA", t.id, `Transversal "${titulo}" (ref ${faseRefCode}) p/ necessidade ${input.necessidadeOrigemId}${documentoId ? `; documento-alvo ${documentoId}` : ""}`, input.usuarioId)
  return { ...t, documentoId }
}

/** Materializa o documento-alvo + os 5 passos padrão numa INSTÂNCIA transversal isolada. */
async function materializarOperacaoTransversal(tarefaId: number, processoId: number, pessoaId: number, tipoDocumentoId: number | null, titulo: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const doc = await tx.documento.create({
      data: {
        pessoaId,
        documentTypeId: tipoDocumentoId ?? undefined,
        status: "SOLICITAR", origem: "automatica", observacoes: `Documento antecipado por Tarefa Transversal #${tarefaId}: ${titulo}`.slice(0, 500),
      } as Prisma.DocumentoUncheckedCreateInput,
      select: { id: true },
    })
    const inst = await tx.phaseWorkflowInstance.create({
      data: { processoId, faseMacroKey: FASE_TRANSVERSAL, status: "ATIVO", origem: "MANUAL", instanciadoPor: "TRANSVERSAL", chaveIdempotencia: `transv-inst|tarefa${tarefaId}` },
      select: { id: true },
    })
    const now = new Date()
    for (let i = 0; i < PASSOS_TRANSVERSAL.length; i++) {
      const s = PASSOS_TRANSVERSAL[i]
      const ativo = i === 0
      await tx.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: inst.id, stepKey: s.stepKey, processoId, faseMacroKey: FASE_TRANSVERSAL,
          ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: false, documentoId: doc.id,
          status: ativo ? "EM_ANDAMENTO" : "BLOQUEADO", slaDays: s.sla, prazo: ativo ? new Date(now.getTime() + s.sla * 86400000) : null,
          startedAt: ativo ? now : null, chaveIdempotencia: `transv-step|tarefa${tarefaId}|${s.stepKey}`,
          snapshot: { transversal: true, tarefaId, label: s.title } as Prisma.InputJsonValue, snapshotSchemaVersion: 1,
        },
      })
    }
    await tx.tarefa.update({ where: { id: tarefaId }, data: { documentoId: doc.id } })
    return doc.id
  }, { timeout: 30000, maxWait: 10000 })
}

const PASSO_DONE = new Set(["CONCLUIDO", "DISPENSADO"])

/** Passos da operação transversal (por tarefa). */
export async function getOperacaoTransversal(tarefaId: number) {
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { documentoId: true } })
  if (!t?.documentoId) return { passos: [] as Array<{ id: number; stepKey: string; title: string; status: string; ordem: number }> }
  const rows = await prisma.phaseWorkflowStepInstance.findMany({
    where: { documentoId: t.documentoId, faseMacroKey: FASE_TRANSVERSAL, status: { notIn: ["SUPERSEDIDO", "CANCELADO"] } },
    orderBy: { ordem: "asc" }, select: { id: true, stepKey: true, status: true, ordem: true, snapshot: true },
  })
  return { passos: rows.map((r) => ({ id: r.id, stepKey: r.stepKey, title: (r.snapshot as { label?: string } | null)?.label ?? r.stepKey, status: r.status, ordem: r.ordem })) }
}

/** Conclui o passo ATIVO da operação transversal e libera o próximo. Ao concluir o ÚLTIMO
 *  (validar), marca a tarefa como concluída — mas a RESOLUÇÃO da necessidade de origem exige
 *  confirmação (o documento pode não ter trazido o dado). */
export async function avancarPassoTransversal(tarefaId: number, stepInstanceId: number, opts?: { usuarioId?: number | null }): Promise<{ ok: boolean; concluiuOperacao: boolean }> {
  const step = await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: stepInstanceId }, select: { id: true, faseMacroKey: true, documentoId: true, ordem: true, status: true } })
  if (!step || step.faseMacroKey !== FASE_TRANSVERSAL) throw new Error("Passo transversal não encontrado")
  if (PASSO_DONE.has(step.status)) return { ok: true, concluiuOperacao: false }
  const now = new Date()
  const concluiuOperacao = await prisma.$transaction(async (tx) => {
    await tx.phaseWorkflowStepInstance.update({ where: { id: step.id }, data: { status: "CONCLUIDO", completedAt: now } })
    const prox = await tx.phaseWorkflowStepInstance.findFirst({ where: { documentoId: step.documentoId!, faseMacroKey: FASE_TRANSVERSAL, ordem: { gt: step.ordem }, status: { in: ["BLOQUEADO", "PENDENTE"] } }, orderBy: { ordem: "asc" }, select: { id: true } })
    if (prox) { await tx.phaseWorkflowStepInstance.update({ where: { id: prox.id }, data: { status: "EM_ANDAMENTO", startedAt: now } }); return false }
    return true // não havia próximo → era o último (validar)
  })
  await audit("PASSO_CONCLUIDO", tarefaId, `Passo transversal ${stepInstanceId} concluído${concluiuOperacao ? " (operação completa)" : ""}`, opts?.usuarioId)
  if (concluiuOperacao) {
    await prisma.tarefa.update({ where: { id: tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO" } }).catch(() => {}) // aguarda confirmação da resolução
  }
  return { ok: true, concluiuOperacao }
}

/** Conclui a transversal REGISTRANDO o resultado. resolveuNecessidade=false ⇒ resultado
 *  negativo: a necessidade permanece pendente e o bloqueio continua. */
export async function concluirTarefaTransversal(
  tarefaId: number,
  opts: { resultadoObtido?: string | null; resolveuNecessidade: boolean; usuarioId?: number | null },
) {
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t || t.tipo !== "TRANSVERSAL") throw new Error("Tarefa transversal não encontrada")

  await prisma.tarefa.update({
    where: { id: tarefaId },
    data: { statusTarefa: "CONCLUIDO_RECEBIDO", concluida: true, dataConclusao: new Date(), resultadoObtido: opts.resultadoObtido ?? null, executedById: opts.usuarioId ?? null },
  })
  await audit("CONCLUIDA", tarefaId, `Concluída ${opts.resolveuNecessidade ? "COM" : "SEM"} resolução. Resultado: ${opts.resultadoObtido ?? "—"}`, opts.usuarioId)

  // A conclusão sozinha NÃO resolve a necessidade — o resultado precisa ser avaliado.
  if (opts.resolveuNecessidade && t.necessidadeId != null) {
    await atenderNecessidade(t.necessidadeId) // motor oficial da necessidade
    await audit("NECESSIDADE_RESOLVIDA", tarefaId, `Necessidade ${t.necessidadeId} → ATENDIDA por transversal`, opts.usuarioId)
    if (t.processoId) await tentarAvancoAutomatico(t.processoId) // BlockingEngine + PhaseAdvanceService (oficiais)
  }
  return t
}

export async function cancelarTarefaTransversal(tarefaId: number, opts: { motivo?: string | null; usuarioId?: number | null }) {
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { id: true, tipo: true } })
  if (!t || t.tipo !== "TRANSVERSAL") throw new Error("Tarefa transversal não encontrada")
  await prisma.tarefa.update({ where: { id: tarefaId }, data: { statusTarefa: "CANCELADA", motivo: opts.motivo ?? undefined } })
  await audit("CANCELADA", tarefaId, `Cancelada. Motivo: ${opts.motivo ?? "—"}`, opts.usuarioId)
  return t
}

/**
 * RECONCILIAÇÃO idempotente: quando a fase de REFERÊNCIA se torna ATIVA, reaproveita o
 * trabalho antecipado — associa a necessidade oficial ao Documento já existente (sem
 * duplicar), preservando auditoria. Chamada no phase.entered. Executar N vezes NÃO duplica.
 */
export async function reconciliarTransversaisNaFase(processoId: number, faseMacroKey: string): Promise<{ reaproveitadas: number }> {
  const faseCode = phaseKeyToFaseCode(faseMacroKey)
  if (!faseCode) return { reaproveitadas: 0 }
  const transversais = await prisma.tarefa.findMany({
    where: { processoId, tipo: "TRANSVERSAL", faseReferenciaCode: faseCode, documentoId: { not: null } },
    select: { id: true, documentoId: true, necessidadeId: true },
  })
  let reaproveitadas = 0
  for (const t of transversais) {
    if (t.documentoId == null) continue
    const doc = await prisma.documento.findUnique({ where: { id: t.documentoId }, select: { id: true, necessidadeId: true } })
    if (!doc) continue
    // associa a necessidade ao doc já existente se ainda não estiver (idempotente)
    if (doc.necessidadeId == null && t.necessidadeId != null) {
      await prisma.documento.update({ where: { id: doc.id }, data: { necessidadeId: t.necessidadeId } })
      reaproveitadas++
      await audit("REAPROVEITADA", t.id, `Documento ${doc.id} reaproveitado na fase ${faseMacroKey} (sem duplicação)`, null)
    }
  }
  return { reaproveitadas }
}
