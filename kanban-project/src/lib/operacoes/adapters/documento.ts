// src/lib/operacoes/adapters/documento.ts
//
// ADAPTADOR "documento" — ÚNICO e GENÉRICO (não conhece certidão de casamento/nascimento/óbito
// nem qualquer tipo específico). Liga a Operação Antecipada à OPERAÇÃO DOCUMENTAL OFICIAL: o
// workflow oficial (montarWorkflowV2 / garantirOperacaoDocumentoV2, escopado à fase vigente do
// doc) é a ÚNICA execução real. Este adaptador só resolve/cria o documento-alvo, lê status e
// vincula à necessidade SOMENTE quando o tipo documental for compatível (mesmo ItemCatalogo mestre
// + mesma pessoa). Nunca corrompe Documento.necessidadeId com um documento de APOIO.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { montarWorkflowV2 } from "@/src/services/documento-operacao"
import type { ExecutionAdapter } from "../tipos"

const STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente", SOLICITAR: "Solicitar", SOLICITADO: "Solicitado", EM_BUSCA: "Em busca",
  RECEBIDO: "Recebido", EM_ANALISE: "Em análise", RETIFICANDO: "Retificando", EM_TRADUCAO: "Em tradução",
  TRADUZIDO: "Traduzido", EM_APOSTILAMENTO: "Em apostilamento", APOSTILADO: "Apostilado", ENTREGUE: "Entregue",
  INVALIDO: "Invalidado", CANCELADO: "Cancelado",
}
const DOC_MORTO = ["INVALIDO", "CANCELADO"] // não reutilizar / não considerar vivo
const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** Compatibilidade documento-alvo ↔ necessidade: mesmo ItemCatalogo mestre + mesma pessoa. */
async function compat(docId: number, needId: number): Promise<boolean> {
  const [doc, need] = await Promise.all([
    prisma.documento.findUnique({ where: { id: docId }, select: { pessoaId: true, necessidadeId: true, documentType: { select: { itemCatalogoId: true } } } }),
    prisma.necessidadeDocumental.findUnique({ where: { id: needId }, select: { pessoaId: true, itemCatalogoId: true } }),
  ])
  if (!doc || !need) return false
  if (doc.necessidadeId != null && doc.necessidadeId !== needId) return false // já é oficial de OUTRA necessidade
  const itemAlvo = doc.documentType?.itemCatalogoId ?? null
  return itemAlvo != null && itemAlvo === need.itemCatalogoId && doc.pessoaId === need.pessoaId
}

export const documentoAdapter: ExecutionAdapter = {
  operationType: "documento",
  label: "Documento",
  canRunOutsidePhase: true,
  allowAdvanceExecution: true,
  workflowDefinitionId: null, // definido pelo catálogo de fases da fase vigente do doc (oficial)
  resultInterpreter: "documento",
  reconciliationStrategy: "compat-item-catalogo",
  active: true,
  exigeTipoDocumento: false, // documento-alvo é OPCIONAL: sem ele, cai no fallback da própria necessidade
  exigePessoa: true,
  permiteReutilizarExistente: true,
  permiteCriarNovo: true,
  camposAdicionais: [
    { key: "tipoDocumentoId", label: "Documento a emitir", type: "tipoDocumento", required: false },
  ],

  // MODO 1: documento-alvo explícito (params.tipoDocumentoId) — valida, reutiliza compatível
  // existente (mesmo tipo+pessoa, não vinculado, não invalidado) e só cria quando não há.
  // MODO 2: sem documento-alvo → usa o documento da própria necessidade. Nunca cria arbitrário
  // em silêncio: se não houver como resolver, lança erro funcional claro.
  async criarOperacao(ctx) {
    const existenteId = num(ctx.params?.documentoExistenteId)
    if (existenteId != null) {
      const d = await prisma.documento.findUnique({ where: { id: existenteId }, select: { id: true } })
      if (!d) throw new Error("Documento informado (documentoExistenteId) não existe")
      return { targetOperationId: d.id }
    }

    const tipoId = num(ctx.params?.tipoDocumentoId)
    if (tipoId != null) {
      const tipo = await prisma.tipoDocumentoCadastro.findUnique({ where: { id: tipoId }, select: { id: true, ativo: true } })
      if (!tipo || !tipo.ativo) throw new Error("Tipo de documento inválido ou inativo")
      const pessoaId = num(ctx.params?.pessoaId) ?? ctx.pessoaId
      if (pessoaId == null) throw new Error("Pessoa é obrigatória para emitir o documento-alvo")
      // Reutilização SEGURA: documento vivo do mesmo tipo+pessoa ainda não vinculado a necessidade.
      const reuso = await prisma.documento.findFirst({
        where: { pessoaId, documentTypeId: tipoId, necessidadeId: null, status: { notIn: DOC_MORTO as never } },
        orderBy: { id: "desc" }, select: { id: true },
      })
      if (reuso) return { targetOperationId: reuso.id }
      const doc = await prisma.documento.create({
        data: { pessoaId, documentTypeId: tipoId, origem: "automatica", observacoes: "Documento-alvo de Operação Antecipada" } as Prisma.DocumentoUncheckedCreateInput,
        select: { id: true },
      })
      return { targetOperationId: doc.id }
    }

    // MODO 2 — fallback pela própria necessidade.
    if (ctx.necessidadeId != null) {
      const doc = await prisma.documento.findFirst({ where: { necessidadeId: ctx.necessidadeId }, orderBy: { id: "desc" }, select: { id: true } })
      if (doc) return { targetOperationId: doc.id }
    }
    throw new Error("Operação documental exige um documento-alvo (tipoDocumentoId) ou uma necessidade com documento associado")
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

  async podeVincularNecessidade(targetOperationId, necessidadeId) {
    if (targetOperationId == null || necessidadeId == null) return false
    if (!(await compat(targetOperationId, necessidadeId))) return false
    // sem equivalente OFICIAL já vinculado à necessidade (outro documento)
    const jaOficial = await prisma.documento.findFirst({
      where: { necessidadeId, id: { not: targetOperationId }, status: { notIn: DOC_MORTO as never } }, select: { id: true },
    })
    return !jaOficial
  },

  async vincularNecessidade(targetOperationId, necessidadeId) {
    if (targetOperationId == null || necessidadeId == null) return
    const doc = await prisma.documento.findUnique({ where: { id: targetOperationId }, select: { necessidadeId: true } })
    if (doc && doc.necessidadeId == null) {
      await prisma.documento.update({ where: { id: targetOperationId }, data: { necessidadeId } })
    }
  },

  // Reconciliação: só vincula quando compatível (documento-alvo = documento exigido pela
  // necessidade). Documento de APOIO permanece sem necessidadeId. Idempotente.
  async reconciliar(op) {
    if (op.targetOperationId == null || op.necessidadeId == null) return
    if (await this.podeVincularNecessidade!(op.targetOperationId, op.necessidadeId)) {
      await this.vincularNecessidade!(op.targetOperationId, op.necessidadeId)
    }
  },
}
