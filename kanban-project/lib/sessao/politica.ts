// lib/sessao/politica.ts
// ============================================================================
// POLÍTICA DE SESSÃO — fonte única, pura, compartilhada por servidor e cliente.
//
// Duas janelas, independentes:
//
//   INATIVIDADE (15 min) — janela DESLIZANTE. Cada renovação emite um token
//   novo válido por mais 15 minutos. É o próprio `exp` do JWT que a carrega,
//   então a inatividade é enforced no SERVIDOR (o token simplesmente expira),
//   não apenas por um timer de tela que qualquer um contorna.
//
//   ABSOLUTA (8 h) — teto rígido contado do INÍCIO da sessão (`sessaoInicio`,
//   congelado no primeiro login e copiado em toda renovação). Nenhuma
//   atividade estende isso: às 8 h a sessão morre, com ou sem uso.
//
// O `exp` de cada token é sempre `min(agora + inatividade, inicio + absoluta)`.
// Perto do teto, o último token nasce mais curto — nunca ultrapassa o limite.
// ============================================================================

/** Minutos de inatividade tolerados antes do logout automático. */
export const INATIVIDADE_MS = 15 * 60 * 1000
/** Antecedência do aviso com contagem regressiva. */
export const AVISO_MS = 60 * 1000
/** Duração máxima absoluta da sessão, independente de atividade. */
export const ABSOLUTA_MS = 8 * 60 * 60 * 1000
/**
 * Só renova de fato quando resta menos que isto — evita emitir token (e linha
 * de auditoria) a cada respiro do usuário. Acima disso o servidor devolve o
 * token atual, e a chamada é um no-op barato.
 */
export const RENOVAR_QUANDO_RESTAR_MS = 10 * 60 * 1000

export type MotivoEncerramento =
  | 'manual'
  | 'inatividade'
  | 'expiracao_absoluta'
  | 'token_invalido'
  | 'outra_aba'

export const MOTIVO_LABEL: Record<MotivoEncerramento, string> = {
  manual: 'Saída manual',
  inatividade: 'Encerrada por inatividade',
  expiracao_absoluta: 'Duração máxima da sessão atingida',
  token_invalido: 'Credencial inválida ou expirada',
  outra_aba: 'Encerrada em outra aba',
}

/**
 * Expiração de um token emitido agora, respeitando as DUAS janelas.
 * Devolve ms epoch. Se a sessão já passou do teto absoluto, devolve `inicio +
 * ABSOLUTA_MS` (no passado) — quem chama trata como sessão morta.
 */
export function expiracaoDoToken(agoraMs: number, sessaoInicioMs: number): number {
  const porInatividade = agoraMs + INATIVIDADE_MS
  const porAbsoluta = sessaoInicioMs + ABSOLUTA_MS
  return Math.min(porInatividade, porAbsoluta)
}

/** A sessão já ultrapassou o teto absoluto? */
export function estourouAbsoluta(agoraMs: number, sessaoInicioMs: number): boolean {
  return agoraMs >= sessaoInicioMs + ABSOLUTA_MS
}

export interface EstadoSessao {
  /** ms até o logout automático (0 = já era). */
  restanteMs: number
  /** Deve exibir a contagem regressiva? */
  emAviso: boolean
  /** Já deve encerrar? */
  expirada: boolean
  /** Por que vai encerrar (quando aplicável). */
  motivo: MotivoEncerramento | null
}

/**
 * Estado da sessão a partir do que é OBSERVÁVEL: quando o token expira e
 * quando a sessão começou. Função pura — a tela só desenha o que sai daqui.
 */
export function avaliarSessao(agoraMs: number, tokenExpMs: number, sessaoInicioMs: number): EstadoSessao {
  const fimAbsoluto = sessaoInicioMs + ABSOLUTA_MS
  // Vence o que chegar primeiro: a inatividade (exp do token) ou o teto.
  const fim = Math.min(tokenExpMs, fimAbsoluto)
  const restanteMs = Math.max(0, fim - agoraMs)
  const motivo: MotivoEncerramento = fimAbsoluto <= tokenExpMs ? 'expiracao_absoluta' : 'inatividade'
  return {
    restanteMs,
    expirada: restanteMs <= 0,
    emAviso: restanteMs > 0 && restanteMs <= AVISO_MS,
    motivo: restanteMs <= AVISO_MS ? motivo : null,
  }
}

/** Vale a pena pedir renovação agora? (evita chamada a cada clique) */
export function devoRenovar(agoraMs: number, tokenExpMs: number, sessaoInicioMs: number): boolean {
  if (estourouAbsoluta(agoraMs, sessaoInicioMs)) return false
  return tokenExpMs - agoraMs <= RENOVAR_QUANDO_RESTAR_MS
}

/** mm:ss para a contagem regressiva. */
export function formatarContagem(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
