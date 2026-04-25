// src/types/outros-custos.ts
//
// 🆕 LOTE 5: Tipos TypeScript para OutrosCustos.
//
// Estes tipos espelham o schema do Prisma e são usados pelo front-end
// (cards, modais, agrupamentos) sem precisar importar o Prisma Client direto
// nos componentes (mais leve no bundle).

// ============================================================================
// Enums (espelham Prisma)
// ============================================================================

export type NaturezaOutroCusto = 'COBRAR' | 'REPASSAR'

export type Moeda = 'BRL' | 'EUR' | 'USD'

export type FormaPagamento =
  | 'PIX'
  | 'CARTAO_CREDITO'
  | 'CARTAO_DEBITO'
  | 'BOLETO'
  | 'TRANSFERENCIA'
  | 'DINHEIRO'
  | 'CHEQUE'
  | 'OUTRO'

export type PagadorTipo = 'REQUERENTE' | 'CONTRATANTE' | 'OUTRO'

// ============================================================================
// OutroCusto + PagamentoOutroCusto
// ============================================================================

// Pagamentos parciais que compõem um OutroCusto
export interface PagamentoOutroCustoData {
  id: number
  outroCustoId: number
  valor: number | string // Prisma Decimal serializa como string às vezes
  data: string // ISO
  forma: FormaPagamento | null
  pagadorTipo: PagadorTipo | null
  pagadorId: number | null
  pagadorNome: string | null
  comprovanteUrl: string | null
  comprovanteNome: string | null
  observacao: string | null
  estornado: boolean
  estornadoEm: string | null
  estornoMotivo: string | null
  createdAt: string
}

// Lançamento de OutroCusto
export interface OutroCustoData {
  id: number
  processoId: number
  natureza: NaturezaOutroCusto
  tipo: string
  descricao: string
  fornecedor: string | null
  valor: number | string
  moeda: Moeda
  cambio: number | string | null
  vencimento: string | null
  interno: boolean
  repassado: boolean
  pago: boolean
  observacao: string | null
  createdAt: string
  updatedAt: string
  pagamentos?: PagamentoOutroCustoData[]
}

// ============================================================================
// Totais (resposta do GET /api/processos/:id/outros-custos)
// ============================================================================

export interface TotaisOutrosCustos {
  totalCobrarBRL: number
  totalRecebidoBRL: number
  totalARecebidoBRL: number
  totalRepassarBRL: number
  totalPagoBRL: number
  totalAPagarBRL: number
  totalInternoBRL: number
  totalRepassadoBRL: number
  contagem: number
}

export interface ResponseListarOutrosCustos {
  outrosCustos: OutroCustoData[]
  totais: TotaisOutrosCustos
}

// ============================================================================
// Form data (criar/editar OutroCusto)
// ============================================================================

export interface OutroCustoFormData {
  natureza: NaturezaOutroCusto
  tipo: string
  descricao: string
  fornecedor?: string
  valor: number
  moeda: Moeda
  cambio?: number
  vencimento?: string // YYYY-MM-DD
  interno: boolean
  repassado: boolean
  pago: boolean
  observacao?: string
}

// Form data (criar pagamento)
export interface PagamentoFormData {
  valor: number
  data?: string // YYYY-MM-DD
  forma?: FormaPagamento
  pagadorTipo?: PagadorTipo
  pagadorId?: number
  pagadorNome?: string
  comprovanteUrl?: string
  comprovanteNome?: string
  observacao?: string
}

// ============================================================================
// Tipos pré-definidos no mockup do Marco
// ============================================================================

// Tipos comuns pra REPASSAR (despesas a terceiros)
export const TIPOS_REPASSAR = [
  'Advogado',
  'Cartório',
  'Consulado',
  'Taxas Consulares',
  'Tribunal',
  'Comune',
  'Tradução Extra',
  'Apostilamento Extra',
  'Retificação',
  'Deslocamento',
  'Outros',
] as const

// Tipos comuns pra COBRAR (receitas)
export const TIPOS_COBRAR = [
  'Honorários Discovery',
  'Serviço Extra',
  'Consultoria',
  'Outros',
] as const

export type TipoRepassar = (typeof TIPOS_REPASSAR)[number]
export type TipoCobrar = (typeof TIPOS_COBRAR)[number]

// ============================================================================
// Labels amigáveis
// ============================================================================

export const LABEL_FORMA_PAGAMENTO: Record<FormaPagamento, string> = {
  PIX: 'PIX',
  CARTAO_CREDITO: 'Cartão de Crédito',
  CARTAO_DEBITO: 'Cartão de Débito',
  BOLETO: 'Boleto',
  TRANSFERENCIA: 'Transferência',
  DINHEIRO: 'Dinheiro',
  CHEQUE: 'Cheque',
  OUTRO: 'Outro',
}

export const LABEL_NATUREZA: Record<NaturezaOutroCusto, string> = {
  COBRAR: 'Cobrar do cliente',
  REPASSAR: 'Repassar a terceiro',
}

export const LABEL_MOEDA: Record<Moeda, string> = {
  BRL: 'Real (R$)',
  EUR: 'Euro (€)',
  USD: 'Dólar (US$)',
}

export const SIMBOLO_MOEDA: Record<Moeda, string> = {
  BRL: 'R$',
  EUR: '€',
  USD: 'US$',
}