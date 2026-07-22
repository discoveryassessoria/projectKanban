// lib/financeiro/adquirente-constants.ts
// ============================================================================
// Cadastro-semente de Adquirentes/Gateways e Bandeiras — FONTE ÚNICA client-safe
// (sem Prisma). Usado pelo seed idempotente, pela API e pela UI. Extensível:
// novas adquirentes/bandeiras entram aqui (ou via cadastro na tela).
// A entidade definitiva vive no banco (model Adquirente / Bandeira); esta lista
// é só o conjunto inicial + rótulos.
// ============================================================================

export interface AdquirenteSeed {
  slug: string
  nome: string
  /** Formas (tipo do enum) que a adquirente suporta operacionalmente. */
  formas: string[]
}

// Cielo, Rede, Stone, Getnet, Mercado Pago, PagBank (as reais do escritório).
export const ADQUIRENTES_SEED: AdquirenteSeed[] = [
  { slug: 'CIELO', nome: 'Cielo', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO'] },
  { slug: 'REDE', nome: 'Rede', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO'] },
  { slug: 'STONE', nome: 'Stone', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX'] },
  { slug: 'GETNET', nome: 'Getnet', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO'] },
  { slug: 'MERCADO_PAGO', nome: 'Mercado Pago', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX', 'BOLETO'] },
  { slug: 'PAGBANK', nome: 'PagBank', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX', 'BOLETO'] },
]

export interface BandeiraSeed {
  slug: string
  nome: string
  /** Slugs de adquirentes compatíveis; vazio = todas. */
  adquirentes: string[]
}

// Visa, Mastercard, Elo, American Express, Hipercard.
export const BANDEIRAS_SEED: BandeiraSeed[] = [
  { slug: 'VISA', nome: 'Visa', adquirentes: [] },
  { slug: 'MASTERCARD', nome: 'Mastercard', adquirentes: [] },
  { slug: 'ELO', nome: 'Elo', adquirentes: [] },
  { slug: 'AMEX', nome: 'American Express', adquirentes: [] },
  { slug: 'HIPERCARD', nome: 'Hipercard', adquirentes: [] },
]

export const ADQUIRENTE_LABEL: Record<string, string> = Object.fromEntries(ADQUIRENTES_SEED.map((a) => [a.slug, a.nome]))
export const BANDEIRA_LABEL: Record<string, string> = Object.fromEntries(BANDEIRAS_SEED.map((b) => [b.slug, b.nome]))
