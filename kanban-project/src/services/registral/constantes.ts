// src/services/registral/constantes.ts
//
// MRG — versões e limites do motor registral.
//
// A VERSÃO entra na chave de idempotência do lote e em cada evidência: subir a
// versão é o que permite reprocessar a mesma pasta com um extrator melhor SEM
// apagar o que a versão anterior concluiu. Duas evidências do mesmo campo com
// versões diferentes coexistem — é isso que dá histórico ao dossiê.

export const VERSAO_MOTOR = "1.0.0"

/** Tentativas antes de a execução ir para FALHA_LEITURA definitiva. */
export const MAX_TENTATIVAS_EXECUCAO = 5

/** Backoff exponencial (ms) por tentativa: 30s, 1min, 4min, 16min, 64min. */
export function backoffMs(tentativa: number): number {
  const base = 30_000
  return base * Math.pow(4, Math.max(0, tentativa - 1))
}

/** Reserva "presa" há mais que isto volta a ser reivindicável (worker morto). */
export const CLAIM_STALE_MS = 5 * 60 * 1000

/** Documentos processados por chamada do worker (mantém a função dentro do limite). */
export const LOTE_PADRAO_POR_CICLO = 10

/** Teto de candidatos do Cadastro Mestre avaliados por ocorrência. */
export const TETO_CANDIDATOS_IDENTIDADE = 200

/** Teto de pessoas carregadas para o cálculo de impacto de uma árvore. */
export const TETO_PESSOAS_IMPACTO = 8000

/** Tipos de evento canônicos que o motor publica na DomainOutbox. */
export const EVENTOS = {
  LOTE_CRIADO: "registral.lote.criado",
  DOCUMENTO_PRONTO: "registral.documento.pronto",
  LOTE_CONCLUIDO: "registral.lote.concluido",
  PROPOSTA_APLICADA: "registral.proposta.aplicada",
  PROPOSTA_REVERTIDA: "registral.proposta.revertida",
  RECONCILIAR_PROCESSO: "registral.reconciliar.processo",
} as const

/** Ações de auditoria (LogAuditoria.acao) — vocabulário fechado. */
export const ACOES_AUDITORIA = {
  LOTE_CRIADO: "registral_lote_criado",
  EXECUCAO_ETAPA: "registral_execucao_etapa",
  EXECUCAO_FALHA: "registral_execucao_falha",
  FATO_AFIRMADO: "registral_fato_afirmado",
  FATO_SUPERSEDIDO: "registral_fato_supersedido",
  EVIDENCIA_REGISTRADA: "registral_evidencia_registrada",
  CONFLITO_ABERTO: "registral_conflito_aberto",
  CONFLITO_RESOLVIDO: "registral_conflito_resolvido",
  PROPOSTA_CRIADA: "registral_proposta_criada",
  PROPOSTA_APROVADA: "registral_proposta_aprovada",
  PROPOSTA_REJEITADA: "registral_proposta_rejeitada",
  PROPOSTA_ADIADA: "registral_proposta_adiada",
  PROPOSTA_APLICADA: "registral_proposta_aplicada",
  PROPOSTA_ABORTADA: "registral_proposta_abortada",
  PROPOSTA_REVERTIDA: "registral_proposta_revertida",
  VERSAO_CRIADA: "registral_versao_criada",
  RECONCILIACAO_DOCUMENTAL: "registral_reconciliacao_documental",
  LINHAGEM_RECALCULADA: "registral_linhagem_recalculada",
} as const
