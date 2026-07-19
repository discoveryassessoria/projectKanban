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
import type { FaseCode } from "@prisma/client"
import { atenderNecessidade } from "@/src/services/necessidade-documental"
import { tentarAvancoAutomatico } from "@/src/lib/motor/auto-avanco"
import { phaseKeyToFaseCode, faseCodeToPhaseKey, getFase, FASES } from "@/src/lib/process-stage/fases-catalog"

const INSTANCIA_ATIVA = ["ATIVO", "AGUARDANDO", "BLOQUEADO"] as const

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
  await audit("CRIADA", t.id, `Transversal "${titulo}" (ref ${faseRefCode}) p/ necessidade ${input.necessidadeOrigemId}`, input.usuarioId)
  return t
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
