// lib/financeiro/taxa-constants.ts
// ============================================================================
// Enums/rótulos da Taxa de Pagamento — FONTE ÚNICA client-safe (sem Prisma).
// Interface inicial ENXUTA (diretriz do usuário): sem "faixa progressiva" nem
// "tabela externa" — só o que o escritório usa. A estrutura evolui se surgir caso real.
// ============================================================================

// Tipos de cálculo REAIS (os únicos oferecidos na UI). Valores legados
// (installment_based/custom) continuam válidos no banco mas não são ofertados.
export const FEE_TYPES = ['percentage', 'fixed', 'percentage_plus_fixed'] as const
export const FEE_TYPES_LABEL: Record<string, string> = {
  percentage: 'Percentual', fixed: 'Valor fixo', percentage_plus_fixed: 'Percentual + valor fixo',
  installment_based: 'Por parcela (legado)', custom: 'Personalizado (legado)',
}
/** Tipos que exibem moeda (dependem dela). Percentual independe de moeda. */
export const FEE_TYPES_COM_MOEDA = ['fixed', 'percentage_plus_fixed']

export const CATEGORIAS_TAXA = ['TAXA_CARTAO', 'TARIFA_BANCARIA', 'GATEWAY', 'ANTECIPACAO', 'IOF', 'SPREAD_CAMBIAL', 'OUTRO'] as const
export const CATEGORIAS_TAXA_LABEL: Record<string, string> = {
  TAXA_CARTAO: 'Taxa de cartão', TARIFA_BANCARIA: 'Tarifa bancária', GATEWAY: 'Gateway',
  ANTECIPACAO: 'Antecipação', IOF: 'IOF', SPREAD_CAMBIAL: 'Spread cambial', OUTRO: 'Outro',
}

export const APLICA_PARCELA = ['TODAS', 'ENTRADA', 'PRIMEIRA', 'ULTIMA', 'FAIXA'] as const
export const APLICA_PARCELA_LABEL: Record<string, string> = {
  TODAS: 'Todas as parcelas', ENTRADA: 'Somente entrada', PRIMEIRA: 'Primeira parcela',
  ULTIMA: 'Última parcela', FAIXA: 'Faixa de parcelas',
}

export const ANTICIPATION_TYPES = ['NAO_POSSUI', 'OPCIONAL', 'OBRIGATORIA'] as const
export const ANTICIPATION_TYPES_LABEL: Record<string, string> = {
  NAO_POSSUI: 'Não possui', OPCIONAL: 'Opcional', OBRIGATORIA: 'Obrigatória',
}

export const BASE_INCIDENCIA = ['TOTAL', 'PARCELA', 'SALDO', 'ENTRADA', 'LIQUIDO', 'BRUTO'] as const
export const BASE_INCIDENCIA_LABEL: Record<string, string> = {
  TOTAL: 'Sobre o total', PARCELA: 'Sobre cada parcela', SALDO: 'Sobre o saldo',
  ENTRADA: 'Sobre a entrada', LIQUIDO: 'Sobre o valor líquido', BRUTO: 'Sobre o valor bruto',
}

export const QUEM_ABSORVE = ['EMPRESA', 'CLIENTE', 'COMPARTILHADA', 'COBRANCA'] as const
export const QUEM_ABSORVE_LABEL: Record<string, string> = {
  EMPRESA: 'Empresa absorve integralmente', CLIENTE: 'Cliente paga integralmente',
  COMPARTILHADA: 'Compartilhada', COBRANCA: 'Configurável na Cobrança',
}

export const ADQUIRENTES = ['STONE', 'CIELO', 'REDE', 'PAGSEGURO', 'STRIPE', 'WISE', 'OUTRO'] as const
export const ADQUIRENTES_LABEL: Record<string, string> = {
  STONE: 'Stone', CIELO: 'Cielo', REDE: 'Rede', PAGSEGURO: 'PagSeguro',
  STRIPE: 'Stripe', WISE: 'Wise', OUTRO: 'Outro',
}

export const MOMENTO_CAMBIO = ['ANTES_CONVERSAO', 'APOS_CONVERSAO', 'MOEDA_CONTRATUAL', 'MOEDA_LIQUIDACAO'] as const
export const MOMENTO_CAMBIO_LABEL: Record<string, string> = {
  ANTES_CONVERSAO: 'Calculada antes da conversão', APOS_CONVERSAO: 'Calculada após a conversão',
  MOEDA_CONTRATUAL: 'Moeda contratual', MOEDA_LIQUIDACAO: 'Moeda de liquidação',
}
