// lib/financeiro/payment-method-constants.ts
// ============================================================================
// Enums/rótulos da Forma de Pagamento — FONTE ÚNICA client-safe (sem Prisma).
// Importado tanto pelo PaymentMethodService (servidor) quanto pela UI (cliente)
// e pelos testes. Não colocar lógica de banco aqui.
// ============================================================================

export const TIPOS_FORMA = [
  'PIX', 'TRANSFERENCIA', 'BOLETO', 'CARTAO_CREDITO', 'CARTAO_DEBITO',
  'DINHEIRO', 'WISE', 'STRIPE', 'PAYPAL', 'GATEWAY', 'OUTRO',
] as const

export const TIPOS_FORMA_LABEL: Record<string, string> = {
  PIX: 'PIX', TRANSFERENCIA: 'Transferência bancária', BOLETO: 'Boleto',
  CARTAO_CREDITO: 'Cartão de crédito', CARTAO_DEBITO: 'Cartão de débito',
  DINHEIRO: 'Dinheiro', WISE: 'Wise', STRIPE: 'Stripe', PAYPAL: 'PayPal',
  GATEWAY: 'Gateway', OUTRO: 'Outro',
}

export const TIPOS_INTEGRACAO = ['NENHUMA', 'MANUAL', 'BANCO', 'GATEWAY', 'ADQUIRENTE', 'CARTEIRA'] as const
export const TIPOS_INTEGRACAO_LABEL: Record<string, string> = {
  NENHUMA: 'Nenhuma', MANUAL: 'Manual', BANCO: 'Banco', GATEWAY: 'Gateway',
  ADQUIRENTE: 'Adquirente', CARTEIRA: 'Carteira digital',
}

export const PRAZOS_LIQUIDACAO = ['IMEDIATO', 'D0', 'D1', 'D2', 'DN'] as const
export const PRAZOS_LIQUIDACAO_LABEL: Record<string, string> = {
  IMEDIATO: 'Imediato', D0: 'D+0', D1: 'D+1', D2: 'D+2', DN: 'D+N (personalizado)',
}

export const CATEGORIAS_FORMA = ['INSTANTANEO', 'BANCARIO', 'CARTAO', 'INTERNACIONAL', 'DINHEIRO', 'GATEWAY', 'OUTRO'] as const
export const CATEGORIAS_FORMA_LABEL: Record<string, string> = {
  INSTANTANEO: 'Instantâneo', BANCARIO: 'Bancário', CARTAO: 'Cartão',
  INTERNACIONAL: 'Internacional', DINHEIRO: 'Dinheiro', GATEWAY: 'Gateway', OUTRO: 'Outro',
}
