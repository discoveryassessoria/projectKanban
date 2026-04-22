// src/types/financeiro-context.ts
// Tipo do contexto compartilhado entre sub-abas.

import type {
  FaturaEnriquecida, ResumoFinanceiro, PessoaParaSelect
} from "./financeiro-v2"

export interface FinanceiroContext {
  processoId: number
  nomeFamilia: string
  pais: string
  etapaAtual: string
  faturas: FaturaEnriquecida[]
  pessoas: PessoaParaSelect[]
  pastaTotal: number
  pastaPago: number
  pastaDetalhes: Array<{
    pessoaId?: number
    pessoa: string
    servico: string
    registro: string
    valor: number
  }>
  contasPagar: Array<{
    id: number
    descricao: string
    fornecedor?: string
    valor: number
    valorPago: number | null
    dataVencimento: string
    status: string
  }>
  resumo: ResumoFinanceiro
  refresh: () => void
}