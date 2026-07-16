// src/lib/motor/phase-advance-helpers.ts
// CP-4F — helpers PUROS (sem prisma / sem alias @/) do Motor de Avanço de Fase.
// Chaves idempotentes determinísticas, mapeamento de resultado, política de
// exigência de justificativa e resolução da próxima/anterior fase pela ORDEM do
// Workflow Macro (nunca por label). Importável por scripts de teste (tsx).

export type AdvanceOperacao = "AVANCAR" | "FORCAR" | "REABRIR" | "RETORNAR"

// Espelha o enum Prisma AdvanceResultado (mantido em string para o helper ser puro).
export type AdvanceResultadoStr =
  | "BLOQUEADO"
  | "AVANCADO"
  | "FORCADO"
  | "REABERTO"
  | "RETORNADO"
  | "IDEMPOTENTE"
  | "CONFLITO"

export type AdvanceFailureCode =
  | "PROCESSO_NAO_ENCONTRADO"
  | "RUNTIME_V2_DESABILITADO"
  | "PROCESSO_LEGACY"
  | "SEM_TIPO_MOTOR"
  | "SEM_PROXIMA_FASE"
  | "FASE_ALVO_INVALIDA"
  | "FASE_ALVO_NAO_ANTERIOR"
  | "JUSTIFICATIVA_OBRIGATORIA"
  | "MOTIVO_OBRIGATORIO"
  | "BLOQUEADO"
  | "CONFLITO"
  | "INSTANCIACAO_FALHOU"

/** Resultado de sucesso esperado para cada operação (quando há mutação de fato). */
export function resultadoDaOperacao(op: AdvanceOperacao): Exclude<AdvanceResultadoStr, "BLOQUEADO" | "IDEMPOTENTE" | "CONFLITO"> {
  switch (op) {
    case "AVANCAR": return "AVANCADO"
    case "FORCAR": return "FORCADO"
    case "REABRIR": return "REABERTO"
    case "RETORNAR": return "RETORNADO"
  }
}

/** Força e reabertura/retorno exigem justificativa + código de motivo (spec §14/§19). */
export function exigeJustificativa(op: AdvanceOperacao): boolean {
  return op === "FORCAR" || op === "REABRIR" || op === "RETORNAR"
}

/**
 * Chave idempotente da tentativa de mudança de fase.
 * Deriva do ESTADO (lockVersion) para que:
 *  - cliques concorrentes idênticos (mesmo lockVersion) colidam no @unique e
 *    convirjam (P2002 → IDEMPOTENTE), sem duplo avanço;
 *  - após um avanço, o lockVersion muda e uma nova tentativa gera nova chave.
 * Nunca usa label como identidade.
 */
export function montarChaveAdvance(i: {
  processoId: number
  operacao: AdvanceOperacao
  faseAtual: string
  fasePretendida?: string | null
  lockVersion: number
  cicloAlvo?: number | null
}): string {
  return [
    "adv",
    `proc${i.processoId}`,
    `op${i.operacao}`,
    `de${i.faseAtual}`,
    `para${i.fasePretendida ?? i.faseAtual}`,
    `lv${i.lockVersion}`,
    `c${i.cicloAlvo ?? "-"}`,
  ].join("|")
}

/** Chave de auditoria de tentativa BLOQUEADA (uma por requisição/correlação). */
export function montarChaveAdvanceBloqueio(i: {
  processoId: number
  operacao: AdvanceOperacao
  faseAtual: string
  correlationId: string
}): string {
  return ["advblk", `proc${i.processoId}`, `op${i.operacao}`, `de${i.faseAtual}`, `corr${i.correlationId}`].join("|")
}

export interface FaseOrdenada {
  phaseKey: string
  ordem: number
}

/** Primeira fase pela ORDEM do Workflow Macro (menor ordem), nunca por label/nome.
 *  Regra estrutural de fase inicial usada na criação V2-nativa do processo. */
export function primeiraFasePorOrdem(fases: FaseOrdenada[]): string | null {
  if (fases.length === 0) return null
  return [...fases].sort((a, b) => a.ordem - b.ordem)[0].phaseKey
}

/** Próxima fase pela ORDEM do Workflow Macro (definição), não por label. */
export function proximaFasePorOrdem(fases: FaseOrdenada[], faseAtualKey: string): string | null {
  const ord = [...fases].sort((a, b) => a.ordem - b.ordem)
  const idx = ord.findIndex((f) => f.phaseKey === faseAtualKey)
  if (idx === -1 || idx + 1 >= ord.length) return null
  return ord[idx + 1].phaseKey
}

/** Índice de ordenação de uma fase (para validar retorno "para trás"). */
export function ordemDaFase(fases: FaseOrdenada[], phaseKey: string): number | null {
  const ord = [...fases].sort((a, b) => a.ordem - b.ordem)
  const idx = ord.findIndex((f) => f.phaseKey === phaseKey)
  return idx === -1 ? null : idx
}

/** Retorno controlado só é válido para uma fase ANTERIOR à atual na ordem macro. */
export function faseAlvoEhAnterior(fases: FaseOrdenada[], faseAtual: string, faseAlvo: string): boolean {
  const a = ordemDaFase(fases, faseAtual)
  const b = ordemDaFase(fases, faseAlvo)
  if (a == null || b == null) return false
  return b < a
}

// --------------------------------------------------------------------------
// Eventos canônicos de fase (phase.completed / phase.entered)
// --------------------------------------------------------------------------
// Fonte ÚNICA e confiável do evento de entrada em fase, para o financeiro (e
// demais efeitos) serem reconstruídos DEPOIS sobre um contrato estável.
// PUROS: recebem occurredAt já materializado (o motor injeta new Date()), então
// permanecem determinísticos e testáveis por tsx sem DB.
//
// A chaveIdempotencia deriva da chave da transição (@unique no DomainOutbox):
// reprocessar/retry/clique-duplo colidem no @unique → o evento é gravado UMA vez.

export type EventoCanonicoTipo = "phase.completed" | "phase.entered"

export interface EventoFasePayloadInput {
  processoId: number
  faseAnteriorKey: string
  faseAnteriorInstanceId: number | null
  faseNovaKey: string
  faseNovaInstanceId: number
  ciclo: number
  operacao: AdvanceOperacao
  origem: string
  solicitadoPorId?: number | null
  macroVersion?: number | null
  /** chave idempotente da transição (montarChaveAdvance) — âncora dos eventos. */
  chaveTransicao: string
  correlationId: string
  /** ISO string — injetado pelo motor (mantém o helper puro/determinístico). */
  occurredAt: string
  /** Override do motivo da transição no payload. Default = operacao. A criação
   *  V2-nativa usa "initial_phase" (nascimento do processo na 1ª fase). */
  transitionReason?: string
}

export interface EventoCanonico {
  tipo: EventoCanonicoTipo
  chaveIdempotencia: string
  eventId: string
  payload: Record<string, unknown>
}

/** phase.entered — SEMPRE emitido após uma transição bem-sucedida. */
export function montarEventoEntered(i: EventoFasePayloadInput): EventoCanonico {
  const eventId = `evt|entered|${i.chaveTransicao}`
  return {
    tipo: "phase.entered",
    chaveIdempotencia: `outbox|entered|${i.chaveTransicao}`,
    eventId,
    payload: {
      eventId,
      idempotencyKey: i.chaveTransicao,
      processId: i.processoId,
      previousPhaseId: i.faseAnteriorKey || null,
      previousPhaseInstanceId: i.faseAnteriorInstanceId,
      newPhaseId: i.faseNovaKey,
      newPhaseInstanceId: i.faseNovaInstanceId,
      newPhaseKey: i.faseNovaKey,
      workflowMacroVersionId: i.macroVersion ?? null,
      ciclo: i.ciclo,
      occurredAt: i.occurredAt,
      source: i.origem,
      requestedBy: i.solicitadoPorId ?? null,
      transitionReason: i.transitionReason ?? i.operacao,
      correlationId: i.correlationId,
    },
  }
}

/** phase.completed — emitido quando a fase de ORIGEM foi de fato CONCLUÍDA. */
export function montarEventoCompleted(i: EventoFasePayloadInput): EventoCanonico {
  const eventId = `evt|completed|${i.chaveTransicao}`
  return {
    tipo: "phase.completed",
    chaveIdempotencia: `outbox|completed|${i.chaveTransicao}`,
    eventId,
    payload: {
      eventId,
      idempotencyKey: i.chaveTransicao,
      processId: i.processoId,
      phaseId: i.faseAnteriorKey || null,
      phaseInstanceId: i.faseAnteriorInstanceId,
      newPhaseId: i.faseNovaKey,
      newPhaseKey: i.faseNovaKey,
      ciclo: i.ciclo,
      occurredAt: i.occurredAt,
      source: i.origem,
      requestedBy: i.solicitadoPorId ?? null,
      transitionReason: i.operacao,
      correlationId: i.correlationId,
    },
  }
}
