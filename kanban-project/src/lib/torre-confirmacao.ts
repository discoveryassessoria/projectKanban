// src/lib/torre-confirmacao.ts
// ============================================================================
// SUGESTÃO NUNCA ATRIBUI SOZINHA (06/10/2026). Toda atribuição que nasce de uma SUGESTÃO ("Precisa de você", "Distribuir", "Atribuir às
// sugeridas") passa por duas viagens: a 1ª devolve a PRÉVIA ("Atribuir X a Y?") com HTTP 428 e NADA é gravado; a 2ª só grava com
// `confirmado: true` + a `assinatura` da prévia (se a sugestão mudou no meio, o servidor recusa e mostra a nova). A tela abre o modal
// de confirmação; um clique solto nunca basta.
// ============================================================================
import { NextResponse } from 'next/server'

export interface PreviaDeConfirmacao {
  pergunta: string
  itens: Array<{ pessoa: string; quantidade: number; tarefas: string[] }>
  assinatura: string
  /** Texto de ALERTA (ex.: "2 tarefas já iniciadas — o andamento é preservado"). */
  alerta?: string
  /** `true` = há tarefa já iniciada: o modal exige uma 2ª confirmação (checkbox) e o cliente reenvia `confirmarAndamento: true`. */
  exigeConfirmacaoDeAndamento?: boolean
  /** `true` = o modal oferece um motivo OPCIONAL (reenviado como `motivo`). */
  pedeMotivo?: boolean
}

export const CODIGO_CONFIRMACAO = 'CONFIRMACAO_OBRIGATORIA'

/** O corpo da requisição confirmou? (`confirmado === true` e a assinatura da prévia que o usuário viu.) */
export function confirmacaoDoCorpo(b: unknown): { confirmado: boolean; assinatura: string | null } {
  const o = (b ?? {}) as Record<string, unknown>
  return { confirmado: o.confirmado === true, assinatura: typeof o.assinatura === 'string' ? o.assinatura : null }
}

/** 428: pede a confirmação mostrando a prévia. Nada foi gravado. */
export const pedirConfirmacao = (previa: PreviaDeConfirmacao): NextResponse =>
  NextResponse.json({ ok: false, code: CODIGO_CONFIRMACAO, erro: 'Confirme a atribuição antes de gravar.', confirmacao: previa }, { status: 428 })
