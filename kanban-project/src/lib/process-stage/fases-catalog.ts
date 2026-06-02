// src/lib/process-stage/fases-catalog.ts
//
// CATÁLOGO DE FASES (Etapa 2) — fonte única da verdade sobre quais etapas
// cada fase do processo cria no workflow do documento.
//
// Modelo: WORKFLOW POR FASE (decisão travada com o Marco).
//   - Em cada fase, o documento tem UM workflow com as etapas DAQUELA fase.
//   - Quando todos os documentos concluem o workflow da fase, o card avança,
//     o workflow é arquivado e um workflow NOVO da próxima fase é criado.
//   - Nunca existe um workflow misturando etapas de fases diferentes.
//
// Este arquivo é só DADOS + tipos. Não toca no banco, não tem lógica de avanço.
// A rota POST /api/documentos/[id]/workflow vai LER este catálogo para saber
// quais steps criar. O motor de avanço (Etapa 3) vai LER `next` para saber
// pra qual fase mover.

import type { FaseCode } from "@prisma/client"

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/** Um step do workflow de uma fase. Mesmo shape que a rota POST já usa. */
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
  /** Rótulo amigável (só pra logs/UI; a coluna do kanban tem seu próprio nome). */
  label: string
  /** Os steps que o workflow desta fase cria, em ordem. */
  steps: FaseStep[]
  /**
   * Próxima fase no fluxo normal (avanço linear).
   * `null` = fase terminal (Finalizado) ou fase com desvio condicional
   * (ex: Análise decide entre Retificação e Tradução — isso é tratado
   * pelo motor, não por um `next` fixo).
   */
  next: FaseCode | null
  /**
   * `true` quando esta fase ainda NÃO foi totalmente especificada no sistema
   * real. O motor não deve tentar criar workflow para fases assim até a gente
   * preencher os steps de verdade. Evita inventar etapas que ainda não vimos.
   */
  pendingSpec?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo — preenchido com Genealogia e Emissão (dados reais).
// As demais ficam marcadas pendingSpec até a gente detalhar.
// ─────────────────────────────────────────────────────────────────────────────

export const FASES: Record<FaseCode, FaseDef> = {
  // ── GENEALOGIA ──────────────────────────────────────────────────────────
  // 1 etapa por documento: localizar o ato no cartório.
  // Gate: todos os docs da linha reta resolvidos. Avança → Emissão.
  GENEALOGIA: {
    code: "GENEALOGIA",
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

  // ── EMISSÃO DOCUMENTAL ──────────────────────────────────────────────────
  // 5 etapas por documento. 1ª nasce em_andamento, resto bloqueada em cadeia.
  // Pesos e stepKeys idênticos ao mockup e aos editores já implementados.
  // Gate: todos os docs validados. Avança → Análise.
  EMISSAO_DOCUMENTAL: {
    code: "EMISSAO_DOCUMENTAL",
    label: "Emissão documental",
    next: "ANALISE_DOCUMENTAL",
    steps: [
      {
        ordem: 1,
        stepKey: "solicitar_certidao",
        title: "Solicitar certidão",
        description:
          "Enviar requerimento ao cartório e registrar protocolo retornado.",
        weight: 25,
        ownerKey: "daniela_brait",
        slaDays: 3,
      },
      {
        ordem: 2,
        stepKey: "aguardar_retorno",
        title: "Aguardar retorno do cartório",
        description:
          "Aguardar resposta do cartório · follow-ups manuais e automáticos disponíveis.",
        weight: 10,
        ownerKey: "daniela_brait",
        slaDays: 15,
      },
      {
        ordem: 3,
        stepKey: "receber_certidao",
        title: "Receber certidão",
        description: "Upload do PDF da certidão recebida.",
        weight: 18,
        ownerKey: "daniela_brait",
        slaDays: 2,
      },
      {
        ordem: 4,
        stepKey: "conferir_certidao",
        title: "Conferir certidão",
        description:
          "Inspeção operacional: legibilidade, integridade, dados mínimos, apostila, tradução.",
        weight: 15,
        ownerKey: "daniela_brait",
        slaDays: 2,
      },
      {
        ordem: 5,
        stepKey: "validar_certidao",
        title: "Validar certidão",
        description: "Decisão jurídica final · marca documento como Recebido.",
        weight: 12,
        ownerKey: "marco_rovatti",
        slaDays: 1,
      },
    ],
  },

  // ── FASES AINDA NÃO ESPECIFICADAS ───────────────────────────────────────
  // Mantidas no catálogo (o enum exige todas as chaves), mas marcadas como
  // pendingSpec: o motor não cria workflow pra elas até detalharmos os steps
  // a partir do mockup + sistema real. Isso evita inventar etapas.

  ANALISE_DOCUMENTAL: {
    code: "ANALISE_DOCUMENTAL",
    label: "Análise Documental",
    next: null, // desvio condicional: Retificação OU Tradução (motor decide)
    steps: [],
    pendingSpec: true,
  },

  RETIFICACAO_REGISTROS: {
    code: "RETIFICACAO_REGISTROS",
    label: "Retificação de registros",
    next: "EMISSAO_DOCUMENTAL_RETIFICADA",
    steps: [],
    pendingSpec: true,
  },

  EMISSAO_DOCUMENTAL_RETIFICADA: {
    code: "EMISSAO_DOCUMENTAL_RETIFICADA",
    label: "Emissão documental retificada",
    next: "TRADUCAO_JURAMENTADA",
    steps: [],
    pendingSpec: true,
  },

  TRADUCAO_JURAMENTADA: {
    code: "TRADUCAO_JURAMENTADA",
    label: "Tradução juramentada",
    next: "APOSTILAMENTO",
    steps: [],
    pendingSpec: true,
  },

  APOSTILAMENTO: {
    code: "APOSTILAMENTO",
    label: "Apostilamento",
    next: "AGUARDANDO_PROTOCOLO",
    steps: [],
    pendingSpec: true,
  },

  AGUARDANDO_PROTOCOLO: {
    code: "AGUARDANDO_PROTOCOLO",
    label: "Aguardando protocolo",
    next: "PROTOCOLADO",
    steps: [],
    pendingSpec: true,
  },

  PROTOCOLADO: {
    code: "PROTOCOLADO",
    label: "Protocolado",
    next: "FINALIZADO",
    steps: [],
    pendingSpec: true,
  },

  FINALIZADO: {
    code: "FINALIZADO",
    label: "Finalizado",
    next: null, // terminal
    steps: [],
    pendingSpec: true,
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de leitura (usados pela rota POST e pelo motor da Etapa 3)
// ─────────────────────────────────────────────────────────────────────────────

/** Definição de uma fase pelo código. */
export function getFase(code: FaseCode): FaseDef {
  return FASES[code]
}

/** Os steps de uma fase (vazio se ainda não especificada). */
export function getStepsForFase(code: FaseCode): FaseStep[] {
  return FASES[code].steps
}

/** Próxima fase no fluxo linear (null se terminal/condicional). */
export function getNextFase(code: FaseCode): FaseCode | null {
  return FASES[code].next
}

/** True se a fase já tem etapas definidas (pronta pro motor criar workflow). */
export function isFaseReady(code: FaseCode): boolean {
  const f = FASES[code]
  return !f.pendingSpec && f.steps.length > 0
}