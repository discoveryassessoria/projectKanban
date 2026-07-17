// src/services/processEngine/stepCompletionResolver.ts
//
// ETAPA 2 — ADAPTADOR DE BANCO do Motor de Conclusão.
//
// A DECISÃO (regra de domínio) vive no núcleo PURO em
// ../completion-engine/policies.ts. Este arquivo só monta o "context" (lê o
// banco) e chama o núcleo. Assim existe UMA fonte de verdade (regras 9/10) e
// nada de regra de domínio no front.
//
// Consumido hoje por: src/app/api/documentos/[id]/workflow/steps/[stepId] (gate
// de conclusão) e src/app/api/documentos/[id]/workflow (stamp de política).
// A assinatura pública { podeConcluir, motivo, policy } é PRESERVADA (sem
// regressão): podeConcluir = result.completed, motivo = result.reason (se travado).

import { prisma } from "@/lib/prisma"
import {
  evaluateStepCompletion,
  normalizePolicy,
  type CompletionPolicy,
  type DocumentFact,
  type StepCompletionResult,
} from "@/src/services/completion-engine/policies"

export type { CompletionPolicy } from "@/src/services/completion-engine/policies"

// ── Política autoritativa por stepKey conhecido ─────────────────────────────
// Enquanto o Gerenciamento não grava política por passo, o stepKey manda para
// os passos conhecidos da Genealogia/Emissão (inclusive corrige passos já
// gravados com o default antigo). "localizar_registro" agora é agregado
// (ALL_REQUIRED_DOCUMENTS_LOCATED) — nunca TASK_COMPLETED por padrão (regra 7).
const KNOWN_STEP_POLICY: Record<string, CompletionPolicy> = {
  localizar_registro: "ALL_REQUIRED_DOCUMENTS_LOCATED", // FIX (regra 7)
  receber_certidao: "DOCUMENT_RECEIVED",
  conferir_certidao: "DOCUMENT_RECEIVED",
  validar_certidao: "DOCUMENT_VALIDATED",
}

/**
 * Política padrão de um passo (usada para carimbar passos novos no workflow).
 * Para passos NÃO conhecidos: MANUAL_CONFIRMATION (sem trava — comportamento
 * legado preservado). Passos conhecidos: mapa autoritativo acima.
 */
export function politicaPadraoParaStep(stepKey: string): CompletionPolicy {
  return KNOWN_STEP_POLICY[stepKey] ?? "MANUAL_CONFIRMATION"
}

/**
 * Política EFETIVA de um passo já existente:
 *   - passo conhecido  → mapa autoritativo (corrige stamps antigos);
 *   - senão            → a política gravada no passo;
 *   - senão            → MANUAL_CONFIRMATION (legado, sem trava).
 * Política gravada porém inválida/desconhecida → normalizePolicy vira
 * NEEDS_REVIEW no núcleo (regra 8), e o passo NÃO conclui.
 */
function politicaEfetiva(stepKey: string, policyDoStep?: string | null): string {
  if (KNOWN_STEP_POLICY[stepKey]) return KNOWN_STEP_POLICY[stepKey]
  return policyDoStep ?? "MANUAL_CONFIRMATION"
}

export interface ResultadoConclusaoPasso {
  /** true = pode concluir; false = travado. (retrocompatível) */
  podeConcluir: boolean
  /** null quando pode; mensagem amigável (vira 422) quando travado. */
  motivo: string | null
  /** política que foi de fato avaliada. */
  policy: string
  /** resultado completo do motor (blockers/evidence/progress/evaluatedAt). */
  result: StepCompletionResult
}

// Status que já contam como "documento localizado/pronto" na Genealogia
// (espelha POS_VALIDADO de compute-phase-progress: recebido/entregue/etc.).
const STATUS_LOCALIZADO = new Set([
  "RECEBIDO",
  "ENTREGUE",
  "APOSTILADO",
  "TRADUZIDO",
])
const STATUS_CANCELADO = new Set(["CANCELADO", "INVALIDO"])

type DocRegistral = {
  status: string
  cartorio: string | null
  numero_registro: string | null
  livro: string | null
  folha: string | null
  termo: string | null
  data_registro: Date | string | null
  arquivo_url: string | null
}

// REGRA OFICIAL de "documento localizado" (unificada com o front, EditorRegistralModal):
// Cartório obrigatório E pelo menos um entre Livro, Folha ou Termo. Back-end,
// BlockingEngine e Workflow usam EXCLUSIVAMENTE esta regra.
const naoVazio = (v: string | null | undefined) => !!(v && String(v).trim())
const temDadosRegistrais = (d: DocRegistral) =>
  naoVazio(d.cartorio) && (naoVazio(d.livro) || naoVazio(d.folha) || naoVazio(d.termo))

function docFact(id: number, d: DocRegistral): DocumentFact {
  // "localizado" (Genealogia/localizar_registro) usa EXCLUSIVAMENTE a regra registral
  // oficial (cartório + livro/folha/termo). received/validated seguem por arquivo.
  const located = temDadosRegistrais(d)
  const received = !!d.arquivo_url || STATUS_LOCALIZADO.has(d.status)
  return {
    ref: String(id),
    required: true,
    cancelled: STATUS_CANCELADO.has(d.status),
    located,
    received,
    // ⚠ validado ainda = recebido (arquivo). Sinal REAL de validação jurídica
    // é seam de fase futura — mantido assim para NÃO regredir validar_certidao.
    validated: received,
  }
}

const SELECT_REGISTRAL = {
  status: true,
  cartorio: true,
  numero_registro: true,
  livro: true,
  folha: true,
  termo: true,
  data_registro: true,
  arquivo_url: true,
} as const

/**
 * Decide se um passo pode ser concluído agora (adaptador → núcleo puro).
 */
export async function resolveStepCompletionState(
  stepKey: string,
  documentoId: number,
  policyDoStep?: string | null,
): Promise<ResultadoConclusaoPasso> {
  const now = new Date()
  const rawPolicy = politicaEfetiva(stepKey, policyDoStep)
  const policy = normalizePolicy(rawPolicy)

  // Monta só o que a política precisa (evita I/O desnecessário).
  let self: DocumentFact | undefined
  let requiredDocuments: DocumentFact[] | undefined

  if (policy === "DOCUMENT_LOCATED" || policy === "DOCUMENT_RECEIVED" || policy === "DOCUMENT_VALIDATED") {
    const d = await prisma.documento.findUnique({
      where: { id: documentoId },
      select: SELECT_REGISTRAL,
    })
    if (d) self = docFact(documentoId, d as DocRegistral)
  }

  if (policy === "ALL_REQUIRED_DOCUMENTS_LOCATED" || policy === "ALL_REQUIRED_DOCUMENTS_VALIDATED") {
    // conjunto obrigatório = docs da LINHA RETA da árvore do processo (mesma
    // régua da matriz/Central e de compute-phase-progress).
    const doc = await prisma.documento.findUnique({
      where: { id: documentoId },
      select: {
        pessoa: {
          select: {
            arvore: {
              select: {
                pessoas: {
                  where: { linhaReta: true },
                  select: { documentos: { select: { id: true, ...SELECT_REGISTRAL } } },
                },
              },
            },
          },
        },
      },
    })
    const docs =
      doc?.pessoa?.arvore?.pessoas.flatMap((p) => p.documentos) ?? []
    requiredDocuments = docs.map((dd) => docFact(dd.id, dd as unknown as DocRegistral))
  }

  const result = evaluateStepCompletion({
    rawPolicy,
    now,
    self,
    requiredDocuments,
    // linkedTasks/condition/customRule: seams para fases futuras (o núcleo já
    // trata; o adaptador legado da Genealogia não usa essas políticas hoje).
  })

  return {
    podeConcluir: result.completed,
    motivo: result.completed ? null : result.reason,
    policy: result.policy,
    result,
  }
}
