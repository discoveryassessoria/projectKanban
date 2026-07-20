// src/services/operacao-antecipada.ts
//
// OPERAÇÃO ANTECIPADA — orquestradora pura. NÃO tem etapas, NÃO tem workflow, NÃO tem regra de
// negócio por tipo. Resolve tudo por CATÁLOGO/ADAPTADOR (src/lib/operacoes/*). O workflow oficial
// da operação-alvo é a única execução real. Ao AVALIAR: aplica motores OFICIAIS na ordem
// necessidade → BlockingEngine → PhaseAdvanceService (via tentarAvancoAutomatico). Nunca antes.

import { prisma } from "@/lib/prisma"
import { StatusOperacaoAntecipada } from "@prisma/client"
import { getAdapter } from "@/src/lib/operacoes/catalogo"
import type { ResultadoAvaliacao } from "@/src/lib/operacoes/tipos"
import { atenderNecessidade } from "@/src/services/necessidade-documental"
import { tentarAvancoAutomatico } from "@/src/lib/motor/auto-avanco"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"

const INSTANCIA_ATIVA = ["ATIVO", "AGUARDANDO", "BLOQUEADO"] as const

async function audit(acao: string, opId: number, descricao: string, usuarioId?: number | null) {
  await prisma.logAuditoria.create({
    data: { acao, entidade: "OPERACAO_ANTECIPADA", entidadeId: opId, descricao: descricao.slice(0, 500), usuarioId: usuarioId ?? null },
  }).catch(() => {})
}

export interface CriarOperacaoAntecipadaInput {
  processoId: number
  necessidadeId: number
  operationType: string
  targetPhaseCode?: string | null
  originStepKey?: string | null
  objetivo?: string | null
  resultadoEsperado?: string | null
  responsavelId?: number | null
  pessoaId?: number | null
  params?: Record<string, unknown>
  usuarioId?: number | null
}

export async function criarOperacaoAntecipada(input: CriarOperacaoAntecipadaInput) {
  const adapter = getAdapter(input.operationType)
  if (!adapter) throw new Error(`Tipo operacional "${input.operationType}" não existe no catálogo`)
  if (!adapter.canRunOutsidePhase) throw new Error(`Operação "${adapter.label}" não é elegível para antecipação`)

  const proc = await prisma.processo.findUnique({ where: { id: input.processoId }, select: { id: true, faseAtualKey: true } })
  if (!proc) throw new Error("Processo não encontrado")

  const nec = await prisma.necessidadeDocumental.findUnique({ where: { id: input.necessidadeId }, select: { id: true, processoId: true, pessoaId: true } })
  if (!nec || nec.processoId !== input.processoId) throw new Error("Necessidade não pertence ao processo")

  const originPhaseCode = phaseKeyToFaseCode(proc.faseAtualKey) ?? proc.faseAtualKey ?? null
  const inst = proc.faseAtualKey
    ? await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: input.processoId, faseMacroKey: proc.faseAtualKey, status: { in: INSTANCIA_ATIVA as unknown as never } }, orderBy: { ciclo: "desc" }, select: { id: true } })
    : null

  const pessoaId = input.pessoaId ?? nec.pessoaId ?? null
  const { targetOperationId } = await adapter.criarOperacao({
    processoId: input.processoId, pessoaId, necessidadeId: input.necessidadeId,
    targetPhaseCode: input.targetPhaseCode ?? null, params: input.params,
  })

  const op = await prisma.operacaoAntecipada.create({
    data: {
      processoId: input.processoId, workflowInstanceId: inst?.id ?? null,
      originPhaseCode, originStepKey: input.originStepKey ?? null, necessidadeId: input.necessidadeId,
      targetPhaseCode: input.targetPhaseCode ?? null, targetWorkflowDefinitionId: adapter.workflowDefinitionId,
      targetOperationType: adapter.operationType, targetOperationId,
      objetivo: input.objetivo ?? null, resultadoEsperado: input.resultadoEsperado ?? null,
      status: StatusOperacaoAntecipada.EM_EXECUCAO, responsavelId: input.responsavelId ?? null, createdBy: input.usuarioId ?? null,
    },
  })
  await audit("CRIADA", op.id, `Operação antecipada "${adapter.label}" p/ necessidade ${input.necessidadeId} (origem ${originPhaseCode}, destino ${input.targetPhaseCode ?? "—"}); alvo ${targetOperationId ?? "sob demanda"}`, input.usuarioId)
  return op
}

const ATIVAS = [StatusOperacaoAntecipada.CRIADA, StatusOperacaoAntecipada.EM_EXECUCAO, StatusOperacaoAntecipada.AGUARDANDO_RESULTADO]

/** Lista operações antecipadas do processo (ou de uma necessidade) com o STATUS da operação oficial. */
export async function listarOperacoesAntecipadas(processoId: number, necessidadeId?: number | null) {
  const rows = await prisma.operacaoAntecipada.findMany({
    where: { processoId, ...(necessidadeId != null ? { necessidadeId } : {}) },
    orderBy: { createdAt: "desc" },
  })
  const responsavelIds = [...new Set(rows.map((r) => r.responsavelId).filter((x): x is number => x != null))]
  const responsaveis = responsavelIds.length
    ? await prisma.usuario.findMany({ where: { id: { in: responsavelIds } }, select: { id: true, nome: true } })
    : []
  const nomePorId = new Map(responsaveis.map((u) => [u.id, u.nome]))

  return Promise.all(rows.map(async (r) => {
    const adapter = getAdapter(r.targetOperationType)
    const opStatus = adapter
      ? await adapter.getStatus(r.targetOperationId, { necessidadeId: r.necessidadeId })
      : { statusRaw: "?", statusLabel: "Tipo desconhecido", concluida: false, uiRef: { kind: r.targetOperationType, id: r.targetOperationId, necessidadeId: r.necessidadeId } }
    // Deriva "aguardando avaliação" quando o workflow oficial concluiu mas a operação ainda não foi avaliada.
    const aguardandoAvaliacao = opStatus.concluida && (ATIVAS as string[]).includes(r.status)
    return {
      id: r.id, necessidadeId: r.necessidadeId, status: r.status,
      operationType: r.targetOperationType, targetOperationId: r.targetOperationId,
      originPhaseCode: r.originPhaseCode, targetPhaseCode: r.targetPhaseCode,
      objetivo: r.objetivo, resultadoEsperado: r.resultadoEsperado, resultadoObtido: r.resultadoObtido,
      responsavel: r.responsavelId != null ? { id: r.responsavelId, nome: nomePorId.get(r.responsavelId) ?? null } : null,
      operacao: opStatus, aguardandoAvaliacao,
      encerrada: !(ATIVAS as string[]).includes(r.status),
    }
  }))
}

/**
 * AVALIAÇÃO FINAL — só é chamada após o workflow oficial terminar. Aplica os motores oficiais na
 * ordem correta. NUNCA antes da avaliação; PhaseAdvance nunca é chamado diretamente pela operação.
 */
export async function avaliarOperacaoAntecipada(
  id: number,
  resultado: ResultadoAvaliacao,
  opts: { resultadoObtido?: string | null; usuarioId?: number | null },
) {
  const op = await prisma.operacaoAntecipada.findUnique({ where: { id } })
  if (!op) throw new Error("Operação antecipada não encontrada")
  const adapter = getAdapter(op.targetOperationType)
  const now = new Date()
  const base = { resultadoObtido: opts.resultadoObtido ?? op.resultadoObtido ?? null, avaliadoPor: opts.usuarioId ?? null, avaliadoEm: now }

  if (resultado === "CANCELAR") {
    await prisma.operacaoAntecipada.update({ where: { id }, data: { ...base, status: StatusOperacaoAntecipada.CANCELADA, cancelledAt: now } })
    await audit("CANCELADA", id, "Operação antecipada cancelada", opts.usuarioId)
    return { status: StatusOperacaoAntecipada.CANCELADA }
  }

  if (resultado === "NAO") {
    // Registra a tentativa; NÃO atualiza a necessidade; permite nova operação antecipada.
    await prisma.operacaoAntecipada.update({ where: { id }, data: { ...base, status: StatusOperacaoAntecipada.NAO_ATINGIDA } })
    await audit("NAO_ATINGIDA", id, `Objetivo não atingido. ${opts.resultadoObtido ?? ""}`.trim(), opts.usuarioId)
    return { status: StatusOperacaoAntecipada.NAO_ATINGIDA }
  }

  // Efeito na entidade-alvo (opcional, delegado ao adaptador — nunca regra por tipo aqui).
  await adapter?.interpretarResultado?.(op.targetOperationId, resultado)

  if (resultado === "PARCIAL") {
    await adapter?.reconciliar?.({ targetOperationId: op.targetOperationId, necessidadeId: op.necessidadeId, processoId: op.processoId }, op.targetPhaseCode ?? "")
    await prisma.operacaoAntecipada.update({ where: { id }, data: { ...base, status: StatusOperacaoAntecipada.CONCLUIDA_PARCIAL } })
    await audit("CONCLUIDA_PARCIAL", id, `Resultado parcial. ${opts.resultadoObtido ?? ""}`.trim(), opts.usuarioId)
    // Não conclui a necessidade — pendências permanecem e o BlockingEngine as manterá.
    return { status: StatusOperacaoAntecipada.CONCLUIDA_PARCIAL }
  }

  // resultado === "SIM": objetivo atingido → motores OFICIAIS na ordem correta.
  await prisma.operacaoAntecipada.update({ where: { id }, data: { ...base, status: StatusOperacaoAntecipada.CONCLUIDA, completedAt: now } })
  if (op.necessidadeId != null) {
    await atenderNecessidade(op.necessidadeId)                 // necessidade → ATENDIDA (motor oficial)
    await audit("NECESSIDADE_ATENDIDA", id, `Necessidade ${op.necessidadeId} atendida por operação antecipada`, opts.usuarioId)
  }
  await tentarAvancoAutomatico(op.processoId)                  // BlockingEngine (computeGate) → PhaseAdvance
  await audit("CONCLUIDA", id, `Objetivo atingido. ${opts.resultadoObtido ?? ""}`.trim(), opts.usuarioId)
  return { status: StatusOperacaoAntecipada.CONCLUIDA }
}

/**
 * RECONCILIAÇÃO — quando a fase oficial (destino) chega, reaproveita o trabalho antecipado sem
 * duplicar. Idempotente. Chamada no phase.entered pelo dispatcher de outbox.
 */
export async function reconciliarOperacoesAntecipadas(processoId: number, faseMacroKey: string): Promise<{ reconciliadas: number }> {
  const faseCode = phaseKeyToFaseCode(faseMacroKey) ?? faseMacroKey
  const ops = await prisma.operacaoAntecipada.findMany({
    where: { processoId, targetPhaseCode: faseCode, status: { in: [StatusOperacaoAntecipada.EM_EXECUCAO, StatusOperacaoAntecipada.AGUARDANDO_RESULTADO, StatusOperacaoAntecipada.CONCLUIDA, StatusOperacaoAntecipada.CONCLUIDA_PARCIAL] } },
    select: { id: true, targetOperationType: true, targetOperationId: true, necessidadeId: true, processoId: true },
  })
  let reconciliadas = 0
  for (const op of ops) {
    const adapter = getAdapter(op.targetOperationType)
    if (!adapter?.reconciliar) continue
    await adapter.reconciliar({ targetOperationId: op.targetOperationId, necessidadeId: op.necessidadeId, processoId: op.processoId }, faseMacroKey)
    reconciliadas++
  }
  if (reconciliadas > 0) await audit("RECONCILIADA", ops[0]?.id ?? 0, `${reconciliadas} operação(ões) reconciliada(s) na fase ${faseMacroKey}`, null)
  return { reconciliadas }
}
