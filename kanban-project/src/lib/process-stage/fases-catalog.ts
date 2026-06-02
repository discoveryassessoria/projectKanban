// src/lib/process-stage/fases-catalog.ts
//
// CATÁLOGO DE FASES — fonte única da verdade sobre quais etapas cada fase
// do processo cria no workflow do documento, e a ordem das fases.
//
// Modelo: WORKFLOW POR FASE (decisão travada com o Marco).
//   - Em cada fase, o documento tem UM workflow com as etapas DAQUELA fase.
//   - A fase do CARD (processo) é sempre a fase do documento da linha reta
//     mais ATRASADO (a "regra do mínimo" / passageiro mais lento).
//   - Quando o documento mais lento avança, o card avança; o trabalho já
//     feito nos outros documentos fica arquivado, nunca apagado.
//
// Este arquivo é só DADOS + tipos. Não toca no banco.

import type { FaseCode } from "@prisma/client"

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/** Um step do workflow de uma fase. Mesmo shape que a rota POST usa. */
export interface FaseStep {
  ordem: number
  stepKey: string
  title: string
  description: string
  weight: number
  ownerKey: string
  slaDays: number
}

/** A definição completa de uma fase. */
export interface FaseDef {
  /** Código estável da fase (= enum FaseCode + = Status.faseCode da coluna). */
  code: FaseCode
  /**
   * Ordem da fase no fluxo (0 = primeira). Usada para COMPARAR fases:
   * a fase do card é a de MENOR ordem entre os documentos da linha reta.
   * É independente da `Status.ordem` da coluna no kanban (que tem buracos);
   * esta ordem é a lógica do fluxo, não a posição visual.
   */
  ordem: number
  /** Rótulo amigável (logs/UI). */
  label: string
  /** Os steps que o workflow desta fase cria, em ordem. */
  steps: FaseStep[]
  /**
   * Próxima fase no fluxo normal (avanço linear).
   * `null` = fase terminal, ou fase com desvio condicional (Análise).
   */
  next: FaseCode | null
  /**
   * `true` quando esta fase ainda NÃO foi totalmente especificada.
   * O motor não cria workflow para fases assim.
   */
  pendingSpec?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo
// ─────────────────────────────────────────────────────────────────────────────

export const FASES: Record<FaseCode, FaseDef> = {
  // ── GENEALOGIA (ordem 0) ────────────────────────────────────────────────
  GENEALOGIA: {
    code: "GENEALOGIA",
    ordem: 0,
    label: "Genealogia",
    next: "EMISSAO_DOCUMENTAL",
    steps: [
      {
        ordem: 1,
        stepKey: "buscar_documento",
        title: "Buscar documento",
        description:
          "Localizar o ato no cartório e preencher os dados registrais completos.",
        weight: 100,
        ownerKey: "equipe_documental",
        slaDays: 5,
      },
    ],
  },

  // ── EMISSÃO DOCUMENTAL (ordem 1) ────────────────────────────────────────
  EMISSAO_DOCUMENTAL: {
    code: "EMISSAO_DOCUMENTAL",
    ordem: 1,
    label: "Emissão documental",
    next: "ANALISE_DOCUMENTAL",
    steps: [
      { ordem: 1, stepKey: "solicitar_certidao", title: "Solicitar certidão",
        description: "Enviar requerimento ao cartório e registrar protocolo retornado.",
        weight: 25, ownerKey: "daniela_brait", slaDays: 3 },
      { ordem: 2, stepKey: "aguardar_retorno", title: "Aguardar retorno do cartório",
        description: "Aguardar resposta do cartório · follow-ups manuais e automáticos disponíveis.",
        weight: 10, ownerKey: "daniela_brait", slaDays: 15 },
      { ordem: 3, stepKey: "receber_certidao", title: "Receber certidão",
        description: "Upload do PDF da certidão recebida.",
        weight: 18, ownerKey: "daniela_brait", slaDays: 2 },
      { ordem: 4, stepKey: "conferir_certidao", title: "Conferir certidão",
        description: "Inspeção operacional: legibilidade, integridade, dados mínimos, apostila, tradução.",
        weight: 15, ownerKey: "daniela_brait", slaDays: 2 },
      { ordem: 5, stepKey: "validar_certidao", title: "Validar certidão",
        description: "Decisão jurídica final · marca documento como Recebido.",
        weight: 12, ownerKey: "marco_rovatti", slaDays: 1 },
    ],
  },

  // ── FASES AINDA NÃO ESPECIFICADAS (ordens 2..9) ─────────────────────────
  ANALISE_DOCUMENTAL: {
    code: "ANALISE_DOCUMENTAL", ordem: 2, label: "Análise Documental",
    next: null, steps: [], pendingSpec: true,
  },
  RETIFICACAO_REGISTROS: {
    code: "RETIFICACAO_REGISTROS", ordem: 3, label: "Retificação de registros",
    next: "EMISSAO_DOCUMENTAL_RETIFICADA", steps: [], pendingSpec: true,
  },
  EMISSAO_DOCUMENTAL_RETIFICADA: {
    code: "EMISSAO_DOCUMENTAL_RETIFICADA", ordem: 4, label: "Emissão documental retificada",
    next: "TRADUCAO_JURAMENTADA", steps: [], pendingSpec: true,
  },
  TRADUCAO_JURAMENTADA: {
    code: "TRADUCAO_JURAMENTADA", ordem: 5, label: "Tradução juramentada",
    next: "APOSTILAMENTO", steps: [], pendingSpec: true,
  },
  APOSTILAMENTO: {
    code: "APOSTILAMENTO", ordem: 6, label: "Apostilamento",
    next: "AGUARDANDO_PROTOCOLO", steps: [], pendingSpec: true,
  },
  AGUARDANDO_PROTOCOLO: {
    code: "AGUARDANDO_PROTOCOLO", ordem: 7, label: "Aguardando protocolo",
    next: "PROTOCOLADO", steps: [], pendingSpec: true,
  },
  PROTOCOLADO: {
    code: "PROTOCOLADO", ordem: 8, label: "Protocolado",
    next: "FINALIZADO", steps: [], pendingSpec: true,
  },
  FINALIZADO: {
    code: "FINALIZADO", ordem: 9, label: "Finalizado",
    next: null, steps: [], pendingSpec: true,
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getFase(code: FaseCode): FaseDef {
  return FASES[code]
}

export function getStepsForFase(code: FaseCode): FaseStep[] {
  return FASES[code].steps
}

export function getNextFase(code: FaseCode): FaseCode | null {
  return FASES[code].next
}

export function isFaseReady(code: FaseCode): boolean {
  const f = FASES[code]
  return !f.pendingSpec && f.steps.length > 0
}

/** Ordem numérica de uma fase (pra comparar/achar o mínimo). */
export function getOrdemFase(code: FaseCode): number {
  return FASES[code].ordem
}

/** Dada uma ordem numérica, retorna o FaseCode correspondente (ou null). */
export function getFaseByOrdem(ordem: number): FaseCode | null {
  const found = Object.values(FASES).find((f) => f.ordem === ordem)
  return found ? found.code : null
}