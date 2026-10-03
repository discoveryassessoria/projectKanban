// src/lib/coleta/conferencia-evento.ts
// ============================================================================
// Como UMA tela pede a conferência da coleta: a porta única de fase devolveu
// `CONFERENCIA_PENDENTE`; quem tentou mover o processo chama `pedirConferenciaColeta`,
// o host (montado uma vez no layout) abre a conferência e, concluída, executa
// `aoConcluir` — que repete a ação original. Nenhuma tela mantém cópia do modal.
// ============================================================================

export const EVENTO_CONFERENCIA_COLETA = "coleta:conferir"
export const CODIGO_CONFERENCIA_PENDENTE = "CONFERENCIA_PENDENTE"

export interface DetalheConferenciaColeta {
  processoId: number
  /** Repete a ação que foi barrada (mover/avançar). Roda só depois da conferência concluída. */
  aoConcluir?: () => void
}

export function pedirConferenciaColeta(processoId: number, aoConcluir?: () => void): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<DetalheConferenciaColeta>(EVENTO_CONFERENCIA_COLETA, { detail: { processoId, aoConcluir } }))
}
