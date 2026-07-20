// src/lib/operacoes/adapters/documento.ts
//
// ADAPTADOR "documento" — liga a Operação Antecipada à OPERAÇÃO DOCUMENTAL OFICIAL. O workflow
// oficial (montarWorkflowV2 / garantirOperacaoDocumentoV2, escopado à fase vigente do doc) é a
// ÚNICA execução real; este adaptador só resolve, lê status e reconcilia. Não cria etapas.

import { prisma } from "@/lib/prisma"
import { montarWorkflowV2 } from "@/src/services/documento-operacao"
import type { ExecutionAdapter } from "../tipos"

// Rótulos amigáveis do status mestre do Documento (fallback: o próprio raw).
const STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente", SOLICITAR: "Solicitar", SOLICITADO: "Solicitado", EM_BUSCA: "Em busca",
  RECEBIDO: "Recebido", EM_ANALISE: "Em análise", RETIFICANDO: "Retificando", EM_TRADUCAO: "Em tradução",
  TRADUZIDO: "Traduzido", EM_APOSTILAMENTO: "Em apostilamento", APOSTILADO: "Apostilado", ENTREGUE: "Entregue",
}

export const documentoAdapter: ExecutionAdapter = {
  operationType: "documento",
  label: "Documento",
  canRunOutsidePhase: true,
  allowAdvanceExecution: true,
  workflowDefinitionId: null, // definido pelo catálogo de fases da fase vigente do doc (oficial)
  resultInterpreter: "documento",
  reconciliationStrategy: "vincular-necessidade",
  active: true,

  // Reutiliza o Documento OFICIAL da necessidade (não cria paralelo). Se ainda não há Documento
  // (ex.: necessidade não materializada), retorna null — a tela oficial cria sob demanda ao abrir.
  async criarOperacao(ctx) {
    if (ctx.necessidadeId == null) return { targetOperationId: null }
    const doc = await prisma.documento.findFirst({ where: { necessidadeId: ctx.necessidadeId }, orderBy: { id: "desc" }, select: { id: true } })
    return { targetOperationId: doc?.id ?? null }
  },

  async getStatus(targetOperationId, ctx) {
    if (targetOperationId == null) {
      return { statusRaw: "PENDENTE", statusLabel: "Não iniciada", concluida: false, uiRef: { kind: "documento", id: null, necessidadeId: ctx.necessidadeId } }
    }
    const [doc, wf] = await Promise.all([
      prisma.documento.findUnique({ where: { id: targetOperationId }, select: { status: true } }),
      montarWorkflowV2(targetOperationId),
    ])
    const raw = doc?.status ?? "PENDENTE"
    const concluida = wf?.status === "concluido"
    return {
      statusRaw: concluida ? "CONCLUIDA" : raw,
      statusLabel: concluida ? "Operação concluída" : (STATUS_LABELS[raw] ?? raw),
      concluida,
      uiRef: { kind: "documento", id: targetOperationId, necessidadeId: ctx.necessidadeId },
    }
  },

  // Reaproveita quando a fase oficial chega: vincula a necessidade ao doc existente (idempotente).
  async reconciliar(op) {
    if (op.targetOperationId == null || op.necessidadeId == null) return
    const doc = await prisma.documento.findUnique({ where: { id: op.targetOperationId }, select: { necessidadeId: true } })
    if (doc && doc.necessidadeId == null) {
      await prisma.documento.update({ where: { id: op.targetOperationId }, data: { necessidadeId: op.necessidadeId } })
    }
  },
}
