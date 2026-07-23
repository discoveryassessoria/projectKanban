// lib/financeiro/dominio/eventos.ts
// ============================================================================
// Domain Events do Motor Financeiro V3. Todo efeito financeiro NASCE de um
// evento de domínio (§0.3), publicado via Outbox (DomainOutbox). PURO.
// ============================================================================

export type TipoEventoFinanceiro =
  | 'financeiro.obrigacao.criada'
  | 'financeiro.ocorrencia.processada'
  | 'financeiro.obrigacao.liquidada'

export interface EventoObrigacaoCriada {
  tipo: 'financeiro.obrigacao.criada'
  obrigacaoId: number
  codigoOperacional: string | null
  natureza: string
  valorContratado: number
}

export interface EventoOcorrenciaProcessada {
  tipo: 'financeiro.ocorrencia.processada'
  obrigacaoId: number
  ocorrenciaId: number
  ocorrenciaTipo: string
}

export type EventoFinanceiroDominio = EventoObrigacaoCriada | EventoOcorrenciaProcessada

/** Chave de idempotência estável de um evento (dedup no Outbox). */
export function chaveEvento(tipo: string, aggregateId: number, discriminador?: string | number): string {
  return `${tipo}:${aggregateId}${discriminador != null ? `:${discriminador}` : ''}`
}
