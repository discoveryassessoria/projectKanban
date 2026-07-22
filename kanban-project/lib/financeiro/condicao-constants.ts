// lib/financeiro/condicao-constants.ts
// ============================================================================
// Enums/rótulos da Condição de Pagamento — FONTE ÚNICA client-safe (sem Prisma).
// A Condição é REGRA REUTILIZÁVEL: só sugere/parametriza; nunca congela.
// ============================================================================

export const POLITICAS_TAXAS = ['IGNORAR', 'REPASSAR', 'ABSORVER', 'ESCOLHER_NA_COBRANCA'] as const
export const POLITICAS_TAXAS_LABEL: Record<string, string> = {
  IGNORAR: 'Ignorar taxas', REPASSAR: 'Repassar ao cliente', ABSORVER: 'Absorver pela empresa',
  ESCOLHER_NA_COBRANCA: 'Permitir escolha na Cobrança',
}

// Câmbio: só as opções NOVAS (sugestão). Valores legados seguem válidos no banco.
export const POLITICAS_CAMBIO = ['PADRAO_SISTEMA', 'SUGERIR_VARIAVEL', 'SUGERIR_TRAVA'] as const
export const POLITICAS_CAMBIO_LABEL: Record<string, string> = {
  PADRAO_SISTEMA: 'Utilizar política padrão do sistema', SUGERIR_VARIAVEL: 'Sugerir câmbio variável',
  SUGERIR_TRAVA: 'Sugerir trava cambial',
}

// aplicaA: rótulos de contas (a semântica de banco continua RECEITA|CUSTO|AMBOS).
export const APLICA_A = ['RECEITA', 'CUSTO', 'AMBOS'] as const
export const APLICA_A_LABEL: Record<string, string> = {
  RECEITA: 'Contas a Receber', CUSTO: 'Contas a Pagar', AMBOS: 'Ambos',
}

export const TIPOS_PAGAMENTO = ['AVISTA', 'PARCELADO'] as const
export const TIPOS_PAGAMENTO_LABEL: Record<string, string> = { AVISTA: 'À vista', PARCELADO: 'Parcelado' }

export const PERIODICIDADES = ['SEMANAL', 'QUINZENAL', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADA'] as const
export const PERIODICIDADES_LABEL: Record<string, string> = {
  SEMANAL: 'Semanal', QUINZENAL: 'Quinzenal', MENSAL: 'Mensal', BIMESTRAL: 'Bimestral',
  TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual', PERSONALIZADA: 'Personalizada (dias)',
}

export const INICIOS = ['IMEDIATA', 'DIAS', 'DATA_ESPECIFICA'] as const
export const INICIOS_LABEL: Record<string, string> = { IMEDIATA: 'Imediata', DIAS: 'Após N dias', DATA_ESPECIFICA: 'Data específica' }

export const DISTRIBUICOES = ['IGUAIS', 'ULTIMA_AJUSTA', 'PRIMEIRA_MAIOR', 'ULTIMA_MAIOR', 'ENTRADA_FIXA', 'ENTRADA_PERCENTUAL', 'PERSONALIZADO'] as const
export const DISTRIBUICOES_LABEL: Record<string, string> = {
  IGUAIS: 'Parcelas iguais', ULTIMA_AJUSTA: 'Última ajusta centavos', PRIMEIRA_MAIOR: 'Primeira maior',
  ULTIMA_MAIOR: 'Última maior', ENTRADA_FIXA: 'Entrada fixa', ENTRADA_PERCENTUAL: 'Entrada percentual', PERSONALIZADO: 'Cronograma personalizado',
}

export const ENTRADA_TIPOS = ['PERCENTUAL', 'VALOR_FIXO'] as const
export const ENTRADA_TIPOS_LABEL: Record<string, string> = { PERCENTUAL: 'Percentual', VALOR_FIXO: 'Valor fixo' }

export const DIA_INEXISTENTE = ['ULTIMO_DIA', 'PROX_UTIL', 'ANT_UTIL'] as const
export const DIA_INEXISTENTE_LABEL: Record<string, string> = { ULTIMO_DIA: 'Último dia do mês', PROX_UTIL: 'Primeiro dia útil seguinte', ANT_UTIL: 'Primeiro dia útil anterior' }

export const AJUSTE_DATA = ['MANTER', 'PROX_UTIL', 'ANT_UTIL'] as const
export const AJUSTE_DATA_LABEL: Record<string, string> = { MANTER: 'Manter', PROX_UTIL: 'Próximo dia útil', ANT_UTIL: 'Dia útil anterior' }

export const MULTA_TIPOS = ['FIXA', 'PERCENTUAL'] as const
export const JUROS_TIPOS = ['SIMPLES', 'COMPOSTO'] as const
export const JUROS_PERIODOS = ['DIARIO', 'MENSAL'] as const
export const DESCONTO_TIPOS = ['COMERCIAL', 'ANTECIPACAO'] as const
