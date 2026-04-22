// src/types/financeiro-v2.ts
// Types usados pelos novos componentes de sub-abas.

export type MoedaV2 = "BRL" | "EUR" | "USD"

export type StatusFaturaCalc = "PENDENTE" | "PARCIAL" | "PAGO" | "VENCIDO"

export interface FaturaEnriquecida {
  id: number
  processoId: number
  descricao: string
  moeda: MoedaV2
  valor: number
  valorOriginal: number | null
  cambio: number | null
  metodoPagamento: string | null
  parcelas: number
  valorParcela: number | null
  dataEmissao: string
  dataVencimento: string | null
  observacoes: string | null
  status: StatusFaturaCalc

  valorPago: number
  valorRestante: number
  valorTotalBRL: number
  valorPagoBRL: number
  valorRestanteBRL: number

  pagamentos: PagamentoFaturaEnriquecido[]
  destinatarios: Array<{
    id: number
    nome: string
    cpf: string | null
    endereco: string | null
    numero: string | null
    complemento: string | null
    bairro: string | null
    cidade: string | null
    estado: string | null
    cep: string | null
  }>
  parcelasBoleto: Array<{
    id: number
    numero: number
    valor: number
    dataVencimento: string
    pago: boolean
    dataPagamento: string | null
  }>
}

export interface PagamentoFaturaEnriquecido {
  id: number
  faturaId: number
  valor: number
  valorOriginal: number | null
  cambio: number | null
  data: string
  formaPagamento: string | null
  comprovanteUrl: string | null
  comprovanteNome: string | null
  observacao: string | null
  estornado?: boolean
  estornadoEm?: string | null
  destinatarios: Array<{ id: number; nome: string }>
  createdAt: string
}

export interface Recibo {
  id: number
  processoId: number
  numero: string
  data: string
  valorTotal: number
  descricao: string
  pagadorRequerenteId: number | null
  pagadorContratanteId: number | null
  pagadorNome: string | null
  pagadorRequerente?: { id: number; nome: string } | null
  pagadorContratante?: { id: number; nome: string } | null
  pdfUrl: string | null
  pdfNome: string | null
  emitidoPor?: { id: number; nome: string } | null
  createdAt: string
}

export interface ResumoFinanceiro {
  totalCobrado: number
  recebido: number
  aReceber: number
  vencido: number
  numFaturas: number
  pendentesCount: number
  vencidasCount: number
  pctRecebido: number
  custo: number
  custoPago: number
  custoPendente: number
  pctPago: number
  lucro: number
  margem: number
}

export interface ProcessoContext {
  nome: string
  pais: string
  etapaAtual: string
  requerentes: string[]
}

export interface PessoaParaSelect {
  id: number
  nome: string
  tipo: "REQUERENTE" | "CONTRATANTE"
  endereco?: string | null
  numero?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
  pais?: string | null
}