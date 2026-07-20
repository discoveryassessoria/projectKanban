// src/services/operacao-antecipada.ts
//
// OPERAÇÃO ANTECIPADA — orquestradora pura. NÃO tem etapas, NÃO tem workflow, NÃO tem regra de
// negócio por tipo. Resolve tudo por CATÁLOGO/ADAPTADOR (src/lib/operacoes/*). O workflow oficial
// da operação-alvo é a única execução real. Ao AVALIAR: aplica motores OFICIAIS na ordem
// necessidade → BlockingEngine → PhaseAdvanceService (via tentarAvancoAutomatico). Nunca antes.

import { prisma } from "@/lib/prisma"
import { Prisma, StatusOperacaoAntecipada } from "@prisma/client"
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
  const targetTipoDocumentoId = input.params?.tipoDocumentoId != null ? Number(input.params.tipoDocumentoId) : null

  // IDEMPOTÊNCIA: não duplicar operação por duplo-clique/refresh/retry. Modo 1 (com documento-alvo)
  // é garantido pelo índice único (catch P2002 abaixo); aqui cobrimos também o Modo 2 (sem tipo).
  const jaExiste = await prisma.operacaoAntecipada.findFirst({
    where: {
      processoId: input.processoId, necessidadeId: input.necessidadeId, targetOperationType: adapter.operationType,
      targetTipoDocumentoId, status: { in: ATIVAS },
    },
  })
  if (jaExiste) return jaExiste

  const params = { ...(input.params ?? {}), ...(pessoaId != null ? { pessoaId } : {}) }
  const { targetOperationId } = await adapter.criarOperacao({
    processoId: input.processoId, pessoaId, necessidadeId: input.necessidadeId,
    targetPhaseCode: input.targetPhaseCode ?? null, params,
  })

  try {
    // publicCode (OPA-n) é gerado AUTOMATICAMENTE pela extensão do Prisma Client (CODE_REGISTRY →
    // CodeGeneratorService central). Não montar aqui: uniforme com todas as demais entidades.
    const op = await prisma.operacaoAntecipada.create({
      data: {
        processoId: input.processoId, workflowInstanceId: inst?.id ?? null,
        originPhaseCode, originStepKey: input.originStepKey ?? null, necessidadeId: input.necessidadeId,
        targetPhaseCode: input.targetPhaseCode ?? null, targetWorkflowDefinitionId: adapter.workflowDefinitionId,
        targetOperationType: adapter.operationType, targetTipoDocumentoId, params: params as Prisma.InputJsonValue,
        targetOperationId, objetivo: input.objetivo ?? null, resultadoEsperado: input.resultadoEsperado ?? null,
        status: StatusOperacaoAntecipada.EM_EXECUCAO, responsavelId: input.responsavelId ?? null, createdBy: input.usuarioId ?? null,
      },
    })
    await audit("CRIADA", op.id, `Operação antecipada "${adapter.label}" p/ necessidade ${input.necessidadeId} (origem ${originPhaseCode}, destino ${input.targetPhaseCode ?? "—"}); alvo doc ${targetOperationId ?? "sob demanda"}${targetTipoDocumentoId ? ` tipo ${targetTipoDocumentoId}` : ""}`, input.usuarioId)
    return op
  } catch (e) {
    // Corrida do índice único (duplo-clique simultâneo): retorna a operação já criada.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existente = await prisma.operacaoAntecipada.findFirst({
        where: { processoId: input.processoId, necessidadeId: input.necessidadeId, targetOperationType: adapter.operationType, targetTipoDocumentoId },
        orderBy: { id: "desc" },
      })
      if (existente) return existente
    }
    throw e
  }
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
    // vinculavel = documento-alvo É o documento exigido pela necessidade (compatível). Quando
    // false, é documento de APOIO → a avaliação captura RESULTADO estruturado, não vincula o doc.
    const vinculavel = adapter?.podeVincularNecessidade
      ? await adapter.podeVincularNecessidade(r.targetOperationId, r.necessidadeId)
      : false
    return {
      id: r.id, publicCode: r.publicCode, necessidadeId: r.necessidadeId, status: r.status,
      operationType: r.targetOperationType, targetOperationId: r.targetOperationId, targetTipoDocumentoId: r.targetTipoDocumentoId,
      originPhaseCode: r.originPhaseCode, targetPhaseCode: r.targetPhaseCode,
      objetivo: r.objetivo, resultadoEsperado: r.resultadoEsperado, resultadoObtido: r.resultadoObtido, resultadoDados: r.resultadoDados,
      responsavel: r.responsavelId != null ? { id: r.responsavelId, nome: nomePorId.get(r.responsavelId) ?? null } : null,
      operacao: opStatus, aguardandoAvaliacao, vinculavel,
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
  opts: { resultadoObtido?: string | null; resultadoDados?: unknown; usuarioId?: number | null },
) {
  const op = await prisma.operacaoAntecipada.findUnique({ where: { id } })
  if (!op) throw new Error("Operação antecipada não encontrada")
  const adapter = getAdapter(op.targetOperationType)
  const now = new Date()
  const dados = opts.resultadoDados != null ? (opts.resultadoDados as Prisma.InputJsonValue) : (op.resultadoDados ?? Prisma.JsonNull)
  const base = { resultadoObtido: opts.resultadoObtido ?? op.resultadoObtido ?? null, resultadoDados: dados, avaliadoPor: opts.usuarioId ?? null, avaliadoEm: now }

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

  // resultado === "SIM": objetivo atingido. O documento-alvo só é vinculado como documento
  // OFICIAL da necessidade quando for COMPATÍVEL (mesmo mestre + pessoa); documento de APOIO
  // apenas produz o RESULTADO (resultadoDados) — nunca corrompe Documento.necessidadeId.
  await prisma.operacaoAntecipada.update({ where: { id }, data: { ...base, status: StatusOperacaoAntecipada.CONCLUIDA, completedAt: now } })
  await adapter?.interpretarResultado?.(op.targetOperationId, "SIM")
  if (op.necessidadeId != null) {
    const podeVincular = adapter?.podeVincularNecessidade ? await adapter.podeVincularNecessidade(op.targetOperationId, op.necessidadeId) : false
    if (podeVincular) {
      await adapter!.vincularNecessidade!(op.targetOperationId, op.necessidadeId)
      await audit("DOC_VINCULADO", id, `Documento-alvo ${op.targetOperationId} vinculado como oficial da necessidade ${op.necessidadeId} (compatível)`, opts.usuarioId)
    }
    // INTERPRETAÇÃO DO RESULTADO na ORIGEM: propaga o resultado obtido à operação oficial da
    // necessidade (conclui seus passos obrigatórios abertos com os dados registrais). É isto que
    // faz o gate/progresso refletirem o trabalho — não basta marcar o status da necessidade.
    const prop = adapter?.aplicarResultadoNaOrigem
      ? await adapter.aplicarResultadoNaOrigem({ necessidadeId: op.necessidadeId, processoId: op.processoId, resultadoDados: (opts.resultadoDados ?? op.resultadoDados) as Record<string, unknown> | null })
      : { concluidos: 0 }
    await atenderNecessidade(op.necessidadeId)                 // idempotente (garante status ATENDIDA)
    await audit("NECESSIDADE_ATENDIDA", id, `Necessidade ${op.necessidadeId} atendida por operação antecipada${podeVincular ? " (doc oficial)" : " (documento de apoio)"}; passos oficiais concluídos: ${prop.concluidos}`, opts.usuarioId)
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
